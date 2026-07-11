/**
 * D1 数据库 Schema 定义、初始化与版本化迁移
 *
 * 结构分两层：
 * 1. SCHEMA_SQL —— v0 冻结基线。【不变量】今后任何表结构变更都不得再编辑 SCHEMA_SQL，
 *    只能向 MIGRATIONS 追加新条目；全新安装同样先建 v0 基线、再顺序回放全部迁移，
 *    以保证「settings 表缺 schema_version 键 = v0」的语义单一，消除新装/存量歧义。
 * 2. MIGRATIONS —— 版本化迁移表。version 必须从 1 起连续递增，statements 为单行 SQL 字符串数组。
 *    每个迁移的语句与版本号写入在同一个 db.batch 中原子应用；多 isolate 并发冷启动竞争时，
 *    败者 batch 整体回滚抛错后重读版本号，若已被他方推进到目标版本则视为已应用并继续，
 *    否则原样抛出。
 *
 * 版本号持久化于 settings 表（key 'schema_version'，字符串存储），缺失或非法值视为 0。
 * 回滚策略：迁移只向前，回滚 = 重新部署旧版 Worker 代码（repository 全部显式列名读写，多余列无害）。
 *
 * 注意：所有 SQL 语句均写成单行形式。历史上 initDB 曾用 db.exec() 逐条执行，
 * 而 D1 的 db.exec() 无法正确处理多行 SQL（换行符会导致 SQLITE_ERROR incomplete input），
 * 参考 https://github.com/cloudflare/workers-sdk/issues/9133
 *       https://github.com/cloudflare/workers-sdk/issues/9479
 * 现均经 db.batch(prepare) 提交以降低冷启动首请求延迟，单行书写约定保留。
 */

// v0 冻结基线：只允许追加 MIGRATIONS，禁止再修改此处的表结构
const SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  "CREATE TABLE IF NOT EXISTS vn_entries (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), title TEXT NOT NULL DEFAULT '', title_ja TEXT NOT NULL DEFAULT '', title_cn TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', image_nsfw INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0, length_text TEXT NOT NULL DEFAULT '', length_minutes INTEGER NOT NULL DEFAULT 0, developers TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', all_age INTEGER NOT NULL DEFAULT 0, title_cn_user TEXT NOT NULL DEFAULT '', personal_rating REAL NOT NULL DEFAULT 0, play_time TEXT NOT NULL DEFAULT '', play_time_hours INTEGER NOT NULL DEFAULT 0, play_time_part_minutes INTEGER NOT NULL DEFAULT 0, play_time_minutes INTEGER NOT NULL DEFAULT 0, review TEXT NOT NULL DEFAULT '', start_date TEXT, finish_date TEXT, user_tags TEXT NOT NULL DEFAULT '[]', tier_id TEXT, tier_sort INTEGER NOT NULL DEFAULT 0);",
  "CREATE TABLE IF NOT EXISTS tiers (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#666666', sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE TABLE IF NOT EXISTS index_tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'starting', total INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT, error TEXT, failed_ids TEXT NOT NULL DEFAULT '[]', last_reconciled_at TEXT);",
  "CREATE TABLE IF NOT EXISTS index_task_items (task_id TEXT NOT NULL, vndb_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'success', retry_count INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (task_id, vndb_id));",
  'CREATE INDEX IF NOT EXISTS idx_vn_entries_tier ON vn_entries(tier_id);',
  'CREATE INDEX IF NOT EXISTS idx_vn_entries_updated ON vn_entries(updated_at);',
  'CREATE INDEX IF NOT EXISTS idx_index_tasks_status ON index_tasks(status);',
  'CREATE INDEX IF NOT EXISTS idx_index_task_items_task ON index_task_items(task_id);'
];

export const SCHEMA_VERSION_KEY = 'schema_version';

// 版本化迁移表：version 从 1 起连续递增，statements 为单行 SQL 字符串数组
export const MIGRATIONS = [
  // v1（07-11-entry-status-field）：条目游玩状态列。可空、无默认值，NULL = 未设置；
  // 合法值白名单见 src/repository.js VN_STATUS_VALUES。列表全量加载后前端筛选，不建索引。
  { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] }
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

export async function readSchemaVersion(db) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(SCHEMA_VERSION_KEY).first();
  if (!row || row.value === undefined || row.value === null) {
    return 0;
  }
  const version = Number.parseInt(row.value, 10);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function sortAndValidateMigrations(migrations) {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((migration, index) => {
    const expected = index + 1;
    if (!Number.isInteger(migration.version) || migration.version !== expected) {
      throw new Error(`MIGRATIONS 版本号必须从 1 起连续递增：期望 ${expected}，实际 ${migration.version}`);
    }
  });
  return sorted;
}

export async function applyPendingMigrations(db, migrations, currentVersion) {
  const sorted = sortAndValidateMigrations(migrations);
  let version = currentVersion;

  for (const migration of sorted) {
    if (migration.version <= version) {
      continue;
    }

    try {
      // 迁移语句与版本号写入同批提交，保证单迁移原子性
      await db.batch([
        ...migration.statements.map(sql => db.prepare(sql)),
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(SCHEMA_VERSION_KEY, String(migration.version))
      ]);
      version = migration.version;
    } catch (error) {
      // 并发竞争容忍：batch 整体回滚后重读版本号，若已被他方推进则视为已应用
      let latest;
      try {
        latest = await readSchemaVersion(db);
      } catch {
        // 重读失败时保留原始迁移错误，避免真实失败原因被读错误覆盖
        throw error;
      }
      if (latest >= migration.version) {
        version = latest;
        continue;
      }
      throw error;
    }
  }

  return version;
}

let initializedDatabases = new WeakSet();
let initializingDatabases = new WeakMap();

export async function initDB(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('D1 database binding is required');
  }

  if (initializedDatabases.has(db)) {
    return;
  }

  const pendingInitialization = initializingDatabases.get(db);
  if (pendingInitialization) {
    await pendingInitialization;
    return;
  }

  const initializationPromise = (async () => {
    await db.batch(SCHEMA_SQL.map(sql => db.prepare(sql)));
    const currentVersion = await readSchemaVersion(db);
    if (currentVersion < LATEST_SCHEMA_VERSION) {
      await applyPendingMigrations(db, MIGRATIONS, currentVersion);
    }
    initializedDatabases.add(db);
  })().finally(() => {
    initializingDatabases.delete(db);
  });

  initializingDatabases.set(db, initializationPromise);
  await initializationPromise;
}

export function resetDBInitFlag() {
  initializedDatabases = new WeakSet();
  initializingDatabases = new WeakMap();
}

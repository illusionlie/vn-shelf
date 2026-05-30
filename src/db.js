/**
 * D1 数据库 Schema 定义与初始化
 *
 * 当前使用 CREATE TABLE IF NOT EXISTS，仅适用于首次建表，不支持增量迁移（ALTER TABLE）。
 * 若未来需要加列或改列，需引入版本化迁移机制（如 schema_version 设置项 + ALTER 语句）。
 */

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS vn_entries (
  id                    TEXT PRIMARY KEY,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  title                 TEXT NOT NULL DEFAULT '',
  title_ja              TEXT NOT NULL DEFAULT '',
  title_cn              TEXT NOT NULL DEFAULT '',
  image                 TEXT NOT NULL DEFAULT '',
  image_nsfw            INTEGER NOT NULL DEFAULT 0,
  rating                REAL NOT NULL DEFAULT 0,
  length_text           TEXT NOT NULL DEFAULT '',
  length_minutes        INTEGER NOT NULL DEFAULT 0,
  developers            TEXT NOT NULL DEFAULT '[]',
  tags                  TEXT NOT NULL DEFAULT '[]',
  all_age               INTEGER NOT NULL DEFAULT 0,
  title_cn_user         TEXT NOT NULL DEFAULT '',
  personal_rating       REAL NOT NULL DEFAULT 0,
  play_time             TEXT NOT NULL DEFAULT '',
  play_time_hours       INTEGER NOT NULL DEFAULT 0,
  play_time_part_minutes INTEGER NOT NULL DEFAULT 0,
  play_time_minutes     INTEGER NOT NULL DEFAULT 0,
  review                TEXT NOT NULL DEFAULT '',
  start_date            TEXT,
  finish_date           TEXT,
  user_tags             TEXT NOT NULL DEFAULT '[]',
  tier_id               TEXT,
  tier_sort             INTEGER NOT NULL DEFAULT 0
);`,
  `CREATE TABLE IF NOT EXISTS tiers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#666666',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`,
  `CREATE TABLE IF NOT EXISTS index_tasks (
  id                  TEXT PRIMARY KEY,
  status              TEXT NOT NULL DEFAULT 'starting',
  total               INTEGER NOT NULL DEFAULT 0,
  processed           INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT,
  completed_at        TEXT,
  error               TEXT,
  failed_ids          TEXT NOT NULL DEFAULT '[]',
  last_reconciled_at  TEXT
);`,
  `CREATE TABLE IF NOT EXISTS index_task_items (
  task_id     TEXT NOT NULL,
  vndb_id     TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'success',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, vndb_id)
);`,
  `CREATE INDEX IF NOT EXISTS idx_vn_entries_tier ON vn_entries(tier_id);`,
  `CREATE INDEX IF NOT EXISTS idx_vn_entries_updated ON vn_entries(updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_index_tasks_status ON index_tasks(status);`,
  `CREATE INDEX IF NOT EXISTS idx_index_task_items_task ON index_task_items(task_id);`,
];

let initializedDatabases = new WeakSet();
let initializingDatabases = new WeakMap();

export async function initDB(db) {
  if (!db || typeof db.exec !== 'function') {
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

  const initializationPromise = Promise.all(SCHEMA_SQL.map(sql => db.exec(sql)))
    .then(() => {
      initializedDatabases.add(db);
    })
    .finally(() => {
      initializingDatabases.delete(db);
    });

  initializingDatabases.set(db, initializationPromise);
  await initializationPromise;
}

export function resetDBInitFlag() {
  initializedDatabases = new WeakSet();
  initializingDatabases = new WeakMap();
}

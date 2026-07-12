import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const UPSERT_SETTINGS_SQL = 'insert or replace into settings (key, value) values (?, ?)';
const SELECT_VERSION_SQL = 'select value from settings where key = ?';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

class FakePreparedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async run() {
    return this.db.executeStatement(this.sql, this.bindings, this.db.settings);
  }

  async first() {
    return this.db.executeStatement(this.sql, this.bindings, this.db.settings);
  }
}

// 轻量 fake：只模拟迁移机制触碰的 SQL（基线 DDL / ALTER / settings 读写），
// batch 原子（先作用于快照，成功才提交），failNextBatch 可编程模拟并发竞争失败。
class FakeMigrationD1 {
  constructor() {
    this.settings = new Map();
    this.executedSql = [];
    this.batchLog = [];
    this.failNextBatch = null;
  }

  prepare(sql) {
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements) {
    const normalized = statements.map(statement => normalizeSql(statement.sql));
    this.batchLog.push(normalized);

    if (typeof this.failNextBatch === 'function') {
      const error = this.failNextBatch({ statements: normalized, db: this });
      if (error) {
        throw error;
      }
    }

    const snapshot = new Map(this.settings);
    const results = [];
    for (const statement of statements) {
      results.push(this.executeStatement(statement.sql, statement.bindings, snapshot));
    }
    this.settings = snapshot;
    return results;
  }

  executeStatement(sql, bindings, settings) {
    const normalizedSql = normalizeSql(sql);
    this.executedSql.push(normalizedSql);

    if (normalizedSql.startsWith('create table if not exists') || normalizedSql.startsWith('create index if not exists')) {
      return { success: true, meta: { changes: 0 } };
    }

    if (normalizedSql === SELECT_VERSION_SQL) {
      const value = settings.get(bindings[0]);
      return value === undefined ? null : { value };
    }

    if (normalizedSql === UPSERT_SETTINGS_SQL) {
      settings.set(bindings[0], bindings[1]);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('alter table')) {
      return { success: true, meta: { changes: 0 } };
    }

    throw new Error(`Unhandled SQL: ${normalizedSql}`);
  }

  migrationSqlLog() {
    return this.executedSql.filter(sql => sql.startsWith('alter table') || sql === UPSERT_SETTINGS_SQL);
  }
}

async function loadDbModule() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-migrations-test-'));
  await fs.writeFile(path.join(tempDir, 'db.mjs'), await fs.readFile(path.join(repoRoot, 'src', 'db.js'), 'utf8'));

  const cacheBust = `test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const db = await import(`${pathToFileURL(path.join(tempDir, 'db.mjs')).href}?${cacheBust}`);
  db.resetDBInitFlag();

  return {
    db,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

const DEMO_MIGRATIONS = [
  { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN demo_a TEXT'] },
  { version: 2, statements: ['ALTER TABLE vn_entries ADD COLUMN demo_b TEXT', 'ALTER TABLE tiers ADD COLUMN demo_c TEXT'] }
];

// ============ Tests ============

test('真实 MIGRATIONS：v1 加 status 列、v2 加 index_tasks type/skipped 列，LATEST_SCHEMA_VERSION 为 2', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    assert.deepEqual(db.MIGRATIONS, [
      { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] },
      { version: 2, statements: [
        "ALTER TABLE index_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'index'",
        'ALTER TABLE index_tasks ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0'
      ] }
    ]);
    assert.equal(db.LATEST_SCHEMA_VERSION, 2);
  } finally {
    await cleanup();
  }
});

test('全新库：initDB 建全部基线表并回放真实迁移，版本号落 2', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    await db.initDB(fake);

    const createStatements = fake.executedSql.filter(sql => sql.startsWith('create table if not exists'));
    assert.equal(createStatements.length, 5, '基线五张表全部建表');
    assert.ok(createStatements.some(sql => sql.includes('settings')));
    assert.ok(createStatements.some(sql => sql.includes('vn_entries')));
    assert.ok(createStatements.some(sql => sql.includes('tiers')));
    assert.ok(createStatements.some(sql => sql.includes('index_tasks')));
    assert.ok(createStatements.some(sql => sql.includes('index_task_items')));

    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      'alter table vn_entries add column status text',
      "alter table index_tasks add column type text not null default 'index'",
      'alter table index_tasks add column skipped integer not null default 0'
    ], '全新库同样走全量迁移回放（基线冻结语义）');
    assert.equal(await db.readSchemaVersion(fake), 2, '版本号推进到最新');
    assert.equal(fake.settings.get(db.SCHEMA_VERSION_KEY), '2', '版本号以字符串落库');
  } finally {
    await cleanup();
  }
});

test('真实迁移 v2：存量 v1 库（已有 status 列）initDB 后加 index_tasks type/skipped 列', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    // 模拟已应用 v1 的存量库
    fake.settings.set('schema_version', '1');

    await db.initDB(fake);

    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      "alter table index_tasks add column type text not null default 'index'",
      'alter table index_tasks add column skipped integer not null default 0'
    ], '仅应用 v2 迁移，不重复 v1');
    assert.equal(fake.settings.get(db.SCHEMA_VERSION_KEY), '2', '版本号推进到 2');
  } finally {
    await cleanup();
  }
});

test('真实迁移 v1：存量 v0 库（含业务数据、无 schema_version 键）initDB 后正确应用', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    // 模拟存量部署：settings 已有业务键，但没有 schema_version（= v0）
    fake.settings.set('config:settings', '{"tagsMode":"vndb"}');

    await db.initDB(fake);

    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      'alter table vn_entries add column status text',
      "alter table index_tasks add column type text not null default 'index'",
      'alter table index_tasks add column skipped integer not null default 0'
    ], '存量 v0 库补齐 status 列及 index_tasks type/skipped 列');
    assert.equal(fake.settings.get(db.SCHEMA_VERSION_KEY), '2', '版本号推进到 2');
    assert.equal(fake.settings.get('config:settings'), '{"tagsMode":"vndb"}', '业务设置键不受迁移影响');

    // 幂等：已最新的库重入不再执行迁移语句
    db.resetDBInitFlag();
    await db.initDB(fake);
    assert.equal(
      fake.executedSql.filter(sql => sql.startsWith('alter table')).length,
      3,
      '重入不重复应用迁移'
    );
  } finally {
    await cleanup();
  }
});

test('注入迁移表：从 v0 全部按序应用，版本号落库且每迁移单批原子', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();

    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, 0);

    assert.equal(finalVersion, 2);
    assert.equal(fake.settings.get(db.SCHEMA_VERSION_KEY), '2', '版本号以字符串落库');

    assert.equal(fake.batchLog.length, 2, '每个迁移一个 batch');
    assert.deepEqual(fake.batchLog[0], [
      'alter table vn_entries add column demo_a text',
      UPSERT_SETTINGS_SQL
    ], 'v1：迁移语句与版本号 upsert 同批');
    assert.deepEqual(fake.batchLog[1], [
      'alter table vn_entries add column demo_b text',
      'alter table tiers add column demo_c text',
      UPSERT_SETTINGS_SQL
    ], 'v2：多语句迁移与版本号 upsert 同批');
  } finally {
    await cleanup();
  }
});

test('存量 v0 库（无 schema_version 键）：待做迁移全部按序应用', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.settings.set('config:settings', '{"tagsMode":"vndb"}');

    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, await db.readSchemaVersion(fake));

    assert.equal(finalVersion, 2);
    assert.equal(fake.settings.get(db.SCHEMA_VERSION_KEY), '2');
    assert.equal(fake.settings.get('config:settings'), '{"tagsMode":"vndb"}', '业务设置键不受迁移影响');

    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.equal(alters.length, 3, '两个迁移共三条 ALTER 全部执行');
  } finally {
    await cleanup();
  }
});

test('部分存量库（schema_version=1）：只应用高于当前版本的迁移', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.settings.set('schema_version', '1');

    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, await db.readSchemaVersion(fake));

    assert.equal(finalVersion, 2);
    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      'alter table vn_entries add column demo_b text',
      'alter table tiers add column demo_c text'
    ], '仅执行 v2 的语句，v1 不重复应用');
  } finally {
    await cleanup();
  }
});

test('已最新库：不执行任何迁移语句', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.settings.set('schema_version', '2');

    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, await db.readSchemaVersion(fake));

    assert.equal(finalVersion, 2);
    assert.deepEqual(fake.migrationSqlLog(), []);
    assert.equal(fake.batchLog.length, 0, '不发起任何迁移 batch');
  } finally {
    await cleanup();
  }
});

test('readSchemaVersion：非法值视为 0', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();

    fake.settings.set('schema_version', 'not-a-number');
    assert.equal(await db.readSchemaVersion(fake), 0);

    fake.settings.set('schema_version', '-3');
    assert.equal(await db.readSchemaVersion(fake), 0);

    fake.settings.set('schema_version', '2');
    assert.equal(await db.readSchemaVersion(fake), 2);
  } finally {
    await cleanup();
  }
});

test('乱序迁移表：升序排序后按 1、2 顺序应用', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    const shuffled = [DEMO_MIGRATIONS[1], DEMO_MIGRATIONS[0]];

    const finalVersion = await db.applyPendingMigrations(fake, shuffled, 0);

    assert.equal(finalVersion, 2);
    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      'alter table vn_entries add column demo_a text',
      'alter table vn_entries add column demo_b text',
      'alter table tiers add column demo_c text'
    ], 'v1 先于 v2 应用');
  } finally {
    await cleanup();
  }
});

test('跳号迁移表：显式报错且不执行任何语句', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    const gapped = [
      { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN demo_a TEXT'] },
      { version: 3, statements: ['ALTER TABLE vn_entries ADD COLUMN demo_c TEXT'] }
    ];

    await assert.rejects(
      () => db.applyPendingMigrations(fake, gapped, 0),
      /版本号必须从 1 起连续递增：期望 2，实际 3/
    );
    assert.deepEqual(fake.migrationSqlLog(), [], '校验失败发生在任何语句执行之前');
  } finally {
    await cleanup();
  }
});

test('并发竞争：batch 失败但版本号已被他方推进 → 静默视为已应用并继续后续迁移', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.failNextBatch = ({ statements }) => {
      if (statements.some(sql => sql.includes('demo_a'))) {
        fake.failNextBatch = null;
        // 模拟他方 isolate 胜出：已应用 v1 并推进版本号
        fake.settings.set('schema_version', '1');
        return new Error('duplicate column name: demo_a');
      }
    };

    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, 0);

    assert.equal(finalVersion, 2);
    assert.equal(fake.settings.get('schema_version'), '2');
    const alters = fake.executedSql.filter(sql => sql.startsWith('alter table'));
    assert.deepEqual(alters, [
      'alter table vn_entries add column demo_b text',
      'alter table tiers add column demo_c text'
    ], '败者不重复执行 v1，继续应用 v2');
  } finally {
    await cleanup();
  }
});

test('并发竞争：batch 失败且版本号未推进 → 原样抛出且版本不变', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.failNextBatch = ({ statements }) => {
      if (statements.some(sql => sql.includes('demo_a'))) {
        return new Error('SQLITE_BUSY: database is locked');
      }
    };

    await assert.rejects(
      () => db.applyPendingMigrations(fake, DEMO_MIGRATIONS, 0),
      /SQLITE_BUSY: database is locked/
    );
    assert.equal(fake.settings.has('schema_version'), false, '失败时版本号不落库');
    assert.deepEqual(fake.executedSql.filter(sql => sql.startsWith('alter table')), [], '失败后不再应用后续迁移');
  } finally {
    await cleanup();
  }
});

test('并发竞争：batch 失败后版本号重读也失败 → 抛出原始迁移错误而非重读错误', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.failNextBatch = ({ statements }) => {
      if (statements.some(sql => sql.includes('demo_a'))) {
        return new Error('duplicate column name: demo_a');
      }
    };
    const originalExecute = fake.executeStatement.bind(fake);
    fake.executeStatement = (sql, bindings, settings) => {
      if (normalizeSql(sql) === SELECT_VERSION_SQL) {
        throw new Error('SQLITE_IOERR: version reread failed');
      }
      return originalExecute(sql, bindings, settings);
    };

    await assert.rejects(
      () => db.applyPendingMigrations(fake, DEMO_MIGRATIONS, 0),
      /duplicate column name: demo_a/,
      '重读失败时保留原始 batch 错误'
    );
    assert.equal(fake.settings.has('schema_version'), false, '失败时版本号不落库');
  } finally {
    await cleanup();
  }
});

test('重入：同一 DB 重复 initDB 不重复执行，resetDBInitFlag 后重建但迁移不重复应用', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();

    await db.initDB(fake);
    const batchCountAfterFirst = fake.batchLog.length;
    const sqlCountAfterFirst = fake.executedSql.length;

    await db.initDB(fake);
    assert.equal(fake.batchLog.length, batchCountAfterFirst, '同 isolate 重入不重复 batch');
    assert.equal(fake.executedSql.length, sqlCountAfterFirst, '同 isolate 重入不执行任何 SQL');

    // 模拟迁移已全部应用后的新 isolate 冷启动
    const finalVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, await db.readSchemaVersion(fake));
    assert.equal(finalVersion, 2);
    const altersAfterApply = fake.executedSql.filter(sql => sql.startsWith('alter table')).length;

    db.resetDBInitFlag();
    await db.initDB(fake);
    const rerunVersion = await db.applyPendingMigrations(fake, DEMO_MIGRATIONS, await db.readSchemaVersion(fake));

    assert.equal(rerunVersion, 2);
    assert.equal(
      fake.executedSql.filter(sql => sql.startsWith('alter table')).length,
      altersAfterApply,
      'reset 后重入：基线重建但迁移零重复应用'
    );
  } finally {
    await cleanup();
  }
});

test('initDB 失败态不缓存：首次初始化失败后重试可成功，成功后才进入缓存', async () => {
  const { db, cleanup } = await loadDbModule();

  try {
    const fake = new FakeMigrationD1();
    fake.failNextBatch = () => {
      fake.failNextBatch = null;
      return new Error('D1_ERROR: transient failure');
    };

    await assert.rejects(() => db.initDB(fake), /transient failure/);
    assert.equal(
      fake.executedSql.filter(sql => sql.startsWith('create table if not exists')).length,
      0,
      '失败的 batch 未执行任何建表语句'
    );

    // 失败不得被 WeakSet 误缓存为已初始化：重试应真正重新执行基线 batch
    await db.initDB(fake);
    assert.equal(
      fake.executedSql.filter(sql => sql.startsWith('create table if not exists')).length,
      5,
      '重试后基线建表真实执行'
    );

    // 成功后才缓存：第三次调用不再发起任何 batch
    const batchCountAfterSuccess = fake.batchLog.length;
    await db.initDB(fake);
    assert.equal(fake.batchLog.length, batchCountAfterSuccess, '成功后重入命中缓存');
  } finally {
    await cleanup();
  }
});

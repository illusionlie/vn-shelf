import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneMap(map) {
  return new Map(Array.from(map.entries(), ([key, value]) => [key, clone(value)]));
}

function createFakeState() {
  return {
    settings: new Map(),
    vnEntries: new Map(),
    tiers: new Map(),
    indexTasks: new Map(),
    indexTaskItems: new Map()
  };
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
    return this.db.executeStatement(this.sql, this.bindings, this.db.state, 'run');
  }

  async first() {
    return this.db.executeStatement(this.sql, this.bindings, this.db.state, 'first');
  }

  async all() {
    return this.db.executeStatement(this.sql, this.bindings, this.db.state, 'all');
  }
}

class FakeD1Database {
  constructor() {
    this.state = createFakeState();
    this.prepareLog = [];
    this.failOn = null;
    this.schemaExecCount = 0;
  }

  cloneState() {
    return {
      settings: cloneMap(this.state.settings),
      vnEntries: cloneMap(this.state.vnEntries),
      tiers: cloneMap(this.state.tiers),
      indexTasks: cloneMap(this.state.indexTasks),
      indexTaskItems: cloneMap(this.state.indexTaskItems)
    };
  }

  async exec() {
    this.schemaExecCount += 1;
  }

  prepare(sql) {
    this.prepareLog.push(normalizeSql(sql));
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements) {
    const snapshot = this.cloneState();
    const results = [];

    try {
      for (const statement of statements) {
        results.push(await this.executeStatement(statement.sql, statement.bindings, snapshot, 'run'));
      }
    } catch (error) {
      throw error;
    }

    this.state = snapshot;
    return results;
  }

  maybeFail(sql, bindings) {
    if (typeof this.failOn !== 'function') {
      return;
    }

    const result = this.failOn({ sql: normalizeSql(sql), bindings: clone(bindings) });
    if (result instanceof Error) {
      throw result;
    }
    if (typeof result === 'string' && result) {
      throw new Error(result);
    }
  }

  executeStatement(sql, bindings, state, mode) {
    const normalizedSql = normalizeSql(sql);

    if (mode === 'run') {
      this.maybeFail(normalizedSql, bindings);
    }

    if (normalizedSql === 'SELECT value FROM settings WHERE key = ?') {
      const value = state.settings.get(bindings[0]);
      return value === undefined ? null : { value };
    }

    if (normalizedSql === 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)') {
      state.settings.set(bindings[0], bindings[1]);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql === 'DELETE FROM settings WHERE key = ?') {
      const existed = state.settings.delete(bindings[0]);
      return { success: true, meta: { changes: existed ? 1 : 0 } };
    }

    if (normalizedSql === 'SELECT id, name, color, sort_order, updated_at FROM tiers ORDER BY sort_order ASC') {
      return {
        results: Array.from(state.tiers.values())
          .map(row => clone(row))
          .sort((a, b) => a.sort_order - b.sort_order)
      };
    }

    if (normalizedSql === 'DELETE FROM tiers') {
      const changes = state.tiers.size;
      state.tiers.clear();
      return { success: true, meta: { changes } };
    }

    if (normalizedSql === 'INSERT INTO tiers (id, name, color, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)' || normalizedSql === 'INSERT OR REPLACE INTO tiers (id, name, color, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)') {
      state.tiers.set(bindings[0], {
        id: bindings[0],
        name: bindings[1],
        color: bindings[2],
        sort_order: bindings[3],
        updated_at: bindings[4]
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql === 'SELECT * FROM vn_entries WHERE id = ?') {
      return clone(state.vnEntries.get(bindings[0]) || null);
    }

    if (normalizedSql === 'SELECT COUNT(*) as count FROM tiers') {
      return { count: state.tiers.size };
    }

    if (normalizedSql === 'DELETE FROM vn_entries') {
      const changes = state.vnEntries.size;
      state.vnEntries.clear();
      return { success: true, meta: { changes } };
    }

    if (normalizedSql === 'DELETE FROM vn_entries WHERE id = ?') {
      const existed = state.vnEntries.delete(bindings[0]);
      return { success: true, meta: { changes: existed ? 1 : 0 } };
    }

    if (normalizedSql.startsWith('INSERT OR REPLACE INTO vn_entries (')) {
      const row = {
        id: bindings[0],
        created_at: bindings[1],
        updated_at: bindings[2],
        title: bindings[3],
        title_ja: bindings[4],
        title_cn: bindings[5],
        image: bindings[6],
        image_nsfw: bindings[7],
        rating: bindings[8],
        length_text: bindings[9],
        length_minutes: bindings[10],
        developers: bindings[11],
        tags: bindings[12],
        all_age: bindings[13],
        title_cn_user: bindings[14],
        personal_rating: bindings[15],
        play_time: bindings[16],
        play_time_hours: bindings[17],
        play_time_part_minutes: bindings[18],
        play_time_minutes: bindings[19],
        review: bindings[20],
        start_date: bindings[21],
        finish_date: bindings[22],
        user_tags: bindings[23],
        tier_id: bindings[24],
        tier_sort: bindings[25]
      };
      state.vnEntries.set(row.id, row);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('INSERT OR REPLACE INTO index_tasks (')) {
      state.indexTasks.set(bindings[0], {
        id: bindings[0],
        status: bindings[1],
        total: bindings[2],
        processed: bindings[3],
        started_at: bindings[4],
        completed_at: bindings[5],
        error: bindings[6],
        failed_ids: bindings[7],
        last_reconciled_at: bindings[8]
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('INSERT INTO index_task_items (task_id, vndb_id, state, retry_count, error, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, vndb_id) DO UPDATE SET')) {
      const [taskId, vndbId, stateValue, retryCount, errorValue, updatedAt] = bindings;
      const key = `${taskId}:${vndbId}`;
      state.indexTaskItems.set(key, {
        task_id: taskId,
        vndb_id: vndbId,
        state: stateValue,
        retry_count: retryCount,
        error: errorValue,
        updated_at: updatedAt
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql === 'SELECT task_id, vndb_id, state, retry_count, error, updated_at FROM index_task_items WHERE task_id = ? AND vndb_id = ?') {
      return clone(state.indexTaskItems.get(`${bindings[0]}:${bindings[1]}`) || null);
    }

    if (normalizedSql === 'SELECT state, retry_count, error, updated_at FROM index_task_items WHERE task_id = ? AND vndb_id = ?') {
      const row = state.indexTaskItems.get(`${bindings[0]}:${bindings[1]}`);
      if (!row) return null;
      return { state: row.state, retry_count: row.retry_count, error: row.error, updated_at: row.updated_at };
    }

    throw new Error(`Unhandled SQL: ${normalizedSql}`);
  }
}

function createKV(seed = {}) {
  const store = new Map();

  for (const [key, value] of Object.entries(seed)) {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  return {
    store,
    kv: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === 'json' ? JSON.parse(value) : value;
      },

      async put(key, value) {
        store.set(key, String(value));
      },

      async delete(key) {
        store.delete(key);
      },

      async list({ prefix = '', cursor } = {}) {
        if (cursor) {
          return { keys: [], list_complete: true, cursor: undefined };
        }

        return {
          keys: Array.from(store.keys())
            .filter(key => key.startsWith(prefix))
            .sort()
            .map(name => ({ name })),
          list_complete: true,
          cursor: undefined
        };
      }
    }
  };
}

function createEntry(id, overrides = {}) {
  return {
    id,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    vndb: {
      title: `Title ${id}`,
      titleJa: `Title ${id}`,
      titleCn: `Title ${id}`,
      image: '',
      imageNsfw: false,
      rating: 8,
      length: '',
      lengthMinutes: 0,
      developers: [],
      tags: [],
      allAge: false,
      ...(overrides.vndb || {})
    },
    user: {
      titleCn: '',
      personalRating: 0,
      playTime: '',
      playTimeHours: 0,
      playTimePartMinutes: 0,
      playTimeMinutes: 0,
      review: '',
      startDate: null,
      finishDate: null,
      tags: [],
      tierId: null,
      tierSort: 0,
      ...(overrides.user || {})
    },
    ...overrides
  };
}

async function loadModules() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-d1-test-'));
  const sourceDir = path.join(repoRoot, 'src');

  await fs.writeFile(path.join(tempDir, 'db.mjs'), await fs.readFile(path.join(sourceDir, 'db.js'), 'utf8'));
  await fs.writeFile(path.join(tempDir, 'repository.mjs'), await fs.readFile(path.join(sourceDir, 'repository.js'), 'utf8').then(text => text.replace("'./db.js'", "'./db.mjs'")));
  await fs.writeFile(
    path.join(tempDir, 'migrate.mjs'),
    await fs.readFile(path.join(sourceDir, 'migrate.js'), 'utf8').then(text => text
      .replace("'./db.js'", "'./db.mjs'")
      .replace("'./repository.js'", "'./repository.mjs'"))
  );

  const cacheBust = `test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const db = await import(`${pathToFileURL(path.join(tempDir, 'db.mjs')).href}?${cacheBust}`);
  const repository = await import(`${pathToFileURL(path.join(tempDir, 'repository.mjs')).href}?${cacheBust}`);
  const migrate = await import(`${pathToFileURL(path.join(tempDir, 'migrate.mjs')).href}?${cacheBust}`);
  db.resetDBInitFlag();

  return {
    db,
    repository,
    migrate,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

test('saveTierList 保存空 tiers 后，getTierList 保持空列表而不是回退默认值', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveTierList(env, {
      tiers: [],
      updatedAt: '2024-03-01T00:00:00.000Z'
    });

    const tierList = await repository.getTierList(env);
    assert.deepEqual(tierList.tiers, []);
    assert.equal(typeof tierList.updatedAt, 'string');
  } finally {
    await cleanup();
  }
});

test('initDB 按具体 DB 实例跟踪初始化，且 reset 后允许重新建表', async () => {
  const { db, cleanup } = await loadModules();

  try {
    const firstDB = new FakeD1Database();
    const secondDB = new FakeD1Database();

    await db.initDB(firstDB);
    await db.initDB(firstDB);
    await db.initDB(secondDB);

    assert.equal(firstDB.schemaExecCount, 1);
    assert.equal(secondDB.schemaExecCount, 1);

    db.resetDBInitFlag();
    await db.initDB(firstDB);

    assert.equal(firstDB.schemaExecCount, 2);
  } finally {
    await cleanup();
  }
});

test('importData replace 失败时整体回滚，成功时保留导入条目的 updatedAt', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const db = new FakeD1Database();
    const env = { DB: db };

    await repository.saveVNEntry(env, createEntry('v1', {
      updatedAt: '2024-01-10T00:00:00.000Z'
    }));
    await repository.saveTierList(env, {
      tiers: [{ id: 'tier-old', name: 'Old', color: '#111111', order: 0 }],
      updatedAt: '2024-01-11T00:00:00.000Z'
    });

    db.failOn = ({ sql, bindings }) => {
      if (sql.startsWith('INSERT OR REPLACE INTO vn_entries (') && bindings[0] === 'v2') {
        return new Error('simulated insert failure');
      }
      return null;
    };

    await assert.rejects(
      () => repository.importData(env, {
        entries: [createEntry('v2', { updatedAt: '2024-02-02T03:04:05.000Z' })],
        tierList: { tiers: [], updatedAt: '2024-02-01T00:00:00.000Z' }
      }, 'replace'),
      /simulated insert failure/
    );

    const oldEntry = await repository.getVNEntry(env, 'v1');
    assert.equal(oldEntry?.id, 'v1');
    assert.equal((await repository.getTierList(env)).tiers.length, 1);

    db.failOn = null;

    await repository.importData(env, {
      entries: [createEntry('v2', { updatedAt: '2024-02-02T03:04:05.000Z' })],
      tierList: { tiers: [], updatedAt: '2024-02-01T00:00:00.000Z' }
    }, 'replace');

    const importedEntry = await repository.getVNEntry(env, 'v2');
    assert.equal(importedEntry.updatedAt, '2024-02-02T03:04:05.000Z');
    assert.equal(await repository.getVNEntry(env, 'v1'), null);

    const tierList = await repository.getTierList(env);
    assert.deepEqual(tierList.tiers, []);
  } finally {
    await cleanup();
  }
});

test('recordIndexItemResult 先按 sticky 语义 SELECT，仅在需要时写入', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const db = new FakeD1Database();
    const env = { DB: db };

    const firstResult = await repository.recordIndexItemResult(env, {
      taskId: 'idx_1',
      vndbId: 'v17',
      state: 'success',
      retryCount: 1
    });
    assert.equal(firstResult.state, 'success');

    const resultAfterSuccess = await repository.recordIndexItemResult(env, {
      taskId: 'idx_1',
      vndbId: 'v17',
      state: 'failed',
      retryCount: 2,
      error: 'boom'
    });
    assert.equal(resultAfterSuccess.state, 'success');
    assert.equal(resultAfterSuccess.error, null);

    const relevantSql = db.prepareLog.filter(sql => sql.includes('index_task_items'));
    assert.equal(relevantSql[0], 'SELECT state, retry_count, error, updated_at FROM index_task_items WHERE task_id = ? AND vndb_id = ?');
    assert.equal(relevantSql[1].startsWith('INSERT INTO index_task_items'), true);
    assert.equal(relevantSql[2], 'SELECT state, retry_count, error, updated_at FROM index_task_items WHERE task_id = ? AND vndb_id = ?');
    assert.equal(relevantSql.length, 3);
  } finally {
    await cleanup();
  }
});

test('migrateKvToD1 部分失败时不打迁移标记，修复后可重试并补迁 index items', async () => {
  const { repository, migrate, cleanup } = await loadModules();

  try {
    const db = new FakeD1Database();
    const { kv } = createKV({
      'config:settings': { adminPasswordHash: 'hash', jwtSecret: 'secret' },
      'tier:list': { tiers: [], updatedAt: '2024-04-01T00:00:00.000Z' },
      'vn:v9': createEntry('v9', { updatedAt: '2024-04-02T03:04:05.000Z' }),
      'index:status': {
        status: 'running',
        taskId: 'idx_9',
        total: 1,
        processed: 0,
        failed: [],
        startedAt: '2024-04-02T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: null
      },
      'index:item:idx_9:v9': {
        taskId: 'idx_9',
        vndbId: 'v9',
        state: 'failed',
        retryCount: 2,
        error: 'boom',
        updatedAt: '2024-04-02T06:00:00.000Z'
      }
    });
    const env = { DB: db, KV: kv };

    db.failOn = ({ sql, bindings }) => {
      if (sql.startsWith('INSERT OR REPLACE INTO vn_entries (') && bindings[0] === 'v9') {
        return new Error('simulated migrate entry failure');
      }
      return null;
    };

    await assert.rejects(
      () => migrate.migrateKvToD1(env),
      /可修复后重试/
    );

    assert.equal(db.state.settings.has('migrated_from_kv'), false);

    db.failOn = null;
    const result = await migrate.migrateKvToD1(env);

    assert.equal(result.settings, true);
    assert.equal(result.tiers, 0);
    assert.equal(result.entries, 1);
    assert.equal(result.indexStatus, true);
    assert.equal(result.indexItems, 1);
    assert.equal(db.state.settings.has('migrated_from_kv'), true);

    const entry = await repository.getVNEntry(env, 'v9');
    assert.equal(entry.updatedAt, '2024-04-02T03:04:05.000Z');

    const tierList = await repository.getTierList(env);
    assert.equal(tierList.tiers.length, 0);

    const item = db.state.indexTaskItems.get('idx_9:v9');
    assert.equal(item?.state, 'failed');
    assert.equal(item?.retry_count, 2);
    assert.equal(item?.error, 'boom');
  } finally {
    await cleanup();
  }
});

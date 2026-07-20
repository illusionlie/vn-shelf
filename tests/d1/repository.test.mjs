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
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

// initDB 经 prepare+batch 执行的建表/建索引/迁移 DDL（真实 D1 中 batch 可执行 DDL）
function isSchemaDdlSql(normalizedSql) {
  return normalizedSql.startsWith('create table if not exists')
    || normalizedSql.startsWith('create index if not exists')
    || normalizedSql.startsWith('alter table');
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
    const normalizedSql = normalizeSql(sql);
    // schema DDL 不计入 prepareLog，保持其只跟踪数据访问 SQL 的断言语义
    if (!isSchemaDdlSql(normalizedSql)) {
      this.prepareLog.push(normalizedSql);
    }
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements) {
    const snapshot = this.cloneState();

    try {
      const results = [];
      for (const statement of statements) {
        results.push(await this.executeStatement(statement.sql, statement.bindings, snapshot, 'run'));
      }
      this.state = snapshot;
      return results;
    } catch (error) {
      throw error;
    }
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

    // schema DDL 仅计数，不改数据状态，也不参与 failOn 注入
    if (isSchemaDdlSql(normalizedSql)) {
      this.schemaExecCount += 1;
      return { success: true, meta: { changes: 0 } };
    }

    if (mode === 'run') {
      this.maybeFail(sql, bindings);
    }

    if (normalizedSql === 'select value from settings where key = ?') {
      const value = state.settings.get(bindings[0]);
      return value === undefined ? null : { value };
    }

    if (normalizedSql === 'insert or replace into settings (key, value) values (?, ?)') {
      state.settings.set(bindings[0], bindings[1]);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql === 'delete from settings where key = ?') {
      const existed = state.settings.delete(bindings[0]);
      return { success: true, meta: { changes: existed ? 1 : 0 } };
    }

    if (normalizedSql === 'select id, name, color, sort_order, updated_at from tiers order by sort_order asc') {
      return {
        results: Array.from(state.tiers.values())
          .map(row => clone(row))
          .sort((a, b) => a.sort_order - b.sort_order)
      };
    }

    if (normalizedSql === 'delete from tiers') {
      const changes = state.tiers.size;
      state.tiers.clear();
      return { success: true, meta: { changes } };
    }

    if (normalizedSql === 'insert or replace into tiers (id, name, color, sort_order, updated_at) values (?, ?, ?, ?, ?)') {
      state.tiers.set(bindings[0], {
        id: bindings[0],
        name: bindings[1],
        color: bindings[2],
        sort_order: bindings[3],
        updated_at: bindings[4]
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql === 'select * from vn_entries where id = ?') {
      return clone(state.vnEntries.get(bindings[0]) || null);
    }

    if (normalizedSql === 'select count(*) as count from tiers') {
      return { count: state.tiers.size };
    }

    if (normalizedSql === 'delete from vn_entries') {
      const changes = state.vnEntries.size;
      state.vnEntries.clear();
      return { success: true, meta: { changes } };
    }

    if (normalizedSql === 'delete from vn_entries where id = ?') {
      const existed = state.vnEntries.delete(bindings[0]);
      return { success: true, meta: { changes: existed ? 1 : 0 } };
    }

    if (normalizedSql.startsWith('insert or replace into vn_entries (')) {
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
        tier_sort: bindings[25],
        status: bindings[26]
      };
      state.vnEntries.set(row.id, row);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('insert or replace into index_tasks (')) {
      state.indexTasks.set(bindings[0], {
        id: bindings[0],
        status: bindings[1],
        type: bindings[2],
        total: bindings[3],
        processed: bindings[4],
        skipped: bindings[5],
        started_at: bindings[6],
        completed_at: bindings[7],
        error: bindings[8],
        failed_ids: bindings[9],
        last_reconciled_at: bindings[10]
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('insert into index_task_items (task_id, vndb_id, state, retry_count, error, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(task_id, vndb_id) do update set')) {
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

    if (normalizedSql === 'select task_id, vndb_id, state, retry_count, error, updated_at from index_task_items where task_id = ?') {
      const results = [];
      for (const [, row] of state.indexTaskItems) {
        if (row.task_id === bindings[0]) {
          results.push(clone(row));
        }
      }
      return { results };
    }

    if (normalizedSql === 'select state, retry_count, error, updated_at from index_task_items where task_id = ? and vndb_id = ?') {
      const row = state.indexTaskItems.get(`${bindings[0]}:${bindings[1]}`);
      if (!row) return null;
      return { state: row.state, retry_count: row.retry_count, error: row.error, updated_at: row.updated_at };
    }

    if (normalizedSql === 'select vndb_id, state from index_task_items where task_id = ?') {
      const results = [];
      for (const [, row] of state.indexTaskItems) {
        if (row.task_id === bindings[0]) {
          results.push({ vndb_id: row.vndb_id, state: row.state });
        }
      }
      return { results };
    }

    if (normalizedSql === 'select * from index_tasks order by started_at desc limit 1') {
      const tasks = Array.from(state.indexTasks.values());
      if (tasks.length === 0) return null;
      tasks.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
      return clone(tasks[0]);
    }

    if (normalizedSql === 'delete from index_task_items where task_id = ?') {
      let changes = 0;
      for (const [key, row] of state.indexTaskItems) {
        if (row.task_id === bindings[0]) {
          state.indexTaskItems.delete(key);
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (normalizedSql.startsWith('update vn_entries set tier_id = ?, tier_sort = ?, updated_at = ? where id = ?')) {
      const row = state.vnEntries.get(bindings[3]);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.tier_id = bindings[0];
      row.tier_sort = bindings[1];
      row.updated_at = bindings[2];
      state.vnEntries.set(bindings[3], row);
      return { success: true, meta: { changes: 1 } };
    }

    if (normalizedSql.startsWith('update vn_entries set tier_id = null, tier_sort = 0, updated_at = ? where tier_id = ?')) {
      let changes = 0;
      for (const [key, row] of state.vnEntries) {
        if (row.tier_id === bindings[1]) {
          row.tier_id = null;
          row.tier_sort = 0;
          row.updated_at = bindings[0];
          state.vnEntries.set(key, row);
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (normalizedSql.startsWith('select id, tier_sort from vn_entries where id in (')) {
      const idList = bindings;
      const results = [];
      for (const id of idList) {
        const row = state.vnEntries.get(id);
        if (row) {
          results.push({ id: row.id, tier_sort: row.tier_sort });
        }
      }
      return { results };
    }

    if (normalizedSql === 'select id from vn_entries') {
      return { results: Array.from(state.vnEntries.values()).map(row => ({ id: row.id })) };
    }

    if (normalizedSql.startsWith('select id, title, title_ja, title_cn, title_cn_user, image, image_nsfw, rating, personal_rating, play_time_minutes, developers, all_age, tier_id, tier_sort, status, created_at from vn_entries order by created_at desc')) {
      const results = Array.from(state.vnEntries.values())
        .map(row => ({
          id: row.id,
          title: row.title,
          title_ja: row.title_ja,
          title_cn: row.title_cn,
          title_cn_user: row.title_cn_user,
          image: row.image,
          image_nsfw: row.image_nsfw,
          rating: row.rating,
          personal_rating: row.personal_rating,
          play_time_minutes: row.play_time_minutes,
          developers: row.developers,
          all_age: row.all_age,
          tier_id: row.tier_id,
          tier_sort: row.tier_sort,
          status: row.status,
          created_at: row.created_at
        }))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return { results };
    }

    if (normalizedSql === 'select id, title, title_ja, title_cn, title_cn_user, rating, personal_rating, play_time_minutes, developers, tags, user_tags, status, start_date, finish_date from vn_entries') {
      const results = Array.from(state.vnEntries.values()).map(row => ({
        id: row.id,
        title: row.title,
        title_ja: row.title_ja,
        title_cn: row.title_cn,
        title_cn_user: row.title_cn_user,
        rating: row.rating,
        personal_rating: row.personal_rating,
        play_time_minutes: row.play_time_minutes,
        developers: row.developers,
        tags: row.tags,
        user_tags: row.user_tags,
        status: row.status,
        start_date: row.start_date,
        finish_date: row.finish_date
      }));
      return { results };
    }

    if (normalizedSql === 'select * from vn_entries order by created_at asc') {
      const results = Array.from(state.vnEntries.values())
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
        .map(row => clone(row));
      return { results };
    }

    throw new Error(`Unhandled SQL: ${normalizedSql}`);
  }
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
  await fs.writeFile(path.join(tempDir, 'stats.mjs'), await fs.readFile(path.join(sourceDir, 'stats.js'), 'utf8'));
  await fs.writeFile(
    path.join(tempDir, 'repository.mjs'),
    await fs.readFile(path.join(sourceDir, 'repository.js'), 'utf8').then(
      text => text.replace("'./db.js'", "'./db.mjs'").replace("'./stats.js'", "'./stats.mjs'")
    )
  );

  const cacheBust = `test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const db = await import(`${pathToFileURL(path.join(tempDir, 'db.mjs')).href}?${cacheBust}`);
  const repository = await import(`${pathToFileURL(path.join(tempDir, 'repository.mjs')).href}?${cacheBust}`);
  db.resetDBInitFlag();

  return {
    db,
    repository,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

// ============ Tests ============

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

test('saveTierList 再保存有内容的 tiers 后可正确读取', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const saved = await repository.saveTierList(env, {
      tiers: [
        { id: 'tier-s', name: 'S', color: '#ff4757', order: 0 },
        { id: 'tier-a', name: 'A', color: '#ffa502', order: 1 }
      ],
      updatedAt: '2024-03-01T00:00:00.000Z'
    });

    assert.equal(saved.tiers.length, 2);
    assert.equal(saved.tiers[0].id, 'tier-s');
    assert.equal(saved.tiers[1].id, 'tier-a');

    const tierList = await repository.getTierList(env);
    assert.equal(tierList.tiers.length, 2);
    assert.equal(tierList.tiers[0].name, 'S');
    assert.equal(tierList.tiers[1].name, 'A');
  } finally {
    await cleanup();
  }
});

test('getTierList 在无数据时返回默认 tiers', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const tierList = await repository.getTierList(env);
    assert.equal(tierList.tiers.length, 5);
    assert.equal(tierList.tiers[0].id, 'tier-s');
    assert.equal(tierList.tiers[4].id, 'tier-d');
    assert.equal(tierList.updatedAt, null);
  } finally {
    await cleanup();
  }
});

test('saveVNEntry 和 getVNEntry 正确存储和读取条目', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    const entry = createEntry('v17', {
      vndb: { title: 'CLANNAD', rating: 8.5, lengthMinutes: 3600, developers: ['Key'], tags: ['Drama'] },
      user: { personalRating: 9, playTimeHours: 60, playTimeMinutes: 3630, tierId: 'tier-s' }
    });

    const saved = await repository.saveVNEntry(env, entry);
    assert.equal(saved.id, 'v17');
    assert.equal(saved.createdAt, entry.createdAt);

    const fetched = await repository.getVNEntry(env, 'v17');
    assert.equal(fetched.id, 'v17');
    assert.equal(fetched.vndb.title, 'CLANNAD');
    assert.equal(fetched.user.personalRating, 9);
    assert.equal(fetched.user.tierId, 'tier-s');
  } finally {
    await cleanup();
  }
});

test('deleteVNEntry 删除后 getVNEntry 返回 null', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    const entry = createEntry('v42');
    await repository.saveVNEntry(env, entry);

    const before = await repository.getVNEntry(env, 'v42');
    assert.ok(before);

    await repository.deleteVNEntry(env, 'v42');

    const after = await repository.getVNEntry(env, 'v42');
    assert.equal(after, null);
  } finally {
    await cleanup();
  }
});

test('importData merge 模式追加条目并合并 tierList', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveVNEntry(env, createEntry('v1', { updatedAt: '2024-01-10T00:00:00.000Z' }));
    await repository.saveTierList(env, {
      tiers: [{ id: 'tier-old', name: 'Old', color: '#111111', order: 0 }],
      updatedAt: '2024-01-11T00:00:00.000Z'
    });

    await repository.importData(env, {
      entries: [createEntry('v2', { updatedAt: '2024-02-02T00:00:00.000Z' })],
      tierList: {
        tiers: [{ id: 'tier-new', name: 'New', color: '#222222', order: 0 }],
        updatedAt: '2024-02-01T00:00:00.000Z'
      }
    }, 'merge');

    const fetched = await repository.getVNEntry(env, 'v2');
    assert.equal(fetched.id, 'v2');

    const existing = await repository.getVNEntry(env, 'v1');
    assert.equal(existing.id, 'v1');

    const tierList = await repository.getTierList(env);
    assert.ok(tierList.tiers.some(t => t.id === 'tier-old'));
    assert.ok(tierList.tiers.some(t => t.id === 'tier-new'));
  } finally {
    await cleanup();
  }
});

test('importData replace 模式清空旧数据并写入新数据', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveVNEntry(env, createEntry('v1', { updatedAt: '2024-01-10T00:00:00.000Z' }));
    await repository.saveTierList(env, {
      tiers: [{ id: 'tier-old', name: 'Old', color: '#111111', order: 0 }],
      updatedAt: '2024-01-11T00:00:00.000Z'
    });

    await repository.importData(env, {
      entries: [createEntry('v2', { updatedAt: '2024-02-02T03:04:05.000Z' })],
      tierList: {
        tiers: [],
        updatedAt: '2024-02-01T00:00:00.000Z'
      }
    }, 'replace');

    const importedEntry = await repository.getVNEntry(env, 'v2');
    assert.equal(importedEntry.updatedAt, '2024-02-02T03:04:05.000Z');

    const oldEntry = await repository.getVNEntry(env, 'v1');
    assert.equal(oldEntry, null);

    const tierList = await repository.getTierList(env);
    assert.deepEqual(tierList.tiers, []);
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
    const countAfterFirst = firstDB.schemaExecCount;
    assert.ok(countAfterFirst >= 1, 'schema should be executed at least once');

    await db.initDB(firstDB);
    assert.equal(firstDB.schemaExecCount, countAfterFirst, 'second initDB on same DB should not re-execute schema');

    await db.initDB(secondDB);
    assert.equal(secondDB.schemaExecCount, countAfterFirst, 'new DB instance should execute schema same number of times');

    db.resetDBInitFlag();
    await db.initDB(firstDB);
    assert.ok(firstDB.schemaExecCount > countAfterFirst, 'after reset, schema should be re-executed');
  } finally {
    await cleanup();
  }
});

test('recordIndexItemResult 保持成功粘性：success 后 followed by failed 不覆盖', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

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

    const relevantSql = env.DB.prepareLog.filter(sql => sql.includes('index_task_items'));
    assert.equal(relevantSql[0], 'select state, retry_count, error, updated_at from index_task_items where task_id = ? and vndb_id = ?');
    assert.ok(relevantSql[1].startsWith('insert into index_task_items'));
    assert.equal(relevantSql[2], 'select state, retry_count, error, updated_at from index_task_items where task_id = ? and vndb_id = ?');
    assert.equal(relevantSql.length, 3);
  } finally {
    await cleanup();
  }
});

test('recordIndexItemResult 允许 failed 升级为 success', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.recordIndexItemResult(env, {
      taskId: 'idx_2',
      vndbId: 'v18',
      state: 'failed',
      retryCount: 2,
      error: 'temporary'
    });

    const upgraded = await repository.recordIndexItemResult(env, {
      taskId: 'idx_2',
      vndbId: 'v18',
      state: 'success',
      retryCount: 3
    });
    assert.equal(upgraded.state, 'success');
    assert.equal(upgraded.error, null);
  } finally {
    await cleanup();
  }
});

test('recordIndexItemResult 缺少 taskId 或 vndbId 时返回 null', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const noTaskId = await repository.recordIndexItemResult(env, {
      taskId: '',
      vndbId: 'v17',
      state: 'success',
      retryCount: 0
    });
    assert.equal(noTaskId, null);

    const noVndbId = await repository.recordIndexItemResult(env, {
      taskId: 'idx_1',
      vndbId: '',
      state: 'success',
      retryCount: 0
    });
    assert.equal(noVndbId, null);
  } finally {
    await cleanup();
  }
});

test('summarizeIndexTaskResults 返回成功的 vndb_id 和 failed 列表', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.recordIndexItemResult(env, { taskId: 'idx_s', vndbId: 'v1', state: 'success', retryCount: 0 });
    await repository.recordIndexItemResult(env, { taskId: 'idx_s', vndbId: 'v2', state: 'success', retryCount: 0 });
    await repository.recordIndexItemResult(env, { taskId: 'idx_s', vndbId: 'v3', state: 'failed', retryCount: 3, error: 'timeout' });

    const summary = await repository.summarizeIndexTaskResults(env, 'idx_s');
    assert.equal(summary.processed, 3);
    assert.deepEqual(summary.failed.sort(), ['v3']);
    assert.deepEqual(summary.settledIds.sort(), ['v1', 'v2', 'v3']);
  } finally {
    await cleanup();
  }
});

test('summarizeIndexTaskResults 对空 taskId 返回空结果', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const summary = await repository.summarizeIndexTaskResults(env, '');
    assert.equal(summary.processed, 0);
    assert.deepEqual(summary.failed, []);
    assert.deepEqual(summary.settledIds, []);
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 跳过终态任务', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_completed',
      status: 'completed',
      total: 2,
      processed: 2,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:01:00.000Z'
    });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_completed');
    assert.equal(result.status, 'completed');
    assert.equal(result.processed, 2);

    const relevantSql = env.DB.prepareLog.filter(sql => sql.includes('index_task_items'));
    assert.equal(relevantSql.length, 0);
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 在任务 ID 不匹配时返回最新状态', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_active',
      status: 'running',
      total: 5,
      processed: 1,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_different');
    assert.equal(result.taskId, 'idx_active');
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 正确汇总 processed 和 failed，收敛到 completed', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_run',
      status: 'running',
      total: 2,
      processed: 0,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    await repository.recordIndexItemResult(env, { taskId: 'idx_run', vndbId: 'v1', state: 'success', retryCount: 0 });
    await repository.recordIndexItemResult(env, { taskId: 'idx_run', vndbId: 'v2', state: 'success', retryCount: 0 });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_run');
    assert.equal(result.status, 'completed');
    assert.equal(result.processed, 2);
    assert.deepEqual(result.failed, []);
    assert.ok(typeof result.completedAt === 'string' && result.completedAt.length > 0);
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 收敛到 partial 当存在 failed', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_partial',
      status: 'running',
      total: 3,
      processed: 0,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    await repository.recordIndexItemResult(env, { taskId: 'idx_partial', vndbId: 'v1', state: 'success', retryCount: 0 });
    await repository.recordIndexItemResult(env, { taskId: 'idx_partial', vndbId: 'v2', state: 'failed', retryCount: 3, error: 'error' });
    await repository.recordIndexItemResult(env, { taskId: 'idx_partial', vndbId: 'v3', state: 'success', retryCount: 0 });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_partial');
    assert.equal(result.status, 'partial');
    assert.equal(result.processed, 3);
    assert.deepEqual(result.failed.sort(), ['v2']);
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 不回退 processed 到更低值（单调递增保护）', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_mono',
      status: 'running',
      total: 10,
      processed: 5,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_mono');

    assert.ok(result.processed >= 5, `processed should be >= 5, got ${result.processed}`);
    assert.equal(result.status, 'running');
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 终态时清理 index_task_items', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_cleanup',
      status: 'running',
      total: 1,
      processed: 0,
      failed: [],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    await repository.recordIndexItemResult(env, { taskId: 'idx_cleanup', vndbId: 'v1', state: 'success', retryCount: 0 });

    const result = await repository.reconcileIndexStatusFromItems(env, 'idx_cleanup');
    assert.equal(result.status, 'completed');

    const cleanupSql = env.DB.prepareLog.filter(sql => sql.includes('delete from index_task_items'));
    assert.ok(cleanupSql.length > 0, 'should have executed DELETE on index_task_items');
  } finally {
    await cleanup();
  }
});

test('getSettings 返回默认值当数据库为空', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const settings = await repository.getSettings(env);
    assert.equal(settings.vndbApiToken, '');
    assert.equal(settings.adminPasswordHash, '');
    assert.equal(settings.tagsMode, 'vndb');
  } finally {
    await cleanup();
  }
});

test('saveSettings 和 getSettings 正确存取配置', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveSettings(env, {
      vndbApiToken: 'test-token',
      adminPasswordHash: 'hash123',
      jwtSecret: 'secret',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com'
    });

    const settings = await repository.getSettings(env);
assert.equal(settings.vndbApiToken, 'test-token');
    assert.equal(settings.adminPasswordHash, 'hash123');
    assert.equal(settings.tagsMode, 'manual');
    assert.equal(settings.translateTags, false);
  } finally {
    await cleanup();
  }
});

test('getIndexStatus 在无任务时返回 idle 默认状态', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    const status = await repository.getIndexStatus(env);
    assert.equal(status.status, 'idle');
    assert.equal(status.taskId, null);
    assert.equal(status.total, 0);
  } finally {
    await cleanup();
  }
});

test('saveIndexStatus 和 getIndexStatus 正确存取索引任务状态', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveIndexStatus(env, {
      taskId: 'idx_test',
      status: 'running',
      total: 10,
      processed: 3,
      failed: ['v99'],
      startedAt: '2024-01-01T00:00:00.000Z'
    });

    const status = await repository.getIndexStatus(env);
    assert.equal(status.taskId, 'idx_test');
    assert.equal(status.status, 'running');
    assert.equal(status.total, 10);
    assert.equal(status.processed, 3);
    assert.deepEqual(status.failed, ['v99']);
    // 默认 type='index'、skipped=0（未显式提供时）
    assert.equal(status.type, 'index');
    assert.equal(status.skipped, 0);
  } finally {
    await cleanup();
  }
});

test('listIndexableVNIds 返回符合 VNDB ID 格式的排序列表', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveVNEntry(env, createEntry('v17'));
    await repository.saveVNEntry(env, createEntry('v3'));
    await repository.saveVNEntry(env, createEntry('v100'));

    const ids = await repository.listIndexableVNIds(env);
    assert.deepEqual(ids, ['v3', 'v17', 'v100']);
  } finally {
    await cleanup();
  }
});

test('updateVNTier 更新条目的 tier 归属', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    await repository.saveVNEntry(env, createEntry('v1'));

    const result = await repository.updateVNTier(env, 'v1', 'tier-a', 5);
    assert.equal(result.user.tierId, 'tier-a');
    assert.equal(result.user.tierSort, 5);

    const entry = await repository.getVNEntry(env, 'v1');
    assert.equal(entry.user.tierId, 'tier-a');
    assert.equal(entry.user.tierSort, 5);
  } finally {
    await cleanup();
  }
});

test('updateVNTier 对不存在的条目返回 null', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    const result = await repository.updateVNTier(env, 'v999', 'tier-s');
    assert.equal(result, null);
  } finally {
    await cleanup();
  }
});

test('clearTierAssignments 清空指定 tier 下的条目归属', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    await repository.saveVNEntry(env, createEntry('v1', { user: { tierId: 'tier-s', tierSort: 2 } }));
    await repository.saveVNEntry(env, createEntry('v2', { user: { tierId: 'tier-a', tierSort: 1 } }));

    const count = await repository.clearTierAssignments(env, 'tier-s');
    assert.equal(count, 1);

    const entry1 = await repository.getVNEntry(env, 'v1');
    assert.equal(entry1.user.tierId, null);
    assert.equal(entry1.user.tierSort, 0);

    const entry2 = await repository.getVNEntry(env, 'v2');
    assert.equal(entry2.user.tierId, 'tier-a');
  } finally {
    await cleanup();
  }
});

test('exportData 导出所有条目和 tierList', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    await repository.saveVNEntry(env, createEntry('v1'));
    await repository.saveTierList(env, {
      tiers: [{ id: 'tier-s', name: 'S', color: '#ff4757', order: 0 }],
      updatedAt: '2024-03-01T00:00:00.000Z'
    });

    const data = await repository.exportData(env);
    assert.equal(data.version, '1.0');
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].id, 'v1');
    assert.equal(data.tierList.tiers.length, 1);
    assert.equal(data.tierList.tiers[0].id, 'tier-s');
  } finally {
    await cleanup();
  }
});

test('status 字段：保存合法状态往返一致，完整条目与列表项均携带', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };
    await repository.saveVNEntry(env, createEntry('v1', { user: { status: 'playing' } }));

    const fetched = await repository.getVNEntry(env, 'v1');
    assert.equal(fetched.user.status, 'playing');

    const list = await repository.getVNList(env);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].status, 'playing');
  } finally {
    await cleanup();
  }
});

test('status 字段：非法值与缺失一律归一为 null', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveVNEntry(env, createEntry('v1', { user: { status: 'weird' } }));
    const invalid = await repository.getVNEntry(env, 'v1');
    assert.equal(invalid.user.status, null);

    await repository.saveVNEntry(env, createEntry('v2'));
    const missing = await repository.getVNEntry(env, 'v2');
    assert.equal(missing.user.status, null);

    const list = await repository.getVNList(env);
    assert.ok(list.items.every(item => item.status === null));
  } finally {
    await cleanup();
  }
});

test('getStats：宽查询装配 computeStats，聚合结果与种子数据一致', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.saveVNEntry(env, createEntry('v1', {
      vndb: { rating: 8, developers: ['Key'], tags: ['Drama', 'Romance'] },
      user: {
        personalRating: 9.5,
        playTimeMinutes: 600,
        status: 'finished',
        startDate: '2026-01-01',
        finishDate: '2026-01-11',
        tags: ['神作']
      }
    }));
    await repository.saveVNEntry(env, createEntry('v2', {
      vndb: { rating: 7, developers: ['Key', 'Alice Soft'], tags: ['Drama'] },
      user: { playTimeMinutes: 300, status: 'playing' }
    }));
    await repository.saveVNEntry(env, createEntry('v3', {
      vndb: { rating: 0 },
      user: { personalRating: 6, finishDate: '2026-02-05' }
    }));

    const stats = await repository.getStats(env);

    // 既有 4 项语义不变：均分仅计 >0 样本
    assert.equal(stats.total, 3);
    assert.equal(stats.totalPlayTimeMinutes, 900);
    assert.equal(stats.avgRating, 7.5);
    assert.equal(stats.avgPersonalRating, 7.75);

    // 状态计数：v3 无 status 归入 none
    assert.deepEqual(stats.statusCounts, { playing: 1, finished: 1, stalled: 0, dropped: 0, wishlist: 0, none: 1 });

    // 直方图：vndb 8/7 各一桶；personal round(9.5)=10 桶与 6 桶各一
    assert.equal(stats.ratingHistograms.vndb[7], 1);
    assert.equal(stats.ratingHistograms.vndb[6], 1);
    assert.equal(stats.ratingHistograms.personal[9], 1);
    assert.equal(stats.ratingHistograms.personal[5], 1);

    // 分歧：仅 v1 双评分（9.5 − 8 = 1.5）
    assert.equal(stats.ratingDiff.count, 1);
    assert.equal(stats.ratingDiff.avg, 1.5);
    assert.equal(stats.ratingDiff.overrated[0].id, 'v1');
    assert.equal(stats.ratingDiff.overrated[0].diff, 1.5);
    assert.deepEqual(stats.ratingDiff.underrated, []);

    // 时间线：时长记入完成月；跨度仅 v1 双日期（10 天）
    assert.deepEqual(stats.timeline.months, [
      { month: '2026-01', finished: 1, playTimeMinutes: 600 },
      { month: '2026-02', finished: 1, playTimeMinutes: 0 }
    ]);
    assert.equal(stats.timeline.datedFinished, 2);
    assert.equal(stats.timeline.avgSpanDays, 10);
    assert.equal(stats.timeline.spanCount, 1);

    // 偏好：一条多社各计一次；平均个人分仅计已评分条目，无样本为 null
    assert.deepEqual(stats.topDevelopers, [
      { name: 'Key', count: 2, avgPersonalRating: 9.5 },
      { name: 'Alice Soft', count: 1, avgPersonalRating: null }
    ]);
    assert.deepEqual(stats.topTags.vndb, [
      { name: 'Drama', count: 2 },
      { name: 'Romance', count: 1 }
    ]);
    assert.deepEqual(stats.topTags.user, [{ name: '神作', count: 1 }]);
  } finally {
    await cleanup();
  }
});

test('importData：旧备份无 status 与含非法 status 均落 null，不拒包（宽松导入）', async () => {
  const { repository, cleanup } = await loadModules();

  try {
    const env = { DB: new FakeD1Database() };

    await repository.importData(env, {
      entries: [
        createEntry('v1'), // 旧备份形态：无 status 字段
        createEntry('v2', { user: { status: 'weird' } }), // 非法值
        createEntry('v3', { user: { status: 'finished' } }) // 合法值
      ]
    }, 'merge');

    assert.equal((await repository.getVNEntry(env, 'v1')).user.status, null);
    assert.equal((await repository.getVNEntry(env, 'v2')).user.status, null);
    assert.equal((await repository.getVNEntry(env, 'v3')).user.status, 'finished');
  } finally {
    await cleanup();
  }
});

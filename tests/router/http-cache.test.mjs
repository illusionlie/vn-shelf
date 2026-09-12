import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'router.js');
const httpCacheSourcePath = path.join(repoRoot, 'src', 'http-cache.js');
const dbSourcePath = path.join(repoRoot, 'src', 'db.js');
const utilsSourcePath = path.join(repoRoot, 'src', 'utils.js');

/**
 * 公开端点访客缓存（ETag + 边缘 Cache API + 版本键失效）的 router 级测试。
 *
 * 加载真实 router.js + 真实 http-cache.js + 真实 db.js，仅 stub 认证/仓储/上游；
 * caches 经 http-cache.testable 垫片以第 6 参注入可控桩（servePublicCached 的
 * cachesImpl 参数设计，无需全局 mock）。覆盖 AC1（304）/ AC2（命中与绕过）/
 * AC3（写后版本失效）/ AC4（CORS 不回退）。
 */

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

// bump 契约形态前缀：必须是单语句原子自增（服务端 +1），读写分离形态不得通过
const BUMP_VERSION_SQL_PREFIX = "insert into settings (key, value) values ('cache:version', '1') on conflict(key) do update";

class FakePreparedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = normalizeSql(sql);
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.db.execute(this.sql, this.bindings, this.db.settings);
  }

  async run() {
    return this.db.execute(this.sql, this.bindings, this.db.settings);
  }
}

// 轻量 fake：只模拟 initDB 迁移回放 + settings 点查 + cache:version 原子自增
class FakeHttpCacheD1 {
  constructor() {
    this.settings = new Map();
    this.bumpSqlLog = [];
    this.failBump = false;
  }

  prepare(sql) {
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements) {
    return statements.map(statement =>
      this.execute(statement.sql, statement.bindings, this.settings)
    );
  }

  execute(sql, bindings, settings) {
    if (
      sql.startsWith('create table if not exists') ||
      sql.startsWith('create index if not exists') ||
      sql.startsWith('alter table')
    ) {
      return { success: true, meta: { changes: 0 } };
    }

    if (sql === 'select value from settings where key = ?') {
      const value = settings.get(bindings[0]);
      return value === undefined ? null : { value };
    }

    if (sql === 'insert or replace into settings (key, value) values (?, ?)') {
      settings.set(bindings[0], bindings[1]);
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.startsWith(BUMP_VERSION_SQL_PREFIX)) {
      if (this.failBump) {
        throw new Error('D1_ERROR: simulated bump failure');
      }
      this.bumpSqlLog.push(sql);
      const current = Number.parseInt(settings.get('cache:version') || '0', 10) || 0;
      settings.set('cache:version', String(current + 1));
      return { success: true, meta: { changes: 1 } };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

// caches 桩：Map 存储副本（put 时读干 body 转 text，match 时重建 Response，可多次命中）
function createCachesStub() {
  const store = new Map();
  const calls = { match: [], put: [], delete: [] };

  return {
    calls,
    cachesImpl: {
      default: {
        async match(request) {
          calls.match.push(request.url);
          const hit = store.get(request.url);
          if (!hit) {
            return undefined;
          }
          return new Response(hit.bodyText, { status: hit.status, headers: hit.headers });
        },
        async put(request, response) {
          calls.put.push(request.url);
          store.set(request.url, {
            status: response.status,
            headers: [...response.headers],
            bodyText: await response.text()
          });
        },
        async delete(request) {
          calls.delete.push(request.url);
          return store.delete(request.url);
        }
      }
    }
  };
}

function createState() {
  return {
    authenticated: true,
    cachesImpl: null,
    getVNListCalls: 0,
    getStatsCalls: 0,
    getTierListCalls: 0,
    updateVNTierCalls: 0,
    vnList: {
      items: [{ id: 'v17', title: 'VN 17', createdAt: '2026-01-01T00:00:00.000Z' }]
    },
    stats: { total: 1 },
    entries: {
      v17: { id: 'v17', createdAt: '2026-01-01T00:00:00.000Z', vndb: {}, user: {} }
    },
    tierList: {
      tiers: [{ id: 'tier_a', name: 'A', color: '#ff0000', order: 0 }],
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
  };
}

async function loadRouterModule() {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const httpCacheSourceCode = await fs.readFile(httpCacheSourcePath, 'utf8');
  const dbSourceCode = await fs.readFile(dbSourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-http-cache-test-'));
  const testId = `hc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  globalThis.__routerHttpCacheTestRegistry = globalThis.__routerHttpCacheTestRegistry || new Map();
  const state = createState();
  globalThis.__routerHttpCacheTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerHttpCacheTestRegistry.get('${testId}');

export async function authMiddleware() {
  if (state.authenticated) {
    return { authenticated: true, settings: { vndbApiToken: '', adminPasswordHash: 'hash', jwtSecret: 'secret' } };
  }
  return { authenticated: false, error: 'No token' };
}

export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerHttpCacheTestRegistry.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

// router.js 顶层 import 依赖（status 白名单），与 src/repository.js 保持一致
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getVNList() {
  state.getVNListCalls += 1;
  return clone(state.vnList);
}
export async function getStats() {
  state.getStatsCalls += 1;
  return clone(state.stats);
}
export async function getVNEntry(_env, id) {
  return state.entries[id] ? clone(state.entries[id]) : null;
}
export async function getTierList() {
  state.getTierListCalls += 1;
  return clone(state.tierList);
}
export async function getSettings() {
  return { vndbApiToken: '', adminPasswordHash: '', jwtSecret: '', lastIndexTime: null, tagsMode: 'vndb', translateTags: true, translationUrl: '' };
}
export async function saveSettings() {}
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function importData() {}
export async function exportData() {
  return { version: '1.0', exportedAt: '2026-01-03T00:00:00.000Z', entries: [], tierList: { tiers: [], updatedAt: null }, appearance: {} };
}
export async function saveTierList(_env, tierList) { return clone(tierList); }
export async function updateVNTier(_env, id) {
  state.updateVNTierCalls += 1;
  return { id, vndb: {}, user: { tierId: null, tierSort: 0 } };
}
export async function batchUpdateVNTiers() { return []; }
export async function clearTierAssignments() { return 0; }
export async function tryAcquireIndexStartLock() { return true; }
export async function releaseIndexStartLock() {}
`;

  const indexTaskStubCode = `
export async function startIndexTask() {
  return { ok: false, status: 500, message: 'unexpected index task call' };
}
export async function getIndexTaskStatus() {
  return { status: 'idle', taskId: null, total: 0, processed: 0, skipped: 0, failed: [], startedAt: null, completedAt: null, error: null, lastReconciledAt: null };
}
`;

  const vndbStubCode = `
export async function fetchVNDB() {
  return {};
}

export class VNDBClient {
  async searchVN() { return []; }
}
`;

  // http-cache 垫片：真实实现 + 经第 6 参注入测试 caches 桩（cachesImpl 参数设计）
  const httpCacheTestableCode = `
import { buildEtag, bumpCacheVersion, readCacheVersion, servePublicCached as serveReal } from './http-cache.real.mjs';

const state = globalThis.__routerHttpCacheTestRegistry.get('${testId}');

export { buildEtag, bumpCacheVersion, readCacheVersion };
export function servePublicCached(request, env, ctx, path, handler) {
  return serveReal(request, env, ctx, path, handler, state.cachesImpl);
}
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/http-cache\.js';/, "from './http-cache.testable.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.real.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  // 真实 http-cache.js + 真实 db.js（无外部依赖，复制后仅改相对导入名）
  const patchedHttpCacheSource = httpCacheSourceCode
    .replace(/from '\.\/db\.js';/, "from './db.real.mjs';");

  const routerPath = path.join(tempDir, 'router.module.mjs');
  await fs.writeFile(path.join(tempDir, 'auth.stub.mjs'), authStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'repository.stub.mjs'), repositoryStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'index-task.stub.mjs'), indexTaskStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'ulist-import.stub.mjs'), 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(path.join(tempDir, 'utils.real.mjs'), utilsSourceCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'vndb.stub.mjs'), vndbStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'http-cache.testable.mjs'), httpCacheTestableCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'http-cache.real.mjs'), patchedHttpCacheSource, 'utf8');
  await fs.writeFile(path.join(tempDir, 'db.real.mjs'), dbSourceCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerHttpCacheTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function createHarness(routerModule, state) {
  const db = new FakeHttpCacheD1();
  const caches = createCachesStub();
  state.cachesImpl = caches.cachesImpl;

  async function send({ method = 'GET', requestPath, headers = {}, body } = {}) {
    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };
    const request = new Request(`https://example.com${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const response = await routerModule.handleRequest(request, { DB: db }, ctx);
    return { response, waitUntilPromises };
  }

  return { db, caches, send };
}

test('访客首请求未命中：执行 handler，响应带 ETag / public max-age=60 / CORS，副本写合成键（AC2）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { db, caches, send } = createHarness(routerModule, state);
    const { response, waitUntilPromises } = await send({ requestPath: '/api/vn' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('ETag'), '"vshelf-0"', '版本 0 派生 ETag');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*', 'AC4：CORS 出口附加');
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(state.getVNListCalls, 1, '未命中时 handler 直行');
    assert.equal(db.settings.get('cache:version'), undefined, '读路径不产生版本键');

    assert.equal(waitUntilPromises.length, 1, '副本经 ctx.waitUntil 异步写入');
    await Promise.all(waitUntilPromises);
    assert.deepEqual(caches.calls.match, ['https://example.com/api/vn__cv=0'], '合成键含版本号');
    assert.deepEqual(caches.calls.put, ['https://example.com/api/vn__cv=0']);
  } finally {
    await cleanup();
  }
});

test('访客二次请求命中缓存副本：handler 不再执行，副本保留 ETag/Cache-Control 且 CORS 仍被附加（AC2/AC4）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { send } = createHarness(routerModule, state);

    const first = await send({ requestPath: '/api/vn' });
    await Promise.all(first.waitUntilPromises);

    const second = await send({ requestPath: '/api/vn' });
    assert.equal(second.response.status, 200);
    assert.equal(state.getVNListCalls, 1, '命中路径不执行 handler（跳过 getVNList 全表查询）');
    assert.equal(second.response.headers.get('ETag'), '"vshelf-0"');
    assert.equal(second.response.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(second.response.headers.get('Access-Control-Allow-Origin'), '*', 'AC4：命中路径 CORS 不回退');
    const payload = await second.response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.data.length, 1);
    assert.equal(second.waitUntilPromises.length, 0, '命中不再写缓存');
  } finally {
    await cleanup();
  }
});

test('缓存键含查询串：不同 sort 参数不串味（各自 miss/put）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { caches, send } = createHarness(routerModule, state);

    const a = await send({ requestPath: '/api/vn?sort=rating_desc' });
    await Promise.all(a.waitUntilPromises);
    const b = await send({ requestPath: '/api/vn?sort=created_desc' });
    await Promise.all(b.waitUntilPromises);

    assert.equal(state.getVNListCalls, 2, '不同查询串各自回源');
    assert.deepEqual(caches.calls.put.sort(), [
      'https://example.com/api/vn?sort=created_desc__cv=0',
      'https://example.com/api/vn?sort=rating_desc__cv=0'
    ], '查询串参与缓存键');

    const hit = await send({ requestPath: '/api/vn?sort=rating_desc' });
    assert.equal(state.getVNListCalls, 2, '同查询串二次访问命中副本');
    assert.equal(hit.response.status, 200);
  } finally {
    await cleanup();
  }
});

test('带 auth_token Cookie：永不读缓存、响应 no-store + ETag、handler 直行；If-None-Match 也不 304（AC2）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { caches, send } = createHarness(routerModule, state);

    const { response } = await send({
      requestPath: '/api/vn',
      headers: {
        Cookie: 'auth_token=anything',
        'If-None-Match': '"vshelf-0"'
      }
    });

    assert.equal(response.status, 200, '管理员永远直查：即使条件请求命中版本也执行 handler');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('ETag'), '"vshelf-0"');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(state.getVNListCalls, 1, 'handler 直行');
    assert.deepEqual(caches.calls.match, [], '管理员路径零缓存读');
    assert.deepEqual(caches.calls.put, [], '管理员路径零缓存写');
  } finally {
    await cleanup();
  }
});

test('访客 If-None-Match 命中 → 304 空体，ETag/Cache-Control/CORS 保留（AC1/AC4）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { send } = createHarness(routerModule, state);

    const { response } = await send({
      requestPath: '/api/stats',
      headers: { 'If-None-Match': '"vshelf-0"' }
    });

    assert.equal(response.status, 304);
    assert.equal(await response.text(), '', '304 空体');
    assert.equal(response.headers.get('ETag'), '"vshelf-0"');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*', 'AC4：304 路径 CORS 不回退');
    assert.equal(state.getStatsCalls, 0, '协商命中不执行 handler');
  } finally {
    await cleanup();
  }
});

test('写成功后版本自增：ETag 更新、旧版本缓存键失联（AC3）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { db, caches, send } = createHarness(routerModule, state);

    // 写前访客请求占住 v0 缓存键
    const before = await send({ requestPath: '/api/vn' });
    await Promise.all(before.waitUntilPromises);
    assert.equal(before.response.headers.get('ETag'), '"vshelf-0"');
    const matchCountAfterInitialMiss = caches.calls.match.length;

    // 写路径（PUT tier 归属）成功 → bump v0→v1
    const write = await send({
      method: 'PUT',
      requestPath: '/api/vn/v17/tier',
      body: { tierId: null }
    });
    assert.equal(write.response.status, 200);
    assert.equal(write.waitUntilPromises.length, 1, 'bump 经 ctx.waitUntil 异步执行');
    await Promise.all(write.waitUntilPromises);
    assert.equal(db.settings.get('cache:version'), '1', '版本键自增到 1');
    assert.ok(
      db.bumpSqlLog[0].startsWith(BUMP_VERSION_SQL_PREFIX),
      'bump 为单语句原子自增 SQL'
    );

    // 新访客请求：ETag 随版本更新，缓存键换到 __cv=1（旧键永不命中 = 失效）
    const after = await send({ requestPath: '/api/vn' });
    await Promise.all(after.waitUntilPromises);
    assert.equal(after.response.headers.get('ETag'), '"vshelf-1"');
    assert.equal(state.getVNListCalls, 2, '新版本键未命中 → 回源执行 handler');
    assert.ok(
      caches.calls.match.slice(matchCountAfterInitialMiss).every(url => !url.endsWith('__cv=0')),
      '写后旧版本键不再被 match（换钥匙式失效）'
    );
    assert.ok(caches.calls.put.includes('https://example.com/api/vn__cv=1'), '新副本落新版本键');

    // 旧 ETag 条件请求不再命中；新 ETag 命中 304
    const staleConditional = await send({
      requestPath: '/api/vn',
      headers: { 'If-None-Match': '"vshelf-0"' }
    });
    assert.equal(staleConditional.response.status, 200, '数据已变：旧 ETag 协商失效');
    const freshConditional = await send({
      requestPath: '/api/vn',
      headers: { 'If-None-Match': '"vshelf-1"' }
    });
    assert.equal(freshConditional.response.status, 304, '新 ETag 协商命中');
  } finally {
    await cleanup();
  }
});

test('写失败（4xx 校验）不 bump 版本；bump 抛错不影响写响应（AC3）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { db, send } = createHarness(routerModule, state);

    // 校验失败：缺 tierId 字段 → 400，无 bump
    const invalid = await send({
      method: 'PUT',
      requestPath: '/api/vn/v17/tier',
      body: {}
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.waitUntilPromises.length, 0, '失败写不调度 bump');
    assert.equal(db.settings.get('cache:version'), undefined);

    // bump 落库失败：写响应仍成功，仅记日志（waitUntil promise 被 catch，不产生未处理拒绝）
    db.failBump = true;
    const failingBump = await send({
      method: 'PUT',
      requestPath: '/api/vn/v17/tier',
      body: { tierId: null }
    });
    assert.equal(failingBump.response.status, 200, 'purge/bump 失败不影响写响应');
    await Promise.all(failingBump.waitUntilPromises);
    assert.equal(db.settings.get('cache:version'), undefined);
  } finally {
    await cleanup();
  }
});

test('/api/config/appearance 不入缓存路径：无 match/put，维持既有 max-age=300', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { caches, send } = createHarness(routerModule, state);

    const { response, waitUntilPromises } = await send({ requestPath: '/api/config/appearance' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300', 'appearance 维持现状');
    assert.equal(response.headers.get('ETag'), null, '不引入 ETag');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(caches.calls.match, [], '零缓存读');
    assert.deepEqual(caches.calls.put, [], '零缓存写');
    assert.equal(waitUntilPromises.length, 0);
  } finally {
    await cleanup();
  }
});

test('/api/tier 与 /api/vn/v{id} 均走缓存路径（缓存集合覆盖四个公开端点）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { caches, send } = createHarness(routerModule, state);

    const tier = await send({ requestPath: '/api/tier' });
    const detail = await send({ requestPath: '/api/vn/v17' });
    await Promise.all([...tier.waitUntilPromises, ...detail.waitUntilPromises]);

    assert.equal(tier.response.headers.get('ETag'), '"vshelf-0"');
    assert.equal(detail.response.headers.get('ETag'), '"vshelf-0"');
    assert.deepEqual(caches.calls.put.sort(), [
      'https://example.com/api/tier__cv=0',
      'https://example.com/api/vn/v17__cv=0'
    ]);
  } finally {
    await cleanup();
  }
});

test('404 业务响应（条目不存在）：带 ETag 与 max-age=60 但不落边缘副本（仅 200 才 put）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { caches, send } = createHarness(routerModule, state);

    const { response, waitUntilPromises } = await send({ requestPath: '/api/vn/v999' });

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('ETag'), '"vshelf-0"', '404 仍带版本 ETag（协商缓存可用）');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*', 'AC4：404 公开响应 CORS 不回退');
    assert.deepEqual(caches.calls.match, ['https://example.com/api/vn/v999__cv=0'], '仍尝试 match（命中则直接复用）');
    assert.deepEqual(caches.calls.put, [], '非 200 不写边缘副本');
    assert.equal(waitUntilPromises.length, 0, '无 waitUntil 调度');
  } finally {
    await cleanup();
  }
});

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
const utilsSourcePath = path.join(repoRoot, 'src', 'utils.js');

/**
 * 07-11-entry-status-field：POST/PUT /api/vn 的 status 校验矩阵（design.md 校验矩阵全场景）。
 *
 * | 场景   | 输入              | 期望 |
 * |--------|-------------------|------|
 * | create | 缺省 / null       | user.status = null |
 * | create | 白名单五值        | 落库 |
 * | create | 其他任意值        | 400 中文文案（信封 {success:false,error} 无 code） |
 * | update | 字段未出现        | 保持原值 |
 * | update | null              | 清除为 null |
 * | update | 白名单 / 非法     | 同 create |
 *
 * utils 不打桩——复制真实 src/utils.js，错误信封形态命中真实实现。
 * 导入宽松归一（entryToRow）在 tests/d1/repository.test.mjs 覆盖。
 */

const INVALID_STATUS_MESSAGE = '状态值无效，仅支持 playing/finished/stalled/dropped/wishlist';

function createExistingEntry(id, status = 'playing') {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    vndb: {
      title: `VN ${id}`,
      titleJa: `VN ${id}`,
      titleCn: '',
      image: '',
      imageNsfw: false,
      rating: 8,
      length: '',
      lengthMinutes: 0,
      developers: [],
      tags: [],
      allAge: false
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
      status,
      tags: [],
      tierId: null,
      tierSort: 0
    }
  };
}

async function loadRouterModule({ entries = {} } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-status-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const repositoryStubPath = path.join(tempDir, 'repository.stub.mjs');
  const indexTaskStubPath = path.join(tempDir, 'index-task.stub.mjs');
  const utilsRealPath = path.join(tempDir, 'utils.real.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerStatusTestRegistry = globalThis.__routerStatusTestRegistry || new Map();
  const state = {
    entries,
    saveCalls: []
  };
  globalThis.__routerStatusTestRegistry.set(testId, state);

  const authStubCode = `
export async function authMiddleware() {
  return { authenticated: true, settings: { vndbApiToken: '', adminPasswordHash: 'hash', jwtSecret: 'secret' } };
}
export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerStatusTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

// 与 src/repository.js 保持一致：router.js 依赖此导出做 status 白名单校验
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getVNEntry(_env, id) {
  return state.entries[id] ? clone(state.entries[id]) : null;
}
export async function saveVNEntry(_env, entry) {
  const saved = clone(entry);
  state.saveCalls.push(saved);
  state.entries[entry.id] = saved;
  return clone(saved);
}
export async function getVNList() { return { items: [] }; }
export async function getStats() { return { total: 0 }; }
export async function deleteVNEntry() {}
export async function getSettings() { return {}; }
export async function saveSettings() {}
export async function exportData() { return { entries: [], tierList: { tiers: [], updatedAt: null } }; }
export async function importData() {}
export async function getTierList() { return { tiers: [], updatedAt: null }; }
export async function saveTierList(_env, tierList) { return tierList; }
export async function updateVNTier() { return null; }
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
  return { status: 'idle', taskId: null, total: 0, processed: 0, failed: [] };
}
`;

  const vndbStubCode = `
export async function fetchVNDB(id) {
  return {
    title: 'Stub VN ' + id,
    titleJa: 'Stub VN ' + id,
    titleCn: '',
    image: '',
    imageNsfw: false,
    rating: 8,
    length: '',
    lengthMinutes: 0,
    developers: [],
    tags: [],
    allAge: false
  };
}
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.real.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(repositoryStubPath, repositoryStubCode, 'utf8');
  await fs.writeFile(indexTaskStubPath, indexTaskStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'ulist-import.stub.mjs'), 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(utilsRealPath, utilsSourceCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerStatusTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendJSON(routerModule, method, requestPath, body) {
  const request = new Request(`https://example.com${requestPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();
  return { response, payload };
}

// ============ create ============

test('POST /api/vn：缺省与 null 的 status 均落 null', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const omitted = await sendJSON(routerModule, 'POST', '/api/vn', { vndbId: 'v100' });
    assert.equal(omitted.response.status, 200);
    assert.equal(omitted.payload.success, true);
    assert.equal(omitted.payload.data.user.status, null, '缺省 → null');

    const explicitNull = await sendJSON(routerModule, 'POST', '/api/vn', { vndbId: 'v101', status: null });
    assert.equal(explicitNull.response.status, 200);
    assert.equal(explicitNull.payload.data.user.status, null, '显式 null → null');
  } finally {
    await cleanup();
  }
});

test('POST /api/vn：白名单值（含预留 wishlist）持久化成功', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const playing = await sendJSON(routerModule, 'POST', '/api/vn', { vndbId: 'v100', status: 'playing' });
    assert.equal(playing.response.status, 200);
    assert.equal(playing.payload.data.user.status, 'playing');
    assert.equal(state.entries.v100.user.status, 'playing');

    // wishlist 首期 UI 不暴露，但后端白名单包含（未来 ulist 导入零迁移启用）
    const wishlist = await sendJSON(routerModule, 'POST', '/api/vn', { vndbId: 'v101', status: 'wishlist' });
    assert.equal(wishlist.response.status, 200);
    assert.equal(wishlist.payload.data.user.status, 'wishlist');
  } finally {
    await cleanup();
  }
});

test('POST /api/vn：非白名单值 → 400 中文文案，错误信封无 code，不落库', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    for (const invalid of ['xxx', '', 'PLAYING', 0]) {
      const { response, payload } = await sendJSON(routerModule, 'POST', '/api/vn', { vndbId: 'v100', status: invalid });
      assert.equal(response.status, 400, `status=${JSON.stringify(invalid)} 应 400`);
      assert.deepEqual(payload, { success: false, error: INVALID_STATUS_MESSAGE });
      assert.equal('code' in payload, false);
    }
    assert.equal(state.saveCalls.length, 0, '校验失败不触发 saveVNEntry');
  } finally {
    await cleanup();
  }
});

// ============ update ============

test('PUT /api/vn/:id：字段未出现 → 保持原值', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    entries: { v17: createExistingEntry('v17', 'playing') }
  });

  try {
    const { response, payload } = await sendJSON(routerModule, 'PUT', '/api/vn/v17', { titleCn: '新标题' });
    assert.equal(response.status, 200);
    assert.equal(payload.data.user.status, 'playing', '未提供 status 时保持原值');
    assert.equal(payload.data.user.titleCn, '新标题');
    assert.equal(state.entries.v17.user.status, 'playing');
  } finally {
    await cleanup();
  }
});

test('PUT /api/vn/:id：null → 清除为 null', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    entries: { v17: createExistingEntry('v17', 'playing') }
  });

  try {
    const { response, payload } = await sendJSON(routerModule, 'PUT', '/api/vn/v17', { status: null });
    assert.equal(response.status, 200);
    assert.equal(payload.data.user.status, null, 'null 清除');
    assert.equal(state.entries.v17.user.status, null);
  } finally {
    await cleanup();
  }
});

test('PUT /api/vn/:id：合法字符串 → 设置', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    entries: { v17: createExistingEntry('v17', 'playing') }
  });

  try {
    const { response, payload } = await sendJSON(routerModule, 'PUT', '/api/vn/v17', { status: 'finished' });
    assert.equal(response.status, 200);
    assert.equal(payload.data.user.status, 'finished');
    assert.equal(state.entries.v17.user.status, 'finished');
  } finally {
    await cleanup();
  }
});

test('PUT /api/vn/:id：非法值 → 400 且原值不变', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    entries: { v17: createExistingEntry('v17', 'stalled') }
  });

  try {
    const { response, payload } = await sendJSON(routerModule, 'PUT', '/api/vn/v17', { status: 'bad-value' });
    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: INVALID_STATUS_MESSAGE });
    assert.equal(state.saveCalls.length, 0, '校验失败不触发 saveVNEntry');
    assert.equal(state.entries.v17.user.status, 'stalled', '原值保持');
  } finally {
    await cleanup();
  }
});

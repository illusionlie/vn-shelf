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

// /api/import appearance 校验用例（ownerName 领域）。
// 加载器形态与 config.update.test.mjs 一致（patch 型替换顶层 import），
// 区别仅在 repository 桩的 importData 记录调用参数供断言透传形态。

// router.js 顶层 import 依赖（公开端点缓存包裹与写路径版本失效）。
// 本套件不触达缓存行为：servePublicCached 直通 handler、bump 为 no-op
const HTTP_CACHE_STUB_CODE = `export async function servePublicCached(request, env, ctx, path, handler) {
  return handler();
}
export async function bumpCacheVersion() {}
`;

async function loadRouterModule({ authenticated = true } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-import-test-'));
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerImportTestRegistry = globalThis.__routerImportTestRegistry || new Map();
  const state = {
    authenticated,
    importDataCalls: []
  };
  globalThis.__routerImportTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerImportTestRegistry?.get('${testId}');
export async function authMiddleware() {
  return { authenticated: !!state.authenticated, settings: {} };
}
export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerImportTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

// router.js 顶层 import 依赖（status 白名单），与 src/repository.js 保持一致
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getSettings() { return {}; }
export async function saveSettings() {}
export async function getVNList() { return { items: [] }; }
export async function getStats() { return {}; }
export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function exportData() { return {}; }

// 记录透传参数：appearance 校验/归一（null → ''）在 router 层完成后才到达此处
export async function importData(env, data, mode) {
  state.importDataCalls.push({ data: clone(data), mode });
}

export async function getIndexStatus() { return {}; }
export async function saveIndexStatus() {}
export async function reconcileIndexStatusFromItems() { return {}; }
export async function tryAcquireIndexStartLock() { return true; }
export async function releaseIndexStartLock() {}
export async function getTierList() { return { tiers: [], updatedAt: null }; }
export async function saveTierList(env, tierList) { return tierList; }
export async function updateVNTier() {}
export async function batchUpdateVNTiers() {}
export async function clearTierAssignments() {}
`;

  const utilsStubCode = `
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
export function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}
export function successResponse(data = null, message = '操作成功', extra = {}) {
  return jsonResponse({ success: true, message, data, ...extra });
}
export function isValidVNDBId(id) {
  return /^v\\d+$/.test(id);
}
export async function parseRequestBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('请求体格式错误');
  }
}
`;

  const vndbStubCode = `
export async function fetchVNDB() { return {}; }
export class VNDBClient {
  async searchVN() { return []; }
}
`;

  const indexTaskStubCode = `
export async function startIndexTask() { return { ok: false, status: 500, message: 'unexpected' }; }
export async function getIndexTaskStatus() { return {}; }
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';")
    .replace(/from '\.\/http-cache\.js';/, "from './http-cache.stub.mjs';");

  await fs.writeFile(path.join(tempDir, 'auth.stub.mjs'), authStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'repository.stub.mjs'), repositoryStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'index-task.stub.mjs'), indexTaskStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'ulist-import.stub.mjs'), 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(path.join(tempDir, 'utils.stub.mjs'), utilsStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'vndb.stub.mjs'), vndbStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'http-cache.stub.mjs'), HTTP_CACHE_STUB_CODE, 'utf8');
  await fs.writeFile(path.join(tempDir, 'router.module.mjs'), patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(path.join(tempDir, 'router.module.mjs')).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerImportTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function createImportBody(appearance) {
  return {
    entries: [{ id: 'v17', vndb: {}, user: {} }],
    appearance,
    mode: 'merge'
  };
}

async function sendImportRequest(routerModule, body) {
  const request = new Request('https://example.com/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const response = await routerModule.handleRequest(request, {});
  return { response, payload: await response.json() };
}

test('/api/import appearance.ownerName 非字符串返回 400 且不触达 importData', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendImportRequest(routerModule, createImportBody({
      ownerName: 123
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'appearance.ownerName 必须为字符串' });
    assert.equal(state.importDataCalls.length, 0);
  } finally {
    await cleanup();
  }
});

test('/api/import appearance.ownerName trim 后超 30 字符返回 400', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendImportRequest(routerModule, createImportBody({
      ownerName: '明'.repeat(31)
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'appearance.ownerName 长度不能超过 30' });
    assert.equal(state.importDataCalls.length, 0);
  } finally {
    await cleanup();
  }
});

test('/api/import 合法 ownerName 透传 importData，null 归一为空串', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    // 合法值原样透传（trim 落库由 repository.applyAppearanceToSettings 防御层完成）
    const { response } = await sendImportRequest(routerModule, createImportBody({
      ownerName: '  小明  '
    }));
    assert.equal(response.status, 200);
    assert.equal(state.importDataCalls.length, 1);
    assert.equal(state.importDataCalls[0].data.appearance.ownerName, '  小明  ');

    // null 归一为 ''（与 backgroundUrl 同规则）
    const { response: nullResponse } = await sendImportRequest(routerModule, createImportBody({
      ownerName: null
    }));
    assert.equal(nullResponse.status, 200);
    assert.equal(state.importDataCalls[1].data.appearance.ownerName, '');
  } finally {
    await cleanup();
  }
});

test('/api/import 缺省 ownerName 或整体缺省 appearance 时跳过校验照常导入', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    // appearance 存在但无 ownerName 键：原样透传（旧导出备份兼容路径）
    const { response } = await sendImportRequest(routerModule, createImportBody({
      backgroundUrl: ''
    }));
    assert.equal(response.status, 200);
    assert.equal(state.importDataCalls.length, 1);
    assert.equal('ownerName' in state.importDataCalls[0].data.appearance, false);

    // 整体无 appearance：importData 收到 undefined
    const { response: noAppearanceResponse } = await sendImportRequest(routerModule, {
      entries: [{ id: 'v17', vndb: {}, user: {} }],
      mode: 'merge'
    });
    assert.equal(noAppearanceResponse.status, 200);
    assert.equal(state.importDataCalls[1].data.appearance, undefined);
  } finally {
    await cleanup();
  }
});

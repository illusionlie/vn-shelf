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

async function loadRouterModule({ authenticated = true, vndbApiToken = 'token-1', searchResults = [], searchError = null } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-vndb-search-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const repositoryStubPath = path.join(tempDir, 'repository.stub.mjs');
  const indexTaskStubPath = path.join(tempDir, 'index-task.stub.mjs');
  const utilsRealPath = path.join(tempDir, 'utils.real.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerVndbSearchTestRegistry = globalThis.__routerVndbSearchTestRegistry || new Map();
  const state = {
    authenticated,
    vndbApiToken,
    searchResults,
    searchError,
    clientTokens: [],
    searchCalls: []
  };
  globalThis.__routerVndbSearchTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerVndbSearchTestRegistry?.get('${testId}');

export async function authMiddleware() {
  // 与真实契约一致：认证成功时必然附带已加载的 settings
  if (state.authenticated) {
    return {
      authenticated: true,
      settings: {
        vndbApiToken: state.vndbApiToken,
        adminPasswordHash: 'hash',
        jwtSecret: 'secret'
      }
    };
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
// 与 src/repository.js 保持一致：router.js 依赖此导出做 status 白名单校验
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function getVNList() { return { items: [] }; }
export async function getStats() { return { total: 0 }; }
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
const state = globalThis.__routerVndbSearchTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function fetchVNDB() {
  return {};
}

export class VNDBClient {
  constructor(token) {
    state.clientTokens.push(token);
  }

  async searchVN(query, limit) {
    state.searchCalls.push({ query, limit });
    if (state.searchError) {
      throw new Error(state.searchError);
    }
    return clone(state.searchResults);
  }
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
      globalThis.__routerVndbSearchTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendSearchRequest(routerModule, query) {
  const request = new Request(`https://example.com/api/vndb/search${query}`, {
    method: 'GET'
  });
  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();
  return { response, payload };
}

test('未认证 → 401 错误信封，无 code，不构造 VNDBClient', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({ authenticated: false });

  try {
    const { response, payload } = await sendSearchRequest(routerModule, '?q=clannad');

    assert.equal(response.status, 401);
    assert.deepEqual(payload, { success: false, error: '未授权' });
    assert.equal(state.clientTokens.length, 0);
  } finally {
    await cleanup();
  }
});

test('q 缺省或 trim 后为空 → 400 中文文案', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    for (const query of ['', '?q=', '?q=%20%20']) {
      const { response, payload } = await sendSearchRequest(routerModule, query);
      assert.equal(response.status, 400, `query=${JSON.stringify(query)}`);
      assert.deepEqual(payload, { success: false, error: '搜索关键词不能为空' });
    }
    assert.equal(state.clientTokens.length, 0);
  } finally {
    await cleanup();
  }
});

test('token 未配置 → 400 中文文案（不走 500），不构造 VNDBClient', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({ vndbApiToken: '' });

  try {
    const { response, payload } = await sendSearchRequest(routerModule, '?q=clannad');

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'VNDB API Token未配置，请先在设置页配置' });
    assert.equal(state.clientTokens.length, 0);
  } finally {
    await cleanup();
  }
});

test('成功 → 统一信封 data 为数组且字段齐全；token 来自 auth.settings；认证端点无 CORS 头', async () => {
  const searchResults = [
    {
      id: 'v17',
      title: 'Ever17',
      original: 'エバーセブンティーン',
      released: '2002-08-29',
      image: 'https://img/x.jpg',
      imageNsfw: false,
      rating: 8.5,
      developers: ['KID']
    }
  ];
  const { routerModule, state, cleanup } = await loadRouterModule({
    vndbApiToken: 'token-abc',
    searchResults
  });

  try {
    const { response, payload } = await sendSearchRequest(routerModule, '?q=ever17');

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      message: '操作成功',
      data: searchResults
    });

    assert.deepEqual(state.clientTokens, ['token-abc']);
    assert.deepEqual(state.searchCalls, [{ query: 'ever17', limit: 10 }]);
    // 认证端点不入 PUBLIC_CORS_PATH_PATTERNS，GET 响应不得附加 CORS 头
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  } finally {
    await cleanup();
  }
});

test('limit clamp：999→20、0→1、非法→10、缺省→10', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    await sendSearchRequest(routerModule, '?q=foo&limit=999');
    await sendSearchRequest(routerModule, '?q=foo&limit=0');
    await sendSearchRequest(routerModule, '?q=foo&limit=abc');
    await sendSearchRequest(routerModule, '?q=foo');

    assert.deepEqual(state.searchCalls.map(call => call.limit), [20, 1, 10, 10]);
  } finally {
    await cleanup();
  }
});

test('q trim 透传、超长静默截断 100 字符', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    await sendSearchRequest(routerModule, `?q=${encodeURIComponent('  命运石之门  ')}`);
    assert.equal(state.searchCalls[0].query, '命运石之门');

    const longQuery = 'a'.repeat(150);
    const { response } = await sendSearchRequest(routerModule, `?q=${longQuery}`);
    assert.equal(response.status, 200);
    assert.equal(state.searchCalls[1].query, 'a'.repeat(100));
  } finally {
    await cleanup();
  }
});

test('VNDB 上游失败 → 500 VNDB API错误信封', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ searchError: '502 - bad gateway' });

  try {
    const { response, payload } = await sendSearchRequest(routerModule, '?q=clannad');

    assert.equal(response.status, 500);
    assert.deepEqual(payload, {
      success: false,
      error: 'VNDB API错误: 502 - bad gateway'
    });
  } finally {
    await cleanup();
  }
});

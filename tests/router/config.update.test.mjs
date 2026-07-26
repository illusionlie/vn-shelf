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
const indexTaskSourcePath = path.join(repoRoot, 'src', 'index-task.js');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultSettings(overrides = {}) {
  return {
    vndbApiToken: '',
    adminPasswordHash: '',
    jwtSecret: '',
    lastIndexTime: null,
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: '',
    ...overrides
  };
}

async function loadRouterModule({ initialSettings = {}, authenticated = true } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const repositoryStubPath = path.join(tempDir, 'repository.stub.mjs');
  const indexTaskStubPath = path.join(tempDir, 'index-task.stub.mjs');
  const utilsStubPath = path.join(tempDir, 'utils.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const ulistImportStubPath = path.join(tempDir, 'ulist-import.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerConfigTestRegistry = globalThis.__routerConfigTestRegistry || new Map();
  const state = {
    settings: createDefaultSettings(initialSettings),
    authenticated,
    setAdminPasswordCalls: [],
    saveSettingsCalls: []
  };
  globalThis.__routerConfigTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerConfigTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function authMiddleware() {
  // 与真实 authMiddleware 契约一致：认证结果附带已加载的 settings，供认证 handler 复用
  return { authenticated: !!state.authenticated, settings: clone(state.settings) };
}

export async function createJWT() {
  return 'stub.jwt.token';
}

export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }

export async function setAdminPassword(env, password) {
  state.setAdminPasswordCounter = (state.setAdminPasswordCounter || 0) + 1;
  const next = clone(state.settings);
  next.adminPasswordHash = \`salt-\${state.setAdminPasswordCounter}:hash-\${password}\`;
  next.jwtSecret = \`jwt-secret-\${state.setAdminPasswordCounter}\`;
  state.settings = next;
  state.setAdminPasswordCalls.push({
    password,
    adminPasswordHash: next.adminPasswordHash,
    jwtSecret: next.jwtSecret
  });
}

export async function isInitialized() {
  return !!(state.settings.adminPasswordHash && state.settings.jwtSecret);
}
`;

  const repositoryStubCode = `
const state = globalThis.__routerConfigTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

// router.js 顶层 import 依赖（status 白名单），与 src/repository.js 保持一致
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getSettings() {
  return clone(state.settings);
}

export async function saveSettings(env, settings) {
  state.settings = clone(settings);
  state.saveSettingsCalls.push(clone(settings));
}

export async function getVNList() {
  return { items: [] };
}

export async function getStats() {
  return {
    total: 0,
    totalPlayTimeMinutes: 0,
    avgRating: 0,
    avgPersonalRating: 0
  };
}

export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function addEntryToList() {}
export async function removeEntryFromList() {}
export async function exportData() {
  return {
    entries: [],
    tierList: {
      tiers: [],
      updatedAt: null
    }
  };
}
export async function importData() {}
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
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
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
export async function fetchVNDB() {
  return {};
}

// router.js 顶层 import 依赖（/api/vndb/search），本套件不触达该路由
export class VNDBClient {
  async searchVN() { return []; }
}
`;

  const indexTaskStubCode = `
export async function startIndexTask() {
  return {
    ok: false,
    status: 500,
    message: 'unexpected index task call'
  };
}

export async function getIndexTaskStatus() {
  return {
    status: 'idle',
    taskId: null,
    total: 0,
    processed: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null,
    lastReconciledAt: null
  };
}
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(repositoryStubPath, repositoryStubCode, 'utf8');
  await fs.writeFile(indexTaskStubPath, indexTaskStubCode, 'utf8');
  await fs.writeFile(ulistImportStubPath, 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(utilsStubPath, utilsStubCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerConfigTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendUpdateConfigRequest(routerModule, body) {
  const request = new Request('https://example.com/api/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();

  return { response, payload };
}

async function sendRequest(routerModule, path, method = 'GET') {
  const request = new Request(`https://example.com${path}`, { method });
  return routerModule.handleRequest(request, {});
}

test('仅修改密码时会更新密码哈希并重新签发 JWT', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    vndbApiToken: 'token-old'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = state.settings.adminPasswordHash;

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-123'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.setAdminPasswordCalls.length, 1);
    assert.notEqual(state.settings.adminPasswordHash, oldHash);
    assert.equal(state.settings.adminPasswordHash, state.setAdminPasswordCalls[0].adminPasswordHash);
    assert.notEqual(state.settings.jwtSecret, 'jwt-secret-old');
    assert.equal(state.settings.jwtSecret, state.setAdminPasswordCalls[0].jwtSecret);
  } finally {
    await cleanup();
  }
});

test('同时修改密码与其他配置字段时会正确更新密码并保留其他字段', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    vndbApiToken: 'token-old',
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: '',
    lastIndexTime: '2024-01-01T00:00:00.000Z'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = state.settings.adminPasswordHash;

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-456',
      vndbApiToken: 'token-new',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com/translations.json'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.setAdminPasswordCalls.length, 1);
    assert.notEqual(state.settings.adminPasswordHash, oldHash);
    assert.equal(state.settings.adminPasswordHash, state.setAdminPasswordCalls[0].adminPasswordHash);
    assert.notEqual(state.settings.jwtSecret, 'jwt-secret-old');
    assert.equal(state.settings.jwtSecret, state.setAdminPasswordCalls[0].jwtSecret);

    assert.equal(state.settings.vndbApiToken, 'token-new');
    assert.equal(state.settings.tagsMode, 'manual');
    assert.equal(state.settings.translateTags, false);
    assert.equal(state.settings.translationUrl, 'https://example.com/translations.json');
    assert.equal(state.settings.lastIndexTime, '2024-01-01T00:00:00.000Z');
  } finally {
    await cleanup();
  }
});

test('不修改密码时不会重置已有凭据', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-stable:hash-stable',
    jwtSecret: 'jwt-secret-stable',
    vndbApiToken: 'token-old',
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: ''
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = deepClone(state.settings.adminPasswordHash);
    const oldSecret = deepClone(state.settings.jwtSecret);

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      vndbApiToken: 'token-updated',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com/tags.json'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.setAdminPasswordCalls.length, 0);
    assert.equal(state.settings.adminPasswordHash, oldHash);
    assert.equal(state.settings.jwtSecret, oldSecret);

    assert.equal(state.settings.vndbApiToken, 'token-updated');
    assert.equal(state.settings.tagsMode, 'manual');
    assert.equal(state.settings.translateTags, false);
    assert.equal(state.settings.translationUrl, 'https://example.com/tags.json');
  } finally {
    await cleanup();
  }
});

test('匿名 GET /api/config/appearance 返回外观与公开 tags 配置默认值', async () => {
  // 覆盖为 undefined：getSettings stub 的 JSON 克隆会丢弃这些键，从而触发默认值规则
  const { routerModule, cleanup } = await loadRouterModule({
    initialSettings: {
      tagsMode: undefined,
      translateTags: undefined,
      translationUrl: undefined
    },
    authenticated: false
  });

  try {
    const response = await sendRequest(routerModule, '/api/config/appearance');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.backgroundUrl, '');
    assert.equal(payload.data.backgroundOverlay, 0.5);
    assert.equal(payload.data.backgroundBlur, 4);
    assert.equal(payload.data.tagsMode, 'vndb');
    assert.equal(payload.data.translateTags, true);
    assert.equal(payload.data.translationUrl, '');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
  } finally {
    await cleanup();
  }
});

test('匿名 GET /api/config/appearance 返回已配置的 tags 字段且不泄露敏感信息', async () => {
  const { routerModule, cleanup } = await loadRouterModule({
    initialSettings: {
      adminPasswordHash: 'salt-secret:hash-secret',
      jwtSecret: 'jwt-secret-secret',
      vndbApiToken: 'token-secret',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com/tags.json',
      backgroundUrl: 'https://example.com/bg.webp',
      backgroundOverlay: 0.3,
      backgroundBlur: 8
    },
    authenticated: false
  });

  try {
    const response = await sendRequest(routerModule, '/api/config/appearance');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.tagsMode, 'manual');
    assert.equal(payload.data.translateTags, false);
    assert.equal(payload.data.translationUrl, 'https://example.com/tags.json');
    assert.equal(payload.data.backgroundUrl, 'https://example.com/bg.webp');
    assert.equal(payload.data.backgroundOverlay, 0.3);
    assert.equal(payload.data.backgroundBlur, 8);

    assert.equal('vndbApiToken' in payload.data, false);
    assert.equal('adminPasswordHash' in payload.data, false);
    assert.equal('jwtSecret' in payload.data, false);
  } finally {
    await cleanup();
  }
});

test('公开只读端点 GET 响应带 CORS 头且 OPTIONS 预检返回 204', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ authenticated: false });

  try {
    const publicPaths = ['/api/vn', '/api/vn/v17', '/api/stats', '/api/tier', '/api/config/appearance'];

    for (const path of publicPaths) {
      const optionsResponse = await sendRequest(routerModule, path, 'OPTIONS');
      assert.equal(optionsResponse.status, 204, `OPTIONS ${path} 应返回 204`);
      assert.equal(optionsResponse.headers.get('Access-Control-Allow-Origin'), '*', `OPTIONS ${path} 应带 Allow-Origin`);
      assert.equal(optionsResponse.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS', `OPTIONS ${path} 应带 Allow-Methods`);
      assert.equal(optionsResponse.headers.get('Access-Control-Max-Age'), '86400', `OPTIONS ${path} 应带 Max-Age`);

      const getResponse = await sendRequest(routerModule, path, 'GET');
      assert.equal(getResponse.headers.get('Access-Control-Allow-Origin'), '*', `GET ${path} 应带 Allow-Origin`);
    }

    // 公开端点即使返回 404（条目不存在）也携带 CORS 头，跨域调用方可读取错误
    const missingEntryResponse = await sendRequest(routerModule, '/api/vn/v17', 'GET');
    assert.equal(missingEntryResponse.status, 404);
    assert.equal(missingEntryResponse.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    await cleanup();
  }
});

test('认证端点响应不带 CORS 头且 OPTIONS 不提供预检', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ authenticated: true });

  try {
    const getConfigResponse = await sendRequest(routerModule, '/api/config', 'GET');
    assert.equal(getConfigResponse.status, 200);
    assert.equal(getConfigResponse.headers.get('Access-Control-Allow-Origin'), null);

    const optionsConfigResponse = await sendRequest(routerModule, '/api/config', 'OPTIONS');
    assert.equal(optionsConfigResponse.status, 404);
    assert.equal(optionsConfigResponse.headers.get('Access-Control-Allow-Origin'), null);

    const optionsExportResponse = await sendRequest(routerModule, '/api/export', 'OPTIONS');
    assert.equal(optionsExportResponse.status, 404);
    assert.equal(optionsExportResponse.headers.get('Access-Control-Allow-Origin'), null);
  } finally {
    await cleanup();
  }
});

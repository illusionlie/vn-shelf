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

// router.js 顶层 import 依赖（公开端点缓存包裹与写路径版本失效）。
// 本套件不触达缓存行为：servePublicCached 直通 handler、bump 为 no-op，
// 缓存语义由 tests/router/http-cache.test.mjs 以真实实现覆盖
const HTTP_CACHE_STUB_CODE = `export async function servePublicCached(request, env, ctx, path, handler) {
  return handler();
}
export async function bumpCacheVersion() {}
`;

// turnstile 桩：本套件不触达 siteverify 行为（语义由 login.turnstile /
// config.turnstile 套件覆盖），直通 pass 即可
const TURNSTILE_STUB_CODE = `export async function verifyTurnstileToken() {
  return { outcome: 'pass' };
}
`;


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
    saveSettingsCalls: [],
    createJWTCalls: [],
    setAuthCookieCalls: []
  };
  globalThis.__routerConfigTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerConfigTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function authMiddleware() {
  // 与真实 authMiddleware 契约一致：认证结果附带已加载的 settings，供认证 handler 复用
  return { authenticated: !!state.authenticated, settings: clone(state.settings) };
}

export async function createJWT(secret, payload) {
  state.createJWTCalls.push({ secret, payload: clone(payload) });
  return 'stub.jwt.token';
}

// 与真实实现（src/auth.js）镜像：在响应头附加 auth_token Cookie，供密码重签发路径断言
export function setAuthCookie(response, token, secure = true) {
  state.setAuthCookieCalls.push({ token, secure });
  const cookieValue = [
    \`auth_token=\${token}\`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    \`Max-Age=\${24 * 60 * 60}\`
  ].filter(Boolean).join('; ');
  response.headers.set('Set-Cookie', cookieValue);
}
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
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';")
    .replace(/from '\.\/http-cache\.js';/, "from './http-cache.stub.mjs';")
    .replace(/from '\.\/turnstile\.js';/, "from './turnstile.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(repositoryStubPath, repositoryStubCode, 'utf8');
  await fs.writeFile(indexTaskStubPath, indexTaskStubCode, 'utf8');
  await fs.writeFile(ulistImportStubPath, 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(utilsStubPath, utilsStubCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'http-cache.stub.mjs'), HTTP_CACHE_STUB_CODE, 'utf8');
  await fs.writeFile(path.join(tempDir, 'turnstile.stub.mjs'), TURNSTILE_STUB_CODE, 'utf8');
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

test('未认证 PUT /api/config 返回 401 且不落库', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({ authenticated: false });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      ownerName: '小明'
    });

    assert.equal(response.status, 401);
    assert.deepEqual(payload, { success: false, error: '未授权' });
    assert.equal(state.saveSettingsCalls.length, 0);
  } finally {
    await cleanup();
  }
});

test('PUT /api/config ownerName：合法输入 trim 后落库，空串清除个性化', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    initialSettings: { ownerName: '旧主人' }
  });

  try {
    const { response: trimResponse } = await sendUpdateConfigRequest(routerModule, {
      ownerName: '  小明  '
    });
    assert.equal(trimResponse.status, 200);
    assert.equal(state.settings.ownerName, '小明');

    // 30 字符（trim 后）边界值通过
    const boundaryName = '明'.repeat(30);
    const { response: boundaryResponse } = await sendUpdateConfigRequest(routerModule, {
      ownerName: boundaryName
    });
    assert.equal(boundaryResponse.status, 200);
    assert.equal(state.settings.ownerName, boundaryName);

    // 空串合法 = 清除个性化
    const { response: clearResponse } = await sendUpdateConfigRequest(routerModule, {
      ownerName: ''
    });
    assert.equal(clearResponse.status, 200);
    assert.equal(state.settings.ownerName, '');
  } finally {
    await cleanup();
  }
});

test('PUT /api/config ownerName：非字符串与 trim 后超 30 字符均返回 400', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    initialSettings: { ownerName: '旧主人' }
  });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      ownerName: 123
    });
    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'ownerName 必须为字符串' });

    const { response: longResponse, payload: longPayload } = await sendUpdateConfigRequest(routerModule, {
      ownerName: '明'.repeat(31)
    });
    assert.equal(longResponse.status, 400);
    assert.deepEqual(longPayload, { success: false, error: 'ownerName 长度不能超过 30' });

    // 校验失败不落库
    assert.equal(state.saveSettingsCalls.length, 0);
    assert.equal(state.settings.ownerName, '旧主人');
  } finally {
    await cleanup();
  }
});

test('混合请求（合法 newPassword + 非法 ownerName）返回 400 且凭据与配置零变更', async () => {
  // 先校验、后写入的核心场景：密码合法但 ownerName 非法时，
  // 不得发生 setAdminPassword（半提交窗口：密码已改写 + jwtSecret 已轮换但响应报 400）
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    ownerName: '旧主人'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-789',
      ownerName: 123
    });
    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'ownerName 必须为字符串' });

    const { response: longResponse, payload: longPayload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-789',
      ownerName: '明'.repeat(31)
    });
    assert.equal(longResponse.status, 400);
    assert.deepEqual(longPayload, { success: false, error: 'ownerName 长度不能超过 30' });

    // 凭据零变更：密码哈希与 jwtSecret 未被改写，settings blob 未落库，无 token 重签发
    assert.equal(state.setAdminPasswordCalls.length, 0);
    assert.equal(state.saveSettingsCalls.length, 0);
    assert.equal(state.createJWTCalls.length, 0);
    assert.equal(state.setAuthCookieCalls.length, 0);
    assert.equal(state.settings.adminPasswordHash, 'salt-old:hash-old');
    assert.equal(state.settings.jwtSecret, 'jwt-secret-old');
    assert.equal(state.settings.ownerName, '旧主人');
  } finally {
    await cleanup();
  }
});

test('混合请求（过短 newPassword + 合法 ownerName）返回 400 且零写入', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    ownerName: '旧主人'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: '12345',
      ownerName: '小明'
    });
    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: '密码长度至少6位' });

    assert.equal(state.setAdminPasswordCalls.length, 0);
    assert.equal(state.saveSettingsCalls.length, 0);
    assert.equal(state.createJWTCalls.length, 0);
    assert.equal(state.setAuthCookieCalls.length, 0);
    assert.equal(state.settings.adminPasswordHash, 'salt-old:hash-old');
    assert.equal(state.settings.jwtSecret, 'jwt-secret-old');
    assert.equal(state.settings.ownerName, '旧主人');
  } finally {
    await cleanup();
  }
});

test('混合请求（合法 newPassword + 合法 ownerName）成功：密码生效、ownerName 落库、响应携新 token', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    ownerName: '旧主人'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-789',
      ownerName: '  小明  '
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    // 密码生效：哈希与 jwtSecret 均切换为 setAdminPassword 写入的新值
    assert.equal(state.setAdminPasswordCalls.length, 1);
    assert.equal(state.settings.adminPasswordHash, state.setAdminPasswordCalls[0].adminPasswordHash);
    assert.equal(state.settings.jwtSecret, state.setAdminPasswordCalls[0].jwtSecret);

    // ownerName trim 后落库（校验与赋值共用同一 trim 结果）
    assert.equal(state.settings.ownerName, '小明');

    // token 基于轮换后的 jwtSecret 重签发，响应携新 token Cookie
    assert.equal(state.createJWTCalls.length, 1);
    assert.equal(state.createJWTCalls[0].secret, state.setAdminPasswordCalls[0].jwtSecret);
    assert.deepEqual(state.createJWTCalls[0].payload, { sub: 'admin' });
    assert.deepEqual(state.setAuthCookieCalls, [{ token: 'stub.jwt.token', secure: true }]);
    assert.match(response.headers.get('Set-Cookie'), /^auth_token=stub\.jwt\.token;/);
  } finally {
    await cleanup();
  }
});

test('GET /api/config 返回 ownerName（未配置时为空串）', async () => {
  const { routerModule, cleanup } = await loadRouterModule({
    initialSettings: { ownerName: '小明' }
  });

  try {
    const response = await sendRequest(routerModule, '/api/config');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.ownerName, '小明');
    assert.equal('vndbApiToken' in payload.data, false);
  } finally {
    await cleanup();
  }

  // 未配置（settings 无 ownerName 键）时空串
  const fresh = await loadRouterModule({});
  try {
    const response = await sendRequest(fresh.routerModule, '/api/config');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.ownerName, '');
  } finally {
    await fresh.cleanup();
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
    assert.equal(payload.data.ownerName, '');
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
      ownerName: '小明',
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
    assert.equal(payload.data.ownerName, '小明');
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

test('PUT /api/config Turnstile 两键：合法输入 trim 后落库，空串清除，半配独立可存（AC7）', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    // trim 后落库；200 字符边界值（trim 后）通过
    const siteKeyBoundary = '0x' + 'a'.repeat(198);
    const { response } = await sendUpdateConfigRequest(routerModule, {
      turnstileSiteKey: `  ${siteKeyBoundary}  `,
      turnstileSecretKey: '  0x-secret-key  '
    });
    assert.equal(response.status, 200);
    assert.equal(state.settings.turnstileSiteKey, siteKeyBoundary);
    assert.equal(state.settings.turnstileSecretKey, '0x-secret-key');

    // 独立可存：只提交 siteKey，secret 保持不动（半配状态合法落库）
    const { response: halfResponse } = await sendUpdateConfigRequest(routerModule, {
      turnstileSiteKey: '0x-new-site-key'
    });
    assert.equal(halfResponse.status, 200);
    assert.equal(state.settings.turnstileSiteKey, '0x-new-site-key');
    assert.equal(state.settings.turnstileSecretKey, '0x-secret-key');

    // 空串合法 = 清除两键
    const { response: clearResponse } = await sendUpdateConfigRequest(routerModule, {
      turnstileSiteKey: '',
      turnstileSecretKey: ''
    });
    assert.equal(clearResponse.status, 200);
    assert.equal(state.settings.turnstileSiteKey, '');
    assert.equal(state.settings.turnstileSecretKey, '');
  } finally {
    await cleanup();
  }
});

test('PUT /api/config Turnstile 两键：非字符串与 trim 后超 200 均返回 400 且零持久化（AC7）', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    turnstileSiteKey: '0x-kept-site',
    turnstileSecretKey: '0x-kept-secret'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const cases = [
      [{ turnstileSiteKey: 123 }, 'turnstileSiteKey 必须为字符串'],
      [{ turnstileSiteKey: 'x'.repeat(201) }, 'turnstileSiteKey 长度不能超过 200'],
      [{ turnstileSecretKey: [] }, 'turnstileSecretKey 必须为字符串'],
      [{ turnstileSecretKey: `  ${'x'.repeat(201)}  ` }, 'turnstileSecretKey 长度不能超过 200']
    ];

    for (const [body, expectedError] of cases) {
      const { response, payload } = await sendUpdateConfigRequest(routerModule, body);
      assert.equal(response.status, 400, `${JSON.stringify(body)} 应 400`);
      assert.deepEqual(payload, { success: false, error: expectedError });
    }

    // 校验失败不落库，存量键保持不变
    assert.equal(state.saveSettingsCalls.length, 0);
    assert.equal(state.setAdminPasswordCalls.length, 0);
    assert.equal(state.settings.turnstileSiteKey, '0x-kept-site');
    assert.equal(state.settings.turnstileSecretKey, '0x-kept-secret');
  } finally {
    await cleanup();
  }
});

test('混合请求（合法 newPassword + 非法 turnstileSecretKey）返回 400 且双持久化零调用（AC7）', async () => {
  // 09-15 前置校验不变量：任何 400 之前 setAdminPassword / saveSettings 零调用
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-123',
      turnstileSecretKey: 42
    });
    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: 'turnstileSecretKey 必须为字符串' });

    assert.equal(state.setAdminPasswordCalls.length, 0, '400 时不得调用 setAdminPassword');
    assert.equal(state.saveSettingsCalls.length, 0, '400 时不得调用 saveSettings');
    assert.equal(state.createJWTCalls.length, 0);
    assert.equal(state.setAuthCookieCalls.length, 0);
    assert.equal(state.settings.adminPasswordHash, 'salt-old:hash-old');
    assert.equal(state.settings.jwtSecret, 'jwt-secret-old');
  } finally {
    await cleanup();
  }
});

test('GET /api/config 返回明文 turnstileSiteKey 与 hasTurnstileSecret 布尔（AC7）', async () => {
  // 未配置：siteKey 空串 + hasTurnstileSecret false
  const { routerModule, cleanup } = await loadRouterModule({});
  try {
    const response = await sendRequest(routerModule, '/api/config');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.turnstileSiteKey, '');
    assert.equal(payload.data.hasTurnstileSecret, false);
  } finally {
    await cleanup();
  }

  // 已配置：明文 siteKey + true，且不回显 secret 本体
  const configured = await loadRouterModule({
    initialSettings: {
      turnstileSiteKey: '0x-site-key',
      turnstileSecretKey: '0x-secret-key'
    }
  });
  try {
    const response = await sendRequest(configured.routerModule, '/api/config');
    const payload = await response.json();
    assert.equal(payload.data.turnstileSiteKey, '0x-site-key');
    assert.equal(payload.data.hasTurnstileSecret, true);
    assert.equal('turnstileSecretKey' in payload.data, false, 'secret 不得明文回显');
  } finally {
    await configured.cleanup();
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

    // Turnstile 测试端点为认证写端点：同样不带 CORS 头、OPTIONS 404
    const optionsTurnstileResponse = await sendRequest(routerModule, '/api/config/turnstile/test', 'OPTIONS');
    assert.equal(optionsTurnstileResponse.status, 404);
    assert.equal(optionsTurnstileResponse.headers.get('Access-Control-Allow-Origin'), null);
  } finally {
    await cleanup();
  }
});

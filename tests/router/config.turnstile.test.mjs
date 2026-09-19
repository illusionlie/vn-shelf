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
 * POST /api/config/turnstile/test 端点测试（AC8）。
 *
 * 关键断言组：
 * - 未认证 401 / 缺参 400（siteverify 桩零调用）
 * - **输入值与已存值分离**：settings 桩预置与请求体不同的 turnstile 值，
 *   断言 siteverify 桩收到的是请求体输入值（支撑「先测试后保存」）
 * - pass → ok:true / invalid → 200 + ok:false / error → 503（fail-closed）
 *
 * turnstile 桩为可控 outcome 开关（复刻协议不复刻实现，见 design §8 桩策略）。
 */

// router.js 顶层 import 依赖：本套件不触达缓存行为
const HTTP_CACHE_STUB_CODE = `export async function servePublicCached(request, env, ctx, path, handler) {
  return handler();
}
export async function bumpCacheVersion() {}
`;

async function loadRouterModule({
  authenticated = true,
  turnstileOutcome = 'pass'
} = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-config-turnstile-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerConfigTurnstileTestRegistry =
    globalThis.__routerConfigTurnstileTestRegistry || new Map();
  const state = {
    authenticated,
    // 已存 settings 值与测试请求体值刻意不同，用于「用输入值而非已存值」分离断言
    storedSettings: {
      vndbApiToken: '',
      adminPasswordHash: 'salt:hash',
      jwtSecret: 'test-secret',
      turnstileSiteKey: 'STORED-site-key',
      turnstileSecretKey: 'STORED-secret-key'
    },
    turnstileOutcome,
    turnstileVerifyCalls: [],
    saveSettingsCalls: []
  };
  globalThis.__routerConfigTurnstileTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerConfigTurnstileTestRegistry?.get('${testId}');

export async function authMiddleware() {
  return { authenticated: !!state.authenticated, settings: state.storedSettings };
}
export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerConfigTurnstileTestRegistry?.get('${testId}');

export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getSettings() {
  return state.storedSettings;
}
export async function saveSettings(_env, settings) {
  state.saveSettingsCalls.push(settings);
}
export async function getVNList() { return { items: [] }; }
export async function getStats() { return {}; }
export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function importData() {}
export async function exportData() { return {}; }
export async function getTierList() { return { tiers: [], updatedAt: null }; }
export async function saveTierList(_env, tierList) { return tierList; }
export async function updateVNTier() { return null; }
export async function batchUpdateVNTiers() { return []; }
export async function clearTierAssignments() { return 0; }
export async function tryAcquireIndexStartLock() { return true; }
export async function releaseIndexStartLock() {}
`;

  const turnstileStubCode = `
const state = globalThis.__routerConfigTurnstileTestRegistry?.get('${testId}');

export async function verifyTurnstileToken(params) {
  state.turnstileVerifyCalls.push({
    secretKey: params?.secretKey,
    token: params?.token,
    remoteIp: params?.remoteIp
  });
  if (state.turnstileOutcome === 'invalid') {
    return { outcome: 'invalid', errorCodes: ['invalid-input-response'] };
  }
  if (state.turnstileOutcome === 'error') {
    return { outcome: 'error' };
  }
  return { outcome: 'pass' };
}
`;

  const indexTaskStubCode = `
export async function startIndexTask() {
  return { ok: false, status: 500, message: 'unexpected index task call' };
}
export async function getIndexTaskStatus() {
  return { status: 'idle' };
}
`;

  const vndbStubCode = `
export async function fetchVNDB() { return {}; }
export class VNDBClient {
  async searchVN() { return []; }
}
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.real.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';")
    .replace(/from '\.\/http-cache\.js';/, "from './http-cache.stub.mjs';")
    .replace(/from '\.\/turnstile\.js';/, "from './turnstile.stub.mjs';");

  await fs.writeFile(path.join(tempDir, 'auth.stub.mjs'), authStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'repository.stub.mjs'), repositoryStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'index-task.stub.mjs'), indexTaskStubCode, 'utf8');
  await fs.writeFile(
    path.join(tempDir, 'ulist-import.stub.mjs'),
    'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n',
    'utf8'
  );
  await fs.writeFile(path.join(tempDir, 'utils.real.mjs'), utilsSourceCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'vndb.stub.mjs'), vndbStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'http-cache.stub.mjs'), HTTP_CACHE_STUB_CODE, 'utf8');
  await fs.writeFile(path.join(tempDir, 'turnstile.stub.mjs'), turnstileStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerConfigTurnstileTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendTestTurnstileRequest(routerModule, body, { ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) {
    headers['CF-Connecting-IP'] = ip;
  }
  const request = new Request('https://example.com/api/config/turnstile/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();
  return { response, payload };
}

const VALID_BODY = {
  siteKey: 'INPUT-site-key',
  secretKey: 'INPUT-secret-key',
  token: 'INPUT-token'
};

test('AC8：未认证 → 401 且不触达 siteverify', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({ authenticated: false });

  try {
    const { response, payload } = await sendTestTurnstileRequest(routerModule, VALID_BODY);

    assert.equal(response.status, 401);
    assert.deepEqual(payload, { success: false, error: '未授权' });
    assert.equal(state.turnstileVerifyCalls.length, 0);
  } finally {
    await cleanup();
  }
});

test('AC8：缺参 / 非法形态 → 400 且不触达 siteverify', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const cases = [
      { siteKey: '', secretKey: 's', token: 't' },
      { siteKey: '   ', secretKey: 's', token: 't' },
      { secretKey: 's', token: 't' },
      { siteKey: 123, secretKey: 's', token: 't' },
      { siteKey: 's', secretKey: '', token: 't' },
      { siteKey: 's', secretKey: 's', token: '' },
      { siteKey: 's', secretKey: 's' },
      { siteKey: 's', secretKey: 's', token: 42 },
      { siteKey: 's', secretKey: 's', token: 'x'.repeat(2049) }
    ];

    for (const body of cases) {
      const { response, payload } = await sendTestTurnstileRequest(routerModule, body);
      assert.equal(response.status, 400, `${JSON.stringify(body)} 应 400`);
      assert.deepEqual(payload, { success: false, error: 'siteKey、secretKey 与 token 均必须为非空字符串' });
    }

    assert.equal(state.turnstileVerifyCalls.length, 0, '参数校验失败不得调用 siteverify');
  } finally {
    await cleanup();
  }
});

test('AC8：siteverify 用请求体输入值而非已存 settings 值（先测试后保存语义）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const { response } = await sendTestTurnstileRequest(routerModule, VALID_BODY, {
      ip: '203.0.113.4'
    });
    assert.equal(response.status, 200);

    assert.equal(state.turnstileVerifyCalls.length, 1);
    // 桩分离断言：收到的必须是 INPUT-* 请求体值，而非 STORED-* 已存值
    assert.equal(state.turnstileVerifyCalls[0].secretKey, 'INPUT-secret-key');
    assert.equal(state.turnstileVerifyCalls[0].token, 'INPUT-token');
    assert.equal(state.turnstileVerifyCalls[0].remoteIp, '203.0.113.4');
    // 测试端点不落库
    assert.equal(state.saveSettingsCalls.length, 0, '测试端点不得写 settings');
  } finally {
    await cleanup();
  }
});

test('AC8：outcome pass → 200 + data.ok:true', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ turnstileOutcome: 'pass' });

  try {
    const { response, payload } = await sendTestTurnstileRequest(routerModule, VALID_BODY);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { ok: true });
  } finally {
    await cleanup();
  }
});

test('AC8：outcome invalid → 200 + data.ok:false + errorCodes（测试失败是有效结果）', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ turnstileOutcome: 'invalid' });

  try {
    const { response, payload } = await sendTestTurnstileRequest(routerModule, VALID_BODY);

    assert.equal(response.status, 200, 'invalid 是有效测试结果，不得 4xx/5xx');
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { ok: false, errorCodes: ['invalid-input-response'] });
  } finally {
    await cleanup();
  }
});

test('AC8：outcome error → 503（测试端点 fail-closed，异常不给假绿）', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ turnstileOutcome: 'error' });

  try {
    const { response, payload } = await sendTestTurnstileRequest(routerModule, VALID_BODY);

    assert.equal(response.status, 503);
    assert.deepEqual(payload, { success: false, error: '人机验证服务暂时不可用，请稍后重试' });
    assert.equal('code' in payload, false, '错误信封不得携带 code 字段');
  } finally {
    await cleanup();
  }
});

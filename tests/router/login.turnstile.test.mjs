import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateLoginAttempt } from '../../src/login-ratelimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'router.js');
const utilsSourcePath = path.join(repoRoot, 'src', 'utils.js');

/**
 * 登录 Turnstile 接线 router 集成测试（AC1-AC6）。
 *
 * 沿用「复制 router.js 源码替换 import 为桩」技术（见 envelope.test.mjs /
 * login.ratelimit.test.mjs）。与限流桩的差异（design §8）：限流桩内嵌真实纯函数
 * （判定逻辑必须真实）；turnstile 桩是可控 outcome 开关（pass/invalid/error 由测试
 * 指令）——verifyTurnstileToken 是网络胶水而非判定逻辑，其语义已由
 * tests/auth/turnstile.test.mjs 直测全分支覆盖，本套件关注接线顺序与信封。
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createFakeLoginRateLock(seedStates = {}) {
  const storage = new Map(Object.entries(seedStates));

  function stubFor(ip) {
    return {
      async fetch(input, init) {
        const url = new URL(typeof input === 'string' ? input : input.url);

        if (url.pathname === '/precheck') {
          const { allowed, retryAfterSec } = evaluateLoginAttempt(storage.get(ip) ?? null, {
            now: Date.now(),
            success: true
          });
          return jsonResponse({ allowed, retryAfterSec: retryAfterSec ?? null });
        }

        if (url.pathname === '/record') {
          let body = {};
          try {
            body = JSON.parse(init?.body || '{}');
          } catch {
            body = {};
          }
          const next = evaluateLoginAttempt(storage.get(ip) ?? null, {
            now: Date.now(),
            success: body.success === true
          });
          storage.set(ip, {
            failures: next.failures,
            windowStart: next.windowStart,
            lockUntil: next.lockUntil
          });
          return jsonResponse({
            allowed: next.allowed,
            failures: next.failures,
            lockUntil: next.lockUntil
          });
        }

        return jsonResponse({ success: false, error: 'Not Found' }, 404);
      }
    };
  }

  return {
    storage,
    idFromName(ip) {
      return { ip };
    },
    get(id) {
      return stubFor(id.ip);
    }
  };
}

// router.js 顶层 import 依赖（公开端点缓存包裹与写路径版本失效）。
// 本套件不触达缓存行为：servePublicCached 直通 handler、bump 为 no-op
const HTTP_CACHE_STUB_CODE = `export async function servePublicCached(request, env, ctx, path, handler) {
  return handler();
}
export async function bumpCacheVersion() {}
`;

async function loadRouterModule({
  turnstileSiteKey = '',
  turnstileSecretKey = '',
  turnstileOutcome = 'pass'
} = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-login-turnstile-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerLoginTurnstileTestRegistry =
    globalThis.__routerLoginTurnstileTestRegistry || new Map();
  const state = {
    settings: {
      vndbApiToken: '',
      adminPasswordHash: 'salt:hash',
      jwtSecret: 'test-secret',
      turnstileSiteKey,
      turnstileSecretKey
    },
    turnstileOutcome,
    turnstileVerifyCalls: [],
    verifyCalls: 0,
    getSettingsCalls: 0
  };
  globalThis.__routerLoginTurnstileTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerLoginTurnstileTestRegistry?.get('${testId}');

export async function authMiddleware() {
  return { authenticated: false, error: 'No token' };
}

export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie(response, token) {
  response.headers.set('Set-Cookie', 'auth_token=' + token);
}
export function clearAuthCookie() {}
export async function verifyAdminPassword(_settings, password) {
  state.verifyCalls += 1;
  return password === 'correct-password';
}
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerLoginTurnstileTestRegistry?.get('${testId}');

export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getSettings() {
  state.getSettingsCalls += 1;
  return state.settings;
}
export async function saveSettings() {}
export async function getVNList() { return { items: [] }; }
export async function getVNEntry() { return null; }
export async function getStats() { return {}; }
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
const state = globalThis.__routerLoginTurnstileTestRegistry?.get('${testId}');

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
export async function fetchVNDB() {
  return {};
}

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
      globalThis.__routerLoginTurnstileTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function createLoginRequest(body, { ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) {
    headers['CF-Connecting-IP'] = ip;
  }
  return new Request('https://example.com/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function sendLogin(routerModule, body, env, options = {}) {
  const response = await routerModule.handleRequest(createLoginRequest(body, options), env);
  const payload = await response.json();
  return { response, payload };
}

const ENABLED_OPTIONS = {
  turnstileSiteKey: '0x-site-key',
  turnstileSecretKey: '0x-secret-key'
};

test('AC1：两键均未配置 → 无 token 登录与现状一致，siteverify 零调用', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    // 现状行为逐项对齐：错误密码 401 + 计入限流；正确密码 200 成功信封
    const wrong = await sendLogin(routerModule, { password: 'wrong-password' }, env);
    assert.equal(wrong.response.status, 401);
    assert.deepEqual(wrong.payload, { success: false, error: '密码错误' });
    assert.equal(loginRateLock.storage.get('local').failures, 1, '失败仍正常计数');

    const success = await sendLogin(routerModule, { password: 'correct-password' }, env);
    assert.equal(success.response.status, 200);
    assert.deepEqual(success.payload, { success: true, message: '登录成功', data: null });

    assert.equal(state.turnstileVerifyCalls.length, 0, '未配置时不得调用 siteverify');

    // status 端点返回 turnstileSiteKey: ''
    const statusResponse = await routerModule.handleRequest(
      new Request('https://example.com/api/auth/status'),
      env
    );
    const statusPayload = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusPayload.data.turnstileSiteKey, '');
  } finally {
    await cleanup();
  }
});

test('AC1：半配（仅 siteKey / 仅 secretKey）→ 行为同未配置，siteverify 零调用', async () => {
  for (const halfOptions of [
    { turnstileSiteKey: '0x-site-key' },
    { turnstileSecretKey: '0x-secret-key' }
  ]) {
    const { routerModule, state, cleanup } = await loadRouterModule(halfOptions);

    try {
      const env = { LOGIN_RATE_LOCK: createFakeLoginRateLock() };

      const noToken = await sendLogin(routerModule, { password: 'wrong-password' }, env);
      assert.equal(noToken.response.status, 401, '半配时无 token 不得被 Turnstile 拦截');
      assert.equal(state.turnstileVerifyCalls.length, 0, '半配不得调用 siteverify');

      // 双钥匙门同样作用于 status 输出：半配不暴露 siteKey（widget 可见 ⟺ 后端强制校验）
      const statusResponse = await routerModule.handleRequest(
        new Request('https://example.com/api/auth/status'),
        env
      );
      const statusPayload = await statusResponse.json();
      assert.equal(statusPayload.data.turnstileSiteKey, '', '半配不得向前端暴露 siteKey');
    } finally {
      await cleanup();
    }
  }
});

test('AC2：已启用 + 无 token → 400，密码校验与限流计数均为 0', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule(ENABLED_OPTIONS);

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(routerModule, { password: 'correct-password' }, env);

    assert.equal(response.status, 400);
    assert.deepEqual(payload, { success: false, error: '请完成人机验证' });
    assert.equal('code' in payload, false, '错误信封不得携带 code 字段');

    // 密码未校验（PBKDF2 未消耗）、siteverify 未调用、限流未计数
    assert.equal(state.verifyCalls, 0, '缺 token 时不得执行 verifyAdminPassword');
    assert.equal(state.turnstileVerifyCalls.length, 0, '缺 token 时不得调用 siteverify');
    assert.equal(loginRateLock.storage.size, 0, '缺 token 时不得计入限流计数');
  } finally {
    await cleanup();
  }
});

test('AC3：已启用 + token invalid → 403，密码校验与限流计数均为 0', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    ...ENABLED_OPTIONS,
    turnstileOutcome: 'invalid'
  });

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(
      routerModule,
      { password: 'correct-password', turnstileToken: 'spent-token' },
      env
    );

    assert.equal(response.status, 403);
    assert.deepEqual(payload, { success: false, error: '人机验证失败，请重试' });
    assert.equal('code' in payload, false, '错误信封不得携带 code 字段');

    assert.equal(state.turnstileVerifyCalls.length, 1);
    assert.equal(state.turnstileVerifyCalls[0].secretKey, '0x-secret-key');
    assert.equal(state.turnstileVerifyCalls[0].token, 'spent-token');
    // Turnstile 拒绝时密码未校验、限流不计数（限流语义 = 密码尝试次数）
    assert.equal(state.verifyCalls, 0, 'Turnstile 拒绝时不得执行 verifyAdminPassword');
    assert.equal(loginRateLock.storage.size, 0, 'Turnstile 拒绝时不得计入限流计数');
  } finally {
    await cleanup();
  }
});

test('AC3：remoteip 传真实 CF-Connecting-IP，无边缘头时不携带', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule(ENABLED_OPTIONS);

  try {
    const env = { LOGIN_RATE_LOCK: createFakeLoginRateLock() };

    await sendLogin(
      routerModule,
      { password: 'correct-password', turnstileToken: 'tok' },
      env,
      { ip: '198.51.100.3' }
    );
    await sendLogin(routerModule, { password: 'correct-password', turnstileToken: 'tok' }, env);

    assert.equal(state.turnstileVerifyCalls.length, 2);
    assert.equal(state.turnstileVerifyCalls[0].remoteIp, '198.51.100.3');
    assert.equal(state.turnstileVerifyCalls[1].remoteIp, '', '无边缘头时不得传 local 占位 IP');
  } finally {
    await cleanup();
  }
});

test('AC4：已启用 + token pass + 密码正确 → 200 登录成功（信封形态不变）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    ...ENABLED_OPTIONS,
    turnstileOutcome: 'pass'
  });

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(
      routerModule,
      { password: 'correct-password', turnstileToken: 'valid-token' },
      env
    );

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '登录成功', data: null });
    assert.match(response.headers.get('Set-Cookie'), /^auth_token=stub\.jwt\.token/);
    assert.equal(state.turnstileVerifyCalls.length, 1);

    // token pass 后密码正常校验并记录成功（计数清零语义不变）
    assert.equal(state.verifyCalls, 1);
    assert.equal(loginRateLock.storage.get('local').failures, 0);
  } finally {
    await cleanup();
  }
});

test('AC4：token pass + 密码错误 → 401（Turnstile 通过不豁免密码校验）', async () => {
  const { routerModule, cleanup } = await loadRouterModule(ENABLED_OPTIONS);

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(
      routerModule,
      { password: 'wrong-password', turnstileToken: 'valid-token' },
      env
    );

    assert.equal(response.status, 401);
    assert.deepEqual(payload, { success: false, error: '密码错误' });
    assert.equal(loginRateLock.storage.get('local').failures, 1, '密码失败仍正常计数');
  } finally {
    await cleanup();
  }
});

test('AC5：siteverify 异常（outcome error）→ fail-open 放行，正确密码仍 200', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule({
    ...ENABLED_OPTIONS,
    turnstileOutcome: 'error'
  });

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(
      routerModule,
      { password: 'correct-password', turnstileToken: 'any-token' },
      env
    );

    assert.equal(response.status, 200, 'siteverify 异常时 fail-open 不得阻断登录');
    assert.deepEqual(payload, { success: true, message: '登录成功', data: null });
    assert.equal(state.turnstileVerifyCalls.length, 1);
    assert.equal(state.verifyCalls, 1, 'fail-open 后密码照常校验');
  } finally {
    await cleanup();
  }
});

test('AC6：限流锁定（429）优先于 Turnstile 检查：不发起 siteverify 调用', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule(ENABLED_OPTIONS);

  try {
    const loginRateLock = createFakeLoginRateLock({
      local: {
        failures: 5,
        windowStart: Date.now() - 60_000,
        lockUntil: Date.now() + 300_000
      }
    });
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(
      routerModule,
      { password: 'correct-password', turnstileToken: 'valid-token' },
      env
    );

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '300');
    assert.deepEqual(payload, { success: false, error: '登录尝试次数过多，请稍后再试' });

    // 锁定短路在 getSettings 与 Turnstile 之前：两者均零调用
    assert.equal(state.getSettingsCalls, 0, '锁定期间不得加载 settings');
    assert.equal(state.turnstileVerifyCalls.length, 0, '锁定期间不得调用 siteverify');
    assert.equal(state.verifyCalls, 0, '锁定期间不得执行 verifyAdminPassword');
  } finally {
    await cleanup();
  }
});

test('status 端点：已配置时返回明文 siteKey（公开无泄露面）', async () => {
  const { routerModule, cleanup } = await loadRouterModule(ENABLED_OPTIONS);

  try {
    const response = await routerModule.handleRequest(
      new Request('https://example.com/api/auth/status'),
      {}
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.initialized, true);
    assert.equal(payload.data.authenticated, false);
    assert.equal(payload.data.turnstileSiteKey, '0x-site-key');
  } finally {
    await cleanup();
  }
});

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
 * 登录限流 router 集成测试（R1 / AC1-AC3）。
 *
 * 沿用「复制 router.js 源码替换 import 为桩」技术（见 envelope.test.mjs）。
 * LOGIN_RATE_LOCK 绑定桩内嵌真实 evaluateLoginAttempt 纯函数实现 /precheck
 * 与 /record 协议——不复制 DO 判定逻辑，保证测试命中的是真实状态机语义。
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 构造 LOGIN_RATE_LOCK Durable Object 绑定桩
 * @param {Object<string, {failures: number, windowStart: number|null, lockUntil: number|null}>} seedStates
 *   按 IP 预置的存储状态（未预置的 IP 视为无记录）
 */
function createFakeLoginRateLock(seedStates = {}) {
  const storage = new Map(Object.entries(seedStates));
  const seenIps = [];

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
    getSeenIps: () => seenIps,
    idFromName(ip) {
      seenIps.push(ip);
      return { ip };
    },
    get(id) {
      return stubFor(id.ip);
    }
  };
}

async function loadRouterModule() {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-login-ratelimit-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerLoginRatelimitTestRegistry = globalThis.__routerLoginRatelimitTestRegistry || new Map();
  const state = {
    verifyCalls: 0,
    getSettingsCalls: 0
  };
  globalThis.__routerLoginRatelimitTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerLoginRatelimitTestRegistry?.get('${testId}');

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
const state = globalThis.__routerLoginRatelimitTestRegistry?.get('${testId}');

export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getSettings() {
  state.getSettingsCalls += 1;
  return { vndbApiToken: '', adminPasswordHash: 'salt:hash', jwtSecret: 'test-secret' };
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
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(path.join(tempDir, 'auth.stub.mjs'), authStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'repository.stub.mjs'), repositoryStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'index-task.stub.mjs'), indexTaskStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'ulist-import.stub.mjs'), 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(path.join(tempDir, 'utils.real.mjs'), utilsSourceCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'vndb.stub.mjs'), vndbStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerLoginRatelimitTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function createLoginRequest(password, { ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) {
    headers['CF-Connecting-IP'] = ip;
  }
  return new Request('https://example.com/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ password })
  });
}

async function sendLogin(routerModule, password, env, options = {}) {
  const response = await routerModule.handleRequest(createLoginRequest(password, options), env);
  const payload = await response.json();
  return { response, payload };
}

test('锁定期间登录返回 429 + Retry-After，且不触 settings 与密码校验（AC1/AC2）', async () => {
  const { routerModule, state, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock({
      local: {
        failures: 5,
        windowStart: Date.now() - 60_000,
        lockUntil: Date.now() + 300_000
      }
    });
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    // 即使密码正确，锁定期间同样 429（文案不泄露密码对错）
    const { response, payload } = await sendLogin(routerModule, 'correct-password', env);

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '300');
    assert.deepEqual(payload, { success: false, error: '登录尝试次数过多，请稍后再试' });
    assert.equal('code' in payload, false, '错误信封不得携带 code 字段');

    // 锁定判定先于 PBKDF2：密码校验与 settings 加载均未被触达
    assert.equal(state.verifyCalls, 0, '锁定期间不得执行 verifyAdminPassword（PBKDF2）');
    assert.equal(state.getSettingsCalls, 0, '锁定期间不得加载 settings');
  } finally {
    await cleanup();
  }
});

test('连续 5 次错误密码后第 6 次返回 429（AC1）', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    for (let i = 0; i < 5; i += 1) {
      const { response, payload } = await sendLogin(routerModule, 'wrong-password', env);
      assert.equal(response.status, 401, `第 ${i + 1} 次错误密码应为 401`);
      assert.deepEqual(payload, { success: false, error: '密码错误' });
    }

    // 第 5 次失败已落 lockUntil，第 6 次即使密码正确也被拒
    const sixth = await sendLogin(routerModule, 'whatever-password', env);
    assert.equal(sixth.response.status, 429);

    const retryAfter = Number(sixth.response.headers.get('Retry-After'));
    assert.ok(Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 600, 'Retry-After 应为 (0, 600] 秒');

    const stored = loginRateLock.storage.get('local');
    assert.equal(stored.failures, 5);
    assert.ok(stored.lockUntil > Date.now(), '第 5 次失败后应写入 lockUntil');
  } finally {
    await cleanup();
  }
});

test('成功登录清零失败计数（AC3）', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock({
      local: { failures: 4, windowStart: Date.now() - 60_000, lockUntil: null }
    });
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    // 预置 4 次失败后一次成功登录
    const success = await sendLogin(routerModule, 'correct-password', env);
    assert.equal(success.response.status, 200);
    assert.deepEqual(success.payload, { success: true, message: '登录成功', data: null });

    // 计数已清零：再错一次应得 401 而不是 429（若未清零此处已是第 5 次，下一次才锁；
    // 第 5 次本身仍是 401，故再补一次验证第 6 次不锁）
    const wrong = await sendLogin(routerModule, 'wrong-password', env);
    assert.equal(wrong.response.status, 401);

    const stored = loginRateLock.storage.get('local');
    assert.equal(stored.failures, 1, '成功登录后计数应清零，本次失败从 1 重新累计');
    assert.equal(stored.lockUntil, null);
  } finally {
    await cleanup();
  }
});

test('锁定到期后正确密码可登录（AC1 解锁路径）', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock({
      local: { failures: 5, windowStart: Date.now() - 60_000, lockUntil: Date.now() - 1_000 }
    });
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    const { response, payload } = await sendLogin(routerModule, 'correct-password', env);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);

    const stored = loginRateLock.storage.get('local');
    assert.equal(stored.failures, 0, '成功登录应清零残留计数');
  } finally {
    await cleanup();
  }
});

test('LOGIN_RATE_LOCK 绑定缺失时 fail-open：登录不受限流影响', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const env = {}; // 无 LOGIN_RATE_LOCK 绑定

    const success = await sendLogin(routerModule, 'correct-password', env);
    assert.equal(success.response.status, 200);

    const wrong = await sendLogin(routerModule, 'wrong-password', env);
    assert.equal(wrong.response.status, 401);
  } finally {
    await cleanup();
  }
});

test('限流粒度键取 CF-Connecting-IP，缺失时回退 local', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const loginRateLock = createFakeLoginRateLock();
    const env = { LOGIN_RATE_LOCK: loginRateLock };

    await sendLogin(routerModule, 'wrong-password', env, { ip: '203.0.113.7' });
    await sendLogin(routerModule, 'wrong-password', env);

    // 每次登录会先后调 precheck 与 record（各一次 idFromName），断言去重后的顺序
    assert.deepEqual(
      Array.from(new Set(loginRateLock.getSeenIps())),
      ['203.0.113.7', 'local']
    );
    assert.equal(loginRateLock.storage.get('203.0.113.7').failures, 1, '带边缘头的请求按真实 IP 计数');
    assert.equal(loginRateLock.storage.get('local').failures, 1, '无边缘头的请求回退 local 占位键');
  } finally {
    await cleanup();
  }
});

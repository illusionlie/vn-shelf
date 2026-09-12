import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
  setAuthCookie,
  clearAuthCookie,
  setAdminPassword,
  verifyAdminPassword
} from '../../src/auth.js';

/**
 * auth 模块直测（R2，不经 router 桩替换）。
 * node >= 18 自带 crypto.subtle / btoa / atob，无需 polyfill（先例：tests/vndb/）。
 *
 * constantTimeEqual 未导出（不扩导出面），经 verifyPassword / verifyJWT 的
 * 行为断言覆盖：等长 / 不等长 / 非串入参。
 */

const SECRET = 'unit-test-secret';

// ---- 测试内自制的 Base64URL + HMAC 工具（与 src/auth.js 实现等价，用于构造“签名合法但头部/载荷非法”的 token）----

function base64UrlEncodeString(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlEncodeBytes(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmacSign(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

/**
 * 构造签名合法（过验签）但 header/payload 内容可控的 token，
 * 用于触达 alg / exp 校验分支（伪造者不知密钥时签名先挂，无法覆盖这些分支）
 */
async function craftToken({ header, payload, secret = SECRET }) {
  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await hmacSign(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ---- createJWT / verifyJWT 往返 ----

test('createJWT/verifyJWT 往返：载荷保留，iat/exp/jti 齐全，exp = iat + 24h', async () => {
  const token = await createJWT(SECRET, { sub: 'admin' });
  const payload = await verifyJWT(token, SECRET);

  assert.ok(payload, '合法 token 应通过校验');
  assert.equal(payload.sub, 'admin');
  assert.equal(typeof payload.iat, 'number');
  assert.equal(typeof payload.jti, 'string');
  assert.equal(payload.exp - payload.iat, 24 * 60 * 60);
});

test('密钥不匹配时校验失败', async () => {
  const token = await createJWT(SECRET, { sub: 'admin' });
  const payload = await verifyJWT(token, 'another-secret');
  assert.equal(payload, null);
});

// ---- 篡改类 ----

test('篡改 payload（保留原签名）校验失败', async () => {
  const token = await createJWT(SECRET, { sub: 'admin' });
  const [encodedHeader, , signature] = token.split('.');
  const forgedPayload = base64UrlEncodeString(JSON.stringify({ sub: 'hacker', exp: nowSeconds() + 3600 }));

  const payload = await verifyJWT(`${encodedHeader}.${forgedPayload}.${signature}`, SECRET);
  assert.equal(payload, null);
});

test('篡改签名校验失败', async () => {
  const token = await createJWT(SECRET, { sub: 'admin' });
  const [encodedHeader, encodedPayload, signature] = token.split('.');

  // 翻转签名末字符（保持在 base64url 字母表内）
  const lastChar = signature.at(-1);
  const flipped = lastChar === 'A' ? 'B' : 'A';
  const forgedSignature = signature.slice(0, -1) + flipped;

  const payload = await verifyJWT(`${encodedHeader}.${encodedPayload}.${forgedSignature}`, SECRET);
  assert.equal(payload, null);
});

test('段数不为 3 的 token 校验失败（不抛错）', async () => {
  assert.equal(await verifyJWT('a.b', SECRET), null);
  assert.equal(await verifyJWT('a.b.c.d', SECRET), null);
  assert.equal(await verifyJWT('', SECRET), null);
});

// ---- alg 显式校验（签名合法的伪造 header）----

test('alg 声明为 none（签名合法）校验失败', async () => {
  const token = await craftToken({
    header: { alg: 'none', typ: 'JWT' },
    payload: { sub: 'admin', exp: nowSeconds() + 3600 }
  });
  assert.equal(await verifyJWT(token, SECRET), null);
});

test('alg 声明为 HS384（签名合法）校验失败', async () => {
  const token = await craftToken({
    header: { alg: 'HS384', typ: 'JWT' },
    payload: { sub: 'admin', exp: nowSeconds() + 3600 }
  });
  assert.equal(await verifyJWT(token, SECRET), null);
});

test('alg 字段缺失（签名合法）校验失败', async () => {
  const token = await craftToken({
    header: { typ: 'JWT' },
    payload: { sub: 'admin', exp: nowSeconds() + 3600 }
  });
  assert.equal(await verifyJWT(token, SECRET), null);
});

// ---- exp 收紧 ----

test('缺失 exp（签名合法）校验失败：无 exp 的 token 不再永不过期', async () => {
  const token = await craftToken({
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: 'admin', iat: nowSeconds() }
  });
  assert.equal(await verifyJWT(token, SECRET), null);
});

test('exp 非数值（字符串）校验失败', async () => {
  const token = await craftToken({
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: 'admin', exp: String(nowSeconds() + 3600) }
  });
  assert.equal(await verifyJWT(token, SECRET), null);
});

test('exp == now 与 exp = now - 1 均拒绝（边界收紧为 exp <= now）', async () => {
  const now = nowSeconds();

  const atNow = await craftToken({
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: 'admin', exp: now }
  });
  assert.equal(await verifyJWT(atNow, SECRET), null, '恰好到期即失效');

  const beforeNow = await craftToken({
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: 'admin', exp: now - 1 }
  });
  assert.equal(await verifyJWT(beforeNow, SECRET), null);

  const afterNow = await craftToken({
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: 'admin', exp: now + 3600 }
  });
  const payload = await verifyJWT(afterNow, SECRET);
  assert.ok(payload, 'exp > now 的合法签名 token 应通过');
  assert.equal(payload.sub, 'admin');
});

// ---- constantTimeEqual 行为断言（经 verifyPassword / verifyJWT 覆盖）----

test('verifyPassword：等长哈希正确比对（constantTimeEqual 等长路径）', async () => {
  const salt = 'test-salt';
  const hash = await hashPassword('secret123', salt);

  assert.equal(await verifyPassword('secret123', salt, hash), true);
  assert.equal(await verifyPassword('wrong-pass', salt, hash), false);
});

test('verifyPassword：存储哈希不等长 / 非串入参返回 false 而不抛错', async () => {
  const salt = 'test-salt';

  // 不等长：长度短路分支
  assert.equal(await verifyPassword('secret123', salt, 'deadbeef'), false);
  // 非串入参：null / undefined
  assert.equal(await verifyPassword('secret123', salt, null), false);
  assert.equal(await verifyPassword('secret123', salt, undefined), false);
});

test('verifyJWT：签名段为非典型输入不抛错', async () => {
  // 签名段显著短于 HMAC 输出（长度不等路径）
  assert.equal(await verifyJWT(`a.${base64UrlEncodeString('{"exp":9999999999}')}.x`, SECRET), null);
});

test('hashPassword：同盐确定，异盐发散', async () => {
  const hashA1 = await hashPassword('secret123', 'salt-a');
  const hashA2 = await hashPassword('secret123', 'salt-a');
  const hashB = await hashPassword('secret123', 'salt-b');

  assert.equal(hashA1, hashA2);
  assert.notEqual(hashA1, hashB);
  assert.match(hashA1, /^[0-9a-f]{64}$/, 'PBKDF2-SHA256 输出应为 64 位十六进制');
});

// ---- Cookie 属性串 ----

test('setAuthCookie：Secure 与非 Secure 两种形态的属性串', () => {
  const secureResponse = new Response(null);
  setAuthCookie(secureResponse, 'tok-abc', true);
  assert.equal(
    secureResponse.headers.get('Set-Cookie'),
    'auth_token=tok-abc; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=86400'
  );

  const plainResponse = new Response(null);
  setAuthCookie(plainResponse, 'tok-abc', false);
  assert.equal(
    plainResponse.headers.get('Set-Cookie'),
    'auth_token=tok-abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400'
  );
});

test('clearAuthCookie：清除属性串（Max-Age=0）', () => {
  const response = new Response(null);
  clearAuthCookie(response);
  assert.equal(
    response.headers.get('Set-Cookie'),
    'auth_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
  );
});

// ---- setAdminPassword / verifyAdminPassword 往返（轻量 fake D1）----

/**
 * 仅覆盖 settings 表读写的最小 fake D1：
 * prepare(sql).bind(...).first()/run() 按 settings 键存取，batch 兼容 initDB 的
 * 建表与迁移语句（均为 no-op，auth 用例不依赖表结构本身）
 */
function createFakeSettingsDB() {
  const store = new Map();

  const makeStatement = (sql, params) => ({
    bind: (...args) => makeStatement(sql, args),
    first: async () => {
      if (/FROM settings/i.test(sql) && params.length === 1) {
        const value = store.get(params[0]);
        return value === undefined ? null : { value };
      }
      return null;
    },
    run: async () => {
      if (/INTO settings/i.test(sql) && params.length === 2) {
        store.set(params[0], params[1]);
      }
      return { success: true };
    },
    all: async () => ({ results: [] })
  });

  return {
    batch: async statements => statements,
    prepare: sql => makeStatement(sql, []),
    store
  };
}

test('setAdminPassword → verifyAdminPassword 往返：正确密码通过，错误密码拒绝', async () => {
  const db = createFakeSettingsDB();
  const env = { DB: db };

  await setAdminPassword(env, 'secret123');

  const stored = JSON.parse(db.store.get('config:settings'));
  assert.match(stored.adminPasswordHash, /^[^\s]+:[0-9a-f]{64}$/, '存储形态应为 salt:hash');
  assert.equal(typeof stored.jwtSecret, 'string');
  assert.ok(stored.jwtSecret.length >= 32, 'jwtSecret 应为足够长的随机串');

  assert.equal(await verifyAdminPassword(stored, 'secret123'), true);
  assert.equal(await verifyAdminPassword(stored, 'wrong-password'), false);
});

test('setAdminPassword 重复调用会轮换 jwtSecret（旧 token 全部失效的语义基础）', async () => {
  const envA = { DB: createFakeSettingsDB() };
  const envB = { DB: createFakeSettingsDB() };

  await setAdminPassword(envA, 'secret123');
  await setAdminPassword(envB, 'secret123');

  const first = JSON.parse(envA.DB.store.get('config:settings'));
  const second = JSON.parse(envB.DB.store.get('config:settings'));
  assert.notEqual(first.jwtSecret, second.jwtSecret);
});

test('verifyAdminPassword：未初始化（无哈希）直接返回 false', async () => {
  assert.equal(await verifyAdminPassword({}, 'whatever'), false);
});

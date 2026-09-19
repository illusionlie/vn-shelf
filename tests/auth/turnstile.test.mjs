import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyTurnstileToken, TURNSTILE_VERIFY_URL } from '../../src/turnstile.js';

/**
 * turnstile 模块直测（fetchImpl 注入，对照 tests/auth/login-ratelimit.test.mjs 纯函数直测先例）。
 * 覆盖 design §8 第一行：pass / invalid+error-codes 透传 / throw / 非 2xx / 坏 JSON → error /
 * token 非法形态 → invalid 且零网络请求 / form body 三字段与 remoteip 省略 / 超时 → error。
 */

function siteverifyResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createFetchSpy(responder) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    if (typeof responder === 'function') {
      return responder(input, init, calls.length);
    }
    return responder;
  };
  return { fetchImpl, calls };
}

test('success:true → outcome pass', async () => {
  const { fetchImpl } = createFetchSpy(siteverifyResponse({ success: true, 'error-codes': [] }));

  const result = await verifyTurnstileToken({
    secretKey: 'secret-x',
    token: 'tok',
    fetchImpl
  });

  assert.deepEqual(result, { outcome: 'pass' });
});

test('success:false → invalid 且 error-codes（连字符键）原样透传', async () => {
  const { fetchImpl } = createFetchSpy(siteverifyResponse({
    success: false,
    'error-codes': ['invalid-input-response', 'timeout-or-duplicate']
  }));

  const result = await verifyTurnstileToken({
    secretKey: 'secret-x',
    token: 'tok',
    fetchImpl
  });

  assert.equal(result.outcome, 'invalid');
  assert.deepEqual(result.errorCodes, ['invalid-input-response', 'timeout-or-duplicate']);
});

test('success:false 且 error-codes 非数组 → invalid 且 errorCodes 归空数组', async () => {
  const { fetchImpl } = createFetchSpy(siteverifyResponse({ success: false, 'error-codes': 'nope' }));

  const result = await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl });

  assert.equal(result.outcome, 'invalid');
  assert.deepEqual(result.errorCodes, []);
});

test('fetch 抛出 → error（模块永不抛出）', async () => {
  const { fetchImpl } = createFetchSpy(() => {
    throw new Error('network down');
  });

  const result = await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl });

  assert.deepEqual(result, { outcome: 'error' });
});

test('非 2xx → error', async () => {
  const { fetchImpl } = createFetchSpy(siteverifyResponse({ success: true }, 503));

  const result = await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl });

  assert.deepEqual(result, { outcome: 'error' });
});

test('坏 JSON → error', async () => {
  const { fetchImpl } = createFetchSpy(new Response('not-json{', { status: 200 }));

  const result = await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl });

  assert.deepEqual(result, { outcome: 'error' });
});

test('success 字段形态异常（缺失 / 非布尔）→ error', async () => {
  const missing = createFetchSpy(siteverifyResponse({ 'error-codes': [] }));
  const nonBoolean = createFetchSpy(siteverifyResponse({ success: 'yes' }));

  assert.deepEqual(
    await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl: missing.fetchImpl }),
    { outcome: 'error' }
  );
  assert.deepEqual(
    await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl: nonBoolean.fetchImpl }),
    { outcome: 'error' }
  );
});

test('token 非字符串 / 空串 / 超 2048 → invalid 且 fetchImpl 零调用', async () => {
  for (const token of [undefined, null, 123, '', 'x'.repeat(2049)]) {
    const { fetchImpl, calls } = createFetchSpy(siteverifyResponse({ success: true }));

    const result = await verifyTurnstileToken({ secretKey: 's', token, fetchImpl });

    assert.equal(result.outcome, 'invalid', `token=${String(token).slice(0, 12)} 应判 invalid`);
    assert.deepEqual(result.errorCodes, ['invalid-input-response']);
    assert.equal(calls.length, 0, '非法 token 不应发起网络请求');
  }
});

test('form body：POST + urlencoded 三字段，remoteip 传入时携带', async () => {
  const { fetchImpl, calls } = createFetchSpy(siteverifyResponse({ success: true }));

  await verifyTurnstileToken({
    secretKey: 'secret-value',
    token: 'token-value',
    remoteIp: '203.0.113.9',
    fetchImpl
  });

  assert.equal(calls.length, 1);
  const { input, init } = calls[0];
  assert.equal(input, TURNSTILE_VERIFY_URL);
  assert.equal(init.method, 'POST');
  assert.ok(init.body instanceof URLSearchParams, 'body 应为 URLSearchParams（自动 urlencoded Content-Type）');
  assert.equal(init.body.get('secret'), 'secret-value');
  assert.equal(init.body.get('response'), 'token-value');
  assert.equal(init.body.get('remoteip'), '203.0.113.9');
});

test('remoteip 缺省时 form body 不携带 remoteip 字段', async () => {
  const { fetchImpl, calls } = createFetchSpy(siteverifyResponse({ success: true }));

  await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl });

  const { init } = calls[0];
  assert.equal(init.body.get('secret'), 's');
  assert.equal(init.body.get('response'), 't');
  assert.equal(init.body.has('remoteip'), false, 'remoteIp 缺省不得写入 local 占位');
});

test('超时中止 → error', async () => {
  // 挂起直到 signal abort，配合注入的短超时（默认 10s 不适合测试）
  const fetchImpl = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
  });

  const result = await verifyTurnstileToken({
    secretKey: 's',
    token: 't',
    timeoutMs: 20,
    fetchImpl
  });

  assert.deepEqual(result, { outcome: 'error' });
});

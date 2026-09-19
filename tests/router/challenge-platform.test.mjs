import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  challengePlatformBeaconResponse,
  handleRequest
} from '../../src/router.js';

/**
 * Turnstile 遥测信标快速应答（09-19 turnstile-local-ux / AC1-AC3）。
 *
 * 纯函数 + handleRequest 接线直测——不依赖 D1/DO 桩（信标路径在任何 env 访问之前返回）。
 * 背景：本地 wrangler dev 无 CF 边缘，/cdn-cgi/challenge-platform/* 落到 Worker 404 无
 * CORS 头，widget 跨域预检挂起且 Turnstile 在遥测定型前不派发 token。
 */

test('AC1：OPTIONS → 204 + 定向 ACAO + 允许 POST/OPTIONS + Max-Age，反射请求头', () => {
  const headers = new Headers({
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type'
  });
  const res = challengePlatformBeaconResponse('OPTIONS', headers);

  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://challenges.cloudflare.com');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'content-type');
  assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');
});

test('AC1：OPTIONS 无 Request-Headers 头时不输出 Allow-Headers', () => {
  const res = challengePlatformBeaconResponse('OPTIONS');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), null);
});

test('AC2：POST → 204 + ACAO，无预检三头', () => {
  const res = challengePlatformBeaconResponse('POST');

  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://challenges.cloudflare.com');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), null);
  assert.equal(res.headers.get('Access-Control-Max-Age'), null);
});

test('AC2：GET 等其他方法 → null（维持自然 404，无 CORS 头）', () => {
  assert.equal(challengePlatformBeaconResponse('GET'), null);
  assert.equal(challengePlatformBeaconResponse('DELETE'), null);
});

test('AC1/AC2 接线：handleRequest 对信标前缀早段应答，不触碰 env', async () => {
  const base = 'https://example.com/cdn-cgi/challenge-platform/h/g/c/a3d923ba9a4f2dfc';

  const options = await handleRequest(
    new Request(base, { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'content-type' } }),
    {}
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), 'https://challenges.cloudflare.com');

  const post = await handleRequest(new Request(base, { method: 'POST' }), {});
  assert.equal(post.status, 204);
  assert.equal(post.headers.get('Access-Control-Allow-Origin'), 'https://challenges.cloudflare.com');

  // 非 OPTIONS/POST：落回自然 404，无 CORS 头
  const get = await handleRequest(new Request(base, { method: 'GET' }), {});
  assert.equal(get.status, 404);
  assert.equal(get.headers.get('Access-Control-Allow-Origin'), null);

  // 前缀之外的 /cdn-cgi/* 不受影响（自然 404）
  const other = await handleRequest(
    new Request('https://example.com/cdn-cgi/other', { method: 'POST' }),
    {}
  );
  assert.equal(other.status, 404);
});

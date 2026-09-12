/**
 * 公开端点访客缓存：数据版本键 + ETag + 边缘 Cache API
 *
 * 机制概要（任务 09-12-public-cache-and-index）：
 * - settings 表单行键 cache:version（十进制数字字符串，缺失/非法视为 0）；
 *   任何改变 vn/tier 数据的写路径成功后 bumpCacheVersion 自增（单语句原子，
 *   避免读改写竞态）。全公开端点共用一个版本号：内容变则版本变则 ETag 变，
 *   无需响应体哈希；跨端点误失效成本 = 一次重算，已确认接受。
 * - Workers Cache API 无通配 purge：把版本号拼进合成缓存键（__cv=<version>），
 *   写后 bump 版本即「换钥匙」，旧版本键自然失联，孤儿条目交 60s TTL 回收。
 * - 管理员（Cookie 含 auth_token）永远直查 D1 并收 no-store，保证写后回读实时；
 *   访客无 Cookie 时走边缘缓存副本（60s TTL 为陈旧上界，用户已确认容忍度）。
 *
 * CORS 头不在本层处理：由 router.handleRequest 出口对返回的 response 统一附加
 * （304 与缓存命中路径同样被覆盖，见 spec「公开端点 CORS 策略」）。
 */

import { initDB } from './db.js';

export const CACHE_VERSION_KEY = 'cache:version';

const VISITOR_CACHE_CONTROL = 'public, max-age=60';
const ADMIN_CACHE_CONTROL = 'no-store';

/**
 * 读取当前数据版本（settings 表 PK 点查；读取前 initDB 复用 WeakSet 记忆化）
 * @param {Object} env - Worker 环境绑定（env.DB 为 D1）
 * @returns {Promise<number>} 缺失/非法视为 0
 */
export async function readCacheVersion(env) {
  await initDB(env.DB);
  const row = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(CACHE_VERSION_KEY).first();

  if (!row || row.value === undefined || row.value === null) {
    return 0;
  }

  const version = Number.parseInt(row.value, 10);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

/**
 * 自增数据版本：首次插入 '1'，其后 +1 覆写回文本（单语句原子，无读改写竞态）
 * @param {Object} env - Worker 环境绑定（env.DB 为 D1）
 */
export async function bumpCacheVersion(env) {
  await initDB(env.DB);
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('cache:version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)"
  ).run();
}

/**
 * 版本 → ETag 头值（含引号的规范形态），If-None-Match 按全等比较
 * @param {number} version
 * @returns {string}
 */
export function buildEtag(version) {
  return `"vshelf-${version}"`;
}

// Cookie 头是否携带 auth_token 键（仅判存在，不校验值——值校验属 authMiddleware 职责）
function hasAuthCookie(request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) {
    return false;
  }
  return cookie.split(';').some(part => part.trim().startsWith('auth_token='));
}

/**
 * 公开 GET 端点的缓存包裹器（router.handleRequest 调用，不改各 handler 内部）。
 *
 * 请求流：
 * 1. 读版本算 ETag（一次 PK 点查）；
 * 2. 访客 If-None-Match 命中 → 304 空体（保留 ETag/Cache-Control）；
 * 3. 管理员（auth_token Cookie）→ 永远直查 handler，响应 no-store + ETag；
 * 4. 访客 → 按版本合成缓存键 match 边缘缓存，命中直接返回；未命中执行 handler，
 *    响应附 ETag + public, max-age=60 后经 ctx.waitUntil 写入缓存。
 *
 * 缓存键 = request.url + '__cv=' + version：URL 含查询串天然区分 sort/search/untiered
 * 变体，版本号随数据写递增实现「换钥匙」式失效。仅缓存 200 响应（404 等不落边缘
 * 缓存，浏览器侧最坏 60s 陈旧由版本键 + TTL 兜底）。
 *
 * @param {Request} request - 原始请求（查询串参与缓存键）
 * @param {Object} env - Worker 环境绑定
 * @param {Object|null} ctx - 执行上下文（waitUntil 用于异步缓存写入）
 * @param {string} path - 请求路径（仅用于日志定位）
 * @param {() => Promise<Response>} handler - 实际执行的 API handler
 * @param {Object} [cachesImpl] - Cache API 注入口（默认 globalThis.caches，测试传桩）
 * @returns {Promise<Response>}
 */
export async function servePublicCached(request, env, ctx, path, handler, cachesImpl = globalThis.caches) {
  const version = await readCacheVersion(env);
  const etag = buildEtag(version);
  const authed = hasAuthCookie(request);

  // 访客协商缓存命中：304 空体（CORS 头由外层 handleRequest 对返回值统一附加）
  if (!authed && request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': VISITOR_CACHE_CONTROL
      }
    });
  }

  // 管理员：永远直查 D1（写后回读实时性由此保证），一切缓存存储禁用
  if (authed) {
    const response = await handler();
    response.headers.set('Cache-Control', ADMIN_CACHE_CONTROL);
    response.headers.set('ETag', etag);
    return response;
  }

  const cache = cachesImpl?.default ?? null;

  // 访客边缘缓存命中：重建可变头副本（Cache API 返回的 Response headers 不可变，
  // 外层 handleRequest 还需 set CORS 头）
  if (cache) {
    const cacheKey = new Request(`${request.url}__cv=${version}`, request);
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return new Response(cached.body, cached);
      }
    } catch (error) {
      // match 失败降级为直查，不影响请求
      console.warn('[http-cache] match failed, fallback to handler', {
        path,
        error: error?.message || String(error)
      });
    }

    const response = await handler();
    response.headers.set('ETag', etag);
    response.headers.set('Cache-Control', VISITOR_CACHE_CONTROL);

    if (response.status === 200 && ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        cache.put(cacheKey, response.clone()).catch(error => {
          // 写缓存失败仅记日志：版本键与 60s TTL 兜底，访客最坏多回源一次
          console.warn('[http-cache] put failed', {
            path,
            error: error?.message || String(error)
          });
        })
      );
    }

    return response;
  }

  // 无 Cache API（本地 Node 测试环境）：仍提供 ETag 协商缓存语义
  const response = await handler();
  response.headers.set('ETag', etag);
  response.headers.set('Cache-Control', VISITOR_CACHE_CONTROL);
  return response;
}

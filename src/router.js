/**
 * 路由模块
 */

import {
  authMiddleware,
  createJWT,
  setAuthCookie,
  clearAuthCookie,
  verifyAdminPassword,
  setAdminPassword,
  isInitialized
} from './auth.js';
import { bumpCacheVersion, servePublicCached } from './http-cache.js';
import { getIndexTaskStatus, startIndexTask } from './index-task.js';
import {
  getVNList,
  getVNEntry,
  getStats,
  saveVNEntry,
  deleteVNEntry,
  getSettings,
  saveSettings,
  exportData,
  importData,
  getTierList,
  saveTierList,
  updateVNTier,
  batchUpdateVNTiers,
  clearTierAssignments,
  tryAcquireIndexStartLock,
  releaseIndexStartLock,
  VN_STATUS_VALUES
} from './repository.js';
import { startUListImport } from './ulist-import.js';
import { errorResponse, successResponse, isValidVNDBId, parseRequestBody } from './utils.js';
import { fetchVNDB, VNDBClient } from './vndb.js';

const MAX_BATCH_TIER_UPDATES = 200;

const INVALID_STATUS_MESSAGE = '状态值无效，仅支持 playing/finished/stalled/dropped/wishlist';

// 游玩状态输入校验：undefined（未提供）与 null（清除）合法，其余必须命中白名单
function isValidStatusInput(status) {
  return status === undefined || status === null || VN_STATUS_VALUES.includes(status);
}

// 公开只读端点（提供真实 CORS：GET 响应附加 Allow-Origin，OPTIONS 预检返回 204）
const PUBLIC_CORS_PATH_PATTERNS = [
  /^\/api\/vn$/,
  /^\/api\/vn\/v\d+$/,
  /^\/api\/stats$/,
  /^\/api\/tier$/,
  /^\/api\/config\/appearance$/
];

function isPublicCorsPath(path) {
  return PUBLIC_CORS_PATH_PATTERNS.some(pattern => pattern.test(path));
}

// 访客缓存路径集合 = PUBLIC_CORS_PATH_PATTERNS 去掉 /api/config/appearance：
// 该端点维持既有 max-age=300 简单缓存，不引入 ETag / 版本键机制
const PUBLIC_CACHE_PATH_PATTERNS = [
  /^\/api\/vn$/,
  /^\/api\/vn\/v\d+$/,
  /^\/api\/stats$/,
  /^\/api\/tier$/
];

function isPublicCachePath(path) {
  return PUBLIC_CACHE_PATH_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * 写路径缓存版本失效：经 ctx.waitUntil 异步 bump cache:version（换钥匙式失效，
 * 旧版本边缘缓存键自然失联）。bump 失败仅记日志不影响写响应——访客侧最坏 60s
 * TTL 陈旧上界兜底，管理员路径不吃缓存不受影响（R3）。
 */
function scheduleCacheBump(env, ctx) {
  if (!ctx || typeof ctx.waitUntil !== 'function') {
    return;
  }

  ctx.waitUntil(
    bumpCacheVersion(env).catch(error => {
      console.warn('[http-cache] bump cache version failed', {
        error: error?.message || String(error)
      });
    })
  );
}

/**
 * 数据写 handler 的统一出口：成功（2xx）才 bump 缓存版本，失败/校验 4xx 不失效
 */
async function invalidatePublicCacheAfterWrite(env, ctx, handler) {
  const response = await handler();
  if (response.ok) {
    scheduleCacheBump(env, ctx);
  }
  return response;
}

let startIndexRequestLockTail = Promise.resolve();

async function runWithStartIndexLock(fn) {
  const previousLock = startIndexRequestLockTail;
  let releaseCurrentLock;

  startIndexRequestLockTail = new Promise(resolve => {
    releaseCurrentLock = resolve;
  });

  await previousLock;

  try {
    return await fn();
  } finally {
    releaseCurrentLock();
  }
}

async function parseJsonBodyOr400(request) {
  try {
    return await parseRequestBody(request);
  } catch (error) {
    throw errorResponse(error?.message || '请求体格式错误', 400);
  }
}

/**
 * 路由处理器
 */
export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 公开只读端点的 CORS 预检；其余 OPTIONS 不做特殊处理，自然落入后续路由得到 404（不带 CORS 头）
  if (method === 'OPTIONS' && isPublicCorsPath(path)) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // API路由
  if (path.startsWith('/api/')) {
    // 公开缓存路径的 GET 改走访客缓存包裹器（ETag 协商 + 边缘 Cache API +
    // 管理员 Cookie 绕过），handler 内部零改动；CORS 附加保持在出口统一处理
    let response;
    if (method === 'GET' && isPublicCachePath(path)) {
      response = await servePublicCached(request, env, ctx, path, () =>
        handleAPI(request, env, path, method, ctx)
      );
    } else {
      response = await handleAPI(request, env, path, method, ctx);
    }

    // 仅公开只读端点的 GET 响应附加 CORS 头，认证/写操作端点一律不加；
    // 304 与缓存命中路径同样在此统一附加（servePublicCached 返回可变头副本）
    if (method === 'GET' && isPublicCorsPath(path)) {
      response.headers.set('Access-Control-Allow-Origin', '*');
    }

    return response;
  }

  // 非API路由返回404（静态资源由 index.js 中的 Assets 处理）
  return errorResponse('Not Found', 404);
}

/**
 * API路由处理
 */
async function handleAPI(request, env, path, method, ctx) {
  // 认证相关接口
  if (path === '/api/auth/status' && method === 'GET') {
    return handleAuthStatus(request, env);
  }

  if (path === '/api/auth/init' && method === 'POST') {
    return handleInit(request, env);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    return handleLogin(request, env);
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return handleLogout(request, env);
  }

  if (path === '/api/auth/verify' && method === 'GET') {
    return handleVerify(request, env);
  }

  // 公开接口
  if (path === '/api/vn' && method === 'GET') {
    return handleGetVNList(request, env);
  }

  if (path.match(/^\/api\/vn\/v\d+$/) && method === 'GET') {
    const id = path.split('/').pop();
    return handleGetVN(request, env, id);
  }

  if (path === '/api/stats' && method === 'GET') {
    return handleGetStats(request, env);
  }

  if (path === '/api/tier' && method === 'GET') {
    return handleGetTierList(request, env);
  }

  if (path === '/api/config/appearance' && method === 'GET') {
    return handleGetAppearance(request, env);
  }

  // 需要认证的接口
  const auth = await authMiddleware(request, env);

  if (path === '/api/vn' && method === 'POST') {
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleCreateVN(request, env, auth));
  }

  if (path === '/api/vn/tier/batch' && method === 'PUT') {
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleBatchUpdateVNTier(request, env, auth));
  }

  if (path.match(/^\/api\/vn\/v\d+\/tier$/) && method === 'PUT') {
    const id = path.split('/')[3];
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleUpdateVNTier(request, env, id, auth));
  }

  if (path.match(/^\/api\/vn\/v\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleUpdateVN(request, env, id, auth));
  }

  if (path.match(/^\/api\/vn\/v\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleDeleteVN(request, env, id, auth));
  }

  if (path === '/api/index/start' && method === 'POST') {
    return handleStartIndex(request, env, auth);
  }

  if (path === '/api/index/status' && method === 'GET') {
    return handleGetIndexStatus(request, env, auth);
  }

  if (path === '/api/ulist/import' && method === 'POST') {
    return handleStartUListImport(request, env, auth, ctx);
  }

  if (path === '/api/vndb/search' && method === 'GET') {
    return handleVndbSearch(request, env, auth);
  }

  if (path === '/api/config' && method === 'GET') {
    return handleGetConfig(request, env, auth);
  }

  if (path === '/api/config' && method === 'PUT') {
    return handleUpdateConfig(request, env, auth);
  }

  if (path === '/api/tier' && method === 'POST') {
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleCreateTier(request, env, auth));
  }

  if (path === '/api/tier/order' && method === 'PUT') {
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleUpdateTierOrder(request, env, auth));
  }

  if (path.match(/^\/api\/tier\/[^/]+$/) && method === 'PUT') {
    const rawId = path.split('/').pop();
    const decodedId = decodePathParam(rawId);
    const id = normalizeTierId(decodedId);
    if (!id) {
      return errorResponse('Tier ID 无效', 400);
    }
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleUpdateTier(request, env, id, auth));
  }

  if (path.match(/^\/api\/tier\/[^/]+$/) && method === 'DELETE') {
    const rawId = path.split('/').pop();
    const decodedId = decodePathParam(rawId);
    const id = normalizeTierId(decodedId);
    if (!id) {
      return errorResponse('Tier ID 无效', 400);
    }
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleDeleteTier(request, env, id, auth));
  }

  if (path === '/api/export' && method === 'GET') {
    return handleExport(request, env, auth);
  }

  if (path === '/api/import' && method === 'POST') {
    return invalidatePublicCacheAfterWrite(env, ctx, () => handleImport(request, env, auth));
  }

  return errorResponse('Not Found', 404);
}

// ============ 认证接口 ============

/**
 * 获取登录限流粒度键：CF-Connecting-IP 在 Cloudflare 边缘恒存在；
 * 本地 dev（wrangler dev 直连无边缘头）缺失时用固定占位键
 */
function getLoginRateLimitIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

/**
 * 取登录限流 DO stub；绑定缺失时 warn 并返回 null（fail-open 放行）。
 * 与 INDEX_START_LOCK 的 fail-closed 语义有意相反：本限流守护的是可用性，
 * 漏配绑定的代价退化为无限流，而不是登录全挂
 */
function getLoginRateLimitStub(env, ip) {
  if (!env?.LOGIN_RATE_LOCK?.idFromName) {
    console.warn('[auth][login-ratelimit] LOGIN_RATE_LOCK binding missing, fail-open');
    return null;
  }
  return env.LOGIN_RATE_LOCK.get(env.LOGIN_RATE_LOCK.idFromName(ip));
}

/**
 * 登录前置检查：锁定则返回 { allowed:false, retryAfterSec }，限流不可用时返回 null
 * @returns {Promise<{allowed: boolean, retryAfterSec: number|null}|null>}
 */
async function precheckLoginRateLimit(env, ip) {
  const stub = getLoginRateLimitStub(env, ip);
  if (!stub) {
    return null;
  }

  try {
    const response = await stub.fetch('https://login-rate-lock/precheck');
    if (!response.ok) {
      console.warn('[auth][login-ratelimit] precheck non-ok', { status: response.status });
      return null;
    }
    const payload = await response.json();
    return {
      allowed: payload.allowed !== false,
      retryAfterSec: Number.isFinite(payload.retryAfterSec) ? payload.retryAfterSec : null
    };
  } catch (error) {
    console.warn('[auth][login-ratelimit] precheck failed, fail-open', {
      error: error?.message || String(error)
    });
    return null;
  }
}

/**
 * 回写登录结果（成功清零计数，失败累计）。同步 await 保证第 5 次失败后的
 * 下一次请求立即被锁；写失败仅告警，不影响登录主流程
 */
async function recordLoginResult(env, ip, success) {
  const stub = getLoginRateLimitStub(env, ip);
  if (!stub) {
    return;
  }

  try {
    const response = await stub.fetch('https://login-rate-lock/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success })
    });
    if (!response.ok) {
      console.warn('[auth][login-ratelimit] record non-ok', { status: response.status });
    }
  } catch (error) {
    console.warn('[auth][login-ratelimit] record failed', {
      error: error?.message || String(error)
    });
  }
}

async function handleAuthStatus(request, env) {
  const initialized = await isInitialized(env);
  const auth = await authMiddleware(request, env);

  return successResponse({
    initialized,
    authenticated: auth.authenticated
  });
}

async function handleInit(request, env) {
  const initialized = await isInitialized(env);
  if (initialized) {
    return errorResponse('已经初始化', 400);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }
  const { password, vndbApiToken } = body;

  if (!password || password.length < 6) {
    return errorResponse('密码长度至少6位', 400);
  }

  await setAdminPassword(env, password);

  if (vndbApiToken) {
    const settings = await getSettings(env);
    settings.vndbApiToken = vndbApiToken;
    await saveSettings(env, settings);
  }

  return successResponse(null, '初始化成功');
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }
  const { password } = body;

  if (!password) {
    return errorResponse('请输入密码', 400);
  }

  // 锁定判定先于 PBKDF2（防穷举同时防 CPU 消耗），限流不可用时 fail-open 放行
  const rateLimitIp = getLoginRateLimitIp(request);
  const precheck = await precheckLoginRateLimit(env, rateLimitIp);
  if (precheck && !precheck.allowed) {
    // 文案不泄露密码对错：锁定期间正确密码同样收到本响应
    const response = errorResponse('登录尝试次数过多，请稍后再试', 429);
    response.headers.set('Retry-After', String(precheck.retryAfterSec ?? 600));
    return response;
  }

  // 单次加载 settings：密码校验与 JWT 签发复用同一对象，避免重复查询
  const settings = await getSettings(env);

  const valid = await verifyAdminPassword(settings, password);

  // 同步回写结果：保证第 5 次失败落库后，下一次请求的 precheck 立即被锁
  await recordLoginResult(env, rateLimitIp, valid);

  if (!valid) {
    return errorResponse('密码错误', 401);
  }

  const token = await createJWT(settings.jwtSecret, { sub: 'admin' });

  const response = successResponse(null, '登录成功');
  setAuthCookie(response, token, env.ENVIRONMENT !== 'development');

  return response;
}

async function handleLogout() {
  const response = successResponse(null, '已退出登录');
  clearAuthCookie(response);
  return response;
}

async function handleVerify(request, env) {
  const auth = await authMiddleware(request, env);
  if (auth.authenticated) {
    return successResponse({ user: auth.user }, 'Token有效');
  }
  return errorResponse(auth.error, 401);
}

// ============ VN接口 ============

async function handleGetVNList(request, env) {
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') || 'created_desc';
  const search = url.searchParams.get('search') || '';
  const untieredOnly = url.searchParams.get('untiered') === 'true';

  const list = await getVNList(env);
  let items = Array.isArray(list.items) ? [...list.items] : [];

  if (untieredOnly) {
    items = items.filter(item => !item?.tierId);
  }

  // 搜索过滤
  if (search) {
    const query = search.toLowerCase();
    items = items.filter(item =>
      item.title.toLowerCase().includes(query) ||
      (item.titleJa && item.titleJa.toLowerCase().includes(query)) ||
      (item.titleCn && item.titleCn.toLowerCase().includes(query))
    );
  }

  // 排序
  const [field, order] = sort.split('_');
  items.sort((a, b) => {
    let valA, valB;

    if (field === 'created') {
      valA = new Date(a.createdAt || 0);
      valB = new Date(b.createdAt || 0);
    } else if (field === 'personal') {
      valA = a.personalRating || 0;
      valB = b.personalRating || 0;
    } else {
      valA = a.rating || 0;
      valB = b.rating || 0;
    }

    return order === 'desc' ? valB - valA : valA - valB;
  });

  return successResponse(items, undefined, {
    total: items.length
  });
}

async function handleGetVN(request, env, id) {
  const entry = await getVNEntry(env, id);

  if (!entry) {
    return errorResponse('条目不存在', 404);
  }

  return successResponse(entry);
}

function isFieldProvided(value) {
  return value !== undefined && value !== null && value !== '';
}

function parseNonNegativeIntegerField(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName}必须是非负数字`);
  }
  return Math.floor(parsed);
}

function splitTotalPlayTimeMinutes(totalMinutes) {
  const safeTotal = Number(totalMinutes);
  const normalizedTotal = Number.isFinite(safeTotal) && safeTotal >= 0
    ? Math.floor(safeTotal)
    : 0;

  return {
    totalMinutes: normalizedTotal,
    hours: Math.floor(normalizedTotal / 60),
    partMinutes: normalizedTotal % 60
  };
}

function formatPlayTimeText(hours, partMinutes) {
  if (hours > 0 && partMinutes > 0) {
    return `${hours}小时${partMinutes}分钟`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  if (partMinutes > 0) {
    return `${partMinutes}分钟`;
  }
  return '';
}

function normalizePlayTimeInput({
  playTimeHours,
  playTimePartMinutes,
  fallbackTotalMinutes = 0
}) {
  const hasHours = isFieldProvided(playTimeHours);
  const hasPartMinutes = isFieldProvided(playTimePartMinutes);
  const fallback = splitTotalPlayTimeMinutes(fallbackTotalMinutes);

  const hours = hasHours
    ? parseNonNegativeIntegerField(playTimeHours, '游玩时长小时')
    : fallback.hours;

  const partMinutes = hasPartMinutes
    ? parseNonNegativeIntegerField(playTimePartMinutes, '游玩时长分钟')
    : fallback.partMinutes;

  // 允许分钟 >= 60，自动进位
  const normalized = splitTotalPlayTimeMinutes(hours * 60 + partMinutes);

  return {
    ...normalized,
    text: formatPlayTimeText(normalized.hours, normalized.partMinutes)
  };
}

function createTierId() {
  return `tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTierId(id) {
  return typeof id === 'string' ? id.trim() : '';
}

function decodePathParam(value) {
  if (typeof value !== 'string') return null;

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeTierName(name) {
  if (typeof name !== 'string') return '';
  return name.trim();
}

function isValidTierColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTierListPayload(tierList) {
  if (!isPlainObject(tierList)) {
    return '导入数据 tierList 必须是对象';
  }

  if (!Array.isArray(tierList.tiers)) {
    return '导入数据 tierList.tiers 必须是数组';
  }

  const seenIds = new Set();

  for (let index = 0; index < tierList.tiers.length; index += 1) {
    const item = tierList.tiers[index];
    const field = `tierList.tiers[${index}]`;

    if (!isPlainObject(item)) {
      return `${field} 必须是对象`;
    }

    const id = normalizeTierId(item.id);
    if (!id) {
      return `${field}.id 必须是非空字符串`;
    }

    if (seenIds.has(id)) {
      return `${field}.id 重复: ${id}`;
    }
    seenIds.add(id);

    const name = normalizeTierName(item.name);
    if (!name) {
      return `${field}.name 必须是非空字符串`;
    }

    if (!isValidTierColor(item.color)) {
      return `${field}.color 必须是 #RRGGBB 格式`;
    }

    if (
      Object.prototype.hasOwnProperty.call(item, 'order') &&
      (!Number.isFinite(Number(item.order)) || Number(item.order) < 0)
    ) {
      return `${field}.order 必须是非负数字`;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(tierList, 'updatedAt') &&
    tierList.updatedAt !== null &&
    typeof tierList.updatedAt !== 'string'
  ) {
    return '导入数据 tierList.updatedAt 必须是字符串或 null';
  }

  return null;
}

async function handleCreateVN(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'playTime') ||
    Object.prototype.hasOwnProperty.call(body, 'playTimeMinutes')
  ) {
    return errorResponse('仅支持 playTimeHours 和 playTimePartMinutes 字段', 400);
  }

  const {
    vndbId,
    titleCn,
    personalRating,
    playTimeHours,
    playTimePartMinutes,
    review,
    startDate,
    finishDate,
    tags,
    status
  } = body;

  if (!vndbId || !isValidVNDBId(vndbId)) {
    return errorResponse('无效的VNDB ID', 400);
  }

  if (!isValidStatusInput(status)) {
    return errorResponse(INVALID_STATUS_MESSAGE, 400);
  }

  // 验证个人评分
  const parsedRating = parseFloat(personalRating);
  const validRating = isNaN(parsedRating) ? 0 : Math.max(0, Math.min(10, parsedRating));

  // 检查是否已存在
  const existing = await getVNEntry(env, vndbId);
  if (existing) {
    return errorResponse('该条目已存在', 400);
  }

  // 从VNDB获取信息
  let vndbData;
  try {
    vndbData = await fetchVNDB(vndbId, env);
  } catch (error) {
    return errorResponse(`VNDB API错误: ${error.message}`, 500);
  }

  let normalizedPlayTime;
  try {
    normalizedPlayTime = normalizePlayTimeInput({
      playTimeHours,
      playTimePartMinutes,
      fallbackTotalMinutes: 0
    });
  } catch (error) {
    return errorResponse(error.message, 400);
  }

  // 创建条目
  const entry = {
    id: vndbId,
    createdAt: new Date().toISOString(),
    vndb: vndbData,
    user: {
      titleCn: titleCn || vndbData.titleCn || '', // 优先使用用户输入，否则使用VNDB中文标题
      personalRating: validRating,
      playTime: normalizedPlayTime.text,
      playTimeHours: normalizedPlayTime.hours,
      playTimePartMinutes: normalizedPlayTime.partMinutes,
      playTimeMinutes: normalizedPlayTime.totalMinutes,
      review: review || '',
      startDate: startDate || null,
      finishDate: finishDate || null,
      status: status ?? null, // 缺省/null 均落 null（未设置）
      tags: Array.isArray(tags) ? tags : [], // 用户手动 tags
      tierId: null
    }
  };

  const savedEntry = await saveVNEntry(env, entry);

  return successResponse(savedEntry, '创建成功');
}

async function handleUpdateVN(request, env, id, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const entry = await getVNEntry(env, id);
  if (!entry) {
    return errorResponse('条目不存在', 404);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'playTime') ||
    Object.prototype.hasOwnProperty.call(body, 'playTimeMinutes')
  ) {
    return errorResponse('仅支持 playTimeHours 和 playTimePartMinutes 字段', 400);
  }

  const {
    titleCn,
    personalRating,
    playTimeHours,
    playTimePartMinutes,
    review,
    startDate,
    finishDate,
    tags,
    status,
    refreshVNDB
  } = body;

  if (!isValidStatusInput(status)) {
    return errorResponse(INVALID_STATUS_MESSAGE, 400);
  }

  // 是否刷新VNDB数据
  if (refreshVNDB) {
    try {
      entry.vndb = await fetchVNDB(id, env);
    } catch (error) {
      return errorResponse(`VNDB API错误: ${error.message}`, 500);
    }
  }

  // 验证个人评分
  const validateRating = (rating) => {
    if (rating === undefined || rating === null) return undefined;
    const parsed = parseFloat(rating);
    if (isNaN(parsed)) return 0;
    return Math.max(0, Math.min(10, parsed));
  };

  // 更新用户数据
  const validatedRating = validateRating(personalRating);

  // 更新游玩时长（仅支持小时 + 分钟）
  const hasPlayTimeInput =
    isFieldProvided(playTimeHours) ||
    isFieldProvided(playTimePartMinutes);

  let playTimePatch = {};
  if (hasPlayTimeInput) {
    try {
      const normalizedPlayTime = normalizePlayTimeInput({
        playTimeHours,
        playTimePartMinutes,
        fallbackTotalMinutes: entry.user?.playTimeMinutes
      });

      playTimePatch = {
        playTime: normalizedPlayTime.text,
        playTimeHours: normalizedPlayTime.hours,
        playTimePartMinutes: normalizedPlayTime.partMinutes,
        playTimeMinutes: normalizedPlayTime.totalMinutes
      };
    } catch (error) {
      return errorResponse(error.message, 400);
    }
  }

  entry.user = {
    ...(entry.user || {}),
    titleCn: titleCn !== undefined ? titleCn : entry.user.titleCn,
    personalRating: validatedRating !== undefined ? validatedRating : entry.user.personalRating,
    ...playTimePatch,
    review: review !== undefined ? review : entry.user.review,
    startDate: startDate !== undefined ? startDate : entry.user.startDate,
    finishDate: finishDate !== undefined ? finishDate : entry.user.finishDate,
    // 三态语义：字段未出现 = 保持；null = 清除；白名单值 = 设置（非法值已在上方 400）
    status: status !== undefined ? status : (entry.user.status ?? null),
    tags: tags !== undefined ? (Array.isArray(tags) ? tags : []) : (entry.user.tags || [])
  };

  const savedEntry = await saveVNEntry(env, entry);

  return successResponse(savedEntry, '更新成功');
}

async function handleDeleteVN(request, env, id, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const entry = await getVNEntry(env, id);
  if (!entry) {
    return errorResponse('条目不存在', 404);
  }

  await deleteVNEntry(env, id);

  return successResponse(null, '删除成功');
}

// ============ Tier接口 ============

async function handleGetTierList(request, env) {
  const tierList = await getTierList(env);
  return successResponse(tierList.tiers, undefined, {
    total: tierList.tiers.length,
    updatedAt: tierList.updatedAt
  });
}

async function handleCreateTier(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  const name = normalizeTierName(body?.name);
  const color = typeof body?.color === 'string'
    ? body.color.trim()
    : '#666666';

  if (!name) {
    return errorResponse('Tier 名称不能为空', 400);
  }

  if (!isValidTierColor(color)) {
    return errorResponse('Tier 颜色必须是 #RRGGBB 格式', 400);
  }

  const tierList = await getTierList(env);
  const tier = {
    id: createTierId(),
    name,
    color,
    order: tierList.tiers.length
  };

  const savedTierList = await saveTierList(env, {
    ...tierList,
    tiers: [...tierList.tiers, tier]
  });

  const createdTier = savedTierList.tiers.find(item => item.id === tier.id) || tier;
  return successResponse(createdTier, '创建成功');
}

async function handleUpdateTier(request, env, id, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  if (!isPlainObject(body)) {
    return errorResponse('请求体必须是对象', 400);
  }

  const tierList = await getTierList(env);
  const index = tierList.tiers.findIndex(item => item.id === id);
  if (index < 0) {
    return errorResponse('Tier 不存在', 404);
  }

  const nextTier = { ...tierList.tiers[index] };

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeTierName(body.name);
    if (!name) {
      return errorResponse('Tier 名称不能为空', 400);
    }
    nextTier.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'color')) {
    const color = typeof body.color === 'string'
      ? body.color.trim()
      : '';
    if (!isValidTierColor(color)) {
      return errorResponse('Tier 颜色必须是 #RRGGBB 格式', 400);
    }
    nextTier.color = color;
  }

  tierList.tiers[index] = nextTier;
  const savedTierList = await saveTierList(env, tierList);

  const updatedTier = savedTierList.tiers.find(item => item.id === id) || nextTier;
  return successResponse(updatedTier, '更新成功');
}

async function handleDeleteTier(request, env, id, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const tierList = await getTierList(env);
  const index = tierList.tiers.findIndex(item => item.id === id);
  if (index < 0) {
    return errorResponse('Tier 不存在', 404);
  }

  const [deletedTier] = tierList.tiers.splice(index, 1);

  // 先清理归属再删除 Tier，避免清理失败导致 Tier 已删但条目仍引用旧 tierId
  const clearedCount = await clearTierAssignments(env, id);
  await saveTierList(env, tierList);

  return successResponse({ deletedTier, clearedCount }, '删除成功');
}

async function handleUpdateTierOrder(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  const tierIds = body?.tierIds;
  if (!Array.isArray(tierIds)) {
    return errorResponse('tierIds 必须是数组', 400);
  }

  const normalizedIds = tierIds
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);

  if (normalizedIds.length !== tierIds.length) {
    return errorResponse('tierIds 必须为非空字符串数组', 400);
  }

  const uniqueIds = new Set(normalizedIds);
  if (uniqueIds.size !== normalizedIds.length) {
    return errorResponse('tierIds 不能包含重复值', 400);
  }

  const tierList = await getTierList(env);
  const existingIds = tierList.tiers.map(item => item.id);

  if (normalizedIds.length !== existingIds.length) {
    return errorResponse('tierIds 数量与现有 Tier 数量不一致', 400);
  }

  for (const idItem of normalizedIds) {
    if (!existingIds.includes(idItem)) {
      return errorResponse(`Tier 不存在: ${idItem}`, 404);
    }
  }

  const orderMap = new Map(normalizedIds.map((idItem, index) => [idItem, index]));
  const nextTierList = {
    ...tierList,
    tiers: tierList.tiers.map(item => ({
      ...item,
      order: orderMap.get(item.id)
    }))
  };

  const savedTierList = await saveTierList(env, nextTierList);
  return successResponse(savedTierList.tiers, '排序更新成功');
}

/**
 * 解析 tier 归属请求体中的 tierId/tierSort 字段（单条与批量更新共用）
 * @param {Object} item - 待解析对象（单条场景为请求体，批量场景为 updates[i]）
 * @param {string} [label] - 批量场景的错误文案前缀（如 `updates[0]`），单条场景省略
 * @returns {{ tierId: string|null, tierSort: number|undefined }}
 * @throws {Error} 校验失败时抛出带文案的错误，由调用方转为 errorResponse(message, 400)
 */
function parseTierAssignmentBody(item, label = '') {
  if (!Object.prototype.hasOwnProperty.call(item, 'tierId')) {
    throw new Error(label ? `${label} 缺少 tierId 字段` : '缺少 tierId 字段');
  }

  const rawTierId = item.tierId;
  const rawTierSort = item.tierSort;
  let tierId = null;
  let tierSort = undefined;

  if (rawTierId !== null) {
    if (typeof rawTierId !== 'string') {
      throw new Error(label ? `${label}.tierId 必须为字符串或 null` : 'tierId 必须为字符串或 null');
    }

    const normalizedTierId = rawTierId.trim();
    tierId = normalizedTierId || null;
  }

  if (Object.prototype.hasOwnProperty.call(item, 'tierSort')) {
    const parsedTierSort = Number(rawTierSort);
    if (!Number.isFinite(parsedTierSort) || parsedTierSort < 0) {
      throw new Error(label ? `${label}.tierSort 必须是非负数字` : 'tierSort 必须是非负数字');
    }
    tierSort = Math.floor(parsedTierSort);
  }

  return { tierId, tierSort };
}

async function handleBatchUpdateVNTier(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  if (!isPlainObject(body)) {
    return errorResponse('请求体必须是对象', 400);
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return errorResponse('updates 必须是非空数组', 400);
  }

  if (updates.length > MAX_BATCH_TIER_UPDATES) {
    return errorResponse(`updates 数量不能超过 ${MAX_BATCH_TIER_UPDATES}`, 400);
  }

  const tierList = await getTierList(env);
  const tierIdSet = new Set(tierList.tiers.map(item => item.id));
  const seenIds = new Set();
  const normalizedUpdates = [];

  for (let index = 0; index < updates.length; index += 1) {
    const item = updates[index];
    if (!isPlainObject(item)) {
      return errorResponse(`updates[${index}] 必须是对象`, 400);
    }

    const idValue = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isValidVNDBId(idValue)) {
      return errorResponse(`updates[${index}].id 必须是合法 VNDB ID`, 400);
    }

    if (seenIds.has(idValue)) {
      return errorResponse(`updates[${index}].id 重复: ${idValue}`, 400);
    }
    seenIds.add(idValue);

    let tierId;
    let tierSort;
    try {
      ({ tierId, tierSort } = parseTierAssignmentBody(item, `updates[${index}]`));
    } catch (error) {
      return errorResponse(error.message, 400);
    }

    if (tierId && !tierIdSet.has(tierId)) {
      return errorResponse(`Tier 不存在: ${tierId}`, 404);
    }

    normalizedUpdates.push({ id: idValue, tierId, tierSort });
  }

  let updatedItems;
  try {
    updatedItems = await batchUpdateVNTiers(env, normalizedUpdates);
  } catch (error) {
    if (Number(error?.status) === 404) {
      return errorResponse(error.message || '条目不存在', 404);
    }
    throw error;
  }

  return successResponse({
    updated: updatedItems.length,
    items: updatedItems
  }, 'Tier 批量更新成功');
}

async function handleUpdateVNTier(request, env, id, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }

  if (!isPlainObject(body)) {
    return errorResponse('请求体必须是对象', 400);
  }

  let tierId;
  let tierSort;
  try {
    ({ tierId, tierSort } = parseTierAssignmentBody(body));
  } catch (error) {
    return errorResponse(error.message, 400);
  }

  if (tierId) {
    const tierList = await getTierList(env);
    const exists = tierList.tiers.some(item => item.id === tierId);
    if (!exists) {
      return errorResponse('Tier 不存在', 404);
    }
  }

  const entry = await updateVNTier(env, id, tierId, tierSort);
  if (!entry) {
    return errorResponse('条目不存在', 404);
  }

  return successResponse(entry, 'Tier 更新成功');
}

// ============ 统计接口 ============

async function handleGetStats(request, env) {
  const stats = await getStats(env);
  return successResponse(stats);
}

// ============ 索引接口 ============

async function handleStartIndex(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const startLockHolder = `start_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return runWithStartIndexLock(async () => {
    const acquired = await tryAcquireIndexStartLock(env, startLockHolder);
    if (!acquired) {
      return errorResponse('已有索引任务正在运行', 409);
    }

    try {
      const result = await startIndexTask(env);

      if (!result.ok) {
        return errorResponse(result.message, result.status);
      }

      return successResponse({ total: result.total }, '索引任务已启动');
    } finally {
      try {
        await releaseIndexStartLock(env, startLockHolder);
      } catch (releaseError) {
        console.error('[index][start] release lock failed', {
          holder: startLockHolder,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError)
        });
      }
    }
  });
}


async function handleGetIndexStatus(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const status = await getIndexTaskStatus(env);
  return successResponse(status);
}

// ============ ulist 导入接口 ============

async function handleStartUListImport(request, env, auth, ctx) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const startLockHolder = `ulist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return runWithStartIndexLock(async () => {
    // 与索引任务互斥：复用 INDEX_START_LOCK Durable Object（两者都写 vn_entries）
    const acquired = await tryAcquireIndexStartLock(env, startLockHolder);
    if (!acquired) {
      return errorResponse('已有索引或导入任务正在运行', 409);
    }

    // 导入任务经 ctx.waitUntil 后台执行，持锁期仅覆盖鉴权 + 建任务这一同步窗口；
    // 后台拉取写入不在锁内，靠 index_tasks 活跃态阻止重复启动。
    try {
      const result = await startUListImport(env, ctx);

      if (!result.ok) {
        return errorResponse(result.message, result.status);
      }

      return successResponse({ taskId: result.taskId }, 'ulist 导入任务已启动');
    } finally {
      try {
        await releaseIndexStartLock(env, startLockHolder);
      } catch (releaseError) {
        console.error('[ulist][start] release lock failed', {
          holder: startLockHolder,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError)
        });
      }
    }
  });
}

// ============ VNDB 搜索接口 ============

/**
 * VNDB 模糊搜索（认证端点，添加条目弹窗的候选来源）。
 * 认证端点不入 PUBLIC_CORS_PATH_PATTERNS、不加 CORS 头。
 * type-ahead 场景单次调用不重试（下一次击键即自然重试），与 fetchVNDB 的退避重试有意不同。
 */
async function handleVndbSearch(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (!q) {
    return errorResponse('搜索关键词不能为空', 400);
  }

  const parsedLimit = Number.parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(20, parsedLimit))
    : 10;

  // settings 单请求复用契约：直接使用 auth.settings 构造 client，
  // 禁止 createVNDBClient(env)（内部会二次 getSettings）
  const token = auth.settings.vndbApiToken;
  if (!token) {
    return errorResponse('VNDB API Token未配置，请先在设置页配置', 400);
  }

  try {
    const results = await new VNDBClient(token).searchVN(q, limit);
    return successResponse(results);
  } catch (error) {
    return errorResponse(`VNDB API错误: ${error.message}`, 500);
  }
}

// ============ 配置接口 ============

async function handleGetAppearance(request, env) {
  const settings = await getSettings(env);

  const response = successResponse({
    // 站点主人名（非敏感外观配置，空串 = 未个性化，前端回退品牌名）
    ownerName: settings.ownerName || '',
    backgroundUrl: settings.backgroundUrl || '',
    backgroundOverlay: settings.backgroundOverlay ?? 0.5,
    backgroundBlur: settings.backgroundBlur ?? 4,
    // Tags 相关配置（非敏感，匿名访客与管理员看到一致的 tags 显示）
    tagsMode: settings.tagsMode || 'vndb',
    translateTags: settings.translateTags !== false,
    translationUrl: settings.translationUrl || ''
  });

  // 公开端点设置缓存
  response.headers.set('Cache-Control', 'public, max-age=300');
  return response;
}

async function handleGetConfig(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  // authMiddleware 认证成功时必然已加载 settings，直接复用避免单请求内重复查询
  const settings = auth.settings;

  // 不返回敏感信息
  return successResponse({
    hasVndbApiToken: !!settings.vndbApiToken,
    hasPassword: !!settings.adminPasswordHash,
    lastIndexTime: settings.lastIndexTime,
    // Tags 相关配置
    tagsMode: settings.tagsMode || 'vndb',
    translateTags: settings.translateTags !== false,
    translationUrl: settings.translationUrl || '',
    // 外观配置
    ownerName: settings.ownerName || '',
    backgroundUrl: settings.backgroundUrl || '',
    backgroundOverlay: settings.backgroundOverlay ?? 0.5,
    backgroundBlur: settings.backgroundBlur ?? 4
  });
}

async function handleUpdateConfig(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }
  // 先校验、后写入：任一字段校验失败（400）时不得发生任何持久化变更——
  // setAdminPassword 直写密码哈希并轮换 jwtSecret（不经 saveSettings），
  // 必须等全部校验通过后才执行，消除"响应报错但凭据已改写"的半提交窗口
  if (body.newPassword && body.newPassword.length < 6) {
    return errorResponse('密码长度至少6位', 400);
  }

  // 站点主人名：面向用户展示的文本，显式 400 早暴露（非静默 coerce/截断），
  // 空串合法 = 清除个性化回退品牌名；校验与赋值共用同一 trim 结果，不留缝隙
  let ownerName;
  if (body.ownerName !== undefined) {
    if (typeof body.ownerName !== 'string') {
      return errorResponse('ownerName 必须为字符串', 400);
    }
    ownerName = body.ownerName.trim();
    if (ownerName.length > 30) {
      return errorResponse('ownerName 长度不能超过 30', 400);
    }
  }

  // authMiddleware 认证成功时必然已加载 settings，直接复用避免单请求内重复查询
  let settings = auth.settings;
  let passwordChanged = false;

  if (body.newPassword) {
    await setAdminPassword(env, body.newPassword);
    // 密码哈希与 jwtSecret 刚被改写，必须重新加载
    settings = await getSettings(env);
    passwordChanged = true;
  }

  if (body.vndbApiToken !== undefined) {
    settings.vndbApiToken = body.vndbApiToken;
  }

  // Tags 相关配置
  if (body.tagsMode !== undefined) {
    if (['vndb', 'manual'].includes(body.tagsMode)) {
      settings.tagsMode = body.tagsMode;
    }
  }

  if (body.translateTags !== undefined) {
    settings.translateTags = !!body.translateTags;
  }

  if (body.translationUrl !== undefined) {
    settings.translationUrl = body.translationUrl;
  }

  // 外观配置
  if (body.backgroundUrl !== undefined) {
    settings.backgroundUrl = String(body.backgroundUrl);
  }

  if (body.backgroundOverlay !== undefined) {
    const overlay = Number(body.backgroundOverlay);
    if (Number.isFinite(overlay)) {
      settings.backgroundOverlay = Math.max(0, Math.min(1, overlay));
    }
  }

  if (body.backgroundBlur !== undefined) {
    const blur = Number(body.backgroundBlur);
    if (Number.isFinite(blur)) {
      settings.backgroundBlur = Math.max(0, Math.min(20, blur));
    }
  }

  // ownerName 已在函数开头前置校验（非 string / trim 后超 30 → 400），此处只赋值
  if (ownerName !== undefined) {
    settings.ownerName = ownerName;
  }

  await saveSettings(env, settings);

  const response = successResponse(null, '设置已更新');

  if (passwordChanged) {
    const token = await createJWT(settings.jwtSecret, { sub: 'admin' });
    setAuthCookie(response, token, env.ENVIRONMENT !== 'development');
  }

  return response;
}

// ============ 导入导出接口 ============

async function handleExport(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const data = await exportData(env);
  // 导出内容进入信封 data 层；前端解包后落盘，导出文件格式保持
  // { version, exportedAt, entries, tierList, appearance } 不变
  return successResponse(data);
}

async function handleImport(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  let body;
  try {
    body = await parseJsonBodyOr400(request);
  } catch (response) {
    return response;
  }
  const { entries, tierList, appearance, mode } = body;
  const importMode = mode || 'merge';

  if (tierList !== undefined) {
    const tierListError = validateTierListPayload(tierList);
    if (tierListError) {
      return errorResponse(tierListError, 400);
    }
  }

  if (appearance !== undefined) {
    if (typeof appearance !== 'object' || appearance === null || Array.isArray(appearance)) {
      return errorResponse('导入数据 appearance 必须是对象', 400);
    }
    if (appearance.backgroundUrl !== undefined && appearance.backgroundUrl !== null) {
      if (typeof appearance.backgroundUrl !== 'string') {
        return errorResponse('appearance.backgroundUrl 必须为字符串', 400);
      }
      const url = appearance.backgroundUrl;
      if (url !== '' && !/^https?:\/\//i.test(url)) {
        return errorResponse('appearance.backgroundUrl 必须为空或以 http:// / https:// 开头', 400);
      }
      if (url.length > 2048) {
        return errorResponse('appearance.backgroundUrl 长度不能超过 2048', 400);
      }
    }
    if (appearance.backgroundUrl === null) {
      appearance.backgroundUrl = '';
    }
    if (appearance.backgroundOverlay !== undefined) {
      if (typeof appearance.backgroundOverlay !== 'number' || !Number.isFinite(appearance.backgroundOverlay)) {
        return errorResponse('appearance.backgroundOverlay 必须为有限数字', 400);
      }
    }
    if (appearance.backgroundBlur !== undefined) {
      if (typeof appearance.backgroundBlur !== 'number' || !Number.isFinite(appearance.backgroundBlur)) {
        return errorResponse('appearance.backgroundBlur 必须为有限数字', 400);
      }
    }
    if (appearance.ownerName !== undefined && appearance.ownerName !== null) {
      if (typeof appearance.ownerName !== 'string') {
        return errorResponse('appearance.ownerName 必须为字符串', 400);
      }
      if (appearance.ownerName.trim().length > 30) {
        return errorResponse('appearance.ownerName 长度不能超过 30', 400);
      }
    }
    if (appearance.ownerName === null) {
      appearance.ownerName = '';
    }
  }

  if (!['merge', 'replace'].includes(importMode)) {
    return errorResponse(`无效的导入模式: ${importMode}，仅支持 merge 或 replace`, 400);
  }

  if (!Array.isArray(entries)) {
    return errorResponse('导入数据 entries 必须是数组', 400);
  }

  if (importMode === 'merge' && entries.length === 0) {
    return errorResponse('导入数据 entries 必须为非空数组', 400);
  }

  if (importMode === 'replace' && entries.length === 0) {
    return errorResponse('replace 模式必须提供非空 entries，否则将清空全部数据', 400);
  }

  const seenIds = new Set();

  // 完整预校验：先校验全部条目，再执行导入写入/删除
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryIndex = i + 1;

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return errorResponse(`导入数据第${entryIndex}条必须是对象`, 400);
    }

    if (!entry.id || typeof entry.id !== 'string') {
      return errorResponse(`导入数据第${entryIndex}条缺少有效 id`, 400);
    }

    if (!isValidVNDBId(entry.id)) {
      return errorResponse(`导入数据第${entryIndex}条 id 无效: ${entry.id}`, 400);
    }

    if (seenIds.has(entry.id)) {
      return errorResponse(`导入数据存在重复 id: ${entry.id}`, 400);
    }
    seenIds.add(entry.id);

    if (!entry.vndb || typeof entry.vndb !== 'object' || Array.isArray(entry.vndb)) {
      return errorResponse(`导入数据第${entryIndex}条 vndb 字段必须是对象`, 400);
    }

    if (!entry.user || typeof entry.user !== 'object' || Array.isArray(entry.user)) {
      return errorResponse(`导入数据第${entryIndex}条 user 字段必须是对象`, 400);
    }
  }

  await importData(env, { entries, tierList, appearance }, importMode);

  return successResponse({ count: entries.length }, '导入成功');
}



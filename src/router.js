/**
 * 路由模块
 */

import {
  authMiddleware,
  createJWT,
  setAuthCookie,
  clearAuthCookie,
  verifyAdminPassword,
  initAdminPassword,
  isInitialized
} from './auth.js';
import {
  getVNList,
  getVNEntry,
  saveVNEntry,
  deleteVNEntry,
  addEntryToList,
  removeEntryFromList,
  getSettings,
  saveSettings,
  exportData,
  importData,
  getIndexStatus,
  saveIndexStatus,
  getTierList,
  saveTierList,
  updateVNTier,
  batchUpdateVNTiers,
  clearTierAssignments
} from './kv.js';
import { jsonResponse, errorResponse, successResponse, isValidVNDBId, parseRequestBody } from './utils.js';
import { fetchVNDB } from './vndb.js';

const MAX_BATCH_TIER_UPDATES = 200;
const INDEX_START_QUEUE_BATCH_SIZE = 25;

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
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS预检请求
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // API路由
  if (path.startsWith('/api/')) {
    return handleAPI(request, env, path, method);
  }

  // 非API路由返回404（静态资源由 index.js 中的 Assets 处理）
  return errorResponse('Not Found', 404);
}

/**
 * API路由处理
 */
async function handleAPI(request, env, path, method) {
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

  // 需要认证的接口
  const auth = await authMiddleware(request, env);

  if (path === '/api/vn' && method === 'POST') {
    return handleCreateVN(request, env, auth);
  }

  if (path === '/api/vn/tier/batch' && method === 'PUT') {
    return handleBatchUpdateVNTier(request, env, auth);
  }

  if (path.match(/^\/api\/vn\/v\d+\/tier$/) && method === 'PUT') {
    const id = path.split('/')[3];
    return handleUpdateVNTier(request, env, id, auth);
  }

  if (path.match(/^\/api\/vn\/v\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    return handleUpdateVN(request, env, id, auth);
  }

  if (path.match(/^\/api\/vn\/v\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    return handleDeleteVN(request, env, id, auth);
  }

  if (path === '/api/index/start' && method === 'POST') {
    return handleStartIndex(request, env, auth);
  }

  if (path === '/api/index/status' && method === 'GET') {
    return handleGetIndexStatus(request, env, auth);
  }

  if (path === '/api/config' && method === 'GET') {
    return handleGetConfig(request, env, auth);
  }

  if (path === '/api/config' && method === 'PUT') {
    return handleUpdateConfig(request, env, auth);
  }

  if (path === '/api/tier' && method === 'POST') {
    return handleCreateTier(request, env, auth);
  }

  if (path === '/api/tier/order' && method === 'PUT') {
    return handleUpdateTierOrder(request, env, auth);
  }

  if (path.match(/^\/api\/tier\/[^/]+$/) && method === 'PUT') {
    const rawId = path.split('/').pop();
    const decodedId = decodePathParam(rawId);
    const id = normalizeTierId(decodedId);
    if (!id) {
      return errorResponse('Tier ID 无效', 400);
    }
    return handleUpdateTier(request, env, id, auth);
  }

  if (path.match(/^\/api\/tier\/[^/]+$/) && method === 'DELETE') {
    const rawId = path.split('/').pop();
    const decodedId = decodePathParam(rawId);
    const id = normalizeTierId(decodedId);
    if (!id) {
      return errorResponse('Tier ID 无效', 400);
    }
    return handleDeleteTier(request, env, id, auth);
  }

  if (path === '/api/export' && method === 'GET') {
    return handleExport(request, env, auth);
  }

  if (path === '/api/import' && method === 'POST') {
    return handleImport(request, env, auth);
  }

  return errorResponse('Not Found', 404);
}

// ============ 认证接口 ============

async function handleAuthStatus(request, env) {
  const initialized = await isInitialized(env);
  const auth = await authMiddleware(request, env);

  return jsonResponse({
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

  await initAdminPassword(env, password);

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

  const valid = await verifyAdminPassword(env, password);
  if (!valid) {
    return errorResponse('密码错误', 401);
  }

  const settings = await getSettings(env);
  const token = await createJWT(settings.jwtSecret, { sub: 'admin' });

  const response = successResponse(null, '登录成功');
  setAuthCookie(response, token, env.ENVIRONMENT === 'production');

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

  return jsonResponse({
    data: items,
    total: items.length
  });
}

async function handleGetVN(request, env, id) {
  const entry = await getVNEntry(env, id);

  if (!entry) {
    return errorResponse('条目不存在', 404);
  }

  return jsonResponse(entry);
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
    tags
  } = body;

  if (!vndbId || !isValidVNDBId(vndbId)) {
    return errorResponse('无效的VNDB ID', 400);
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
      tags: Array.isArray(tags) ? tags : [], // 用户手动 tags
      tierId: null
    }
  };

  await saveVNEntry(env, entry);
  await addEntryToList(env, entry);

  return successResponse(entry, '创建成功');
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
    refreshVNDB
  } = body;

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
    tags: tags !== undefined ? (Array.isArray(tags) ? tags : []) : (entry.user.tags || [])
  };

  await saveVNEntry(env, entry);
  await addEntryToList(env, entry); // 更新列表中的条目

  return successResponse(entry, '更新成功');
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
  await removeEntryFromList(env, id);

  return successResponse(null, '删除成功');
}

// ============ Tier接口 ============

async function handleGetTierList(request, env) {
  const tierList = await getTierList(env);
  return jsonResponse({
    data: tierList.tiers,
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

    if (!Object.prototype.hasOwnProperty.call(item, 'tierId')) {
      return errorResponse(`updates[${index}] 缺少 tierId 字段`, 400);
    }

    const rawTierId = item.tierId;
    const rawTierSort = item.tierSort;
    let tierId = null;
    let tierSort = undefined;

    if (rawTierId !== null) {
      if (typeof rawTierId !== 'string') {
        return errorResponse(`updates[${index}].tierId 必须为字符串或 null`, 400);
      }

      const normalizedTierId = rawTierId.trim();
      tierId = normalizedTierId || null;
    }

    if (Object.prototype.hasOwnProperty.call(item, 'tierSort')) {
      const parsedTierSort = Number(rawTierSort);
      if (!Number.isFinite(parsedTierSort) || parsedTierSort < 0) {
        return errorResponse(`updates[${index}].tierSort 必须是非负数字`, 400);
      }
      tierSort = Math.floor(parsedTierSort);
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

  if (!Object.prototype.hasOwnProperty.call(body, 'tierId')) {
    return errorResponse('缺少 tierId 字段', 400);
  }

  const rawTierId = body.tierId;
  const rawTierSort = body.tierSort;
  let tierId = null;
  let tierSort = undefined;

  if (rawTierId !== null) {
    if (typeof rawTierId !== 'string') {
      return errorResponse('tierId 必须为字符串或 null', 400);
    }

    const normalizedTierId = rawTierId.trim();
    tierId = normalizedTierId || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tierSort')) {
    const parsedTierSort = Number(rawTierSort);
    if (!Number.isFinite(parsedTierSort) || parsedTierSort < 0) {
      return errorResponse('tierSort 必须是非负数字', 400);
    }
    tierSort = Math.floor(parsedTierSort);
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
  const list = await getVNList(env);
  return jsonResponse(list.stats);
}

// ============ 索引接口 ============

async function handleStartIndex(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  return runWithStartIndexLock(async () => {
    const currentStatus = await getIndexStatus(env);
    if (currentStatus.status === 'running') {
      return errorResponse('已有索引任务正在运行', 409);
    }

    const list = await getVNList(env);
    const total = list.items.length;

    if (total === 0) {
      return errorResponse('没有需要索引的条目', 400);
    }

    // 创建索引状态
    const taskId = `idx_${Date.now()}`;
    const status = {
      status: 'running',
      taskId,
      total,
      processed: 0,
      failed: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      lastReconciledAt: null
    };

    await saveIndexStatus(env, status);

    try {
      // 分片并发发送（同一批次共享同一个 taskId）
      for (let i = 0; i < list.items.length; i += INDEX_START_QUEUE_BATCH_SIZE) {
        const chunk = list.items.slice(i, i + INDEX_START_QUEUE_BATCH_SIZE);
        await Promise.all(chunk.map(item => env.VN_INDEX_QUEUE.send({
          vndbId: item.id,
          taskId,
          retryCount: 0
        })));
      }
    } catch (error) {
      const failedStatus = {
        ...status,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };

      await saveIndexStatus(env, failedStatus);
      return errorResponse('索引任务启动失败，请稍后重试', 500);
    }

    return successResponse({ total }, '索引任务已启动');
  });
}

async function handleGetIndexStatus(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const status = await getIndexStatus(env);
  return jsonResponse(status);
}

// ============ 配置接口 ============

async function handleGetConfig(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const settings = await getSettings(env);

  // 不返回敏感信息
  return successResponse({
    hasVndbApiToken: !!settings.vndbApiToken,
    hasPassword: !!settings.adminPasswordHash,
    lastIndexTime: settings.lastIndexTime,
    // Tags 相关配置
    tagsMode: settings.tagsMode || 'vndb',
    translateTags: settings.translateTags !== false,
    translationUrl: settings.translationUrl || ''
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
  let settings = await getSettings(env);

  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      return errorResponse('密码长度至少6位', 400);
    }
    await initAdminPassword(env, body.newPassword);
    settings = await getSettings(env);
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

  await saveSettings(env, settings);

  return successResponse(null, '设置已更新');
}

// ============ 导入导出接口 ============

async function handleExport(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const data = await exportData(env);
  return jsonResponse(data);
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
  const { entries, tierList, mode } = body;
  const importMode = mode || 'merge';

  if (tierList !== undefined) {
    const tierListError = validateTierListPayload(tierList);
    if (tierListError) {
      return errorResponse(tierListError, 400);
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

  await importData(env, { entries, tierList }, importMode);

  return successResponse({ count: entries.length }, '导入成功');
}

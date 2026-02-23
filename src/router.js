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
  saveIndexStatus
} from './kv.js';
import { jsonResponse, errorResponse, successResponse, isValidVNDBId, parseRequestBody } from './utils.js';
import { fetchVNDB } from './vndb.js';

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

  // 需要认证的接口
  const auth = await authMiddleware(request, env);

  if (path === '/api/vn' && method === 'POST') {
    return handleCreateVN(request, env, auth);
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

  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;
  const { password, vndbApiToken } = bodyResult.data;

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
  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;
  const { password } = bodyResult.data;

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

  const list = await getVNList(env);
  let items = list.items;

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

async function handleCreateVN(request, env, auth) {
  if (!auth.authenticated) {
    return errorResponse('未授权', 401);
  }

  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;

  if (
    Object.prototype.hasOwnProperty.call(bodyResult.data, 'playTime') ||
    Object.prototype.hasOwnProperty.call(bodyResult.data, 'playTimeMinutes')
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
  } = bodyResult.data;

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
      tags: Array.isArray(tags) ? tags : [] // 用户手动 tags
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

  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;

  if (
    Object.prototype.hasOwnProperty.call(bodyResult.data, 'playTime') ||
    Object.prototype.hasOwnProperty.call(bodyResult.data, 'playTimeMinutes')
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
  } = bodyResult.data;

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

  const list = await getVNList(env);

  if (list.items.length === 0) {
    return errorResponse('没有需要索引的条目', 400);
  }

  // 创建索引状态
  const taskId = `idx_${Date.now()}`;
  const status = {
    status: 'running',
    taskId,
    total: list.items.length,
    processed: 0,
    failed: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    lastReconciledAt: null
  };

  await saveIndexStatus(env, status);

  // 发送所有ID到Queue（同一批次共享同一个 taskId）
  for (const item of list.items) {
    await env.VN_INDEX_QUEUE.send({
      vndbId: item.id,
      taskId,
      retryCount: 0
    });
  }

  return successResponse({ total: list.items.length }, '索引任务已启动');
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

  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;
  const body = bodyResult.data;
  const settings = await getSettings(env);

  if (body.vndbApiToken !== undefined) {
    settings.vndbApiToken = body.vndbApiToken;
  }

  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      return errorResponse('密码长度至少6位', 400);
    }
    await initAdminPassword(env, body.newPassword);
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

  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) return bodyResult.error;
  const { entries, mode } = bodyResult.data;
  const importMode = mode || 'merge';

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

  await importData(env, { entries }, importMode);

  return successResponse({ count: entries.length }, '导入成功');
}

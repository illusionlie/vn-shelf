/**
 * KV操作封装模块
 */

import { safeJSONParse } from './utils.js';

// 索引条目结果保留 14 天，避免 KV 键无限增长
const INDEX_ITEM_RESULT_TTL_SECONDS = 14 * 24 * 60 * 60;

/**
 * 获取设置
 * @param {Object} env - 环境变量
 * @returns {Object}
 */
export async function getSettings(env) {
  const settings = await env.KV.get('config:settings', 'json');
  return settings || {
    vndbApiToken: '',
    adminPasswordHash: '',
    jwtSecret: '',
    lastIndexTime: null,
    // Tags 显示配置
    tagsMode: 'vndb',           // 'vndb' | 'manual'
    translateTags: true,         // 是否启用前端翻译
    translationUrl: ''           // 翻译文件 URL（空则使用默认）
  };
}

/**
 * 保存设置
 * @param {Object} env - 环境变量
 * @param {Object} settings - 设置对象
 */
export async function saveSettings(env, settings) {
  await env.KV.put('config:settings', JSON.stringify(settings));
}

/**
 * 获取VN列表（预聚合）
 * @param {Object} env - 环境变量
 * @returns {Object}
 */
export async function getVNList(env) {
  const list = await env.KV.get('vn:list', 'json');
  return list || {
    items: [],
    stats: {
      total: 0,
      totalPlayTimeMinutes: 0,
      avgRating: 0,
      avgPersonalRating: 0
    },
    updatedAt: null
  };
}

/**
 * 保存VN列表
 * @param {Object} env - 环境变量
 * @param {Object} list - 列表对象
 */
export async function saveVNList(env, list) {
  list.updatedAt = new Date().toISOString();
  await env.KV.put('vn:list', JSON.stringify(list));
}

/**
 * 获取单个VN条目
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 * @returns {Object|null}
 */
export async function getVNEntry(env, id) {
  return await env.KV.get(`vn:${id}`, 'json');
}

/**
 * 保存单个VN条目
 * @param {Object} env - 环境变量
 * @param {Object} entry - 条目对象
 */
export async function saveVNEntry(env, entry) {
  entry.updatedAt = new Date().toISOString();
  await env.KV.put(`vn:${entry.id}`, JSON.stringify(entry));
}

/**
 * 删除单个VN条目
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 */
export async function deleteVNEntry(env, id) {
  await env.KV.delete(`vn:${id}`);
}

/**
 * 规范化数值：缺失/非数值/负数都按 0 处理，避免统计出现负值
 * @param {any} value
 * @returns {number}
 */
function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num;
}

/**
 * 将完整条目转换为列表项
 * 说明：playTimeMinutes 主要用于增量统计，不影响既有展示逻辑。
 * @param {Object} entry
 * @returns {Object}
 */
function buildListItem(entry) {
  return {
    id: entry.id,
    title: entry.vndb?.title || '', // 英文标题
    titleJa: entry.vndb?.titleJa || entry.vndb?.title || '', // 日文标题，没有则使用英文
    titleCn: entry.user?.titleCn || entry.vndb?.titleCn || '', // 中文标题，优先用户设置
    image: entry.vndb?.image || '',
    rating: toNonNegativeNumber(entry.vndb?.rating),
    personalRating: toNonNegativeNumber(entry.user?.personalRating),
    playTimeMinutes: toNonNegativeNumber(entry.user?.playTimeMinutes),
    developers: entry.vndb?.developers || [],
    allAge: entry.vndb?.allAge || false, // 全年龄标记
    createdAt: entry.createdAt
  };
}

/**
 * 读取列表项用于增量统计的关键字段
 * @param {Object|null} item
 * @returns {{ rating: number, personalRating: number, playTimeMinutes: number, hasPersonalRating: boolean }}
 */
function getListItemStatsInput(item) {
  const rating = toNonNegativeNumber(item?.rating);
  const personalRating = toNonNegativeNumber(item?.personalRating);
  const playTimeMinutes = toNonNegativeNumber(item?.playTimeMinutes);

  return {
    rating,
    personalRating,
    playTimeMinutes,
    hasPersonalRating: personalRating > 0
  };
}

/**
 * 统计“有个人评分”的条目数（personalRating > 0）
 * @param {Array} items
 * @returns {number}
 */
function countPersonalRatedItems(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((count, item) => {
    return count + (toNonNegativeNumber(item?.personalRating) > 0 ? 1 : 0);
  }, 0);
}

/**
 * 按给定 ID 快照重建 VN 列表聚合数据
 * @param {Object} env - 环境变量
 * @param {string[]} ids - 需要参与聚合的条目 ID 快照
 * @returns {Object}
 */
async function rebuildVNListByIds(env, ids) {
  const normalizedIds = Array.isArray(ids)
    ? Array.from(new Set(ids.filter(id => typeof id === 'string' && id)))
    : [];

  // 批量获取所有条目
  const entries = [];
  for (const id of normalizedIds) {
    const entry = await getVNEntry(env, id);
    if (entry) {
      entries.push(entry);
    }
  }

  // 计算统计数据（全量语义基准）
  const totals = entries.reduce((acc, entry) => {
    const rating = toNonNegativeNumber(entry.vndb?.rating);
    const personalRating = toNonNegativeNumber(entry.user?.personalRating);
    const playTimeMinutes = toNonNegativeNumber(entry.user?.playTimeMinutes);

    acc.totalPlayTimeMinutes += playTimeMinutes;
    acc.ratingsSum += rating;

    if (personalRating > 0) {
      acc.personalRatingsCount += 1;
      acc.personalRatingsSum += personalRating;
    }

    return acc;
  }, {
    totalPlayTimeMinutes: 0,
    ratingsSum: 0,
    personalRatingsCount: 0,
    personalRatingsSum: 0
  });

  // 构建新列表
  const newList = {
    items: entries.map(buildListItem),
    stats: {
      total: entries.length,
      totalPlayTimeMinutes: totals.totalPlayTimeMinutes,
      avgRating: entries.length > 0 ? totals.ratingsSum / entries.length : 0,
      avgPersonalRating: totals.personalRatingsCount > 0
        ? totals.personalRatingsSum / totals.personalRatingsCount
        : 0
    },
    updatedAt: new Date().toISOString()
  };

  await saveVNList(env, newList);
  return newList;
}

/**
 * 重建VN列表聚合数据
 * 兜底场景：批量导入、历史数据修复、或怀疑增量统计漂移时使用全量重建校正。
 * @param {Object} env - 环境变量
 */
export async function rebuildVNList(env) {
  const oldList = await getVNList(env);
  const ids = Array.isArray(oldList.items)
    ? oldList.items.map(item => item?.id).filter(id => typeof id === 'string' && id)
    : [];

  return rebuildVNListByIds(env, ids);
}

/**
 * 添加条目到列表
 * @param {Object} env - 环境变量
 * @param {Object} entry - 条目对象
 */
export async function addEntryToList(env, entry) {
  const list = await getVNList(env);

  // 基于当前列表计算更新前 personalRating>0 的计数（用于增量平均值）
  const prevPersonalRatedCount = countPersonalRatedItems(list.items);

  // 检查是否已存在
  const existingIndex = list.items.findIndex(item => item.id === entry.id);
  const nextItem = buildListItem(entry);
  const previousItem = existingIndex >= 0 ? list.items[existingIndex] : null;

  if (existingIndex >= 0) {
    // 更新现有条目
    list.items[existingIndex] = nextItem;
  } else {
    // 添加新条目
    list.items.push(nextItem);
  }

  // 更新统计（增量，不再全量回读所有条目）
  await updateListStats(env, list, {
    previousItem,
    nextItem,
    totalDelta: existingIndex >= 0 ? 0 : 1,
    prevPersonalRatedCount,
    nextPersonalRatedCount: countPersonalRatedItems(list.items)
  });
}

/**
 * 从列表中移除条目
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 */
export async function removeEntryFromList(env, id) {
  const list = await getVNList(env);
  const prevPersonalRatedCount = countPersonalRatedItems(list.items);

  const existingIndex = list.items.findIndex(item => item.id === id);
  const previousItem = existingIndex >= 0 ? list.items[existingIndex] : null;

  if (existingIndex >= 0) {
    list.items.splice(existingIndex, 1);
  }

  // 删除不存在条目时 totalDelta 为 0，避免把统计减成负值
  await updateListStats(env, list, {
    previousItem,
    nextItem: null,
    totalDelta: existingIndex >= 0 ? -1 : 0,
    prevPersonalRatedCount,
    nextPersonalRatedCount: countPersonalRatedItems(list.items)
  });
}

/**
 * 增量更新列表统计
 * 公式：
 * - ratingSum' = ratingSum - oldRating + newRating
 * - playTime' = playTime - oldPlayTime + newPlayTime
 * - personalSum' = personalSum - oldPersonal(>0) + newPersonal(>0)
 * 再由 sum / count 还原平均值；count 对 avgPersonalRating 仅统计 personalRating > 0。
 *
 * 一致性假设：list.items 与 list.stats 来自同一基线。
 * 若检测到基线异常（如旧数据缺少 playTimeMinutes 或 total 不一致），
 * 自动回退到全量 rebuildVNList() 进行兜底校正。
 *
 * @param {Object} env - 环境变量
 * @param {Object} list - 列表对象
 * @param {Object} delta - 统计增量上下文
 */
async function updateListStats(env, list, delta) {
  const {
    previousItem = null,
    nextItem = null,
    totalDelta = 0,
    prevPersonalRatedCount = 0,
    nextPersonalRatedCount = 0
  } = delta || {};

  list.stats = list.stats || {
    total: 0,
    totalPlayTimeMinutes: 0,
    avgRating: 0,
    avgPersonalRating: 0
  };

  const prevStats = list.stats;
  const prevTotal = Math.max(0, toNonNegativeNumber(prevStats.total));
  const prevTotalPlayTime = toNonNegativeNumber(prevStats.totalPlayTimeMinutes);
  const prevAvgRating = toNonNegativeNumber(prevStats.avgRating);
  const prevAvgPersonalRating = toNonNegativeNumber(prevStats.avgPersonalRating);

  const prevInput = getListItemStatsInput(previousItem);
  const nextInput = getListItemStatsInput(nextItem);

  const expectedTotal = Math.max(0, prevTotal + totalDelta);
  const actualTotal = Array.isArray(list.items) ? list.items.length : 0;
  const snapshotIds = Array.isArray(list.items)
    ? list.items.map(item => item?.id).filter(id => typeof id === 'string' && id)
    : [];

  // 基线异常（例如旧数据缺少 playTimeMinutes）时走全量重建兜底
  // 注意：这里必须使用“当前内存快照”而非 KV 旧列表，避免新增条目丢失
  const missingLegacyStatField = previousItem && (previousItem.playTimeMinutes === undefined || previousItem.playTimeMinutes === null);
  if (expectedTotal !== actualTotal || missingLegacyStatField) {
    await rebuildVNListByIds(env, snapshotIds);
    return;
  }

  const prevRatingSum = prevAvgRating * prevTotal;
  const prevPersonalSum = prevAvgPersonalRating * Math.max(0, toNonNegativeNumber(prevPersonalRatedCount));

  const nextRatingSum = Math.max(0, prevRatingSum - prevInput.rating + nextInput.rating);
  const nextTotalPlayTime = Math.max(0, prevTotalPlayTime - prevInput.playTimeMinutes + nextInput.playTimeMinutes);

  const nextPersonalSum = Math.max(
    0,
    prevPersonalSum
      - (prevInput.hasPersonalRating ? prevInput.personalRating : 0)
      + (nextInput.hasPersonalRating ? nextInput.personalRating : 0)
  );

  const safePersonalRatedCount = Math.max(0, toNonNegativeNumber(nextPersonalRatedCount));

  list.stats = {
    total: actualTotal,
    totalPlayTimeMinutes: nextTotalPlayTime,
    avgRating: actualTotal > 0 ? nextRatingSum / actualTotal : 0,
    avgPersonalRating: safePersonalRatedCount > 0 ? nextPersonalSum / safePersonalRatedCount : 0
  };

  await saveVNList(env, list);
}

/**
 * 获取索引状态
 * @param {Object} env - 环境变量
 * @returns {Object}
 */
export async function getIndexStatus(env) {
  const status = await env.KV.get('index:status', 'json');
  return status || {
    status: 'idle',
    taskId: null,
    total: 0,
    processed: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null,
    lastReconciledAt: null
  };
}

/**
 * 保存索引状态
 * @param {Object} env - 环境变量
 * @param {Object} status - 状态对象
 */
export async function saveIndexStatus(env, status) {
  await env.KV.put('index:status', JSON.stringify(status));
}

/**
 * 记录单个条目的索引结果（幂等键：taskId + vndbId）
 *
 * 一致性策略：
 * - 每个条目写入独立键，避免多个消费者并发读改写 index:status 的覆盖问题。
 * - 成功结果具备“粘性”：若已成功，后续重复投递即使失败也不回退为 failed。
 *   这可降低 at-least-once 投递下的误报失败风险。
 *
 * 局限：KV 缺少 CAS，极端并发下仍可能出现最后写入覆盖；后续通过汇总校正降低影响。
 */
export async function recordIndexItemResult(env, { taskId, vndbId, state, retryCount = 0, error = null }) {
  if (!taskId || !vndbId) return null;

  const key = `index:item:${taskId}:${vndbId}`;
  const normalizedState = state === 'failed' ? 'failed' : 'success';
  const existing = await env.KV.get(key, 'json');

  // 成功结果优先，避免重复消息把已成功条目回退为失败
  if (existing?.state === 'success' && normalizedState === 'failed') {
    return existing;
  }

  const result = {
    taskId,
    vndbId,
    state: normalizedState,
    retryCount,
    error: normalizedState === 'failed' ? (error || null) : null,
    updatedAt: new Date().toISOString()
  };

  await env.KV.put(key, JSON.stringify(result), {
    expirationTtl: INDEX_ITEM_RESULT_TTL_SECONDS
  });
  return result;
}

/**
 * 汇总任务条目结果，计算唯一 processed 与 failed 集合
 */
export async function summarizeIndexTaskResults(env, taskId) {
  if (!taskId) {
    return { processed: 0, failed: [] };
  }

  const prefix = `index:item:${taskId}:`;
  const keyNames = [];
  let cursor = undefined;

  do {
    const page = await env.KV.list({ prefix, cursor });
    for (const item of page.keys) {
      keyNames.push(item.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  if (keyNames.length === 0) {
    return { processed: 0, failed: [] };
  }

  const values = await Promise.all(keyNames.map(name => env.KV.get(name, 'json')));
  const failedSet = new Set();

  for (let i = 0; i < keyNames.length; i++) {
    const keyName = keyNames[i];
    const value = values[i];
    const fallbackId = keyName.slice(prefix.length);
    const id = value?.vndbId || fallbackId;

    if (value?.state === 'failed') {
      failedSet.add(id);
    }
  }

  return {
    processed: keyNames.length,
    failed: Array.from(failedSet)
  };
}

/**
 * 清理指定索引任务的条目结果键（best-effort）
 * @param {Object} env - 环境变量
 * @param {string} taskId - 索引任务ID
 * @returns {number} 删除键数量
 */
async function cleanupIndexTaskResults(env, taskId) {
  if (!taskId) return 0;

  const prefix = `index:item:${taskId}:`;
  const keyNames = [];
  let cursor = undefined;

  do {
    const page = await env.KV.list({ prefix, cursor });
    for (const item of page.keys) {
      keyNames.push(item.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  if (keyNames.length === 0) {
    return 0;
  }

  await Promise.all(keyNames.map(name => env.KV.delete(name)));
  return keyNames.length;
}

/**
 * 基于条目结果重算并写回 index:status（替代逐条 processed++）
 */
export async function reconcileIndexStatusFromItems(env, taskId) {
  const status = await getIndexStatus(env);

  // 只允许当前活动任务更新聚合状态，隔离旧任务残留消息
  if (!taskId || !status.taskId || status.taskId !== taskId) {
    return status;
  }

  // 终态任务不再重复汇总，避免清理后把 failed 覆写为空
  if (status.status === 'completed' || status.status === 'partial' || status.status === 'failed') {
    return status;
  }

  const summary = await summarizeIndexTaskResults(env, taskId);
  const total = status.total || 0;
  const summarizedProcessed = Math.min(total, summary.processed);

  const nextStatus = {
    ...status,
    // 维持单调上升（在同一状态视图内），并且不超过 total
    processed: Math.min(total, Math.max(status.processed || 0, summarizedProcessed)),
    failed: summary.failed,
    lastReconciledAt: new Date().toISOString()
  };

  let transitionedToTerminal = false;
  if (nextStatus.status === 'running' && nextStatus.processed >= total) {
    nextStatus.status = nextStatus.failed.length > 0 ? 'partial' : 'completed';
    nextStatus.completedAt = nextStatus.completedAt || new Date().toISOString();
    transitionedToTerminal = true;
  }

  await saveIndexStatus(env, nextStatus);

  if (transitionedToTerminal) {
    try {
      await cleanupIndexTaskResults(env, taskId);
    } catch (error) {
      console.warn('[index][cleanup] failed to cleanup task items', { taskId, error });
    }
  }

  return nextStatus;
}

/**
 * 导出所有数据
 * @param {Object} env - 环境变量
 * @returns {Object}
 */
export async function exportData(env) {
  const list = await getVNList(env);
  const entries = [];
  
  for (const item of list.items) {
    const entry = await getVNEntry(env, item.id);
    if (entry) {
      entries.push(entry);
    }
  }
  
  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    entries
  };
}

/**
 * 导入数据
 * @param {Object} env - 环境变量
 * @param {Object} data - 导入数据
 * @param {string} mode - 导入模式 (merge | replace)
 */
export async function importData(env, data, mode = 'merge') {
  if (mode === 'replace') {
    // 获取并删除现有数据
    const oldList = await getVNList(env);
    for (const item of oldList.items) {
      await deleteVNEntry(env, item.id);
    }
  }
  
  // 写入新数据
  for (const entry of data.entries) {
    await saveVNEntry(env, entry);
  }
  
  // 重建列表
  await rebuildVNList(env);
}

/**
 * KV操作封装模块
 */

// 索引条目结果保留 14 天，避免 KV 键无限增长
const INDEX_ITEM_RESULT_TTL_SECONDS = 14 * 24 * 60 * 60;
const TIER_COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
const BATCH_UPDATE_TIER_CHUNK_SIZE = 25;
const INDEX_START_LOCK_DO_NAME = 'global';
// 兼容旧配置时的回退锁键：仅用于 best-effort 互斥（KV 无原子 CAS，极端并发下可能双成功）
const INDEX_START_LOCK_KEY = 'index:start-lock';
const INDEX_START_LOCK_TTL_SECONDS = 60;
const INDEX_START_LOCK_TTL_MS = INDEX_START_LOCK_TTL_SECONDS * 1000;
let hasWarnedIndexStartLockKVFallback = false;

const DEFAULT_TIERS = [
  { id: 'tier-s', name: 'S', color: '#ff4757', order: 0 },
  { id: 'tier-a', name: 'A', color: '#ffa502', order: 1 },
  { id: 'tier-b', name: 'B', color: '#2ed573', order: 2 },
  { id: 'tier-c', name: 'C', color: '#1e90ff', order: 3 },
  { id: 'tier-d', name: 'D', color: '#a55eea', order: 4 }
];

function buildDefaultTierList() {
  return {
    tiers: DEFAULT_TIERS.map(tier => ({ ...tier })),
    updatedAt: null
  };
}

function normalizeTierList(tierList) {
  const seenTierIds = new Set();

  const tiers = Array.isArray(tierList?.tiers)
    ? tierList.tiers
      .map(item => {
        const normalizedId = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!normalizedId || seenTierIds.has(normalizedId)) {
          return null;
        }
        seenTierIds.add(normalizedId);

        const normalizedName = typeof item?.name === 'string'
          ? item.name.trim()
          : '';
        const normalizedColor = typeof item?.color === 'string' && TIER_COLOR_HEX_REGEX.test(item.color.trim())
          ? item.color.trim()
          : '#666666';

        return {
          id: normalizedId,
          name: normalizedName || `Tier ${seenTierIds.size}`,
          color: normalizedColor,
          order: Number.isFinite(Number(item?.order)) ? Math.max(0, Math.floor(Number(item.order))) : seenTierIds.size - 1
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index }))
    : [];

  return {
    tiers,
    updatedAt: tierList?.updatedAt || null
  };
}

function isTierListObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeTierLists(currentTierList, incomingTierList) {
  const normalizedCurrent = normalizeTierList(currentTierList);
  const normalizedIncoming = normalizeTierList(incomingTierList);
  const incomingTierMap = new Map(normalizedIncoming.tiers.map(tier => [tier.id, tier]));

  const mergedTiers = normalizedCurrent.tiers.map(tier => {
    const incomingTier = incomingTierMap.get(tier.id);
    if (!incomingTier) {
      return { ...tier };
    }

    incomingTierMap.delete(tier.id);

    return {
      ...tier,
      name: incomingTier.name,
      color: incomingTier.color
    };
  });

  for (const tier of incomingTierMap.values()) {
    mergedTiers.push({
      ...tier,
      order: mergedTiers.length
    });
  }

  return normalizeTierList({
    tiers: mergedTiers,
    updatedAt: normalizedCurrent.updatedAt || normalizedIncoming.updatedAt || null
  });
}

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
 * 获取Tier列表
 * @param {Object} env - 环境变量
 * @returns {{tiers: Array, updatedAt: string|null}}
 */
export async function getTierList(env) {
  const tierList = await env.KV.get('tier:list', 'json');

  if (!tierList) {
    return buildDefaultTierList();
  }

  return normalizeTierList(tierList);
}

/**
 * 保存Tier列表
 * @param {Object} env - 环境变量
 * @param {Object} tierList - Tier 列表对象
 * @returns {{tiers: Array, updatedAt: string}}
 */
export async function saveTierList(env, tierList) {
  const normalized = normalizeTierList(tierList);
  normalized.updatedAt = new Date().toISOString();
  await env.KV.put('tier:list', JSON.stringify(normalized));
  return normalized;
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
 * 从列表项集合重算统计快照
 * @param {Array} items
 * @returns {{ total: number, totalPlayTimeMinutes: number, avgRating: number, avgPersonalRating: number }}
 */
function buildListStats(items) {
  const safeItems = Array.isArray(items) ? items : [];

  const totals = safeItems.reduce((acc, item) => {
    const rating = toNonNegativeNumber(item?.rating);
    const personalRating = toNonNegativeNumber(item?.personalRating);
    const playTimeMinutes = toNonNegativeNumber(item?.playTimeMinutes);

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

  return {
    total: safeItems.length,
    totalPlayTimeMinutes: totals.totalPlayTimeMinutes,
    avgRating: safeItems.length > 0 ? totals.ratingsSum / safeItems.length : 0,
    avgPersonalRating: totals.personalRatingsCount > 0
      ? totals.personalRatingsSum / totals.personalRatingsCount
      : 0
  };
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
    tierId: entry.user?.tierId || null,
    tierSort: toNonNegativeNumber(entry.user?.tierSort),
    createdAt: entry.createdAt
  };
}

function normalizeSnapshotIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  return Array.from(new Set(
    ids
      .map(id => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean)
  ));
}

/**
 * 按给定 ID 快照重建 VN 列表聚合数据
 * @param {Object} env - 环境变量
 * @param {string[]} ids - 需要参与聚合的条目 ID 快照
 * @returns {Object}
 */
async function rebuildVNListByIds(env, ids) {
  const normalizedIds = normalizeSnapshotIds(ids);

  // 批量获取所有条目
  const entries = [];
  for (const id of normalizedIds) {
    const entry = await getVNEntry(env, id);
    if (entry) {
      entries.push(entry);
    }
  }

  // 构建新列表
  const items = entries.map(buildListItem);
  const newList = {
    items,
    stats: buildListStats(items),
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

  // 检查是否已存在
  const existingIndex = list.items.findIndex(item => item.id === entry.id);
  const nextItem = buildListItem(entry);

  if (existingIndex >= 0) {
    // 更新现有条目
    list.items[existingIndex] = nextItem;
  } else {
    // 添加新条目
    list.items.push(nextItem);
  }

  list.stats = buildListStats(list.items);
  await saveVNList(env, list);
}

/**
 * 从列表中移除条目
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 */
export async function removeEntryFromList(env, id) {
  const list = await getVNList(env);

  const existingIndex = list.items.findIndex(item => item.id === id);

  if (existingIndex >= 0) {
    list.items.splice(existingIndex, 1);
    list.stats = buildListStats(list.items);
    await saveVNList(env, list);
    return;
  }

  // 删除不存在条目时保持幂等，不写回 KV
}

/**
 * 规范化 Tier 归属参数
 * @param {Object|null} userData - user 数据
 * @param {string|null} tierId - Tier ID，null 表示移除分类
 * @param {number|undefined} tierSort - Tier 内排序值（从 0 开始）
 * @returns {{tierId: string|null, tierSort: number}}
 */
function normalizeTierAssignment(userData, tierId, tierSort = undefined) {
  const normalizedTierId = tierId || null;
  const currentTierSort = Number(userData?.tierSort);
  const normalizedTierSort = Number.isFinite(Number(tierSort))
    ? Math.max(0, Math.floor(Number(tierSort)))
    : (Number.isFinite(currentTierSort) && currentTierSort >= 0 ? Math.floor(currentTierSort) : 0);

  return {
    tierId: normalizedTierId,
    tierSort: normalizedTierId ? normalizedTierSort : 0
  };
}

/**
 * 更新VN条目的 Tier 归属
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 * @param {string|null} tierId - Tier ID，null 表示移除分类
 * @param {number|undefined} tierSort - Tier 内排序值（从 0 开始）
 * @returns {Object|null}
 */
export async function updateVNTier(env, id, tierId, tierSort = undefined) {
  const entry = await getVNEntry(env, id);
  if (!entry) {
    return null;
  }

  const normalizedAssignment = normalizeTierAssignment(entry.user, tierId, tierSort);

  entry.user = {
    ...(entry.user || {}),
    tierId: normalizedAssignment.tierId,
    tierSort: normalizedAssignment.tierSort
  };

  await saveVNEntry(env, entry);
  await addEntryToList(env, entry);

  return entry;
}

/**
 * 批量更新 VN 条目的 Tier 归属
 *
 * 性能策略：
 * - 每个条目仍单独写回 `vn:{id}`（确保明细一致）
 * - `vn:list` 仅在最后写回一次，避免循环中重复读改写
 * - 若发现列表快照不完整，则回退到基于“列表快照 + 缺失条目ID”的 `rebuildVNListByIds()` 兜底校正
 *
 * @param {Object} env - 环境变量
 * @param {{id: string, tierId: string|null, tierSort?: number}[]} updates - 批量更新数据
 * @returns {Promise<Array<{id: string, tierId: string|null, tierSort: number}>>}
 */
export async function batchUpdateVNTiers(env, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return [];
  }

  const list = await getVNList(env);
  const listItems = Array.isArray(list.items) ? [...list.items] : [];
  const listItemIndexMap = new Map();
  for (let index = 0; index < listItems.length; index += 1) {
    const itemId = listItems[index]?.id;
    if (typeof itemId === 'string' && itemId) {
      listItemIndexMap.set(itemId, index);
    }
  }

  let requiresRebuild = !Array.isArray(list.items);
  const rebuildSnapshotIds = new Set(
    Array.isArray(list.items)
      ? list.items.map(item => item?.id).filter(id => typeof id === 'string' && id)
      : []
  );

  // 两阶段处理：
  // 1) 先完整校验并构造所有更新，避免中途遇到 404 导致“已写入部分明细但未更新聚合列表”
  // 2) 再统一写入明细并更新聚合快照
  const preparedUpdates = [];

  for (const update of updates) {
    const entry = await getVNEntry(env, update.id);
    if (!entry) {
      const notFoundError = new Error(`条目不存在: ${update.id}`);
      notFoundError.status = 404;
      throw notFoundError;
    }

    const normalizedAssignment = normalizeTierAssignment(entry.user, update.tierId, update.tierSort);
    const nextEntry = {
      ...entry,
      user: {
        ...(entry.user || {}),
        tierId: normalizedAssignment.tierId,
        tierSort: normalizedAssignment.tierSort
      }
    };

    preparedUpdates.push({
      entry: nextEntry,
      normalizedAssignment
    });
  }

  const updatedItems = [];
  let writeError = null;

  for (let index = 0; index < preparedUpdates.length; index += BATCH_UPDATE_TIER_CHUNK_SIZE) {
    const chunk = preparedUpdates.slice(index, index + BATCH_UPDATE_TIER_CHUNK_SIZE);

    const writeResults = await Promise.allSettled(chunk.map(async (prepared) => {
      const { entry, normalizedAssignment } = prepared;

      await saveVNEntry(env, entry);

      const itemIndex = listItemIndexMap.get(entry.id);
      if (itemIndex === undefined) {
        requiresRebuild = true;
        rebuildSnapshotIds.add(entry.id);
      } else {
        listItems[itemIndex] = buildListItem(entry);
      }

      updatedItems.push({
        id: entry.id,
        tierId: normalizedAssignment.tierId,
        tierSort: normalizedAssignment.tierSort
      });
    }));

    const rejected = writeResults.find(result => result.status === 'rejected');
    if (rejected) {
      writeError = rejected.reason instanceof Error
        ? rejected.reason
        : new Error(String(rejected.reason));
      break;
    }
  }

  const shouldForceRebuild = writeError !== null;

  if (requiresRebuild || shouldForceRebuild) {
    await rebuildVNListByIds(env, Array.from(rebuildSnapshotIds));
  } else {
    list.items = listItems;
    await saveVNList(env, list);
  }

  if (writeError) {
    throw writeError;
  }

  return updatedItems;
}

/**
 * 清空指定 Tier 下所有 VN 的 tierId
 * @param {Object} env - 环境变量
 * @param {string} tierId - Tier ID
 * @returns {number} 更新条目数
 */
export async function clearTierAssignments(env, tierId) {
  if (!tierId) return 0;

  const list = await getVNList(env);
  const targets = Array.isArray(list.items)
    ? list.items.filter(item => item?.tierId === tierId)
    : [];

  if (targets.length === 0) {
    return 0;
  }

  await batchUpdateVNTiers(env, targets.map(item => ({
    id: item.id,
    tierId: null
  })));

  return targets.length;
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

function hasIndexStartLockDurableObjectBinding(env) {
  return Boolean(
    env?.INDEX_START_LOCK
    && typeof env.INDEX_START_LOCK.idFromName === 'function'
    && typeof env.INDEX_START_LOCK.get === 'function'
  );
}

async function callIndexStartLockDurableObject(env, path, payload = {}) {
  const durableId = env.INDEX_START_LOCK.idFromName(INDEX_START_LOCK_DO_NAME);
  const durableStub = env.INDEX_START_LOCK.get(durableId);

  const response = await durableStub.fetch(`https://index-start-lock${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`索引启动锁请求失败: ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function warnIndexStartLockKVFallbackOnce(operation) {
  if (hasWarnedIndexStartLockKVFallback) {
    return;
  }

  hasWarnedIndexStartLockKVFallback = true;
  console.warn('[index][start-lock] INDEX_START_LOCK Durable Object binding not found; fallback to KV lock (best-effort, non-atomic under high concurrency)', {
    operation,
    key: INDEX_START_LOCK_KEY,
    ttlSeconds: INDEX_START_LOCK_TTL_SECONDS
  });
}

/**
 * 尝试获取索引启动分布式锁
 * 优先使用 Durable Object 提供原子互斥；未配置时回退到 KV 兼容逻辑（best-effort，非强一致互斥）。
 * @param {Object} env - 环境变量
 * @param {string} holder - 持有者标识
 * @returns {Promise<boolean>} true=获取成功，false=获取失败
 */
export async function tryAcquireIndexStartLock(env, holder) {
  if (!holder) return false;

  if (hasIndexStartLockDurableObjectBinding(env)) {
    const result = await callIndexStartLockDurableObject(env, '/acquire', {
      holder,
      ttlMs: INDEX_START_LOCK_TTL_MS
    });
    return result?.acquired === true;
  }

  warnIndexStartLockKVFallbackOnce('acquire');

  const now = Date.now();

  const existing = await env.KV.get(INDEX_START_LOCK_KEY, 'json');

  if (existing?.expiresAt && Number(existing.expiresAt) > now) {
    return false;
  }

  const nextLock = {
    holder,
    expiresAt: now + INDEX_START_LOCK_TTL_MS,
    acquiredAt: new Date(now).toISOString()
  };

  await env.KV.put(INDEX_START_LOCK_KEY, JSON.stringify(nextLock), {
    expirationTtl: INDEX_START_LOCK_TTL_SECONDS
  });

  const confirmed = await env.KV.get(INDEX_START_LOCK_KEY, 'json');
  return confirmed?.holder === holder;
}

/**
 * 释放索引启动分布式锁（仅持有者可释放）
 * 未配置 Durable Object 时回退为 KV best-effort 释放。
 * @param {Object} env - 环境变量
 * @param {string} holder - 持有者标识
 */
export async function releaseIndexStartLock(env, holder) {
  if (!holder) return;

  if (hasIndexStartLockDurableObjectBinding(env)) {
    await callIndexStartLockDurableObject(env, '/release', { holder });
    return;
  }

  warnIndexStartLockKVFallbackOnce('release');

  const existing = await env.KV.get(INDEX_START_LOCK_KEY, 'json');
  if (existing?.holder === holder) {
    await env.KV.delete(INDEX_START_LOCK_KEY);
  }
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
  const tierList = await getTierList(env);
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
    entries,
    tierList
  };
}

/**
 * 导入数据
 * @param {Object} env - 环境变量
 * @param {Object} data - 导入数据
 * @param {string} mode - 导入模式 (merge | replace)
 */
export async function importData(env, data, mode = 'merge') {
  const incomingEntries = Array.isArray(data?.entries) ? data.entries : [];
  const incomingEntryIds = normalizeSnapshotIds(incomingEntries.map(entry => entry?.id));
  const hasIncomingTierList = isTierListObject(data?.tierList);

  let rebuildSnapshotIds = incomingEntryIds;

  if (mode === 'merge') {
    const oldList = await getVNList(env);
    const oldListIds = Array.isArray(oldList.items)
      ? oldList.items.map(item => item?.id)
      : [];

    rebuildSnapshotIds = normalizeSnapshotIds([...oldListIds, ...incomingEntryIds]);
  }

  if (mode === 'replace') {
    // 获取并删除现有数据
    const oldList = await getVNList(env);
    for (const item of oldList.items) {
      await deleteVNEntry(env, item.id);
    }

    // replace 语义下，若未提供 tierList 则清空旧 Tier 数据
    if (!hasIncomingTierList) {
      await env.KV.delete('tier:list');
    }
  }

  // 写入新数据
  for (const entry of incomingEntries) {
    await saveVNEntry(env, entry);
  }

  if (hasIncomingTierList) {
    if (mode === 'merge') {
      // merge 语义下保留现有 Tier，并按 ID 合并导入 Tier
      const persistedTierList = await env.KV.get('tier:list', 'json');
      const currentTierList = isTierListObject(persistedTierList)
        ? persistedTierList
        : { tiers: [], updatedAt: null };

      const mergedTierList = mergeTierLists(currentTierList, data.tierList);
      await saveTierList(env, mergedTierList);
    } else {
      await saveTierList(env, data.tierList);
    }
  }

  // 按导入模式重建列表：replace=导入ID集合，merge=旧列表ID∪导入ID
  await rebuildVNListByIds(env, rebuildSnapshotIds);
}

/**
 * D1 数据访问层 — 函数签名与 kv.js 兼容，内部用 D1 SQL 替代 KV 操作
 */

import { initDB } from './db.js';

const TIER_COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
const VNDB_ID_REGEX = /^v\d+$/;
const INDEX_START_LOCK_DO_NAME = 'global';
const INDEX_START_LOCK_TTL_SECONDS = 60;
const INDEX_START_LOCK_TTL_MS = INDEX_START_LOCK_TTL_SECONDS * 1000;
const TIER_LIST_META_KEY = 'tier:list:meta';

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

function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num;
}

function rowToEntry(row) {
  if (!row) return null;

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vndb: {
      title: row.title || '',
      titleJa: row.title_ja || '',
      titleCn: row.title_cn || '',
      image: row.image || '',
      imageNsfw: Boolean(row.image_nsfw),
      rating: toNonNegativeNumber(row.rating),
      length: row.length_text || '',
      lengthMinutes: toNonNegativeNumber(row.length_minutes),
      developers: safeJSONParse(row.developers, []),
      tags: safeJSONParse(row.tags, []),
      allAge: Boolean(row.all_age)
    },
    user: {
      titleCn: row.title_cn_user || '',
      personalRating: toNonNegativeNumber(row.personal_rating),
      playTime: row.play_time || '',
      playTimeHours: toNonNegativeNumber(row.play_time_hours),
      playTimePartMinutes: toNonNegativeNumber(row.play_time_part_minutes),
      playTimeMinutes: toNonNegativeNumber(row.play_time_minutes),
      review: row.review || '',
      startDate: row.start_date,
      finishDate: row.finish_date,
      tags: safeJSONParse(row.user_tags, []),
      tierId: row.tier_id || null,
      tierSort: toNonNegativeNumber(row.tier_sort)
    }
  };
}

function entryToRow(entry, { preserveUpdatedAt = false, now = new Date().toISOString() } = {}) {
  const createdAt = entry.createdAt || now;
  const updatedAt = preserveUpdatedAt && typeof entry.updatedAt === 'string'
    ? entry.updatedAt
    : now;

  return {
    id: entry.id,
    created_at: createdAt,
    updated_at: updatedAt,
    title: entry.vndb?.title || '',
    title_ja: entry.vndb?.titleJa || '',
    title_cn: entry.vndb?.titleCn || '',
    image: entry.vndb?.image || '',
    image_nsfw: entry.vndb?.imageNsfw ? 1 : 0,
    rating: toNonNegativeNumber(entry.vndb?.rating),
    length_text: entry.vndb?.length || '',
    length_minutes: toNonNegativeNumber(entry.vndb?.lengthMinutes),
    developers: JSON.stringify(entry.vndb?.developers || []),
    tags: JSON.stringify(entry.vndb?.tags || []),
    all_age: entry.vndb?.allAge ? 1 : 0,
    title_cn_user: entry.user?.titleCn || '',
    personal_rating: toNonNegativeNumber(entry.user?.personalRating),
    play_time: entry.user?.playTime || '',
    play_time_hours: toNonNegativeNumber(entry.user?.playTimeHours),
    play_time_part_minutes: toNonNegativeNumber(entry.user?.playTimePartMinutes),
    play_time_minutes: toNonNegativeNumber(entry.user?.playTimeMinutes),
    review: entry.user?.review || '',
    start_date: entry.user?.startDate || null,
    finish_date: entry.user?.finishDate || null,
    user_tags: JSON.stringify(entry.user?.tags || []),
    tier_id: entry.user?.tierId || null,
    tier_sort: toNonNegativeNumber(entry.user?.tierSort)
  };
}

export function buildSaveVNEntryStatement(db, entry, options = {}) {
  const row = entryToRow(entry, options);

  return {
    row,
    statement: db.prepare(`
      INSERT OR REPLACE INTO vn_entries (
        id, created_at, updated_at,
        title, title_ja, title_cn, image, image_nsfw, rating,
        length_text, length_minutes, developers, tags, all_age,
        title_cn_user, personal_rating, play_time, play_time_hours,
        play_time_part_minutes, play_time_minutes, review,
        start_date, finish_date, user_tags, tier_id, tier_sort
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.id, row.created_at, row.updated_at,
      row.title, row.title_ja, row.title_cn, row.image, row.image_nsfw, row.rating,
      row.length_text, row.length_minutes, row.developers, row.tags, row.all_age,
      row.title_cn_user, row.personal_rating, row.play_time, row.play_time_hours,
      row.play_time_part_minutes, row.play_time_minutes, row.review,
      row.start_date, row.finish_date, row.user_tags, row.tier_id, row.tier_sort
    )
  };
}

function buildClearTierListStatements(db) {
  return [
    db.prepare('DELETE FROM tiers'),
    db.prepare('DELETE FROM settings WHERE key = ?').bind(TIER_LIST_META_KEY)
  ];
}

function buildSaveTierListStatements(db, tierList, { includeReset = true, now = new Date().toISOString() } = {}) {
  const normalized = normalizeTierList(tierList);
  const statements = includeReset ? buildClearTierListStatements(db) : [];

  statements.push(
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind(TIER_LIST_META_KEY, JSON.stringify({ initialized: true, updatedAt: now }))
  );

  for (const tier of normalized.tiers) {
    statements.push(
      db.prepare(
        'INSERT OR REPLACE INTO tiers (id, name, color, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(tier.id, tier.name, tier.color, tier.order, now)
    );
  }

  return { normalized, now, statements };
}

function safeJSONParse(text, fallback) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function rowToListItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    titleJa: row.title_ja || row.title || '',
    titleCn: row.title_cn_user || row.title_cn || '',
    image: row.image || '',
    imageNsfw: Boolean(row.image_nsfw),
    rating: toNonNegativeNumber(row.rating),
    personalRating: toNonNegativeNumber(row.personal_rating),
    playTimeMinutes: toNonNegativeNumber(row.play_time_minutes),
    developers: safeJSONParse(row.developers, []),
    allAge: Boolean(row.all_age),
    tierId: row.tier_id || null,
    tierSort: toNonNegativeNumber(row.tier_sort),
    createdAt: row.created_at
  };
}

// ============ Settings ============

export async function getSettings(env) {
  await initDB(env.DB);
  const row = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('config:settings').first();

  if (!row) {
    return {
      vndbApiToken: '',
      adminPasswordHash: '',
      jwtSecret: '',
      lastIndexTime: null,
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: '',
      backgroundUrl: '',
      backgroundOverlay: 0.5,
      backgroundBlur: 4
    };
  }

  return safeJSONParse(row.value, {});
}

export async function saveSettings(env, settings) {
  await initDB(env.DB);
  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).bind('config:settings', JSON.stringify(settings)).run();
}

// ============ VN List ============

export async function getVNList(env) {
  await initDB(env.DB);

  const [entryResults, statsResults] = await Promise.all([
    env.DB.prepare(
      'SELECT id, title, title_ja, title_cn, title_cn_user, image, image_nsfw, rating, personal_rating, play_time_minutes, developers, all_age, tier_id, tier_sort, created_at FROM vn_entries ORDER BY created_at DESC'
    ).all(),
    env.DB.prepare(
      'SELECT COUNT(*) as total, COALESCE(SUM(play_time_minutes), 0) as totalPlayTimeMinutes, COALESCE(AVG(CASE WHEN rating > 0 THEN rating END), 0) as avgRating, COALESCE(AVG(CASE WHEN personal_rating > 0 THEN personal_rating END), 0) as avgPersonalRating, MAX(updated_at) as maxUpdatedAt FROM vn_entries'
    ).first()
  ]);

  const items = (entryResults.results || []).map(rowToListItem);
  const statsRow = statsResults;

  return {
    items,
    stats: {
      total: statsRow?.total || 0,
      totalPlayTimeMinutes: toNonNegativeNumber(statsRow?.totalPlayTimeMinutes),
      avgRating: toNonNegativeNumber(statsRow?.avgRating),
      avgPersonalRating: toNonNegativeNumber(statsRow?.avgPersonalRating)
    },
    updatedAt: statsRow?.maxUpdatedAt || null
  };
}

// ============ VN Entry ============

export async function getVNEntry(env, id) {
  await initDB(env.DB);
  const row = await env.DB.prepare(
    'SELECT * FROM vn_entries WHERE id = ?'
  ).bind(id).first();

  return rowToEntry(row);
}

export async function saveVNEntry(env, entry, options = {}) {
  await initDB(env.DB);
  const { row, statement } = buildSaveVNEntryStatement(env.DB, entry, options);
  await statement.run();

  return {
    ...entry,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function deleteVNEntry(env, id) {
  await initDB(env.DB);
  await env.DB.prepare('DELETE FROM vn_entries WHERE id = ?').bind(id).run();
}

// ============ Tier ============

export async function getTierList(env) {
  await initDB(env.DB);
  const { results } = await env.DB.prepare(
    'SELECT id, name, color, sort_order, updated_at FROM tiers ORDER BY sort_order ASC'
  ).all();

  if (results && results.length > 0) {
    return {
      tiers: results.map(row => ({
        id: row.id,
        name: row.name,
        color: row.color,
        order: row.sort_order
      })),
      updatedAt: results[0].updated_at
    };
  }

  const tierMetaRow = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(TIER_LIST_META_KEY).first();

  if (!tierMetaRow) {
    return buildDefaultTierList();
  }

  const tierMeta = safeJSONParse(tierMetaRow.value, {});
  return {
    tiers: [],
    updatedAt: typeof tierMeta?.updatedAt === 'string' ? tierMeta.updatedAt : null
  };
}

export async function saveTierList(env, tierList) {
  await initDB(env.DB);
  const { normalized, now, statements } = buildSaveTierListStatements(env.DB, tierList);
  await env.DB.batch(statements);

  return { ...normalized, updatedAt: now };
}

// ============ VN Tier ============

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

export async function updateVNTier(env, id, tierId, tierSort = undefined) {
  await initDB(env.DB);
  const entry = await getVNEntry(env, id);
  if (!entry) {
    return null;
  }

  const normalizedAssignment = normalizeTierAssignment(entry.user, tierId, tierSort);

  await env.DB.prepare(
    'UPDATE vn_entries SET tier_id = ?, tier_sort = ?, updated_at = ? WHERE id = ?'
  ).bind(normalizedAssignment.tierId, normalizedAssignment.tierSort, new Date().toISOString(), id).run();

  return {
    ...entry,
    user: {
      ...(entry.user || {}),
      tierId: normalizedAssignment.tierId,
      tierSort: normalizedAssignment.tierSort
    }
  };
}

const BATCH_UPDATE_TIER_CHUNK_SIZE = 25;
// D1 batch() 是原子事务：单个 batch 内所有语句要么全部成功，要么全部回滚。
// 但多个 batch() 调用之间不具备跨批事务性——前一个 batch 提交后，后续 batch 失败无法回滚已提交的数据。
const D1_BATCH_CHUNK_SIZE = 100;

export async function batchUpdateVNTiers(env, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return [];
  }

  await initDB(env.DB);

  const uniqueIds = Array.from(new Set(updates.map(u => u.id).filter(Boolean)));
  const existingRows = [];
  for (let i = 0; i < uniqueIds.length; i += BATCH_UPDATE_TIER_CHUNK_SIZE) {
    const chunkIds = uniqueIds.slice(i, i + BATCH_UPDATE_TIER_CHUNK_SIZE);
    const placeholders = chunkIds.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, tier_sort FROM vn_entries WHERE id IN (${placeholders})`
    ).bind(...chunkIds).all();
    existingRows.push(...(results || []));
  }

  const existingMap = new Map(existingRows.map(row => [row.id, row]));
  for (const update of updates) {
    if (!existingMap.has(update.id)) {
      const notFoundError = new Error(`条目不存在: ${update.id}`);
      notFoundError.status = 404;
      throw notFoundError;
    }
  }

  const preparedUpdates = updates.map(update => {
    const row = existingMap.get(update.id);
    const normalizedAssignment = normalizeTierAssignment(
      { tierSort: row.tier_sort },
      update.tierId,
      update.tierSort
    );
    return {
      id: update.id,
      tierId: normalizedAssignment.tierId,
      tierSort: normalizedAssignment.tierSort
    };
  });

  const now = new Date().toISOString();

  for (let i = 0; i < preparedUpdates.length; i += BATCH_UPDATE_TIER_CHUNK_SIZE) {
    const chunk = preparedUpdates.slice(i, i + BATCH_UPDATE_TIER_CHUNK_SIZE);
    await env.DB.batch(
      chunk.map(item =>
        env.DB.prepare(
          'UPDATE vn_entries SET tier_id = ?, tier_sort = ?, updated_at = ? WHERE id = ?'
        ).bind(item.tierId, item.tierSort, now, item.id)
      )
    );
  }

  return preparedUpdates.map(item => ({
    id: item.id,
    tierId: item.tierId,
    tierSort: item.tierSort
  }));
}

export async function clearTierAssignments(env, tierId) {
  if (!tierId) return 0;

  await initDB(env.DB);
  const result = await env.DB.prepare(
    'UPDATE vn_entries SET tier_id = NULL, tier_sort = 0, updated_at = ? WHERE tier_id = ?'
  ).bind(new Date().toISOString(), tierId).run();

  return result.meta?.changes || 0;
}

// ============ Index Status ============

export async function getIndexStatus(env) {
  await initDB(env.DB);
  const row = await env.DB.prepare(
    'SELECT * FROM index_tasks ORDER BY started_at DESC LIMIT 1'
  ).first();

  if (!row) {
    return {
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

  return {
    status: row.status || 'idle',
    taskId: row.id,
    total: row.total || 0,
    processed: row.processed || 0,
    failed: safeJSONParse(row.failed_ids, []),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error || null,
    lastReconciledAt: row.last_reconciled_at
  };
}

export async function saveIndexStatus(env, status) {
  await initDB(env.DB);

  const failed = Array.isArray(status.failed) ? status.failed : [];
  const taskId = status.taskId || status.id;
  const statusValue = status.status || 'idle';

  await env.DB.prepare(`
    INSERT OR REPLACE INTO index_tasks (id, status, total, processed, started_at, completed_at, error, failed_ids, last_reconciled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    taskId,
    statusValue,
    status.total || 0,
    status.processed || 0,
    status.startedAt || null,
    status.completedAt || null,
    status.error || null,
    JSON.stringify(failed),
    status.lastReconciledAt || null
  ).run();
}

// ============ Index Lock (Durable Object) ============

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

export async function tryAcquireIndexStartLock(env, holder) {
  if (!holder) return false;

  if (!hasIndexStartLockDurableObjectBinding(env)) {
    throw new Error('INDEX_START_LOCK Durable Object binding is required');
  }

  const result = await callIndexStartLockDurableObject(env, '/acquire', {
    holder,
    ttlMs: INDEX_START_LOCK_TTL_MS
  });
  return result?.acquired === true;
}

export async function releaseIndexStartLock(env, holder) {
  if (!holder) return;

  if (!hasIndexStartLockDurableObjectBinding(env)) {
    throw new Error('INDEX_START_LOCK Durable Object binding is required');
  }

  await callIndexStartLockDurableObject(env, '/release', { holder });
}

// ============ Index Item Results ============

export async function recordIndexItemResult(env, { taskId, vndbId, state, retryCount = 0, error = null }) {
  if (!taskId || !vndbId) return null;

  await initDB(env.DB);

  const normalizedState = state === 'failed' ? 'failed' : 'success';
  const incomingError = normalizedState === 'failed' ? (error || null) : null;
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    'SELECT state, retry_count, error, updated_at FROM index_task_items WHERE task_id = ? AND vndb_id = ?'
  ).bind(taskId, vndbId).first();

  if (existing && existing.state === 'success' && normalizedState === 'failed') {
    return {
      taskId,
      vndbId,
      state: 'success',
      retryCount: existing.retry_count,
      error: null,
      updatedAt: existing.updated_at
    };
  }

  await env.DB.prepare(`
    INSERT INTO index_task_items (task_id, vndb_id, state, retry_count, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, vndb_id) DO UPDATE SET
      state = excluded.state,
      retry_count = excluded.retry_count,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).bind(taskId, vndbId, normalizedState, retryCount, incomingError, now).run();

  return {
    taskId,
    vndbId,
    state: normalizedState,
    retryCount,
    error: incomingError,
    updatedAt: now
  };
}

export async function summarizeIndexTaskResults(env, taskId) {
  if (!taskId) {
    return { processed: 0, failed: [], settledIds: [] };
  }

  await initDB(env.DB);

  const { results } = await env.DB.prepare(
    'SELECT vndb_id, state FROM index_task_items WHERE task_id = ?'
  ).bind(taskId).all();

  const failedSet = new Set();
  const settledIdSet = new Set();

  for (const row of (results || [])) {
    settledIdSet.add(row.vndb_id);
    if (row.state === 'failed') {
      failedSet.add(row.vndb_id);
    }
  }

  return {
    processed: settledIdSet.size,
    failed: Array.from(failedSet),
    settledIds: Array.from(settledIdSet)
  };
}

export async function reconcileIndexStatusFromItems(env, taskId) {
  await initDB(env.DB);

  const status = await getIndexStatus(env);

  if (!taskId || !status.taskId || status.taskId !== taskId) {
    return status;
  }

  const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'start_failed']);
  if (TERMINAL_STATUSES.has(status.status)) {
    return status;
  }

  const summary = await summarizeIndexTaskResults(env, taskId);
  const total = status.total || 0;
  const summarizedProcessed = Math.min(total, summary.processed);
  const settledProcessed = Math.min(
    total,
    new Set([...(summary.settledIds || []), ...(status.failed || [])]).size
  );

  const candidateStatus = {
    ...status,
    processed: Math.min(total, Math.max(status.processed || 0, summarizedProcessed, settledProcessed)),
    failed: Array.from(new Set([...(status.failed || []), ...summary.failed])),
    lastReconciledAt: new Date().toISOString()
  };

  if ((candidateStatus.status === 'running' || candidateStatus.status === 'starting') && candidateStatus.processed >= total) {
    candidateStatus.status = candidateStatus.failed.length > 0 ? 'partial' : 'completed';
    candidateStatus.completedAt = candidateStatus.completedAt || new Date().toISOString();
  }

  const latest = await getIndexStatus(env);

  if (!latest.taskId || latest.taskId !== taskId) {
    return latest;
  }

  if (TERMINAL_STATUSES.has(latest.status)) {
    console.log('[index][reconcile] skip stale write because latest status already terminal', {
      taskId,
      latestStatus: latest.status,
      candidateStatus: candidateStatus.status,
      latestProcessed: latest.processed,
      candidateProcessed: candidateStatus.processed
    });
    return latest;
  }

  const mergedTotal = Number.isFinite(Number(latest.total))
    ? Math.max(0, Math.floor(Number(latest.total)))
    : total;
  const mergedSettledProcessed = Math.min(
    mergedTotal,
    new Set([...(summary.settledIds || []), ...(latest.failed || []), ...(candidateStatus.failed || [])]).size
  );

  const mergedStatus = {
    ...latest,
    failed: Array.from(new Set([...(latest.failed || []), ...(candidateStatus.failed || [])])),
    lastReconciledAt: candidateStatus.lastReconciledAt,
    processed: Math.min(mergedTotal, Math.max(
      latest.processed || 0,
      status.processed || 0,
      candidateStatus.processed || 0,
      mergedSettledProcessed
    ))
  };

  if ((mergedStatus.status === 'running' || mergedStatus.status === 'starting') && mergedStatus.processed >= mergedTotal) {
    mergedStatus.status = mergedStatus.failed.length > 0 ? 'partial' : 'completed';
    mergedStatus.completedAt = mergedStatus.completedAt || new Date().toISOString();
  }

  if ((latest.processed || 0) > (candidateStatus.processed || 0)) {
    console.log('[index][reconcile] monotonic merge prevented processed rollback', {
      taskId,
      latestProcessed: latest.processed,
      candidateProcessed: candidateStatus.processed,
      mergedProcessed: mergedStatus.processed
    });
  }

  const transitionedToTerminal =
    (latest.status === 'running' || latest.status === 'starting') &&
    (mergedStatus.status === 'completed' || mergedStatus.status === 'partial');

  await saveIndexStatus(env, mergedStatus);

  if (transitionedToTerminal) {
    try {
      await env.DB.prepare(
        'DELETE FROM index_task_items WHERE task_id = ?'
      ).bind(taskId).run();
    } catch (cleanupError) {
      console.warn('[index][cleanup] failed to cleanup task items', { taskId, error: cleanupError?.message || String(cleanupError) });
    }
  }

  return mergedStatus;
}

export async function listIndexableVNIds(env) {
  await initDB(env.DB);
  const { results } = await env.DB.prepare(
    'SELECT id FROM vn_entries'
  ).all();

  return (results || [])
    .map(row => row.id)
    .filter(id => VNDB_ID_REGEX.test(id))
    .sort((a, b) => {
      const aNumeric = Number.parseInt(a.slice(1), 10);
      const bNumeric = Number.parseInt(b.slice(1), 10);
      if (aNumeric !== bNumeric) return aNumeric - bNumeric;
      return a.localeCompare(b);
    });
}

// ============ Export / Import ============

export async function exportData(env) {
  await initDB(env.DB);

  const { results: entryRows } = await env.DB.prepare(
    'SELECT * FROM vn_entries ORDER BY created_at ASC'
  ).all();

  const entries = (entryRows || []).map(rowToEntry);

  const tierList = await getTierList(env);

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    entries,
    tierList
  };
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function importData(env, data, mode = 'merge') {
  await initDB(env.DB);

  const incomingEntries = Array.isArray(data?.entries) ? data.entries : [];
  const hasIncomingTierList = isTierListObject(data?.tierList);

  if (mode === 'replace') {
    // ⚠️ replace 模式将 DELETE 与 INSERT 混合在分片 batch 中。
    // 每个 batch 是原子事务，但跨 batch 不保证原子性：
    // 若总语句数 > D1_BATCH_CHUNK_SIZE，前几个 batch 成功后后续 batch 失败将导致数据不完整且无法回滚。
    const deleteStatements = [
      env.DB.prepare('DELETE FROM vn_entries'),
      ...buildClearTierListStatements(env.DB)
    ];

    for (const entry of incomingEntries) {
      const { statement } = buildSaveVNEntryStatement(env.DB, entry, { preserveUpdatedAt: true });
      deleteStatements.push(statement);
    }

    if (hasIncomingTierList) {
      const { statements: tierStatements } = buildSaveTierListStatements(env.DB, data.tierList, { includeReset: false });
      deleteStatements.push(...tierStatements);
    }

    for (const chunk of chunkArray(deleteStatements, D1_BATCH_CHUNK_SIZE)) {
      await env.DB.batch(chunk);
    }
    return;
  }

  const entryStatements = incomingEntries.map(
    entry => buildSaveVNEntryStatement(env.DB, entry, { preserveUpdatedAt: true }).statement
  );

  for (const chunk of chunkArray(entryStatements, D1_BATCH_CHUNK_SIZE)) {
    await env.DB.batch(chunk);
  }

  if (hasIncomingTierList) {
    const currentTierList = await getTierList(env);
    const mergedTierList = mergeTierLists(currentTierList, data.tierList);
    await saveTierList(env, mergedTierList);
  }
}

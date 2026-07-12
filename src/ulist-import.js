/**
 * VNDB ulist 用户列表导入管线
 *
 * 执行模型：waitUntil 分页循环 + 分批 D1 写入，单任务串行。
 * - getAuthInfo 取 uid（校验 listread） → 建 type='ulist_import' 任务
 * - 一次性预载已存在 id 集合到内存，避免逐条 getVNEntry 的额外 subrequest
 * - 分页拉取（每页 vn.* 一次拉全）→ 映射 → 过滤 skip/已存在 → saveVNEntry → 每页更新进度
 * - 终态 completed / partial；单次墙钟跑不完置 partial（已存在跳过 = 天然断点续传）
 *
 * 任务状态复用 index_tasks 表（type='ulist_import' 区分）；启动互斥复用
 * INDEX_START_LOCK Durable Object（由 router 层持锁调用，与索引任务互斥）。
 */

import {
  getIndexStatus,
  saveIndexStatus,
  saveVNEntry,
  listIndexableVNIds
} from './repository.js';
import { createVNDBClient, mapUListItemToEntry } from './vndb.js';

const ULIST_PAGE_SIZE = 100;
export const ULIST_IMPORT_TYPE = 'ulist_import';

const ULIST_IMPORT_ACTIVE_STATUSES = new Set(['starting', 'running']);

function nowIso() {
  return new Date().toISOString();
}

function buildImportStatus(overrides = {}) {
  return {
    status: 'starting',
    taskId: null,
    type: ULIST_IMPORT_TYPE,
    total: 0,
    processed: 0,
    skipped: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null,
    lastReconciledAt: null,
    ...overrides
  };
}

// 单条映射防御：单条异常不中断整批，计为 skip
function mapItemSafely(item) {
  try {
    return mapUListItemToEntry(item);
  } catch (error) {
    console.warn('[ulist][import] map item failed', {
      error: error?.message || String(error)
    });
    return { skip: true };
  }
}

/**
 * 启动 ulist 导入任务：同步完成鉴权 + 建任务；实际拉取经 ctx.waitUntil 后台执行。
 * @param {Object} env
 * @param {Object|null} ctx - Worker 执行上下文（需 waitUntil；缺失时同步执行完再返回）
 * @returns {Promise<{ ok: boolean, code?: string, status?: number, message?: string, taskId?: string }>}
 */
export async function startUListImport(env, ctx) {
  const currentStatus = await getIndexStatus(env);
  if (ULIST_IMPORT_ACTIVE_STATUSES.has(currentStatus.status)) {
    return {
      ok: false,
      code: 'already_running',
      status: 409,
      message: currentStatus.type === ULIST_IMPORT_TYPE
        ? '已有导入任务正在运行'
        : '已有索引任务正在运行'
    };
  }

  let client;
  let authInfo;
  try {
    client = await createVNDBClient(env);
    authInfo = await client.getAuthInfo();
  } catch (error) {
    return {
      ok: false,
      code: 'auth_failed',
      status: 400,
      message: error?.message || 'VNDB 鉴权失败'
    };
  }

  const taskId = `ulist_${Date.now()}`;
  const startedAt = nowIso();
  await saveIndexStatus(env, buildImportStatus({
    status: 'running',
    taskId,
    startedAt
  }));

  const runPromise = runUListImport(env, client, authInfo.id, taskId, startedAt)
    .catch(error => {
      console.error('[ulist][import] run failed', {
        taskId,
        error: error?.message || String(error)
      });
    });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(runPromise);
  } else {
    // 无 waitUntil（测试或非请求上下文）：直接等待，保证任务完成
    await runPromise;
  }

  return { ok: true, taskId };
}

/**
 * 后台分页拉取 + 映射 + 写入。skipped = 已存在 + 纯 wishlist；failed 仅写库失败。
 */
export async function runUListImport(env, client, userId, taskId, startedAt = nowIso()) {
  // 预载已存在条目 id 集合，逐条命中判断走内存，避免 N 次 getVNEntry subrequest
  const existingIds = new Set(await listIndexableVNIds(env));

  let imported = 0;
  let skipped = 0;
  const failed = [];
  let page = 1;
  let more = true;
  let total = 0;

  const buildProgress = (extra = {}) => buildImportStatus({
    status: 'running',
    taskId,
    total,
    processed: imported + skipped + failed.length,
    skipped,
    failed,
    startedAt,
    lastReconciledAt: nowIso(),
    ...extra
  });

  try {
    while (more) {
      const pageResult = await client.fetchUList(userId, {
        page,
        results: ULIST_PAGE_SIZE
      });
      more = pageResult.more;
      page += 1;
      total += pageResult.results.length;

      for (const item of pageResult.results) {
        const mapped = mapItemSafely(item);

        // 纯 wishlist / 映射异常 → skip
        if (!mapped || mapped.skip || !mapped.id) {
          skipped += 1;
          continue;
        }

        // 已存在同 ID：跳过，本地数据零改动（计入 skipped）
        if (existingIds.has(mapped.id)) {
          skipped += 1;
          continue;
        }

        try {
          await saveVNEntry(env, { ...mapped, createdAt: nowIso() });
          existingIds.add(mapped.id);
          imported += 1;
        } catch (error) {
          failed.push(mapped.id);
          console.warn('[ulist][import] save entry failed', {
            taskId,
            id: mapped.id,
            error: error?.message || String(error)
          });
        }
      }

      // 每页结束更新进度，前端 5s 轮询即时可见
      await saveIndexStatus(env, buildProgress());
    }

    await saveIndexStatus(env, buildProgress({
      status: failed.length > 0 ? 'partial' : 'completed',
      completedAt: nowIso(),
      error: failed.length > 0 ? `${failed.length} 个条目导入失败` : null
    }));
  } catch (error) {
    // 拉取中断（网络/墙钟）：记录已导入进度并置 partial（重跑时已存在自动跳过 = 断点续传）
    await saveIndexStatus(env, buildProgress({
      status: 'partial',
      completedAt: nowIso(),
      error: error?.message || '导入中断，请重试（已导入条目会自动跳过）'
    }));
  }

  return { total, imported, skipped, failed };
}

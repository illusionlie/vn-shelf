import {
  getIndexStatus,
  saveIndexStatus,
  listIndexableVNIds,
  recordIndexItemResult
} from './kv.js';

export const INDEX_TASK_ACTIVE_STATUSES = new Set(['starting', 'running']);
export const INDEX_TASK_TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'start_failed']);

function createBaseIndexTaskStatus(overrides = {}) {
  return {
    status: 'idle',
    taskId: null,
    total: 0,
    processed: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null,
    lastReconciledAt: null,
    ...overrides
  };
}

export function isIndexTaskActiveStatus(status) {
  return INDEX_TASK_ACTIVE_STATUSES.has(status);
}

export function isIndexTaskTerminalStatus(status) {
  return INDEX_TASK_TERMINAL_STATUSES.has(status);
}

export function mergeIndexTaskFailedIds(...collections) {
  const merged = new Set();

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue;
    }

    for (const rawId of collection) {
      const normalizedId = typeof rawId === 'string' ? rawId.trim() : '';
      if (normalizedId) {
        merged.add(normalizedId);
      }
    }
  }

  return Array.from(merged).sort((a, b) => a.localeCompare(b, 'en'));
}

function buildEnqueueFailureSummary(failureCount) {
  if (failureCount <= 0) {
    return null;
  }

  return `${failureCount} 个条目入队失败`;
}

export async function getIndexTaskStatus(env) {
  return getIndexStatus(env);
}

export async function startIndexTask(env, { batchSize = 25 } = {}) {
  const currentStatus = await getIndexStatus(env);
  if (isIndexTaskActiveStatus(currentStatus.status)) {
    return {
      ok: false,
      code: 'already_running',
      status: 409,
      message: '已有索引任务正在运行'
    };
  }

  const uniqueIds = await listIndexableVNIds(env);
  const total = uniqueIds.length;

  if (total === 0) {
    return {
      ok: false,
      code: 'empty',
      status: 400,
      message: '没有需要索引的条目'
    };
  }

  const taskId = `idx_${Date.now()}`;
  const startingStatus = createBaseIndexTaskStatus({
    status: 'starting',
    taskId,
    total,
    startedAt: new Date().toISOString()
  });

  await saveIndexStatus(env, startingStatus);

  const failedIds = [];
  let enqueuedCount = 0;
  let lastEnqueueError = null;

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const chunk = uniqueIds.slice(i, i + batchSize);
    const chunkResults = await Promise.allSettled(chunk.map(vndbId => env.VN_INDEX_QUEUE.send({
      vndbId,
      taskId,
      retryCount: 0
    })));

    for (let index = 0; index < chunkResults.length; index += 1) {
      const result = chunkResults[index];
      const vndbId = chunk[index];

      if (result.status === 'fulfilled') {
        enqueuedCount += 1;
        continue;
      }

      failedIds.push(vndbId);
      lastEnqueueError = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    }
  }

  if (failedIds.length > 0) {
    await Promise.allSettled(failedIds.map(vndbId => recordIndexItemResult(env, {
      taskId,
      vndbId,
      state: 'failed',
      retryCount: 0,
      error: 'enqueue_failed'
    })));
  }

  if (enqueuedCount === 0) {
    const startFailedStatus = createBaseIndexTaskStatus({
      ...startingStatus,
      status: 'start_failed',
      processed: failedIds.length,
      failed: failedIds,
      completedAt: new Date().toISOString(),
      error: lastEnqueueError || buildEnqueueFailureSummary(failedIds.length) || '索引任务启动失败'
    });

    await saveIndexStatus(env, startFailedStatus);

    return {
      ok: false,
      code: 'enqueue_failed',
      status: 500,
      message: '索引任务启动失败，请稍后重试',
      task: startFailedStatus
    };
  }

  const runningStatus = createBaseIndexTaskStatus({
    ...startingStatus,
    status: 'running',
    processed: failedIds.length,
    failed: failedIds,
    error: buildEnqueueFailureSummary(failedIds.length)
  });

  await saveIndexStatus(env, runningStatus);

  return {
    ok: true,
    task: runningStatus,
    enqueueFailed: failedIds.length,
    enqueued: enqueuedCount,
    total
  };
}

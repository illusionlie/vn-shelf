/**
 * VN Shelf - Cloudflare Worker入口
 */

import {
  getVNEntry,
  saveVNEntry,
  getIndexStatus,
  rebuildVNList,
  recordIndexItemResult,
  reconcileIndexStatusFromItems
} from './kv.js';
import { handleRequest } from './router.js';
import { fetchVNDB } from './vndb.js';

const INDEX_MAX_RETRY = 3;
const INDEX_RETRY_DELAY_SECONDS = 60;
const INDEX_RECONCILE_INTERVAL_MS = 5000;
const INDEX_START_LOCK_STORAGE_KEY = 'index:start-lock';
const INDEX_START_LOCK_DEFAULT_TTL_MS = 30 * 1000;

/**
 * 索引启动分布式锁 Durable Object（全局单例）
 */
export class IndexStartLockDurableObject {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return this.jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
    }

    const url = new URL(request.url);

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (url.pathname === '/acquire') {
      return this.handleAcquire(body);
    }

    if (url.pathname === '/release') {
      return this.handleRelease(body);
    }

    if (url.pathname === '/status') {
      return this.handleStatus();
    }

    return this.jsonResponse({ success: false, error: 'Not Found' }, 404);
  }

  async handleAcquire(body) {
    const holder = typeof body?.holder === 'string' ? body.holder.trim() : '';
    const requestedTtlMs = Number(body?.ttlMs);
    const ttlMs = Number.isFinite(requestedTtlMs) && requestedTtlMs > 0
      ? Math.floor(requestedTtlMs)
      : INDEX_START_LOCK_DEFAULT_TTL_MS;

    if (!holder) {
      return this.jsonResponse({ acquired: false, error: 'holder required' }, 400);
    }

    const now = Date.now();
    const existing = await this.state.storage.get(INDEX_START_LOCK_STORAGE_KEY);

    if (existing?.expiresAt && Number(existing.expiresAt) > now && existing.holder !== holder) {
      return this.jsonResponse({
        acquired: false,
        holder: existing.holder,
        expiresAt: existing.expiresAt
      });
    }

    const nextLock = {
      holder,
      acquiredAt: existing?.holder === holder && existing?.acquiredAt
        ? existing.acquiredAt
        : new Date(now).toISOString(),
      expiresAt: now + ttlMs
    };

    await this.state.storage.put(INDEX_START_LOCK_STORAGE_KEY, nextLock);

    return this.jsonResponse({
      acquired: true,
      holder,
      expiresAt: nextLock.expiresAt
    });
  }

  async handleRelease(body) {
    const holder = typeof body?.holder === 'string' ? body.holder.trim() : '';

    if (!holder) {
      return this.jsonResponse({ released: false, error: 'holder required' }, 400);
    }

    const existing = await this.state.storage.get(INDEX_START_LOCK_STORAGE_KEY);

    if (existing?.holder === holder) {
      await this.state.storage.delete(INDEX_START_LOCK_STORAGE_KEY);
      return this.jsonResponse({ released: true });
    }

    return this.jsonResponse({ released: false });
  }

  async handleStatus() {
    const existing = await this.state.storage.get(INDEX_START_LOCK_STORAGE_KEY);
    return this.jsonResponse({
      lock: existing || null
    });
  }

  jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

export default {
  /**
   * HTTP请求处理
   */
  async fetch(request, env, ctx) {
    try {
      // 先尝试从 Assets 获取静态资源
      const url = new URL(request.url);

      // 对于页面路由，尝试从 Assets 获取
      if (!url.pathname.startsWith('/api/')) {
        try {
          // 尝试从 Assets 获取
          const assetResponse = await env.ASSETS.fetch(request);
          if (assetResponse.status === 200) {
            return assetResponse;
          }
        } catch (error) {
          // 记录静态资源异常，继续尝试 API 路由
          console.warn('[worker][assets] fetch failed, fallback to router', {
            path: url.pathname,
            error: error?.message || String(error)
          });
        }
      }

      // 处理 API 路由
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: 'Internal Server Error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  /**
   * Queue消息处理（批量索引）
   */
  async queue(batch, env, ctx) {
    const touchedTasks = new Map();

    for (const message of batch.messages) {
      const { vndbId, taskId, retryCount = 0 } = message.body || {};

      if (!vndbId || !taskId) {
        console.warn('[index][queue-item] skip invalid message body', { body: message.body });
        message.ack();
        continue;
      }

      const taskMeta = touchedTasks.get(taskId) || { settledCount: 0 };
      touchedTasks.set(taskId, taskMeta);

      try {
        // 1. 从VNDB获取数据
        const vndbData = await fetchVNDB(vndbId, env);

        // 2. 获取现有条目
        const entry = await getVNEntry(env, vndbId);

        if (entry) {
          // 更新VNDB数据
          entry.vndb = vndbData;
          await saveVNEntry(env, entry);
        }

        // 3. 幂等写入单条结果（按 taskId + vndbId 唯一）
        await recordIndexItemResult(env, {
          taskId,
          vndbId,
          state: 'success',
          retryCount
        });

        taskMeta.settledCount += 1;
        console.log('[index][queue-item] success recorded', { taskId, vndbId, retryCount });
        message.ack();
      } catch (error) {
        console.error(`Index error for ${vndbId}:`, error);

        if (retryCount < INDEX_MAX_RETRY) {
          try {
            // 重试：重新发送消息，延迟 60 秒
            await env.VN_INDEX_QUEUE.send({
              ...message.body,
              retryCount: retryCount + 1
            }, { delaySeconds: INDEX_RETRY_DELAY_SECONDS });

            // 已成功补发重试消息，确认当前消息避免重复结算
            message.ack();
            console.warn('[index][queue-item] scheduled retry and acked original message', {
              taskId,
              vndbId,
              retryCount: retryCount + 1
            });
          } catch (retryError) {
            // 补发失败时触发当前消息重试，避免消息丢失
            console.error('[index][queue-item] retry schedule failed, trigger original message retry', {
              taskId,
              vndbId,
              retryCount: retryCount + 1,
              error: retryError?.message || String(retryError)
            });
            message.retry();
          }
        } else {
          try {
            // 达到重试上限后写入失败结果
            await recordIndexItemResult(env, {
              taskId,
              vndbId,
              state: 'failed',
              retryCount,
              error: error?.message || String(error)
            });
            taskMeta.settledCount += 1;
            console.warn('[index][queue-item] failed recorded', { taskId, vndbId, retryCount });
            message.ack();
          } catch (recordError) {
            console.error('[index][queue-item] failed result record failed, trigger original message retry', {
              taskId,
              vndbId,
              retryCount,
              error: recordError?.message || String(recordError)
            });
            message.retry();
          }
        }
      }
    }

    // 基于条目结果汇总任务状态，增加节流避免每个批次都触发全量扫描
    for (const [taskId, taskMeta] of touchedTasks.entries()) {
      const before = await getIndexStatus(env);
      if (before.taskId !== taskId || before.status !== 'running') {
        continue;
      }

      const nowMs = Date.now();
      const lastReconciledAtMs = before.lastReconciledAt ? Date.parse(before.lastReconciledAt) : Number.NaN;
      const shouldReconcileByInterval =
        !Number.isFinite(lastReconciledAtMs) || (nowMs - lastReconciledAtMs) >= INDEX_RECONCILE_INTERVAL_MS;

      const remaining = Math.max(0, (before.total || 0) - (before.processed || 0));
      const shouldReconcileNearCompletion = taskMeta.settledCount > 0 && remaining <= taskMeta.settledCount;

      if (!shouldReconcileByInterval && !shouldReconcileNearCompletion) {
        // 若本批次被节流，注册一次延迟汇总，保证任务可收敛到终态
        if (ctx && typeof ctx.waitUntil === 'function' && Number.isFinite(lastReconciledAtMs)) {
          const delayMs = Math.max(0, INDEX_RECONCILE_INTERVAL_MS - (nowMs - lastReconciledAtMs));

          ctx.waitUntil((async () => {
            await new Promise(resolve => setTimeout(resolve, delayMs));

            const delayedBefore = await getIndexStatus(env);
            if (delayedBefore.taskId !== taskId || delayedBefore.status !== 'running') {
              return;
            }

            const delayedNext = await reconcileIndexStatusFromItems(env, taskId);

            if (
              delayedBefore.status === 'running' &&
              (delayedNext.status === 'completed' || delayedNext.status === 'partial')
            ) {
              await rebuildVNList(env);
            }
          })());
        }

        continue;
      }

      const next = await reconcileIndexStatusFromItems(env, taskId);

      console.log('[index][queue-reconcile]', {
        taskId,
        status: next.status,
        processed: next.processed,
        total: next.total,
        failedCount: next.failed?.length || 0,
        settledInBatch: taskMeta.settledCount
      });

      // 仅在 running -> completed/partial 的转移时触发聚合重建
      if (
        before.taskId === taskId &&
        before.status === 'running' &&
        (next.status === 'completed' || next.status === 'partial')
      ) {
        await rebuildVNList(env);
      }
    }
  }
};

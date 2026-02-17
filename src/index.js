/**
 * VN Shelf - Cloudflare Worker入口
 */

import { handleRequest } from './router.js';
import { getVNEntry, saveVNEntry, getIndexStatus, saveIndexStatus, rebuildVNList } from './kv.js';
import { fetchVNDB } from './vndb.js';

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
        } catch (e) {
          // Assets 未找到，继续处理 API 路由
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
    for (const message of batch.messages) {
      const { vndbId, taskId, retryCount = 0 } = message.body;
      
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
        
        // 3. 更新进度
        const status = await getIndexStatus(env);
        status.processed++;
        await saveIndexStatus(env, status);
        
        // 4. 确认消息
        message.ack();
        
      } catch (error) {
        console.error(`Index error for ${vndbId}:`, error);
        
        if (retryCount < 3) {
          // 重试：重新发送消息，延迟60秒
          await env.VN_INDEX_QUEUE.send({
            ...message.body,
            retryCount: retryCount + 1
          }, { delaySeconds: 60 });
        } else {
          // 标记失败
          const status = await getIndexStatus(env);
          status.failed.push(vndbId);
          status.processed++;
          await saveIndexStatus(env, status);
        }
        
        message.ack();
      }
    }
    
    // 检查是否全部完成
    const status = await getIndexStatus(env);
    if (status.processed >= status.total && status.status === 'running') {
      status.status = status.failed.length > 0 ? 'completed' : 'completed';
      status.completedAt = new Date().toISOString();
      await saveIndexStatus(env, status);
      
      // 重建聚合列表
      await rebuildVNList(env);
    }
  }
};

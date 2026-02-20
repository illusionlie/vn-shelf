/**
 * KV操作封装模块
 */

import { safeJSONParse } from './utils.js';

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
 * 重建VN列表聚合数据
 * @param {Object} env - 环境变量
 */
export async function rebuildVNList(env) {
  const oldList = await getVNList(env);
  const ids = oldList.items.map(item => item.id);
  
  // 批量获取所有条目
  const entries = [];
  for (const id of ids) {
    const entry = await getVNEntry(env, id);
    if (entry) {
      entries.push(entry);
    }
  }
  
  // 计算统计数据
  const totalPlayTimeMinutes = entries.reduce((sum, e) => sum + (e.user?.playTimeMinutes || 0), 0);
  const ratingsSum = entries.reduce((sum, e) => sum + (e.vndb?.rating || 0), 0);
  const personalRatings = entries.filter(e => e.user?.personalRating > 0);
  const personalRatingsSum = personalRatings.reduce((sum, e) => sum + e.user.personalRating, 0);
  
  // 构建新列表
  const newList = {
    items: entries.map(e => ({
      id: e.id,
      title: e.vndb?.title || '', // 英文标题
      titleJa: e.vndb?.titleJa || e.vndb?.title || '', // 日文标题，没有则使用英文
      titleCn: e.user?.titleCn || e.vndb?.titleCn || '', // 中文标题，优先用户设置
      image: e.vndb?.image || '',
      rating: e.vndb?.rating || 0,
      personalRating: e.user?.personalRating || 0,
      developers: e.vndb?.developers || [],
      allAge: e.vndb?.allAge || false, // 全年龄标记
      createdAt: e.createdAt
    })),
    stats: {
      total: entries.length,
      totalPlayTimeMinutes,
      avgRating: entries.length > 0 ? ratingsSum / entries.length : 0,
      avgPersonalRating: personalRatings.length > 0 ? personalRatingsSum / personalRatings.length : 0
    },
    updatedAt: new Date().toISOString()
  };
  
  await saveVNList(env, newList);
  return newList;
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
  if (existingIndex >= 0) {
    // 更新现有条目
    list.items[existingIndex] = {
      id: entry.id,
      title: entry.vndb?.title || '',
      titleJa: entry.vndb?.titleJa || entry.vndb?.title || '',
      titleCn: entry.user?.titleCn || entry.vndb?.titleCn || '',
      image: entry.vndb?.image || '',
      rating: entry.vndb?.rating || 0,
      personalRating: entry.user?.personalRating || 0,
      developers: entry.vndb?.developers || [],
      allAge: entry.vndb?.allAge || false, // 全年龄标记
      createdAt: entry.createdAt
    };
  } else {
    // 添加新条目
    list.items.push({
      id: entry.id,
      title: entry.vndb?.title || '',
      titleJa: entry.vndb?.titleJa || entry.vndb?.title || '',
      titleCn: entry.user?.titleCn || entry.vndb?.titleCn || '',
      image: entry.vndb?.image || '',
      rating: entry.vndb?.rating || 0,
      personalRating: entry.user?.personalRating || 0,
      developers: entry.vndb?.developers || [],
      allAge: entry.vndb?.allAge || false, // 全年龄标记
      createdAt: entry.createdAt
    });
  }
  
  // 更新统计
  await updateListStats(env, list);
}

/**
 * 从列表中移除条目
 * @param {Object} env - 环境变量
 * @param {string} id - VNDB ID
 */
export async function removeEntryFromList(env, id) {
  const list = await getVNList(env);
  list.items = list.items.filter(item => item.id !== id);
  await updateListStats(env, list);
}

/**
 * 更新列表统计
 * @param {Object} env - 环境变量
 * @param {Object} list - 列表对象
 */
async function updateListStats(env, list) {
  // 重新获取所有条目计算统计
  const entries = [];
  for (const item of list.items) {
    const entry = await getVNEntry(env, item.id);
    if (entry) {
      entries.push(entry);
    }
  }
  
  const totalPlayTimeMinutes = entries.reduce((sum, e) => sum + (e.user?.playTimeMinutes || 0), 0);
  const ratingsSum = entries.reduce((sum, e) => sum + (e.vndb?.rating || 0), 0);
  const personalRatings = entries.filter(e => e.user?.personalRating > 0);
  const personalRatingsSum = personalRatings.reduce((sum, e) => sum + e.user.personalRating, 0);
  
  list.stats = {
    total: entries.length,
    totalPlayTimeMinutes,
    avgRating: entries.length > 0 ? ratingsSum / entries.length : 0,
    avgPersonalRating: personalRatings.length > 0 ? personalRatingsSum / personalRatings.length : 0
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
    total: 0,
    processed: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null
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

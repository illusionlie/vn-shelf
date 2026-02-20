/**
 * VNDB API封装模块
 * 文档参考: https://api.vndb.org/kana
 */

import { getSettings } from './kv.js';

const VNDB_API_URL = 'https://api.vndb.org/kana';

/**
 * VNDB API客户端
 */
export class VNDBClient {
  constructor(token) {
    this.token = token;
  }

  /**
   * 发送API请求
   * @param {string} endpoint - 端点
   * @param {Object} body - 请求体
   * @returns {Promise<Object>}
   */
  async request(endpoint, body) {
    const response = await fetch(`${VNDB_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${this.token}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VNDB API错误: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * 获取视觉小说信息
   * @param {string} id - VNDB ID (如 v17)
   * @returns {Promise<Object>}
   */
  async getVN(id) {
    // 移除v前缀获取数字ID
    const numericId = id.replace(/^v/, '');
    
    const result = await this.request('/vn', {
      filters: ['id', '=', 'v' + numericId],
      fields: 'title, titles.lang, titles.title, titles.main, titles.official, image.url, image.sexual, image.violence, rating, length_minutes, developers.name, tags.id, tags.name, tags.rating, tags.category, tags.spoiler',
      results: 1
    });

    if (!result.results || result.results.length === 0) {
      throw new Error(`未找到视觉小说: ${id}`);
    }
    const vn = result.results[0];
    
    // 提取各种语言的标题
    const titles = this.extractTitles(vn.titles || []);
    
    // 检查是否有 "No Sexual Content" 标签 (g235)
    const hasAllAgeTag = (vn.tags || []).some(t => t.id === 'g235');
    
    // 转换为我们的数据格式
    return {
      title: vn.title || '', // 英文标题（VNDB主标题）
      titleJa: titles.japanese || vn.title || '', // 日文标题，没有则使用英文
      titleCn: titles.chinese.official || titles.chinese.fan || '', // 中文标题
      image: vn.image?.url || '',
      imageNsfw: (vn.image?.sexual > 1 || vn.image?.violence > 1),
      rating: (vn.rating || 0) / 10, // VNDB API 返回 0-100 范围，转换为 0-10
      length: formatLengthFromMinutes(vn.length_minutes),
      lengthMinutes: vn.length_minutes || 0,
      developers: (vn.developers || []).map(d => d.name),
      tags: (vn.tags || [])
        .filter(t => t.rating > 1 && t.category === 'cont' && (!t.spoiler || t.spoiler === 0)) // 只保留评分大于1、内容标签、无剧透的标签
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 10) // 只保留前10个标签
        .map(t => t.name),
      allAge: hasAllAgeTag // 标记为全年龄作品
    };
  }
 
  /**
   * 从标题列表中提取各种语言的标题
   * @param {Array} titles - 标题数组
   * @returns {Object} { chinese: { official, fan }, japanese: 日文标题 }
   */
  extractTitles(titles) {
    const result = {
      chinese: { official: null, fan: null },
      japanese: null
    };
    
    // 优先简体中文，其次繁体中文
    const chineseLangs = ['zh-Hans', 'zh-Hant', 'zh'];
    
    for (const lang of chineseLangs) {
      // 查找官方中文标题
      const officialTitle = titles.find(t => t.lang === lang && t.official);
      if (officialTitle && !result.chinese.official) {
        result.chinese.official = officialTitle.title;
      }
      
      // 查找非官方中文标题（汉化组）
      const fanTitle = titles.find(t => t.lang === lang && !t.official);
      if (fanTitle && !result.chinese.fan) {
        result.chinese.fan = fanTitle.title;
      }
    }
    
    // 提取日文标题
    const japaneseTitle = titles.find(t => t.lang === 'ja');
    if (japaneseTitle) {
      result.japanese = japaneseTitle.title;
    }
    
    return result;
  }

  /**
   * 批量获取视觉小说信息
   * @param {string[]} ids - VNDB ID数组
   * @returns {Promise<Object[]>}
   */
  async getVNBatch(ids) {
    const results = [];
    
    for (const id of ids) {
      try {
        const vn = await this.getVN(id);
        results.push({ id, success: true, data: vn });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * 搜索视觉小说
   * @param {string} query - 搜索关键词
   * @param {number} limit - 结果数量限制
   * @returns {Promise<Object[]>}
   */
  async searchVN(query, limit = 10) {
    const result = await this.request('/vn', {
      filters: ['search', '=', query],
      fields: 'id, title, alttitle, image.url, rating, developers.name',
      results: limit
    });

    return (result.results || []).map(vn => ({
      id: vn.id,
      title: vn.title,
      original: vn.alttitle || '',
      image: vn.image?.url || '',
      rating: (vn.rating || 0) / 10, // VNDB API 返回 0-100 范围，转换为 0-10
      developers: (vn.developers || []).map(d => d.name)
    }));
  }
}

/**
 * 从分钟数格式化游戏时长
 * @param {number} minutes - 游戏时长（分钟）
 * @returns {string}
 */
function formatLengthFromMinutes(minutes) {
  if (!minutes || minutes <= 0) {
    return '未知';
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours === 0) {
    return `${mins}分钟`;
  } else if (mins === 0) {
    return `${hours}小时`;
  } else {
    return `${hours}小时${mins}分钟`;
  }
}

/**
 * 创建VNDB客户端
 * @param {Object} env - 环境变量
 * @returns {VNDBClient}
 */
export async function createVNDBClient(env) {
  const settings = await getSettings(env);
  
  if (!settings.vndbApiToken) {
    throw new Error('VNDB API Token未配置');
  }
  
  return new VNDBClient(settings.vndbApiToken);
}

/**
 * 获取单个VN信息（带重试）
 * @param {string} id - VNDB ID
 * @param {Object} env - 环境变量
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<Object>}
 */
export async function fetchVNDB(id, env, maxRetries = 3) {
  const client = await createVNDBClient(env);
  
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.getVN(id);
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        // 指数退避
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError;
}

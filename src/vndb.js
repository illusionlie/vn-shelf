/**
 * VNDB API封装模块
 * 文档参考: https://api.vndb.org/kana
 */

import { getSettings } from './repository.js';

const VNDB_API_URL = 'https://api.vndb.org/kana';
const UserAgent = 'vn-shelf/2.0.0 (+https://github.com/illusionlie/vn-shelf)';

// VN 元数据字段选择：getVN 与 ulist 的 vn.* 嵌套共用，保证两条路径拉取字段一致
const VN_FIELDS = 'title, titles.lang, titles.title, titles.main, titles.official, image.url, image.sexual, image.violence, rating, length_minutes, developers.name, tags.id, tags.name, tags.rating, tags.category, tags.spoiler';

// ulist label id → 本地状态枚举映射（07-11 固化，见 backend/conventions.md「条目游玩状态枚举」）
const ULIST_LABEL_TO_STATUS = { 1: 'playing', 2: 'finished', 3: 'stalled', 4: 'dropped', 5: 'wishlist' };
// 多 label 单值化：终态优先 2(finished) > 4(dropped) > 3(stalled) > 1(playing)
const STATUS_PRIORITY = ['finished', 'dropped', 'stalled', 'playing'];

/**
 * 从标题列表中提取各种语言的标题
 * @param {Array} titles - 标题数组
 * @returns {Object} { chinese: { official, fan }, japanese: 日文标题 }
 */
export function extractTitles(titles) {
  const result = {
    chinese: { official: null, fan: null },
    japanese: null
  };

  // 优先简体中文，其次繁体中文
  const chineseLangs = ['zh-Hans', 'zh-Hant', 'zh'];

  for (const lang of chineseLangs) {
    // 查找官方中文标题
    const officialTitle = (titles || []).find(t => t.lang === lang && t.official);
    if (officialTitle && !result.chinese.official) {
      result.chinese.official = officialTitle.title;
    }

    // 查找非官方中文标题（汉化组）
    const fanTitle = (titles || []).find(t => t.lang === lang && !t.official);
    if (fanTitle && !result.chinese.fan) {
      result.chinese.fan = fanTitle.title;
    }
  }

  // 提取日文标题
  const japaneseTitle = (titles || []).find(t => t.lang === 'ja');
  if (japaneseTitle) {
    result.japanese = japaneseTitle.title;
  }

  return result;
}

/**
 * 将 VNDB vn 对象转换为本地 vndb 数据格式（getVN 与 ulist 映射共用）
 * @param {Object} vn - VNDB /vn 或 ulist 内嵌 vn 对象
 * @returns {Object} 本地 vndb 数据
 */
export function mapVnObjectToVndbData(vn) {
  const source = vn || {};

  // 提取各种语言的标题
  const titles = extractTitles(source.titles || []);

  // 检查是否有 "No Sexual Content" 标签 (g235)
  const hasAllAgeTag = (source.tags || []).some(t => t.id === 'g235');

  return {
    title: source.title || '', // 英文标题（VNDB主标题）
    titleJa: titles.japanese || source.title || '', // 日文标题，没有则使用英文
    titleCn: titles.chinese.official || titles.chinese.fan || '', // 中文标题
    image: source.image?.url || '',
    imageNsfw: (source.image?.sexual > 1 || source.image?.violence > 1),
    rating: (source.rating || 0) / 10, // VNDB API 返回 0-100 范围，转换为 0-10
    length: formatLengthFromMinutes(source.length_minutes),
    lengthMinutes: source.length_minutes || 0,
    developers: (source.developers || []).map(d => d.name),
    tags: (source.tags || [])
      .filter(t => t.rating > 1 && t.category === 'cont' && (!t.spoiler || t.spoiler === 0)) // 只保留评分大于1、内容标签、无剧透的标签
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10) // 只保留前10个标签
      .map(t => t.name),
    allAge: hasAllAgeTag // 标记为全年龄作品
  };
}

/**
 * 将单条 ulist 项映射为本地 entry；纯 wishlist（仅 label5、无 1-4）返回 { skip: true }
 * @param {Object} item - VNDB ulist 项（含 id、vote、started、finished、labels[]、vn）
 * @returns {{ skip: true } | Object} 跳过标记或完整 entry
 */
export function mapUListItemToEntry(item) {
  const source = item || {};
  const labelIds = (source.labels || [])
    .map(label => Number(label?.id))
    .filter(id => Number.isInteger(id));

  // 单值化：在出现的 1-4 label 中按终态优先取一个；无 1-4 → null（未设置）
  let status = null;
  for (const candidate of STATUS_PRIORITY) {
    if (labelIds.some(id => ULIST_LABEL_TO_STATUS[id] === candidate)) {
      status = candidate;
      break;
    }
  }

  // 纯 wishlist：仅有 label 5、且无任何 1-4 → 跳过不导入
  if (status === null && labelIds.includes(5)) {
    return { skip: true };
  }

  // vote (10-100) → personalRating (0-10)，空 → 0；与现有精度一致（四舍五入到一位小数）
  const rawVote = Number(source.vote);
  const personalRating = Number.isFinite(rawVote) && rawVote > 0
    ? Math.round((rawVote / 10) * 10) / 10
    : 0;

  return {
    id: source.id,
    vndb: mapVnObjectToVndbData(source.vn),
    user: {
      titleCn: '',
      personalRating,
      playTime: '',
      playTimeHours: 0,
      playTimePartMinutes: 0,
      playTimeMinutes: 0,
      review: '',
      startDate: source.started || null,
      finishDate: source.finished || null,
      status,
      tags: [],
      tierId: null
    }
  };
}

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
   * @param {Object|null} body - 请求体（GET 时忽略）
   * @param {string} method - HTTP 方法，默认 POST（/vn、/ulist）；/authinfo 用 GET
   * @returns {Promise<Object>}
   */
  async request(endpoint, body, method = 'POST') {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${this.token}`,
        'User-Agent': UserAgent
      }
    };

    if (method !== 'GET' && body !== undefined && body !== null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${VNDB_API_URL}${endpoint}`, options);

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
      fields: VN_FIELDS,
      results: 1
    });

    if (!result.results || result.results.length === 0) {
      throw new Error(`未找到视觉小说: ${id}`);
    }

    // 转换为我们的数据格式（与 ulist 映射共用）
    return mapVnObjectToVndbData(result.results[0]);
  }

  /**
   * 获取当前 token 对应的用户信息
   * @returns {Promise<{id: string, username: string, permissions: string[]}>}
   */
  async getAuthInfo() {
    const result = await this.request('/authinfo', null, 'GET');

    if (!result || !result.id) {
      throw new Error('无法获取 VNDB 用户信息，请检查 API Token 是否有效');
    }

    const permissions = Array.isArray(result.permissions) ? result.permissions : [];
    if (!permissions.includes('listread')) {
      throw new Error('VNDB API Token 缺少 listread 权限，无法读取用户列表');
    }

    return {
      id: result.id,
      username: result.username || '',
      permissions
    };
  }

  /**
   * 拉取用户 ulist 分页
   * @param {string} userId - VNDB 用户 ID（如 u1）
   * @param {{page?: number, results?: number}} options
   * @returns {Promise<{results: Object[], more: boolean}>}
   */
  async fetchUList(userId, { page = 1, results = 100 } = {}) {
    const result = await this.request('/ulist', {
      user: userId,
      fields: `id, vote, notes, started, finished, labels.id, labels.label, ${VN_FIELDS.split(', ').map(f => `vn.${f}`).join(', ')}`,
      sort: 'id',
      page,
      results
    });

    return {
      results: Array.isArray(result.results) ? result.results : [],
      more: Boolean(result.more)
    };
  }

  /**
   * 搜索视觉小说（GET /api/vndb/search 数据源，添加条目弹窗模糊搜索）
   * @param {string} query - 搜索关键词（search filter 跨标题/别名/发行版名匹配）
   * @param {number} limit - 结果数量限制
   * @returns {Promise<Object[]>}
   */
  async searchVN(query, limit = 10) {
    const result = await this.request('/vn', {
      filters: ['search', '=', query],
      sort: 'searchrank', // 按相关度排序（缺省为按 id 排序）
      fields: 'id, title, alttitle, released, image.url, image.sexual, image.violence, rating, developers.name',
      results: limit
    });

    return (result.results || []).map(vn => ({
      id: vn.id,
      title: vn.title,
      original: vn.alttitle || '',
      released: vn.released || '',
      image: vn.image?.url || '',
      // 与 mapVnObjectToVndbData 同口径：sexual/violence 任一 >1 视为 NSFW
      imageNsfw: (vn.image?.sexual > 1 || vn.image?.violence > 1),
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

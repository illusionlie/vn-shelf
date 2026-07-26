/**
 * API封装模块
 */

import { t } from './i18n.js';

const API_BASE = '/api';

/**
 * 构建标准化 API 错误
 * @param {number} status
 * @param {Object} payload
 * @returns {Error & {status: number, code: string|null, payload: Object}}
 */
function createApiError(status, payload = {}) {
  const error = new Error(payload.error || `HTTP ${status}`);
  error.status = status;
  error.code = payload.code || null;
  error.payload = payload;
  return error;
}

/**
 * 后端错误 code → 用户友好文案词典 key 映射表（文案经 t() 取自 locales）。
 * 与 createApiError 同源：后端返回的 {code} 经 createApiError 劝入 error.code，
 * 前端约定 code 字段优先于 message。
 *
 * i18n 边界（AC5）：本映射表只覆盖前端自产的通用文案。后端 errorResponse 的
 * 4xx 中文友好 message（无 code 字段）在下方第 4 支原样透传，不做翻译。
 */
const FRIENDLY_CODE_MAP = {
  UNAUTHORIZED: 'error.unauthorized',
  FORBIDDEN: 'error.forbidden',
  NOT_FOUND: 'error.notFound',
  VALIDATION: 'error.validation',
  CONFLICT: 'error.conflict',
  RATE_LIMIT: 'error.rateLimit',
  SERVER_ERROR: 'error.serverError',
  NETWORK: 'error.network'
};

/**
 * createApiError 的 `HTTP <status>` 兑底 message 识别。后端 errorResponse 返回的
 * 中文友好文案不会匹配此模式，可安全区分“技术兑底串”与“服务端友好串”。
 */
const HTTP_FALLBACK_RE = /^HTTP \d{3}$/i;

/**
 * 将 API 错误转换为用户面友好 toast 文案。
 *
 * 设计原则（与后端实际行为对齐）：
 * - 后端 `errorResponse(message, status)` 返回 `{success:false, error: message}`，
 *   **不含 code 字段**，且 message 均为中文友好文案（如 `密码错误`/`未授权`/`VN 不存在`/`密码长度至少6位`）。
 * - 因此“技术文本透传”的真实风险面是：5xx 未处理异常的裸 message、网络层 `Failed to fetch`、
 *   以及 createApiError 的 `HTTP <status>` 兑底串——本函数仅对这些情形生成通用友好文案，
 *   不暴露原始文本。
 * - 对 4xx（含本地校验 throw）的友好 message，直接沿用比泛化映射更精准（`密码错误` 优于 `请先登录`）。
 *
 * 解析顺序：
 *   1. `error.code` 命中映射表 → 用映射文案
 *   2. 网络错误（status===0 且无可用友好 message）→ NETWORK 文案
 *   3. 5xx → SERVER_ERROR 文案（隐藏可能的后端异常文本）
 *   4. 存在非 `HTTP xxx` 兑底的 message（4xx 服务端友好文案或本地校验友好串）→ 沿用
 *   5. 按 status 映射兑底，最后退回 `<prefix>`
 *
 * 注意：本地 throw new Error('友好文案') 的校验错误也会走第 4 支（status=0、message 为友好串），
 * 会被保留；但 JSON.parse 等技术异常的 message（如 'Unexpected token...'）同样是 status=0 +
 * 非 HTTP 兑底串，会被误保留——因此调用方对“本地解析/校验”应单独捕获并产出友好文案，
 * 不要依赖本函数过滤技术文本（见 settingsPage.importData 的分层 catch）。
 *
 * @param {{code?:string|null,status?:number,message?:string}|Error} error
 * @param {string} [prefix='操作失败'] - 业务前缀（如“保存失败”、“加载失败”）
 * @returns {string} 友好 toast 文案
 */
export function friendlyErrorMessage(error, prefix = t('prefix.operationFailed')) {
  const code = error?.code || null;
  const status = Number(error?.status) || 0;
  const message = error?.message || '';
  const hasFriendlyMessage = Boolean(message) && !HTTP_FALLBACK_RE.test(message);

  console.warn('[friendlyErrorMessage]', { prefix, code, status, error: message || String(error) });

  // 1. code 优先（NETWORK 经 apiRequest 网络层封装填入）
  if (code && FRIENDLY_CODE_MAP[code]) {
    return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP[code])}`;
  }

  // 2. 网络层失败（status=0 且无服务端友好 message）
  if (status === 0 && !hasFriendlyMessage) {
    return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.NETWORK)}`;
  }

  // 3. 5xx：后端可能透传未处理异常的裸 message，统一友好文案不暴露
  if (status >= 500) {
    return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.SERVER_ERROR)}`;
  }

  // 4. 4xx 服务端友好文案 / 本地校验友好串：沿用。
  //    i18n 边界（AC5）：后端 4xx 中文 message 原样透传，不经词典翻译；
  //    仅前端自产的前缀与分隔符（common.colon）随 locale，message 本体不动。
  if (hasFriendlyMessage) {
    return `${prefix}${t('common.colon')}${message}`;
  }

  // 5. 按 status 映射兑底
  if (status === 401) return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.UNAUTHORIZED)}`;
  if (status === 403) return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.FORBIDDEN)}`;
  if (status === 404) return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.NOT_FOUND)}`;
  if (status === 409) return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.CONFLICT)}`;
  if (status === 429) return `${prefix}${t('common.colon')}${t(FRIENDLY_CODE_MAP.RATE_LIMIT)}`;

  // 无任何可用信息：只返回前缀，绝不拼接裸技术文本
  return prefix;
}

/**
 * 发送API请求
 * @param {string} endpoint - 端点
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>}
 */
async function apiRequest(endpoint, options = {}) {
  const url = API_BASE + endpoint;
  const config = { ...options };
  config.headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    // 网络层失败（离线/DNS/断网）：统一封装为 NETWORK 错误，避免裸 'Failed to fetch'
    // 技术文本透传到 friendlyErrorMessage。
    console.warn('[api] network request failed', {
      endpoint,
      error: networkError?.message || String(networkError)
    });
    throw createApiError(0, { error: t('error.networkRequestFailed'), code: 'NETWORK' });
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    // 非 JSON 响应统一降级为空对象
  }

  if (!response.ok) {
    throw createApiError(response.status, data);
  }

  return data;
}

// ============ 认证API ============

export const authAPI = {
  /**
   * 初始化系统
   * @param {string} password - 管理员密码
   * @param {string} vndbApiToken - VNDB API Token
   */
  async init(password, vndbApiToken = '') {
    return apiRequest('/auth/init', {
      method: 'POST',
      body: { password, vndbApiToken }
    });
  },

  /**
   * 登录
   * @param {string} password - 密码
   */
  async login(password) {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: { password }
    });
  },

  /**
   * 退出登录
   */
  async logout() {
    return apiRequest('/auth/logout', {
      method: 'POST'
    });
  },

  /**
   * 验证Token
   */
  async verify() {
    return apiRequest('/auth/verify');
  },

  /**
   * 获取认证状态
   */
  async status() {
    return apiRequest('/auth/status');
  }
};

// ============ VN API ============

export const vnAPI = {
  /**
   * 获取VN列表
   * @param {Object} params - 查询参数
   */
  async getList(params = {}) {
    const query = new URLSearchParams();
    if (params.sort) query.set('sort', params.sort);
    if (params.search) query.set('search', params.search);
    if (params.untiered) query.set('untiered', 'true');

    const queryString = query.toString();
    return apiRequest(`/vn${queryString ? '?' + queryString : ''}`);
  },

  /**
   * 获取单个VN详情
   * @param {string} id - VNDB ID
   */
  async get(id) {
    return apiRequest(`/vn/${id}`);
  },

  /**
   * 创建VN条目
   * @param {Object} data - 条目数据
   */
  async create(data) {
    return apiRequest('/vn', {
      method: 'POST',
      body: data
    });
  },

  /**
   * 更新VN条目
   * @param {string} id - VNDB ID
   * @param {Object} data - 更新数据
   */
  async update(id, data) {
    return apiRequest(`/vn/${id}`, {
      method: 'PUT',
      body: data
    });
  },

  /**
   * 删除VN条目
   * @param {string} id - VNDB ID
   */
  async delete(id) {
    return apiRequest(`/vn/${id}`, {
      method: 'DELETE'
    });
  },

  /**
   * 更新 VN 的 Tier 归属
   * @param {string} id - VNDB ID
   * @param {string|null} tierId - Tier ID，null 表示移除分类
   * @param {number|undefined} tierSort - Tier 内排序值（从 0 开始）
   */
  async updateTier(id, tierId, tierSort = undefined) {
    const body = { tierId };
    if (tierSort !== undefined) {
      body.tierSort = tierSort;
    }

    return apiRequest(`/vn/${id}/tier`, {
      method: 'PUT',
      body
    });
  },

  /**
   * 批量更新 VN 的 Tier 归属
   * @param {{id: string, tierId: string|null, tierSort?: number}[]} updates
   */
  async batchUpdateTier(updates) {
    return apiRequest('/vn/tier/batch', {
      method: 'PUT',
      body: { updates }
    });
  }
};

// ============ Tier API ============

export const tierAPI = {
  /**
   * 获取 Tier 列表
   */
  async getList() {
    return apiRequest('/tier');
  },

  /**
   * 创建 Tier
   * @param {{name: string, color: string}} data
   */
  async create(data) {
    return apiRequest('/tier', {
      method: 'POST',
      body: data
    });
  },

  /**
   * 更新 Tier
   * @param {string} id - Tier ID
   * @param {{name?: string, color?: string}} data
   */
  async update(id, data) {
    return apiRequest(`/tier/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: data
    });
  },

  /**
   * 删除 Tier
   * @param {string} id - Tier ID
   */
  async delete(id) {
    return apiRequest(`/tier/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  /**
   * 更新 Tier 排序
   * @param {string[]} tierIds - 排序后的 Tier ID 数组
   */
  async updateOrder(tierIds) {
    return apiRequest('/tier/order', {
      method: 'PUT',
      body: { tierIds }
    });
  }
};

// ============ 统计API ============

export const statsAPI = {
  /**
   * 获取统计数据
   */
  async get() {
    return apiRequest('/stats');
  }
};

// ============ VNDB 搜索API ============

export const vndbAPI = {
  /**
   * VNDB 模糊搜索（认证接口，添加条目弹窗的候选来源）
   * @param {string} q - 搜索关键词
   * @param {number} limit - 结果数量（后端 clamp 1..20，默认 10）
   */
  async search(q, limit = 10) {
    const query = new URLSearchParams({ q, limit: String(limit) });
    return apiRequest(`/vndb/search?${query.toString()}`);
  }
};

// ============ 索引API ============

export const indexAPI = {
  /**
   * 启动批量索引
   */
  async start() {
    return apiRequest('/index/start', {
      method: 'POST'
    });
  },

  /**
   * 获取索引状态
   */
  async getStatus() {
    return apiRequest('/index/status');
  }
};

// ============ ulist 导入API ============

export const ulistAPI = {
  /**
   * 启动 VNDB ulist 导入任务
   */
  async import() {
    return apiRequest('/ulist/import', {
      method: 'POST'
    });
  }
};

// ============ 配置API ============

export const configAPI = {
  /**
   * 获取配置
   */
  async get() {
    return apiRequest('/config');
  },

  /**
   * 更新配置
   * @param {Object} data - 配置数据
   */
  async update(data) {
    return apiRequest('/config', {
      method: 'PUT',
      body: data
    });
  },

  /**
   * 获取外观配置（公开接口，无需认证）
   */
  async getAppearance() {
    return apiRequest('/config/appearance');
  }
};

// ============ 导入导出API ============

export const dataAPI = {
  /**
   * 导出数据
   */
  async export() {
    return apiRequest('/export');
  },

  /**
   * 导入数据
   * @param {Object} data - 导入数据
   * @param {string} mode - 导入模式
   */
  async import(data, mode = 'merge') {
    const body = {
      entries: data.entries,
      tierList: data.tierList,
      mode
    };
    if (data.appearance) {
      body.appearance = data.appearance;
    }
    return apiRequest('/import', {
      method: 'POST',
      body
    });
  }
};

/**
 * API封装模块
 */

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
 * 发送API请求
 * @param {string} endpoint - 端点
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>}
 */
async function apiRequest(endpoint, options = {}) {
  const url = API_BASE + endpoint;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, config);

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
    return apiRequest('/import', {
      method: 'POST',
      body: {
        entries: data.entries,
        tierList: data.tierList,
        mode
      }
    });
  }
};

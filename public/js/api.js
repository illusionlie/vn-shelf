/**
 * API封装模块
 */

const API_BASE = '/api';

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
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
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
      body: { entries: data.entries, mode }
    });
  }
};

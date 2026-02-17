/**
 * 工具函数模块
 */

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string}
 */
export function randomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * 生成UUID
 * @returns {string}
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 延迟函数
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解析游玩时长文��为分钟数
 * 支持格式: "25小时", "25h", "2天3小时", "2d3h", "150分钟", "150min", "2:30" (2小时30分)
 * @param {string} text - 游玩时长文本
 * @returns {number} 分钟数
 */
export function parsePlayTime(text) {
  if (!text || typeof text !== 'string') return 0;
  
  const normalized = text.toLowerCase().trim();
  let totalMinutes = 0;
  
  // 匹配 "X天Y小时" 或 "XdYh" 格式
  const dayHourMatch = normalized.match(/(\d+)\s*(?:天|d|days?)\s*(?:(\d+)\s*(?:小时|h|hours?))?/);
  if (dayHourMatch) {
    const days = parseInt(dayHourMatch[1], 10) || 0;
    const hours = parseInt(dayHourMatch[2], 10) || 0;
    totalMinutes = days * 24 * 60 + hours * 60;
    return totalMinutes;
  }
  
  // 匹配 "X小时Y分钟" 或 "XhYmin" 格式
  const hourMinMatch = normalized.match(/(\d+)\s*(?:小时|h|hours?)\s*(?:(\d+)\s*(?:分钟|min|minutes?))?/);
  if (hourMinMatch) {
    const hours = parseInt(hourMinMatch[1], 10) || 0;
    const mins = parseInt(hourMinMatch[2], 10) || 0;
    totalMinutes = hours * 60 + mins;
    return totalMinutes;
  }
  
  // 匹配 "X分钟" 或 "Xmin" 格式
  const minMatch = normalized.match(/(\d+)\s*(?:分钟|min|minutes?)(?!\s*(?:小时|h|hours?))/);
  if (minMatch) {
    totalMinutes = parseInt(minMatch[1], 10) || 0;
    return totalMinutes;
  }
  
  // 匹配 "X小时" 或 "Xh" 格式
  const hourMatch = normalized.match(/(\d+)\s*(?:小时|h|hours?)(?!\s*(?:分钟|min|minutes?))/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10) || 0;
    totalMinutes = hours * 60;
    return totalMinutes;
  }
  
  // 匹配 "HH:MM" 时间格式
  const timeMatch = normalized.match(/^(\d+):(\d+)$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10) || 0;
    const mins = parseInt(timeMatch[2], 10) || 0;
    totalMinutes = hours * 60 + mins;
    return totalMinutes;
  }
  
  // 匹配纯数字（默认为小时）
  const numMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const hours = parseFloat(numMatch[1]) || 0;
    totalMinutes = Math.round(hours * 60);
    return totalMinutes;
  }
  
  return 0;
}

/**
 * JSON安全解析
 * @param {string} str - JSON字符串
 * @param {*} defaultValue - 解析失败时的默认值
 * @returns {*}
 */
export function safeJSONParse(str, defaultValue = null) {
  try {
    return str ? JSON.parse(str) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * 创建JSON响应
 * @param {*} data - 响应数据
 * @param {number} status - HTTP状态码
 * @param {Object} headers - 额外响应头
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * 创建错误响应
 * @param {string} message - 错误信息
 * @param {number} status - HTTP状态码
 * @returns {Response}
 */
export function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

/**
 * 创建成功响应
 * @param {*} data - 响应数据
 * @param {string} message - 成功信息
 * @returns {Response}
 */
export function successResponse(data = null, message = '操作成功') {
  return jsonResponse({ success: true, message, data });
}

/**
 * 解析Cookie
 * @param {string} cookieString - Cookie字符串
 * @returns {Object}
 */
export function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  
  cookieString.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });
  
  return cookies;
}

/**
 * 格式化日期
 * @param {Date|string} date - 日期
 * @param {string} format - 格式
 * @returns {string}
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day);
}

/**
 * 验证VNDB ID格式
 * @param {string} id - VNDB ID
 * @returns {boolean}
 */
export function isValidVNDBId(id) {
  return /^v\d+$/.test(id);
}

/**
 * 简易Markdown渲染
 * @param {string} text - Markdown文本
 * @returns {string}
 */
export function renderMarkdown(text) {
  if (!text) return '';
  
  return text
    // 转义HTML
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 删除线
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // 链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 换行
    .replace(/\n/g, '<br>');
}

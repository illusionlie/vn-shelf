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
 * 安全解析请求体 JSON
 * @param {Request} request - Request 对象
 * @returns {Promise<{success: boolean, data?: *, error?: Response}>}
 */
export async function parseRequestBody(request) {
  try {
    const data = await request.json();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: errorResponse('请求体格式错误', 400) };
  }
}

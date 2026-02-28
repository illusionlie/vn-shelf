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
 * 解析请求体 JSON
 * @param {Request} request - Request 对象
 * @returns {Promise<*>}
 * @throws {Error} 请求体不是合法 JSON 时抛错
 */
export async function parseRequestBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('请求体格式错误');
  }
}

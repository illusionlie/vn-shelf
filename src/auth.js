/**
 * 认证模块
 */

import { randomString, parseCookies } from './utils.js';
import { getSettings, saveSettings } from './kv.js';

/**
 * 创建JWT Token
 * @param {string} secret - JWT密钥
 * @param {Object} payload - 载荷
 * @returns {string}
 */
export async function createJWT(secret, payload) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 24 * 60 * 60, // 24小时有效期
    jti: randomString(16)
  };
  
  // Base64URL编码
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  
  // 签名
  const signature = await sign(`${encodedHeader}.${encodedPayload}`, secret);
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * 验证JWT Token
 * @param {string} token - JWT Token
 * @param {string} secret - JWT密钥
 * @returns {Object|null}
 */
export async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [encodedHeader, encodedPayload, signature] = parts;
    
    // 验证签名
    const expectedSignature = await sign(`${encodedHeader}.${encodedPayload}`, secret);
    if (signature !== expectedSignature) {
      return null;
    }
    
    // 解码载荷
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    
    // 验证过期时间
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * HMAC-SHA256签名
 * @param {string} message - 消息
 * @param {string} secret - 密钥
 * @returns {string}
 */
async function sign(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );
  
  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Base64URL编码
 * @param {string|Uint8Array} data - 数据
 * @returns {string}
 */
function base64UrlEncode(data) {
  const str = typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL解码
 * @param {string} str - Base64URL字符串
 * @returns {string}
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) {
    str += '='.repeat(4 - pad);
  }
  return decodeURIComponent(escape(atob(str)));
}

/**
 * 密码哈希 (PBKDF2)
 * @param {string} password - 密码
 * @param {string} salt - 盐值
 * @returns {Promise<string>}
 */
export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 验证密码
 * @param {string} password - 密码
 * @param {string} salt - 盐值
 * @param {string} storedHash - 存储的哈希值
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, salt, storedHash) {
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}

/**
 * 认证中间件
 * @param {Request} request - 请求对象
 * @param {Object} env - 环境变量
 * @returns {Object} { authenticated: boolean, user?: Object, error?: string }
 */
export async function authMiddleware(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookie);
  
  if (!cookies.auth_token) {
    return { authenticated: false, error: 'No token' };
  }
  
  const settings = await getSettings(env);
  
  try {
    const payload = await verifyJWT(cookies.auth_token, settings.jwtSecret);
    if (!payload) {
      return { authenticated: false, error: 'Invalid token' };
    }
    
    return { authenticated: true, user: payload };
  } catch (e) {
    return { authenticated: false, error: 'Token verification failed' };
  }
}

/**
 * 设置认证Cookie
 * @param {Response} response - 响应对象
 * @param {string} token - JWT Token
 * @param {boolean} secure - 是否启用Secure
 */
export function setAuthCookie(response, token, secure = true) {
  const cookieValue = [
    `auth_token=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    `Max-Age=${24 * 60 * 60}`
  ].filter(Boolean).join('; ');
  
  response.headers.set('Set-Cookie', cookieValue);
}

/**
 * 清除认证Cookie
 * @param {Response} response - 响应对象
 */
export function clearAuthCookie(response) {
  const cookieValue = [
    'auth_token=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ].join('; ');
  
  response.headers.set('Set-Cookie', cookieValue);
}

/**
 * 初始化管理员密码
 * @param {Object} env - 环境变量
 * @param {string} password - 密码
 */
export async function initAdminPassword(env, password) {
  const salt = randomString(16);
  const hash = await hashPassword(password, salt);
  
  const settings = await getSettings(env);
  settings.adminPasswordHash = `${salt}:${hash}`;
  settings.jwtSecret = randomString(32);
  
  await saveSettings(env, settings);
}

/**
 * 验证管理员密码
 * @param {Object} env - 环境变量
 * @param {string} password - 密码
 * @returns {Promise<boolean>}
 */
export async function verifyAdminPassword(env, password) {
  const settings = await getSettings(env);
  
  if (!settings.adminPasswordHash) {
    return false;
  }
  
  const [salt, hash] = settings.adminPasswordHash.split(':');
  return verifyPassword(password, salt, hash);
}

/**
 * 检查是否已初始化
 * @param {Object} env - 环境变量
 * @returns {Promise<boolean>}
 */
export async function isInitialized(env) {
  const settings = await getSettings(env);
  return !!(settings.adminPasswordHash && settings.jwtSecret);
}

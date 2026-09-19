/**
 * Cloudflare Turnstile siteverify 客户端
 *
 * 无状态网络胶水模块：fetchImpl 注入直测（对照 login-ratelimit.js 的纯函数直测先例）。
 * **永不抛出**——网络异常 / 非 2xx / JSON 解析失败 / 字段形态异常统一归并为
 * { outcome: 'error' }，fail-open 还是 fail-closed 由调用方决定：
 * 登录侧 fail-open（守可用性，漏验证不阻断管理员），测试端点 fail-closed
 * （守真实性，异常放行会给误配发假绿）。
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// 官方文档标注 siteverify 的 response 字段 max 2048 chars；
// 超长必为恶意载荷，直接判 invalid 不发网络请求
const MAX_TOKEN_LENGTH = 2048;

// 默认超时：Worker → challenges.cloudflare.com 为 CF 内网路径，正常亚秒级返回，
// 10s 只兜极端异常；参数化仅为测试注入短超时
const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

/**
 * 校验 Turnstile token
 * @param {Object} params
 * @param {string} params.secretKey - Turnstile secret key
 * @param {string} params.token - widget 回调拿到的 token
 * @param {string} [params.remoteIp] - 访客 IP（真实 CF-Connecting-IP；缺失不传——
 *   不用限流的 'local' 占位，那是 DO 实例键不是 IP）
 * @param {number} [params.timeoutMs=10000] - siteverify 超时毫秒
 * @param {Function} [params.fetchImpl=fetch] - 注入测试用
 * @returns {Promise<{outcome: 'pass'|'invalid'|'error', errorCodes?: string[]}>}
 */
export async function verifyTurnstileToken({
  secretKey,
  token,
  remoteIp,
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
  fetchImpl = fetch
}) {
  // 输入防御：token 非字符串 / 空 / 超长 → invalid（不发网络请求）
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { outcome: 'invalid', errorCodes: ['invalid-input-response'] };
  }

  let response;
  try {
    const form = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) {
      form.set('remoteip', remoteIp);
    }
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      // URLSearchParams 作为 body 自动携带 application/x-www-form-urlencoded
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    // 网络异常 / 超时中止：模块永不抛出，语义交由调用方决定
    return { outcome: 'error' };
  }

  if (!response.ok) {
    return { outcome: 'error' };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { outcome: 'error' };
  }

  if (payload && typeof payload === 'object' && typeof payload.success === 'boolean') {
    if (payload.success) {
      return { outcome: 'pass' };
    }
    // 官方响应键为 error-codes（带连字符，非 errorCodes）
    const errorCodes = Array.isArray(payload['error-codes'])
      ? payload['error-codes'].map(String)
      : [];
    return { outcome: 'invalid', errorCodes };
  }

  // 字段形态异常（success 缺失 / 非布尔）：视为服务端不可用而非校验失败
  return { outcome: 'error' };
}

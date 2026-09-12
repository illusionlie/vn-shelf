/**
 * 登录限流纯函数核心
 *
 * 按 IP 的失败计数与锁定判定（连续 5 次失败锁 10 分钟，失败计数窗口 15 分钟）。
 * 状态存储与 TTL 由 LoginRateLimiterDurableObject（src/index.js）承担，本模块
 * 保持纯函数以便 node --test 直测全分支；时间由调用方注入（now），窗口/锁定到期
 * 按惰性判定覆盖，无需 alarm 主动清理。
 */

/** 触发锁定的连续失败次数 */
export const LOGIN_MAX_FAILURES = 5;

/** 锁定时长：10 分钟 */
export const LOGIN_LOCK_MS = 600_000;

/** 失败计数窗口：15 分钟（窗口过期后失败重新从 1 计） */
export const LOGIN_WINDOW_MS = 900_000;

/**
 * 规范化存储状态（字段缺失/非法一律视为无记录）
 * @param {Object|null} state - DO storage 中读出的状态
 * @returns {{failures: number, windowStart: number|null, lockUntil: number|null}}
 */
function normalizeState(state) {
  return {
    failures: Number.isFinite(state?.failures) ? state.failures : 0,
    windowStart: Number.isFinite(state?.windowStart) ? state.windowStart : null,
    lockUntil: Number.isFinite(state?.lockUntil) ? state.lockUntil : null
  };
}

/**
 * 评估一次登录尝试对限流状态的影响
 * @param {Object|null} state - 当前存储状态 { failures, windowStart, lockUntil }（均可为 null）
 * @param {{now: number, success: boolean}} attempt - 本次尝试（now 为毫秒时间戳）
 * @returns {{allowed: boolean, failures: number, windowStart: number|null, lockUntil: number|null, retryAfterSec: number|null}}
 *   allowed：当前时刻是否放行尝试——锁定期间即使密码正确也拒绝，且状态原样返回不改动；
 *   失败累计达到 LOGIN_MAX_FAILURES 时本次记录即写入 lockUntil，后续尝试将被拒
 */
export function evaluateLoginAttempt(state, { now, success }) {
  const current = normalizeState(state);

  // 锁定判定优先于一切（也先于 PBKDF2，由调用方在 precheck 阶段拦截）
  if (current.lockUntil !== null && current.lockUntil > now) {
    return {
      allowed: false,
      failures: current.failures,
      windowStart: current.windowStart,
      lockUntil: current.lockUntil,
      retryAfterSec: Math.ceil((current.lockUntil - now) / 1000)
    };
  }

  // 成功登录清零计数（锁定到期后的首笔成功同样走此分支）
  if (success) {
    return {
      allowed: true,
      failures: 0,
      windowStart: null,
      lockUntil: null,
      retryAfterSec: null
    };
  }

  // 失败：窗口过期（now - windowStart >= LOGIN_WINDOW_MS）则重开窗口从 1 计，否则窗口内累计
  const windowExpired = current.windowStart === null || (now - current.windowStart) >= LOGIN_WINDOW_MS;
  const failures = windowExpired ? 1 : current.failures + 1;
  const windowStart = windowExpired ? now : current.windowStart;
  const lockUntil = failures >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCK_MS : null;

  return {
    allowed: lockUntil === null,
    failures,
    windowStart,
    lockUntil,
    retryAfterSec: lockUntil === null ? null : Math.ceil((lockUntil - now) / 1000)
  };
}

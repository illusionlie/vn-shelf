import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateLoginAttempt,
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS
} from '../../src/login-ratelimit.js';

/**
 * 登录限流纯函数全分支直测（不经 router 桩替换，DO 壳不进单测——
 * 与 IndexStartLockDurableObject 同策略，存储与协议由 router 级测试覆盖）。
 *
 * 语义见 src/login-ratelimit.js 头注与任务 design.md：
 * - 锁定期间 success / failure 均拒绝且状态不变
 * - 成功清零；失败按 15 分钟窗口累计，满 5 次锁 10 分钟
 */

test('首次失败：从 0 计到 1，不触发锁定', () => {
  const now = 1_000_000;

  const result = evaluateLoginAttempt(null, { now, success: false });

  assert.deepEqual(result, {
    allowed: true,
    failures: 1,
    windowStart: now,
    lockUntil: null,
    retryAfterSec: null
  });
});

test('窗口内失败递增计数', () => {
  const now = 1_000_000;
  const state = { failures: 2, windowStart: now - 60_000, lockUntil: null };

  const result = evaluateLoginAttempt(state, { now, success: false });

  assert.equal(result.allowed, true);
  assert.equal(result.failures, 3);
  assert.equal(result.windowStart, state.windowStart);
  assert.equal(result.lockUntil, null);
});

test('窗口过期（now - windowStart >= LOGIN_WINDOW_MS）重开窗口从 1 计', () => {
  const now = 1_000_000;

  // 恰好到期边界（==）即视为过期
  const atBoundary = evaluateLoginAttempt(
    { failures: 4, windowStart: now - LOGIN_WINDOW_MS, lockUntil: null },
    { now, success: false }
  );
  assert.equal(atBoundary.failures, 1);
  assert.equal(atBoundary.windowStart, now);
  assert.equal(atBoundary.allowed, true);

  const pastBoundary = evaluateLoginAttempt(
    { failures: 4, windowStart: now - LOGIN_WINDOW_MS - 1, lockUntil: null },
    { now, success: false }
  );
  assert.equal(pastBoundary.failures, 1);
});

test('第 5 次失败触发锁定：lockUntil = now + LOGIN_LOCK_MS，后续尝试将被拒', () => {
  const now = 1_000_000;
  const state = { failures: LOGIN_MAX_FAILURES - 1, windowStart: now - 60_000, lockUntil: null };

  const result = evaluateLoginAttempt(state, { now, success: false });

  assert.equal(result.failures, 5);
  assert.equal(result.allowed, false, '触发锁定的这笔记录后，下一次尝试不再放行');
  assert.equal(result.lockUntil, now + LOGIN_LOCK_MS);
  assert.equal(result.retryAfterSec, LOGIN_LOCK_MS / 1000);
});

test('锁定期间 success 与 failure 均拒绝，且状态原样返回不改动', () => {
  const now = 1_000_000;
  const state = { failures: 5, windowStart: now - 60_000, lockUntil: now + 300_000 };

  for (const success of [true, false]) {
    const result = evaluateLoginAttempt(state, { now, success });

    assert.equal(result.allowed, false, `success=${success} 时也应被拒`);
    assert.equal(result.failures, 5);
    assert.equal(result.windowStart, state.windowStart);
    assert.equal(result.lockUntil, state.lockUntil);
  }
});

test('retryAfterSec 向上取整（毫秒余数进位）', () => {
  const now = 1_000_000;

  const withRemainder = evaluateLoginAttempt(
    { failures: 5, windowStart: now - 60_000, lockUntil: now + 299_999 },
    { now, success: true }
  );
  assert.equal(withRemainder.retryAfterSec, 300, '299999ms 应进位为 300 秒');

  const exact = evaluateLoginAttempt(
    { failures: 5, windowStart: now - 60_000, lockUntil: now + 300_000 },
    { now, success: true }
  );
  assert.equal(exact.retryAfterSec, 300);
});

test('锁定到期（lockUntil <= now）后：正确密码放行且清零', () => {
  const now = 1_000_000;

  // lockUntil == now 恰好到期的边界即解锁
  const atBoundary = evaluateLoginAttempt(
    { failures: 5, windowStart: now - 60_000, lockUntil: now },
    { now, success: true }
  );
  assert.equal(atBoundary.allowed, true);
  assert.equal(atBoundary.failures, 0);
  assert.equal(atBoundary.windowStart, null);
  assert.equal(atBoundary.lockUntil, null);

  const alreadyExpired = evaluateLoginAttempt(
    { failures: 5, windowStart: now - 60_000, lockUntil: now - 1 },
    { now, success: true }
  );
  assert.equal(alreadyExpired.allowed, true);
});

test('锁定到期后的失败在窗口内会立即再锁（计数 >= 5 持续满足）', () => {
  const now = 1_000_000;
  // 5 次失败锁 10 分钟，到期时距窗口起点仅 10 分钟，仍在 15 分钟窗口内
  const state = { failures: 5, windowStart: now - LOGIN_LOCK_MS, lockUntil: now - 1 };

  const result = evaluateLoginAttempt(state, { now, success: false });

  assert.equal(result.allowed, false);
  assert.equal(result.failures, 6);
  assert.equal(result.lockUntil, now + LOGIN_LOCK_MS);
});

test('成功登录清零失败计数（无锁定状态下）', () => {
  const now = 1_000_000;
  const state = { failures: 3, windowStart: now - 60_000, lockUntil: null };

  const result = evaluateLoginAttempt(state, { now, success: true });

  assert.deepEqual(result, {
    allowed: true,
    failures: 0,
    windowStart: null,
    lockUntil: null,
    retryAfterSec: null
  });
});

test('状态字段缺失或非法（null / 非数值）视为无记录', () => {
  const now = 1_000_000;

  for (const state of [null, undefined, {}, { failures: 'x', windowStart: 'y', lockUntil: 'z' }]) {
    const result = evaluateLoginAttempt(state, { now, success: false });

    assert.equal(result.failures, 1);
    assert.equal(result.windowStart, now);
    assert.equal(result.lockUntil, null);
    assert.equal(result.allowed, true);
  }
});

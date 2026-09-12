import { friendlyErrorMessage } from './api.js';
import { VN_STATUS_OPTIONS } from './constants.js';
import { t } from './i18n.js';

/**
 * VN Shelf 工具函数模块
 */

export function formatUserPlayTime(user) {
  if (!user) return t('common.notRecorded');

  const rawHours = Number(user.playTimeHours);
  const rawPartMinutes = Number(user.playTimePartMinutes);
  const hasHours = Number.isFinite(rawHours) && rawHours >= 0;
  const hasPartMinutes = Number.isFinite(rawPartMinutes) && rawPartMinutes >= 0;

  if (!hasHours && !hasPartMinutes) {
    return t('common.notRecorded');
  }

  const inputHours = hasHours ? Math.floor(rawHours) : 0;
  const inputPartMinutes = hasPartMinutes ? Math.floor(rawPartMinutes) : 0;
  const normalizedTotalMinutes = inputHours * 60 + inputPartMinutes;

  if (normalizedTotalMinutes <= 0) {
    return t('common.notRecorded');
  }

  const displayHours = Math.floor(normalizedTotalMinutes / 60);
  const displayPartMinutes = normalizedTotalMinutes % 60;

  if (displayHours > 0 && displayPartMinutes > 0) {
    return t('time.hoursMinutes', { h: displayHours, m: displayPartMinutes });
  }
  if (displayHours > 0) {
    return t('time.hours', { h: displayHours });
  }
  return t('time.minutes', { m: displayPartMinutes });
}

// =========== 状态徽章 ============

/**
 * 状态徽章文案（卡片与详情弹窗两页同口径）。
 * 卡片徽章仅渲染已配色的四状态；白名单外的值（如后端预留的 wishlist / null）
 * 返回空串，配合 statusIcon 整章不渲染，避免渲染无样式徽章或裸 i18n key。
 * @param {string|null} status - 游玩状态
 * @returns {string}
 */
export function statusBadgeLabel(status) {
  return VN_STATUS_OPTIONS.includes(status) ? t(`status.${status}`) : '';
}

/**
 * 状态徽章内嵌单色 SVG 图标（fill/stroke 均用 currentColor，随状态章白字渲染）。
 * 用内嵌 SVG 而非 ▶✓⏸✕ Unicode，避免 Windows 下被 emoji 字体劫持成彩色。
 * 白名单外返回空串，配合 statusBadgeLabel 整章不渲染。
 * @param {string|null} status - 游玩状态
 * @returns {string}
 */
export function statusIcon(status) {
  const icons = {
    // 在玩：播放三角
    playing: '<path d="M8 5v14l11-7z"/>',
    // 已完成：对勾
    finished: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    // 搁置：暂停双竖
    stalled: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>',
    // 抛弃：叉
    dropped: '<path d="M6 6 18 18M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
  };
  const inner = icons[status];
  return inner
    ? `<svg class="status-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`
    : '';
}

// =========== 滚动锁定 ============

let modalOpenCount = 0;

export function lockPageScroll() {
  modalOpenCount += 1;
  document.body.classList.add('modal-open');
}

export function unlockPageScroll() {
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0) {
    document.body.classList.remove('modal-open');
  }
}

// =========== 移动端菜单 ============

/**
 * 切换移动端 more-menu：同步 toggle 按钮 aria-expanded，打开时挂“点外部/Esc 关闭”
 * 监听（关闭即卸载），避免重复绑定与监听泄露。
 *
 * - 打开：menu 加 .open、toggle 按钮 aria-expanded=true；下一 tick 挂 document click（点菜单/toggle 外部即关闭）
 *   与 keydown(Esc) 监听；用 setTimeout(0) 错开当前触发点击，避免开启后立刻自关闭。
 * - 关闭：移除 .open、aria-expanded=false、卸载监听。
 */
export function toggleMobileMenu() {
  const menu = document.getElementById('more-menu');
  const toggleBtn = document.querySelector('.more-menu-toggle-btn');
  if (!menu || !toggleBtn) return;

  const willOpen = !menu.classList.contains('open');
  if (willOpen) {
    menu.classList.add('open');
    toggleBtn.setAttribute('aria-expanded', 'true');

    const closeHandler = (event) => {
      if (!menu.contains(event.target) && !toggleBtn.contains(event.target)) {
        closeMobileMenu(menu, toggleBtn);
      }
    };
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        closeMobileMenu(menu, toggleBtn);
      }
    };

    menu._mobileMenuClose = closeHandler;
    menu._mobileMenuEsc = escHandler;

    // 下一 tick 挂 click 监听，避免当前触发点击冒泡到 document 立即关闭
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
    document.addEventListener('keydown', escHandler);
  } else {
    closeMobileMenu(menu, toggleBtn);
  }
}

function closeMobileMenu(menu, toggleBtn) {
  menu.classList.remove('open');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  if (menu._mobileMenuClose) {
    document.removeEventListener('click', menu._mobileMenuClose);
    menu._mobileMenuClose = null;
  }
  if (menu._mobileMenuEsc) {
    document.removeEventListener('keydown', menu._mobileMenuEsc);
    menu._mobileMenuEsc = null;
  }
}

// =========== 焦点陷阱 ============

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 在指定容器内建立焦点陷阱：聚焦首个可聚焦项，Tab/Shift+Tab 在容器内循环不外溢，
 * 并记录触发元素以便关闭后还原。返回清理函数：移除 keydown 监听并把焦点还原到触发元素。
 *
 * 与 lockPageScroll 解耦：滚动锁由调用方各自管理，本函数只管焦点。
 *
 * @param {HTMLElement} el - 模态容器（.modal）
 * @returns {() => void} 清理函数（移除监听 + 还原焦点）
 */
export function trapFocus(el) {
  if (!el) return () => {};
  const lastFocus = document.activeElement;

  const getFocusables = () =>
    Array.from(el.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      node => node.offsetParent !== null || node.getClientRects().length > 0
    );

  // 聚焦首个可聚焦项
  const focusFirst = () => {
    const focusables = getFocusables();
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      el.focus?.();
    }
  };
  focusFirst();

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const focusables = getFocusables();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  el.addEventListener('keydown', onKeydown);

  return () => {
    el.removeEventListener('keydown', onKeydown);
    try {
      if (lastFocus && typeof lastFocus.focus === 'function') {
        lastFocus.focus();
      }
    } catch {
      // 还原焦点失败时静默降级
    }
  };
}

// =========== 弹窗生命周期守卫 ============

/**
 * 弹窗生命周期守卫：滚动锁与焦点陷阱的成对管理。
 *
 * 此前 4 处弹窗（详情 / 编辑 / tier 编辑 / confirmDialog）逐字重复
 * 「lockPageScroll → trapFocus → try{release()}catch{} 静默降级 → unlockPageScroll」，
 * 收敛为本工厂统一持有：
 * - `open()`：锁定页面滚动（幂等——守卫已持锁时不重复计数，对应原「已打开不重复 lock」语义）
 * - `trap(el)`：在容器上建立焦点陷阱并持有 release（el 为空时静默跳过）
 * - `close()`：静默释放焦点陷阱（try/catch 降级语义逐字保留）+ 解锁滚动 + 置空
 *
 * trap 独立于 open：焦点陷阱须等 Alpine 渲染出模态 DOM 后（$nextTick 回调内）建立，
 * 调度权留在调用方。confirmDialog 叠加于内容模态之上、自身不重复锁滚动，
 * 用 `createModalGuard({ lockScroll: false })` 只取焦点陷阱部分。
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.lockScroll=true] - 是否管理页面滚动锁
 * @returns {{ open(): void, trap(el: HTMLElement): void, close(): void }}
 */
export function createModalGuard({ lockScroll = true } = {}) {
  let release = null;
  let locked = false;
  return {
    open() {
      if (!lockScroll || locked) return;
      lockPageScroll();
      locked = true;
    },
    trap(el) {
      if (!el) return;
      release = trapFocus(el);
    },
    close() {
      if (release) {
        try {
          release();
        } catch {
          // 释放焦点陷阱失败时静默降级
        }
        release = null;
      }
      if (lockScroll && locked) {
        unlockPageScroll();
        locked = false;
      }
    }
  };
}

// =========== 进度条 ============

export function initProgressBar() {
  const progressBar = document.querySelector('.loading-progress-bar');
  const progressFill = progressBar?.querySelector('.progress-fill');
  if (!progressFill) return;

  // 守卫：bfcache 重现或重复 init 时，若进度条已隐藏则不再启动动画，
  // 避免已完成却再跑一遍进度条导致闪烁。
  if (progressBar.classList.contains('hidden')) return;

  let progress = 0;
  let finished = false;
  const interval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 90) {
      progress = 90;
      clearInterval(interval);
    }
    progressFill.style.width = progress + '%';
  }, 200);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(interval);
    progressFill.style.width = '100%';
    setTimeout(() => {
      if (progressBar) progressBar.classList.add('hidden');
    }, 500);
  };

  // 主源 1：window load。若 DOM 已 complete（脚本晚于 load 触发）立即完成。
  if (document.readyState === 'complete') {
    finish();
  } else {
    window.addEventListener('load', finish, { once: true });
  }

  // 主源 2：bfcache 前进后退触发 pageshow（persisted=true 表示从 bfcache 恢复）。
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) finish();
  }, { once: true });

  // 兜底：极端情况下 5s 强制完成（单次，finished 守卫保证不重复）。
  setTimeout(finish, 5000);
}


// =========== Loading 包装器 ============

/**
 * 包裹异步操作：统一翻转 isLoading、捕获错误并产出友好 toast。
 *
 * 约定：
 * - `ctx` 为组件实例，需提供 `isLoading` 字段与 `this.$store.app.addToast` 绑定。
 * - 异步函数正常返回时，若有 `successMsg` 则推 success toast，并返回其结果。
 * - 异步函数抛错时，输出 `${errorPrefix}: ${message}` error toast，并将原始错误记入 console.warn。
 * - `finally` 复位 `isLoading`，无论成功失败。
 *
 * @param {Object} ctx - 宿主组件实例（提供 isLoading / $store）
 * @param {() => Promise<*>} asyncFn - 待执行的异步主体
 * @param {Object} opts
 * @param {string} [opts.successMsg=''] - 成功 toast 文案（空则不弹）
 * @param {string} [opts.errorPrefix='操作失败'] - 失败 toast 文案前缀
 * @returns {Promise<*>} asyncFn 的返回值；失败时返回 undefined
 */
export async function withLoading(ctx, asyncFn, { successMsg = '', errorPrefix = t('prefix.operationFailed') } = {}) {
  ctx.isLoading = true;
  try {
    const result = await asyncFn();
    if (successMsg) ctx.$store?.app?.addToast(successMsg);
    return result;
  } catch (error) {
    console.warn('[withLoading]', { errorPrefix, error: error?.message || String(error) });
    ctx.$store?.app?.addToast(friendlyErrorMessage(error, errorPrefix), 'error');
  } finally {
    ctx.isLoading = false;
  }
}

// =========== 防抖 ============

/**
 * trailing 防抖：在停止调用 `ms` 毫秒后执行一次，保留 `this` 与参数。
 *
 * @param {Function} fn - 需防抖的目标函数
 * @param {number} [ms=200] - 防抖等待毫秒
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, ms = 200) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

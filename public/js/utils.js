/**
 * VN Shelf 工具函数模块
 */

export function formatUserPlayTime(user) {
  if (!user) return '未记录';

  const rawHours = Number(user.playTimeHours);
  const rawPartMinutes = Number(user.playTimePartMinutes);
  const hasHours = Number.isFinite(rawHours) && rawHours >= 0;
  const hasPartMinutes = Number.isFinite(rawPartMinutes) && rawPartMinutes >= 0;

  if (!hasHours && !hasPartMinutes) {
    return '未记录';
  }

  const inputHours = hasHours ? Math.floor(rawHours) : 0;
  const inputPartMinutes = hasPartMinutes ? Math.floor(rawPartMinutes) : 0;
  const normalizedTotalMinutes = inputHours * 60 + inputPartMinutes;

  if (normalizedTotalMinutes <= 0) {
    return '未记录';
  }

  const displayHours = Math.floor(normalizedTotalMinutes / 60);
  const displayPartMinutes = normalizedTotalMinutes % 60;

  if (displayHours > 0 && displayPartMinutes > 0) {
    return `${displayHours}小时${displayPartMinutes}分钟`;
  }
  if (displayHours > 0) {
    return `${displayHours}小时`;
  }
  return `${displayPartMinutes}分钟`;
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

export function toggleMobileMenu() {
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.toggle('open');
}

// =========== 进度条 ============

export function initProgressBar() {
  const progressBar = document.querySelector('.loading-progress-bar');
  const progressFill = progressBar?.querySelector('.progress-fill');
  if (!progressFill) return;

  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 90) {
      progress = 90;
      clearInterval(interval);
    }
    progressFill.style.width = progress + '%';
  }, 200);

  // 页面加载完成时
  window.addEventListener('load', () => {
    clearInterval(interval);
    if (progressFill) {
      progressFill.style.width = '100%';
      setTimeout(() => {
        if (progressBar) progressBar.classList.add('hidden');
      }, 500);
    }
  });

  // Fallback: 3秒后隐藏
  setTimeout(() => {
    clearInterval(interval);
    if (progressFill) progressFill.style.width = '100%';
    setTimeout(() => {
      if (progressBar) progressBar.classList.add('hidden');
    }, 500);
  }, 3000);
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
export async function withLoading(ctx, asyncFn, { successMsg = '', errorPrefix = '操作失败' } = {}) {
  ctx.isLoading = true;
  try {
    const result = await asyncFn();
    if (successMsg) ctx.$store?.app?.addToast(successMsg);
    return result;
  } catch (error) {
    console.warn('[withLoading]', { errorPrefix, error: error?.message || String(error) });
    ctx.$store?.app?.addToast(`${errorPrefix}: ${error?.message || error}`, 'error');
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

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

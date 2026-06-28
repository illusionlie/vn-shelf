/**
 * VN Shelf 主应用入口
 * Alpine.js 全局 Store 注册 + 组件注册
 */

import { authAPI } from './api.js';
import { loginPage } from './components/loginPage.js';
import { settingsPage } from './components/settingsPage.js';
import { statsPage } from './components/statsPage.js';
import { tierlistPage } from './components/tierlistPage.js';
import { vnShelf } from './components/vnShelf.js';
import { initTheme, toggleTheme, initBackground } from './theme.js';
import { initProgressBar, toggleMobileMenu } from './utils.js';

// ============ 全局状态 ============

// toast 递增序列，避免同毫秒并发 toast 的 id 碰撞导致 removeToast 误删
let _toastSeq = 0;

document.addEventListener('alpine:init', () => {
  // 全局Store
  Alpine.store('app', {
    isAdmin: false,
    isLoading: false,
    toasts: [],
    _initialized: false,
    init() {
      if (this._initialized) return;
      this._initialized = true;
      this.checkAuth();
      initTheme();
      initBackground();
      initProgressBar();
    },

    async checkAuth() {
      try {
        const res = await authAPI.verify();
        this.isAdmin = res.success;
      } catch (error) {
        console.warn('[app] auth verify failed', {
          error: error?.message || String(error)
        });
        this.isAdmin = false;
      }
    },

    addToast(message, type = 'success') {
      const id = ++_toastSeq;
      this.toasts.push({ id, message, type });
      setTimeout(() => this.removeToast(id), 3000);
    },

    removeToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }
  });

  // 注册 Alpine 组件
  Alpine.data('vnShelf', vnShelf);
  Alpine.data('loginPage', loginPage);
  Alpine.data('settingsPage', settingsPage);
  Alpine.data('statsPage', statsPage);
  Alpine.data('tierlistPage', tierlistPage);
});

// 注册全局函数（供 HTML onclick 使用）
window.toggleTheme = toggleTheme;
window.toggleMobileMenu = toggleMobileMenu;

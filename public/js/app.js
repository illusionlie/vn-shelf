/**
 * VN Shelf 主应用入口
 * Alpine.js 全局 Store 注册 + 组件注册
 */

import { authAPI, configAPI } from './api.js';
import { confirmDialog } from './components/confirmDialog.js';
import { loginPage } from './components/loginPage.js';
import { settingsPage } from './components/settingsPage.js';
import { statsPage } from './components/statsPage.js';
import { tierlistPage } from './components/tierlistPage.js';
import { vnShelf } from './components/vnShelf.js';
import { injectShell } from './layout.js';
import { initTheme, toggleTheme, initBackground } from './theme.js';
import { initProgressBar, toggleMobileMenu } from './utils.js';

// 在 Alpine 初始化前注入公共壳层（进度条 / 背景遮罩 / Toast / confirmDialog）
injectShell();

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
    appearance: null,
    _appearancePromise: null,
    _confirmDialog: null,

    init() {
      if (this._initialized) return;
      this._initialized = true;
      this.checkAuth();
      initTheme();
      initBackground();
      initProgressBar();
    },

    /**
     * 加载外观配置（appearance）：Promise 去重 + sessionStorage 直读 + 后台静默刷新。
     *
     * - `force=true`：清缓存与 in-flight promise，强制重新拉取（settings 保存后调用）。
     * - sessionStorage 命中：立即返回缓存值，并后台静默刷新（非阻塞），刷新成功后
     *   派发 'appearance-refreshed' 事件让 theme.js 重应用背景。
     * - 多处并发调用同一首屏：通过 `_appearancePromise` 去重，只发一次请求。
     *
     * @param {Object} opts
     * @param {boolean} [opts.force=false] - 强制刷新（绕过 sessionStorage 与 in-flight 缓存）
     * @returns {Promise<Object>} appearance 配置（失败时返回 {}）
     */
    async loadAppearance({ force = false } = {}) {
      if (force) {
        this.appearance = null;
        this._appearancePromise = null;
      }
      if (this.appearance) return this.appearance;
      if (this._appearancePromise) return this._appearancePromise;

      const doLoad = (async () => {
        // sessionStorage 直读（跨页冷启动先返回，后台静默刷新）
        if (!force) {
          const cachedRaw = sessionStorage.getItem('vn-shelf:appearance:v1');
          if (cachedRaw) {
            try {
              const cached = JSON.parse(cachedRaw);
              this.appearance = cached;
              this._refreshAppearanceBackground();
              return cached;
            } catch {
              // 解析失败则走网络路径重取
            }
          }
        }

        try {
          const res = await configAPI.getAppearance();
          const data = res.data || {};
          this.appearance = data;
          try {
            sessionStorage.setItem('vn-shelf:appearance:v1', JSON.stringify(data));
          } catch {
            // sessionStorage 不可用（隐私模式等）时静默降级
          }
        } catch (error) {
          console.warn('[app] load appearance failed', {
            error: error?.message || String(error)
          });
          this.appearance = {};
        }
        return this.appearance;
      })();

      this._appearancePromise = doLoad;
      try {
        return await doLoad;
      } finally {
        this._appearancePromise = null;
      }
    },

    /**
     * 后台静默刷新 appearance：拉取最新配置并写回 Store/sessionStorage，
     * 成功后派发 'appearance-refreshed' 事件供 theme.js 重应用背景。
     * 失败时仅 console.warn，不打扰用户。
     */
    async _refreshAppearanceBackground() {
      try {
        const res = await configAPI.getAppearance();
        const data = res.data || {};
        this.appearance = data;
        try {
          sessionStorage.setItem('vn-shelf:appearance:v1', JSON.stringify(data));
        } catch {
          // sessionStorage 不可用时静默降级
        }
        window.dispatchEvent(new CustomEvent('appearance-refreshed', { detail: data }));
      } catch (error) {
        console.warn('[app] refresh appearance failed', {
          error: error?.message || String(error)
        });
      }
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
    },

    /**
     * 全局确认对话框：驱动 confirmDialog 组件显示，返回 Promise<boolean>。
     * confirmDialog 组件通过自身 init() 把自身挂到本 Store（init 里 this 是组件实例，可正确暴露 show 方法）。
     * 若组件未挂载（极端时序），回退返回 false，不阻塞业务。
     *
     * @param {Object} [opts] - 透传给 confirmDialog.show
     * @returns {Promise<boolean>} true=确认、false=取消
     */
    async confirm(opts = {}) {
      if (!this._confirmDialog) return false;
      return this._confirmDialog.show(opts);
    }
  });

  // 注册 Alpine 组件
  Alpine.data('vnShelf', vnShelf);
  Alpine.data('loginPage', loginPage);
  Alpine.data('settingsPage', settingsPage);
  Alpine.data('statsPage', statsPage);
  Alpine.data('tierlistPage', tierlistPage);
  Alpine.data('confirmDialog', confirmDialog);
});

// 注册全局函数（供 HTML onclick 使用）
window.toggleTheme = toggleTheme;
window.toggleMobileMenu = toggleMobileMenu;

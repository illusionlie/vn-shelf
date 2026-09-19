/**
 * VN Shelf 登录页组件
 */

import { authAPI, friendlyErrorMessage } from '../api.js';
import { t } from '../i18n.js';
import { loadTurnstileScript, turnstileTheme } from '../turnstile.js';

export function loginPage() {
  return {
    isInitialized: null,
    password: '',
    vndbApiToken: '',
    error: '',
    isLoading: false,
    // Cloudflare Turnstile（后端两键齐备才启用；'' = 未启用，零第三方请求）
    turnstileSiteKey: '',
    turnstileToken: '',
    turnstileWidgetId: null,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      try {
        // 这里只检查初始化
        // 因为全局会 checkAuth
        const status = await authAPI.status();
        if (status.data.authenticated) {
          window.location.href = '/';
          return;
        }
        this.isInitialized = status.data.initialized;
        this.turnstileSiteKey = status.data.turnstileSiteKey || '';

        // 仅登录表单渲染 widget（初始化表单不渲染：Turnstile 只可能在初始化完成后
        // 经设置页配置，首次部署窗口必然未启用）；x-ref 在 template x-if 内同组件
        // 作用域可用，$nextTick 等待 DOM 挂载完成
        if (this.isInitialized === true && this.turnstileSiteKey) {
          this.$nextTick(() => this.mountTurnstile());
        }
      } catch (error) {
        this.isInitialized = false;
      }
    },

    mountTurnstile() {
      loadTurnstileScript()
        .then(() => {
          if (!this.$refs.turnstileBox || this.turnstileWidgetId !== null) return;
          this.turnstileWidgetId = window.turnstile.render(this.$refs.turnstileBox, {
            sitekey: this.turnstileSiteKey,
            // Turnstile 的 'auto' 跟系统而非站点手动主题，须按 html.dark-mode 显式传
            theme: turnstileTheme(),
            callback: token => { this.turnstileToken = token; },
            // token 过期 / widget 出错：清空本地 token，提交门控会拦住无 token 请求
            'expired-callback': () => { this.turnstileToken = ''; },
            'error-callback': () => { this.turnstileToken = ''; }
          });
        })
        .catch(() => {
          // 网络拦截场景的可操作提示（脚本是 Cloudflare 域，无法自托管）
          this.error = t('login.turnstileLoadFailed');
        });
    },

    resetTurnstile() {
      this.turnstileToken = '';
      if (this.turnstileWidgetId === null || !window.turnstile) return;
      try {
        window.turnstile.reset(this.turnstileWidgetId);
      } catch (error) {
        console.warn('[login] turnstile reset failed', {
          error: error?.message || String(error)
        });
      }
    },

    async handleSubmit() {
      if (!this.password) {
        this.error = t('validation.passwordRequired');
        return;
      }

      // 提交门控：启用时无 token 不发请求（后端同样会 400，前端拦截省一次往返）
      if (this.isInitialized === true && this.turnstileSiteKey && !this.turnstileToken) {
        this.error = t('login.turnstileRequired');
        return;
      }

      this.isLoading = true;
      this.error = '';

      try {
        if (!this.isInitialized) {
          // 初始化
          await authAPI.init(this.password, this.vndbApiToken);
        }

        // 登录
        await authAPI.login(this.password, this.turnstileToken);
        window.location.href = '/';
      } catch (error) {
        // authAPI.init/login 的 4xx 返回中文友好文案（密码错误/请完成人机验证等），
        // friendlyErrorMessage 会保留；5xx/网络错误统一友好文案，不暴露技术文本。
        this.error = friendlyErrorMessage(error, t('prefix.loginFailed'));
      } finally {
        this.isLoading = false;
        // token 单次消费：无论成败都重置 widget 取新 token
        //（401 后重试与失败重试都必须拿新 token，旧 token 已被 siteverify 消费/失效）
        if (this.isInitialized === true && this.turnstileSiteKey) {
          this.resetTurnstile();
        }
      }
    }
  };
}

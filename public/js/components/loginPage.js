/**
 * VN Shelf 登录页组件
 */

import { authAPI, friendlyErrorMessage } from '../api.js';

export function loginPage() {
  return {
    isInitialized: null,
    password: '',
    vndbApiToken: '',
    error: '',
    isLoading: false,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      try {
        // 这里只检查初始化
        // 因为全局会 checkAuth
        const status = await authAPI.status();
        if (status.authenticated) {
          window.location.href = '/';
          return;
        }
        this.isInitialized = status.initialized;
      } catch (error) {
        this.isInitialized = false;
      }
    },

    async handleSubmit() {
      if (!this.password) {
        this.error = '请输入密码';
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
        await authAPI.login(this.password);
        window.location.href = '/';
      } catch (error) {
        // authAPI.init/login 的 4xx 返回中文友好文案（密码错误/密码长度至少6位等），
        // friendlyErrorMessage 会保留；5xx/网络错误统一友好文案，不暴露技术文本。
        this.error = friendlyErrorMessage(error, '登录失败');
      } finally {
        this.isLoading = false;
      }
    }
  };
}

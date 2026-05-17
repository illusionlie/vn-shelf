/**
 * VN Shelf 登录页组件
 */

import { authAPI } from '../api.js';

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
        this.error = error.message;
      } finally {
        this.isLoading = false;
      }
    }
  };
}

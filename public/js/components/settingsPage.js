/**
 * VN Shelf 设置页组件
 */

import { authAPI, configAPI, friendlyErrorMessage, indexAPI, dataAPI } from '../api.js';
import { setBackgroundConfig, applyBackground } from '../theme.js';
import {
  initTranslations,
  getTranslationsCacheStatus,
  clearTranslationsCache,
  DEFAULT_TRANSLATION_URL
} from '../translations.js';
import { withLoading } from '../utils.js';

export function settingsPage() {
  return {
    INDEX_STATUS_POLL_INTERVAL_MS: 5000,
    config: {
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: '',
      backgroundUrl: '',
      backgroundOverlay: 0.5,
      backgroundBlur: 4
    },
    vndbApiToken: '',
    newPassword: '',
    confirmPassword: '',
    indexStatus: null,
    translationCacheStatus: null,
    isLoading: false,
    _initialized: false,
    _indexStatusPollTimer: null,
    _beforeUnloadHandler: null,

    async init() {
      if (this._initialized) return;
      this._initialized = true;

      this._beforeUnloadHandler = () => {
        this.stopIndexStatusPolling();
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);

      try {
        const status = await authAPI.status();
        if (!status.authenticated) {
          window.location.href = '/login';
          return;
        }
      } catch (error) {
        console.warn('[settings] auth status failed', {
          error: error?.message || String(error)
        });
        window.location.href = '/login';
        return;
      }
      await this.loadConfig();
      await this.loadIndexStatus();
      await this.loadTranslationCacheStatus();
    },

    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: '',
          backgroundUrl: '',
          backgroundOverlay: 0.5,
          backgroundBlur: 4
        };
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '加载配置失败'), 'error');
      }
    },

    async loadIndexStatus() {
      try {
        this.indexStatus = await indexAPI.getStatus();
        this.syncIndexStatusPolling();
      } catch (error) {
        console.warn('[settings] load index status failed', {
          error: error?.message || String(error)
        });
        this.indexStatus = null;
        this.stopIndexStatusPolling();
      }
    },

    isIndexTaskActive(status = this.indexStatus?.status) {
      return status === 'starting' || status === 'running';
    },

    syncIndexStatusPolling() {
      if (this.isIndexTaskActive()) {
        this.startIndexStatusPolling();
        return;
      }

      this.stopIndexStatusPolling();
    },

    startIndexStatusPolling() {
      if (this._indexStatusPollTimer) {
        return;
      }

      this._indexStatusPollTimer = window.setInterval(() => {
        this.loadIndexStatus();
      }, this.INDEX_STATUS_POLL_INTERVAL_MS);
    },

    stopIndexStatusPolling() {
      if (!this._indexStatusPollTimer) {
        return;
      }

      window.clearInterval(this._indexStatusPollTimer);
      this._indexStatusPollTimer = null;
    },

    async saveVndbToken() {
      if (!this.vndbApiToken) return;

      await withLoading(this, async () => {
        await configAPI.update({ vndbApiToken: this.vndbApiToken });
        this.vndbApiToken = '';
        await this.loadConfig();
      }, { successMsg: 'VNDB API Token已保存', errorPrefix: '保存失败' });
    },

    async changePassword() {
      if (!this.newPassword || this.newPassword.length < 6) {
        this.$store.app.addToast('密码长度至少6位', 'error');
        return;
      }

      if (this.newPassword !== this.confirmPassword) {
        this.$store.app.addToast('两次输入的密码不一致', 'error');
        return;
      }

      await withLoading(this, async () => {
        await configAPI.update({ newPassword: this.newPassword });
        this.newPassword = '';
        this.confirmPassword = '';
      }, { successMsg: '密码已更新', errorPrefix: '更新失败' });
    },

    async startIndex() {
      this.isLoading = true;
      try {
        const res = await indexAPI.start();
        this.$store.app.addToast(`索引已启动，共${res.data.total}个条目`);
        await this.loadIndexStatus();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '启动索引失败'), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async exportData() {
      try {
        const data = await dataAPI.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vn-shelf-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.$store.app.addToast('导出成功');
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '导出失败'), 'error');
      }
    },

    async importData(event) {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();

        // 文件读取 / JSON 解析 / 结构校验：均为本地可控错误，产出友好文案直出，
        // 不走 friendlyErrorMessage（JSON.parse 的 'Unexpected token...' 是技术文本，
        // 会绕过 friendlyErrorMessage 的 5xx/网络过滤，所以这里单独捕获并替换为友好提示）。
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          this.$store.app.addToast('导入失败：文件不是有效的 JSON', 'error');
          return;
        }

        if (!data.entries || !Array.isArray(data.entries)) {
          this.$store.app.addToast('导入失败：无效的导入文件格式', 'error');
          return;
        }

        const choice = await this.$store.app.confirm({
          title: '导入模式',
          message: '合并：保留现有数据并追加；替换：清空现有数据后写入。',
          confirmText: '合并',
          cancelText: '替换',
          danger: false,
          thirdText: '取消导入'
        });
        // true=null 语义：true=合并、false=替换、null=取消导入（放弃不弹错）
        if (choice === null) {
          return;
        }
        const mode = choice ? 'merge' : 'replace';

        await dataAPI.import(data, mode);

        if (data.appearance) {
          setBackgroundConfig(data.appearance);
          applyBackground(data.appearance);
        }

        const actionText = mode === 'merge' ? '合并' : '替换';
        this.$store.app.addToast(`导入成功（${actionText}），共${data.entries.length}个条目`);
      } catch (error) {
        // 服务端导入错误（5xx/网络/4xx 友好文案）经 friendlyErrorMessage 处理
        this.$store.app.addToast(friendlyErrorMessage(error, '导入失败'), 'error');
      } finally {
        // 清空文件输入
        event.target.value = '';
      }
    },

    async logout() {
      try {
        await authAPI.logout();
        window.location.href = '/login';
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '退出失败'), 'error');
      }
    },

    formatStatus(status) {
      const map = {
        idle: '空闲',
        starting: '启动中',
        running: '运行中',
        completed: '已完成',
        failed: '失败',
        partial: '部分完成',
        start_failed: '启动失败'
      };
      return map[status] || status;
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '未知';
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        console.warn('[settings] formatDateTime received invalid date', { dateStr });
        return dateStr;
      }

      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    },

    formatDate(dateStr) {
      if (!dateStr) return '未知';
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        console.warn('[settings] formatDate received invalid date', { dateStr });
        return dateStr;
      }

      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    },

    async loadTranslationCacheStatus() {
      try {
        this.translationCacheStatus = await getTranslationsCacheStatus();
      } catch (error) {
        console.warn('[settings] load translation cache status failed', {
          error: error?.message || String(error)
        });
        this.translationCacheStatus = null;
      }
    },

    async saveTagsConfig() {
      await withLoading(this, async () => {
        await configAPI.update({
          tagsMode: this.config.tagsMode,
          translateTags: this.config.translateTags,
          translationUrl: this.config.translationUrl
        });

        // 如果启用了翻译，预加载翻译数据
        if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
          const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
          await initTranslations(url, false);
          await this.loadTranslationCacheStatus();
        }

        // 失效 appearance 缓存，使其它标签页/组件即时读到新 tags 配置
        await this.$store.app.loadAppearance({ force: true });
      }, { successMsg: 'Tags 设置已保存', errorPrefix: '保存失败' });
    },

    async clearTranslationCache() {
      const ok = await this.$store.app.confirm({
        title: '清除翻译缓存',
        message: '下次使用时需要重新下载翻译数据。',
        confirmText: '清除',
        danger: true
      });
      if (!ok) return;

      try {
        await clearTranslationsCache();
        this.translationCacheStatus = null;
        this.$store.app.addToast('翻译缓存已清除');
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '清除缓存失败'), 'error');
      }
    },

    previewBackground() {
      const config = {
        backgroundUrl: this.config.backgroundUrl || '',
        backgroundOverlay: this.config.backgroundOverlay ?? 0.5,
        backgroundBlur: this.config.backgroundBlur ?? 4
      };
      setBackgroundConfig(config);
      applyBackground(config);
    },

    async saveAppearanceConfig() {
      await withLoading(this, async () => {
        await configAPI.update({
          backgroundUrl: this.config.backgroundUrl || '',
          backgroundOverlay: this.config.backgroundOverlay ?? 0.5,
          backgroundBlur: this.config.backgroundBlur ?? 4
        });

        // 失效 appearance 缓存并用新数据即时应用背景
        const cfg = await this.$store.app.loadAppearance({ force: true });
        setBackgroundConfig(cfg);
        applyBackground(cfg);
      }, { successMsg: '外观设置已保存', errorPrefix: '保存失败' });
    }
  };
}

/**
 * VN Shelf 设置页组件
 */

import { authAPI, configAPI, friendlyErrorMessage, indexAPI, dataAPI, ulistAPI } from '../api.js';
import { getLocale, getStoredLocale, setLocale, t } from '../i18n.js';
import { applySiteIdentity } from '../site-identity.js';
import { setBackgroundConfig, applyBackground } from '../theme.js';
import {
  initTranslations,
  getTranslationsCacheStatus,
  clearTranslationsCache,
  DEFAULT_TRANSLATION_URL
} from '../translations.js';
import { loadTurnstileScript, turnstileTheme } from '../turnstile.js';
import { withLoading } from '../utils.js';

export function settingsPage() {
  return {
    INDEX_STATUS_POLL_INTERVAL_MS: 5000,
    config: {
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: '',
      ownerName: '',
      backgroundUrl: '',
      backgroundOverlay: 0.5,
      backgroundBlur: 4
    },
    vndbApiToken: '',
    newPassword: '',
    confirmPassword: '',
    // Cloudflare Turnstile（09-19）：siteKey 预填已存值；secret 只写不读
    // （GET 只回布尔），保存语义 = 两框都提交、secret 留空 = 清除（禁用）
    turnstileSiteKey: '',
    turnstileSecretKey: '',
    turnstileTestOutcome: null,
    isTestingTurnstile: false,
    _turnstileTestWidgetId: null,
    locale: getStoredLocale(),
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
        if (!status.data.authenticated) {
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
          ownerName: '',
          backgroundUrl: '',
          backgroundOverlay: 0.5,
          backgroundBlur: 4
        };
        // Turnstile siteKey 预填明文；secret 不可读回，输入框恒空起步
        this.turnstileSiteKey = this.config.turnstileSiteKey || '';
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadConfigFailed')), 'error');
      }
    },

    async loadIndexStatus() {
      try {
        // 解包信封 data 层：indexStatus 保持裸 status 对象，
        // formatStatus / isIndexTaskActive / 模板绑定的字段路径不变
        this.indexStatus = (await indexAPI.getStatus()).data;
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
      }, { successMsg: t('toast.vndbTokenSaved'), errorPrefix: t('prefix.saveFailed') });
    },

    async changePassword() {
      if (!this.newPassword || this.newPassword.length < 6) {
        this.$store.app.addToast(t('validation.passwordMin'), 'error');
        return;
      }

      if (this.newPassword !== this.confirmPassword) {
        this.$store.app.addToast(t('validation.passwordMismatch'), 'error');
        return;
      }

      await withLoading(this, async () => {
        await configAPI.update({ newPassword: this.newPassword });
        this.newPassword = '';
        this.confirmPassword = '';
      }, { successMsg: t('toast.passwordUpdated'), errorPrefix: t('prefix.updateFailed') });
    },

    /**
     * Turnstile 配置状态行：输入 siteKey 与（输入或已存）secret 的组合反馈。
     * 两键齐 = 启用态；半配 = 未启用（提示补齐）；全空 = 未配置。
     */
    get turnstileStatusKey() {
      const siteKeySet = !!(this.turnstileSiteKey || '').trim();
      const secretSet = !!(this.turnstileSecretKey || '').trim() || !!this.config?.hasTurnstileSecret;
      if (siteKeySet && secretSet) return 'enabled';
      if (!siteKeySet && !secretSet) return 'none';
      return 'half';
    },

    async saveTurnstile() {
      // 保存语义：两框都提交（siteKey 预填已存值，secret 留空 = 清除即禁用）
      await withLoading(this, async () => {
        await configAPI.update({
          turnstileSiteKey: this.turnstileSiteKey || '',
          turnstileSecretKey: this.turnstileSecretKey || ''
        });
        this.turnstileSecretKey = '';
        this.turnstileTestOutcome = null;
        await this.loadConfig();
      }, { successMsg: t('toast.turnstileSaved'), errorPrefix: t('prefix.saveFailed') });
    },

    /**
     * 用输入框当前值测试配置：动态渲染临时 widget（当前输入 siteKey）→ 拿 token →
     * 调测试端点。临时 widget 用完 turnstile.remove() 防叠加。
     */
    async testTurnstile() {
      if (this.isTestingTurnstile) return;

      const siteKey = (this.turnstileSiteKey || '').trim();
      const secretKey = (this.turnstileSecretKey || '').trim();
      if (!siteKey || !secretKey) {
        this.$store.app.addToast(t('settings.turnstileTestInputRequired'), 'error');
        return;
      }

      this.isTestingTurnstile = true;
      this.turnstileTestOutcome = null;
      try {
        // 等待 x-show 容器先变为可见再渲染临时 widget（避免向 display:none 容器 render）
        await this.$nextTick();
        const token = await new Promise((resolve, reject) => {
          loadTurnstileScript()
            .then(() => {
              const box = this.$refs.turnstileTestBox;
              if (!box) {
                reject(new Error('turnstile test container missing'));
                return;
              }
              this._turnstileTestWidgetId = window.turnstile.render(box, {
                sitekey: siteKey,
                theme: turnstileTheme(),
                callback: widgetToken => resolve(widgetToken),
                'expired-callback': () => reject(new Error('turnstile token expired')),
                'error-callback': () => reject(new Error('turnstile widget error'))
              });
            })
            .catch(reject);
        });

        const res = await configAPI.testTurnstile({ siteKey, secretKey, token });
        this.turnstileTestOutcome = res.data.ok
          ? { ok: true }
          : { ok: false, errorCodes: res.data.errorCodes || [] };
        this.$store.app.addToast(
          res.data.ok ? t('settings.turnstileTestOk') : t('settings.turnstileTestFail'),
          res.data.ok ? 'success' : 'error'
        );
      } catch (error) {
        // 服务端错误（含 503）带已著文案原样展示；本地失败（脚本/widget/过期）给通用文案
        const serverMessage = error?.payload?.error;
        this.$store.app.addToast(serverMessage || t('settings.turnstileTestFail'), 'error');
      } finally {
        if (this._turnstileTestWidgetId !== null && window.turnstile) {
          try {
            window.turnstile.remove(this._turnstileTestWidgetId);
          } catch (removeError) {
            console.warn('[settings] turnstile test widget remove failed', {
              error: removeError?.message || String(removeError)
            });
          }
          this._turnstileTestWidgetId = null;
        }
        this.isTestingTurnstile = false;
      }
    },

    async startIndex() {
      this.isLoading = true;
      try {
        const res = await indexAPI.start();
        this.$store.app.addToast(t('toast.indexStarted', { total: res.data.total }));
        await this.loadIndexStatus();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.startIndexFailed')), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async startUListImport() {
      this.isLoading = true;
      try {
        await ulistAPI.import();
        this.$store.app.addToast(t('toast.ulistImportStarted'));
        await this.loadIndexStatus();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.ulistImportFailed')), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async exportData() {
      try {
        // 解包信封 data 层后落盘：导出文件内容保持
        // { version, exportedAt, entries, tierList, appearance } 原格式，历史备份可直接重新导入
        const { data } = await dataAPI.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vn-shelf-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.$store.app.addToast(t('toast.exportOk'));
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.exportFailed')), 'error');
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
          this.$store.app.addToast(t('toast.importInvalidJson'), 'error');
          return;
        }

        if (!data.entries || !Array.isArray(data.entries)) {
          this.$store.app.addToast(t('toast.importInvalidFormat'), 'error');
          return;
        }

        const choice = await this.$store.app.confirm({
          title: t('confirm.importTitle'),
          message: t('confirm.importMessage'),
          confirmText: t('confirm.importMerge'),
          cancelText: t('confirm.importReplace'),
          danger: false,
          thirdText: t('confirm.importAbort')
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
          // ownerName 随导入的 appearance 即时生效（与背景字段同管线）
          applySiteIdentity(data.appearance);
        }

        const actionText = mode === 'merge' ? t('confirm.importMerge') : t('confirm.importReplace');
        this.$store.app.addToast(t('toast.importOk', { action: actionText, total: data.entries.length }));
      } catch (error) {
        // 服务端导入错误（5xx/网络/4xx 友好文案）经 friendlyErrorMessage 处理
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.importFailed')), 'error');
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
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.logoutFailed')), 'error');
      }
    },

    formatStatus(status) {
      const map = {
        idle: t('status.idle'),
        starting: t('status.starting'),
        running: t('status.running'),
        completed: t('status.completed'),
        failed: t('status.failed'),
        partial: t('status.partial'),
        start_failed: t('status.startFailed')
      };
      return map[status] || status;
    },

    // 任务类型文案：index=索引 / ulist_import=ulist 导入（进度区按 type 区分显示）
    formatTaskType(type) {
      return type === 'ulist_import' ? t('settings.taskTypeUlistImport') : t('settings.taskTypeIndex');
    },

    formatDateTime(dateStr) {
      if (!dateStr) return t('common.unknown');
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        console.warn('[settings] formatDateTime received invalid date', { dateStr });
        return dateStr;
      }

      return date.toLocaleString(getLocale(), {
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
      if (!dateStr) return t('common.unknown');
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        console.warn('[settings] formatDate received invalid date', { dateStr });
        return dateStr;
      }

      return date.toLocaleDateString(getLocale(), {
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
      }, { successMsg: t('toast.tagsConfigSaved'), errorPrefix: t('prefix.saveFailed') });
    },

    async clearTranslationCache() {
      const ok = await this.$store.app.confirm({
        title: t('confirm.clearCacheTitle'),
        message: t('confirm.clearCacheMessage'),
        confirmText: t('confirm.clearCacheAction'),
        danger: true
      });
      if (!ok) return;

      try {
        await clearTranslationsCache();
        this.translationCacheStatus = null;
        this.$store.app.addToast(t('toast.translationCacheCleared'));
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.clearCacheFailed')), 'error');
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
          ownerName: this.config.ownerName || '',
          backgroundUrl: this.config.backgroundUrl || '',
          backgroundOverlay: this.config.backgroundOverlay ?? 0.5,
          backgroundBlur: this.config.backgroundBlur ?? 4
        });

        // 失效 appearance 缓存并用新数据即时应用背景与站点名
        const cfg = await this.$store.app.loadAppearance({ force: true });
        setBackgroundConfig(cfg);
        applyBackground(cfg);
        applySiteIdentity(cfg);
      }, { successMsg: t('toast.appearanceSaved'), errorPrefix: t('prefix.saveFailed') });
    },

    /**
     * 切换 UI 语言：持久化偏好后整页重载（spec：切换刷新生效 by design），
     * 重载后所有动态文案一致使用新词典。
     */
    async changeLocale() {
      await setLocale(this.locale);
      window.location.reload();
    }
  };
}

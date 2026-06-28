/**
 * 页面组件共享 mixin
 *
 * 以对象展开方式混入 Alpine 组件（如 `...createTagsView()`），
 * 方法内的 this 指向宿主组件实例。
 */

import { vnAPI } from '../api.js';
import {
  DEFAULT_TRANSLATION_URL,
  getFromIndexedDB,
  initTranslations,
  translateTags
} from '../translations.js';
import { lockPageScroll, unlockPageScroll } from '../utils.js';

const DEFAULT_TAGS_CONFIG = {
  tagsMode: 'vndb',
  translateTags: true,
  translationUrl: ''
};

/**
 * Tags 视图 mixin：公开配置加载、翻译初始化、tags 显示与热刷新
 */
export function createTagsView() {
  return {
    config: { ...DEFAULT_TAGS_CONFIG },
    translations: null,

    async loadConfig() {
      // 从全局 Store 读取 appearance（带 sessionStorage 直读 + 后台刷新，避免每页重复请求）
      const cfg = await this.$store.app.loadAppearance();
      this.config = {
        tagsMode: cfg.tagsMode ?? DEFAULT_TAGS_CONFIG.tagsMode,
        translateTags: cfg.translateTags ?? DEFAULT_TAGS_CONFIG.translateTags,
        translationUrl: cfg.translationUrl ?? DEFAULT_TAGS_CONFIG.translationUrl
      };
    },

    async initTranslations() {
      // 只在 vndb 模式且启用翻译时加载翻译数据
      if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
        const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
        try {
          this.translations = await initTranslations(url);
        } catch (error) {
          console.error('[tagsView] Failed to load translations:', error);
          this.translations = null;
        }
      }
    },

    /**
     * 获取要显示的 tags
     * @param {Object} vn - VN 条目
     * @returns {string[]} - 要显示的 tags 数组
     */
    getDisplayTags(vn) {
      if (!vn) return [];

      // 手动模式：优先使用用户 tags
      if (this.config.tagsMode === 'manual') {
        return Array.isArray(vn?.user?.tags) ? vn.user.tags : [];
      }

      // VNDB 模式
      const vndbTags = Array.isArray(vn?.vndb?.tags) ? vn.vndb.tags : [];

      // 如果启用翻译且有翻译数据，翻译 tags
      if (this.config.translateTags && this.translations) {
        return translateTags(vndbTags, this.translations);
      }

      // 否则返回原始英文 tags
      return vndbTags;
    },

    /**
     * 监听后台翻译缓存更新事件，从 IndexedDB 重读并触发 Alpine 响应式刷新
     * MPA 页面无需 teardown；调用方以 _initialized 守卫防止重复挂监听
     */
    setupTranslationsRefresh() {
      window.addEventListener('translations-updated', async () => {
        try {
          const cached = await getFromIndexedDB();
          if (cached?.translations) {
            this.translations = cached.translations;
          }
        } catch (error) {
          console.warn('[tagsView] reload translations after update failed', {
            error: error?.message || String(error)
          });
        }
      });
    }
  };
}

/**
 * 详情弹窗 mixin
 */
export function createDetailModal() {
  return {
    selectedVN: null,
    showDetail: false,

    async openDetail(vn) {
      try {
        const res = await vnAPI.get(vn.id);
        this.selectedVN = res;
        if (!this.showDetail) {
          lockPageScroll();
        }
        this.showDetail = true;
      } catch (error) {
        this.$store.app.addToast('加载详情失败: ' + error.message, 'error');
      }
    },

    closeDetail() {
      if (!this.showDetail) return;
      this.showDetail = false;
      this.selectedVN = null;
      unlockPageScroll();
    }
  };
}

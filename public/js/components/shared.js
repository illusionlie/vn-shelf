/**
 * 页面组件共享 mixin
 *
 * 以对象展开方式混入 Alpine 组件（如 `...createTagsView()`），
 * 方法内的 this 指向宿主组件实例。
 */

import { friendlyErrorMessage, vnAPI } from '../api.js';
import { t } from '../i18n.js';
import {
  DEFAULT_TRANSLATION_URL,
  getFromIndexedDB,
  initTranslations,
  translateTags
} from '../translations.js';
import { createModalGuard } from '../utils.js';

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
 * 详情弹窗管理员动作 mixin：单条目 VNDB 刷新与删除（09-09 就地更新场景的跨页复用）
 *
 * 刷新/删除的就地生效因页面列表结构而异（书架页 vnList/filteredList + 渲染窗口、
 * tier 页 allVN + tier 分组），经两个宿主钩子交回：宿主组件用同名方法
 * 覆盖 mixin 的空实现（对象展开后者覆盖，与 createTagsView 同惯例）：
 * - `applyDetailEntryUpdated(entry)`：刷新成功后就地合并列表条目（不整表重拉、不重置渲染窗口）
 * - `applyDetailEntryRemoved(id)`：删除成功后就地移除列表条目
 *
 * busy 语义按 09-09 spec Scenario：刷新钮 aria-disabled/aria-busy 保焦点（真 disabled
 * 会让焦点掉出弹窗陷阱）；同条目刷新在途期间编辑/删除由模板联动禁用
 * （后端 saveVNEntry 为 INSERT OR REPLACE 整行写入的在途互斥）。
 */
export function createDetailAdminActions() {
  return {
    // 单条目 VNDB 刷新的 per-id busy map：{ [vnId]: true }。同 id 重入被守卫拦截，不同 id 可并行。
    // 用普通对象而非 Set，避免依赖集合类型的响应式细节。
    refreshing: {},

    isRefreshing(id) {
      return Boolean(id && this.refreshing[id]);
    },

    // 单条目 VNDB 刷新：只传 refreshVNDB，用户字段由后端三态语义（未出现 = 保持）原样保留。
    async refreshVN(id) {
      if (!id || this.refreshing[id]) return;
      this.refreshing[id] = true;
      try {
        const res = await vnAPI.update(id, { refreshVNDB: true });
        if (res.data?.id) {
          this.applyDetailEntryUpdated(res.data);
          // 已打开的详情弹窗同步为新条目（完整实体，非列表项投影）
          if (this.selectedVN?.id === id) {
            this.selectedVN = res.data;
          }
        }
        this.$store.app.addToast(t('toast.refreshOk'));
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.refreshFailed')), 'error');
      } finally {
        delete this.refreshing[id];
      }
    },

    async deleteVN(id) {
      const ok = await this.$store.app.confirm({
        title: t('confirm.deleteVnTitle'),
        message: t('confirm.deleteVnMessage'),
        confirmText: t('confirm.deleteAction'),
        danger: true
      });
      if (!ok) return;

      try {
        await vnAPI.delete(id);
        this.$store.app.addToast(t('toast.deleteOk'));
        this.closeDetail();
        await this.applyDetailEntryRemoved(id);
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.deleteFailed')), 'error');
      }
    },

    // ===== 宿主钩子（两组件列表结构不同，展开覆盖此空实现）=====
    applyDetailEntryUpdated() {},
    applyDetailEntryRemoved() {}
  };
}

/**
 * 详情弹窗 mixin
 */
export function createDetailModal() {
  return {
    selectedVN: null,
    showDetail: false,
    // 弹窗生命周期守卫（滚动锁 + 焦点陷阱）；vnShelf 从详情跳编辑时也经它释放
    _detailModalGuard: createModalGuard(),

    async openDetail(vn) {
      try {
        // 管理员传 no-store 绕过浏览器 HTTP 缓存（登录前访客态副本写后可能陈旧 60s）
        const res = await vnAPI.get(
          vn.id,
          this.$store.app.isAdmin ? { cache: 'no-store' } : {}
        );
        this.selectedVN = res.data;
        // 首开才锁滚动（guard 幂等，已持锁不重复计数）
        this._detailModalGuard.open();
        this.showDetail = true;
        this.$nextTick(() => {
          this._detailModalGuard.trap(this.$refs.detailModal);
        });
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadDetailFailed')), 'error');
      }
    },

    closeDetail() {
      if (!this.showDetail) return;
      this.showDetail = false;
      this.selectedVN = null;
      this._detailModalGuard.close();
    }
  };
}

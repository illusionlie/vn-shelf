/**
 * VN Shelf 主页书架组件
 */

import { vnAPI, configAPI } from '../api.js';
import { renderMarkdown } from '../markdown.js';
import { initTranslations, translateTags, DEFAULT_TRANSLATION_URL } from '../translations.js';
import { formatUserPlayTime, lockPageScroll, unlockPageScroll } from '../utils.js';

export function vnShelf() {
  return {
    vnList: [],
    filteredList: [],
    searchQuery: '',
    sortBy: 'created_desc',
    isLoading: true,
    selectedVN: null,
    showDetail: false,
    showEdit: false,
    editForm: {},
    // 翻译相关状态
    config: null,
    translations: null,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      await this.loadConfig();
      await this.initTranslations();
      await this.loadVNList();
    },

    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      } catch (error) {
        console.warn('[vnShelf] load config fallback to defaults', {
          error: error?.message || String(error)
        });
        // 未登录时使用默认配置
        this.config = {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      }
    },

    async initTranslations() {
      // 只在 vndb 模式且启用翻译时加载翻译数据
      if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
        const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
        try {
          this.translations = await initTranslations(url);
        } catch (error) {
          console.error('[vnShelf] Failed to load translations:', error);
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
        return vn.user?.tags || [];
      }

      // VNDB 模式
      const vndbTags = vn.vndb?.tags || [];

      // 如果启用翻译且有翻译数据，翻译 tags
      if (this.config.translateTags && this.translations) {
        return translateTags(vndbTags, this.translations);
      }

      // 否则返回原始英文 tags
      return vndbTags;
    },

    async loadVNList() {
      this.isLoading = true;
      try {
        const res = await vnAPI.getList({ sort: this.sortBy });
        this.vnList = res.data || [];
        this.filteredList = this.vnList;
      } catch (error) {
        this.$store.app.addToast('加载失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    handleSearch() {
      if (!this.searchQuery) {
        this.filteredList = this.vnList;
        return;
      }

      const query = this.searchQuery.toLowerCase();
      this.filteredList = this.vnList.filter(vn =>
        vn.title.toLowerCase().includes(query) ||
        (vn.titleCn && vn.titleCn.toLowerCase().includes(query))
      );
    },

    handleSortChange() {
      this.loadVNList();
    },

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
    },

    openEdit(vn = null) {
      if (vn) {
        // 解析 tags 为文本（用于编辑）
        const userTags = vn.user?.tags || [];
        const playTimeHours = Number.isFinite(Number(vn.user?.playTimeHours)) && Number(vn.user?.playTimeHours) >= 0
          ? Math.floor(Number(vn.user?.playTimeHours))
          : 0;
        const playTimePartMinutes = Number.isFinite(Number(vn.user?.playTimePartMinutes)) && Number(vn.user?.playTimePartMinutes) >= 0
          ? Math.floor(Number(vn.user?.playTimePartMinutes))
          : 0;

        this.editForm = {
          id: vn.id,
          vndbId: vn.id,
          titleCn: vn.user?.titleCn || '',
          personalRating: vn.user?.personalRating || 0,
          playTimeHours,
          playTimePartMinutes,
          review: vn.user?.review || '',
          startDate: vn.user?.startDate || '',
          finishDate: vn.user?.finishDate || '',
          tags: userTags.join(', '), // 逗号分隔的文本
          isNew: false
        };
      } else {
        this.editForm = {
          vndbId: '',
          titleCn: '',
          personalRating: 0,
          playTimeHours: 0,
          playTimePartMinutes: 0,
          review: '',
          startDate: '',
          finishDate: '',
          tags: '',
          isNew: true
        };
      }
      if (!this.showEdit) {
        lockPageScroll();
      }
      this.showEdit = true;

      if (this.showDetail) {
        this.showDetail = false;
        unlockPageScroll();
      }
    },

    closeEdit() {
      if (!this.showEdit) return;
      this.showEdit = false;
      this.editForm = {};
      unlockPageScroll();
    },

    formatUserPlayTime,

    normalizePlayTimeInput() {
      const rawHours = Number(this.editForm.playTimeHours);
      const rawPartMinutes = Number(this.editForm.playTimePartMinutes);

      if (!Number.isFinite(rawHours) || rawHours < 0) {
        throw new Error('游玩时长小时必须是非负数字');
      }
      if (!Number.isFinite(rawPartMinutes) || rawPartMinutes < 0) {
        throw new Error('游玩时长分钟必须是非负数字');
      }

      return {
        playTimeHours: Math.floor(rawHours),
        playTimePartMinutes: Math.floor(rawPartMinutes)
      };
    },

    /**
     * 解析 tags 文本为数组
     * @param {string} tagsText - 逗号分隔的 tags 文本
     * @returns {string[]} - tags 数组
     */
    parseTags(tagsText) {
      if (!tagsText || !tagsText.trim()) return [];
      return tagsText
        .split(/[,，]/) // 支持中英文逗号
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    },

    async saveEdit() {
      try {
        // 解析 tags
        const tags = this.parseTags(this.editForm.tags);
        const playTimeData = this.normalizePlayTimeInput();

        if (this.editForm.isNew) {
          await vnAPI.create({
            vndbId: this.editForm.vndbId,
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTimeHours: playTimeData.playTimeHours,
            playTimePartMinutes: playTimeData.playTimePartMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
            tags: tags
          });
          this.$store.app.addToast('添加成功');
        } else {
          await vnAPI.update(this.editForm.id, {
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTimeHours: playTimeData.playTimeHours,
            playTimePartMinutes: playTimeData.playTimePartMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
            tags: tags
          });
          this.$store.app.addToast('更新成功');
        }
        this.closeEdit();
        await this.loadVNList();
      } catch (error) {
        this.$store.app.addToast('保存失败: ' + error.message, 'error');
      }
    },

    async deleteVN() {
      if (!confirm('确定要删除这个条目吗？')) return;

      try {
        await vnAPI.delete(this.selectedVN.id);
        this.$store.app.addToast('删除成功');
        this.closeDetail();
        await this.loadVNList();
      } catch (error) {
        this.$store.app.addToast('删除失败: ' + error.message, 'error');
      }
    },

    renderMarkdown
  };
}

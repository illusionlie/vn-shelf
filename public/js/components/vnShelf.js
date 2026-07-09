/**
 * VN Shelf 主页书架组件
 */

import { friendlyErrorMessage, vnAPI } from '../api.js';
import { t } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { debounce, formatUserPlayTime, lockPageScroll, trapFocus, unlockPageScroll } from '../utils.js';

import { createDetailModal, createTagsView } from './shared.js';

export function vnShelf() {
  return {
    ...createTagsView(),
    ...createDetailModal(),

    vnList: [],
    filteredList: [],
    searchQuery: '',
    sortBy: 'created_desc',
    isLoading: true,
    showEdit: false,
    editForm: {},
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.debouncedSearch = debounce(this.handleSearch.bind(this), 200);
      this.setupTranslationsRefresh();
      await this.loadConfig();
      await this.initTranslations();
      await this.loadVNList();
    },

    async loadVNList() {
      this.isLoading = true;
      try {
        const res = await vnAPI.getList({ sort: this.sortBy });
        this.vnList = res.data || [];
        this.filteredList = this.vnList;
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadFailed')), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // 搜索过滤（匹配字段与后端 handleGetVNList 一致：title / titleJa / titleCn）
    applySearchFilter(list) {
      if (!this.searchQuery) {
        return list;
      }

      const query = this.searchQuery.toLowerCase();
      return list.filter(vn =>
        vn.title.toLowerCase().includes(query) ||
        (vn.titleJa && vn.titleJa.toLowerCase().includes(query)) ||
        (vn.titleCn && vn.titleCn.toLowerCase().includes(query))
      );
    },

    handleSearch() {
      this.filteredList = this.applySearchFilter(this.vnList);
    },

    // 本地排序（比较器语义与后端 handleGetVNList 一致），不再重新请求列表
    handleSortChange() {
      const [field, order] = this.sortBy.split('_');

      this.vnList.sort((a, b) => {
        let valA, valB;

        if (field === 'created') {
          valA = new Date(a.createdAt || 0);
          valB = new Date(b.createdAt || 0);
        } else if (field === 'personal') {
          valA = a.personalRating || 0;
          valB = b.personalRating || 0;
        } else {
          valA = a.rating || 0;
          valB = b.rating || 0;
        }

        return order === 'desc' ? valB - valA : valA - valB;
      });

      // 重放当前搜索过滤，保持 filteredList 与排序结果同步
      this.filteredList = this.applySearchFilter(this.vnList);
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
        // 从详情跳转到编辑：释放详情焦点陷阱（但不走 closeDetail，避免清空 selectedVN
        // 进而破坏编辑模态内 getDisplayTags(selectedVN || editForm) 的标签展示）
        this.showDetail = false;
        if (this._detailTrapRelease) {
          try {
            this._detailTrapRelease();
          } catch {
            // 释放焦点陷阱失败时静默降级
          }
          this._detailTrapRelease = null;
        }
        unlockPageScroll();
      }

      this.$nextTick(() => {
        if (this.$refs.editModal) {
          this._editTrapRelease = trapFocus(this.$refs.editModal);
        }
      });
    },

    closeEdit() {
      if (!this.showEdit) return;
      this.showEdit = false;
      this.editForm = {};
      if (this._editTrapRelease) {
        try {
          this._editTrapRelease();
        } catch {
          // 释放焦点陷阱失败时静默降级
        }
        this._editTrapRelease = null;
      }
      unlockPageScroll();
    },

    formatUserPlayTime,

    normalizePlayTimeInput() {
      const rawHours = Number(this.editForm.playTimeHours);
      const rawPartMinutes = Number(this.editForm.playTimePartMinutes);

      if (!Number.isFinite(rawHours) || rawHours < 0) {
        throw new Error(t('validation.playTimeHoursInvalid'));
      }
      if (!Number.isFinite(rawPartMinutes) || rawPartMinutes < 0) {
        throw new Error(t('validation.playTimeMinutesInvalid'));
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
          this.$store.app.addToast(t('toast.addOk'));
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
          this.$store.app.addToast(t('toast.updateOk'));
        }
        this.closeEdit();
        await this.loadVNList();
      } catch (error) {
        // normalizePlayTimeInput 的本地校验 throw（友好文案，无 status）会被
        // friendlyErrorMessage 第 4 支保留；vnAPI 的服务端错误走 5xx/4xx 分支。
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.saveFailed')), 'error');
      }
    },

    async deleteVN() {
      const ok = await this.$store.app.confirm({
        title: t('confirm.deleteVnTitle'),
        message: t('confirm.deleteVnMessage'),
        confirmText: t('confirm.deleteAction'),
        danger: true
      });
      if (!ok) return;

      try {
        await vnAPI.delete(this.selectedVN.id);
        this.$store.app.addToast(t('toast.deleteOk'));
        this.closeDetail();
        await this.loadVNList();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.deleteFailed')), 'error');
      }
    },

    renderMarkdown
  };
}

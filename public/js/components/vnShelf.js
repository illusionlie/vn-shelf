/**
 * VN Shelf 主页书架组件
 */

import { friendlyErrorMessage, vnAPI } from '../api.js';
import { t } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { debounce, formatUserPlayTime, lockPageScroll, trapFocus, unlockPageScroll } from '../utils.js';

import { createDetailModal, createTagsView } from './shared.js';

// 与 src/repository.js 的 VN_STATUS_VALUES 保持同步（后端另含预留的 wishlist，首期 UI 不暴露）
const VN_STATUS_OPTIONS = ['playing', 'finished', 'stalled', 'dropped'];

export function vnShelf() {
  return {
    ...createTagsView(),
    ...createDetailModal(),

    vnList: [],
    filteredList: [],
    searchQuery: '',
    sortBy: 'created_desc',
    statusFilter: 'all',
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
        this.filteredList = this.applyFilters(this.vnList);
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

    // 状态过滤：'all' 不过滤；'none' 匹配未设置（null）；四状态精确匹配
    applyStatusFilter(list) {
      if (this.statusFilter === 'none') {
        return list.filter(vn => !vn.status);
      }
      if (VN_STATUS_OPTIONS.includes(this.statusFilter)) {
        return list.filter(vn => vn.status === this.statusFilter);
      }
      return list;
    },

    // 搜索 ∧ 状态叠加过滤（所有过滤重放走这里，保证两个条件同时生效）
    applyFilters(list) {
      return this.applyStatusFilter(this.applySearchFilter(list));
    },

    handleSearch() {
      this.filteredList = this.applyFilters(this.vnList);
    },

    handleStatusFilterChange() {
      this.filteredList = this.applyFilters(this.vnList);
    },

    // 卡片徽章仅渲染已配色的四状态；白名单外的值（如后端预留的 wishlist）
    // 安全降级为不显示徽章，避免渲染无样式徽章或裸 i18n key
    statusBadgeLabel(status) {
      return VN_STATUS_OPTIONS.includes(status) ? t(`status.${status}`) : '';
    },

    // 内嵌单色 SVG 图标（fill/stroke 均用 currentColor，随状态章白字渲染）。
    // 用内嵌 SVG 而非 ▶✓⏸✕ Unicode，避免 Windows 下被 emoji 字体劫持成彩色。
    // 白名单外（含 null / wishlist）返回空串，配合 statusBadgeLabel 整章不渲染。
    statusIcon(status) {
      const icons = {
        // 在玩：播放三角
        playing: '<path d="M8 5v14l11-7z"/>',
        // 已完成：对勾
        finished: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
        // 搁置：暂停双竖
        stalled: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>',
        // 抛弃：叉
        dropped: '<path d="M6 6 18 18M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
      };
      const inner = icons[status];
      return inner
        ? `<svg class="status-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`
        : '';
    },

    // 卡片评分：个人评分优先，未评分（后端存 0 / 缺失）回退 VNDB 分
    hasPersonalRating(vn) {
      return (vn.personalRating || 0) > 0;
    },

    // 个人分沿用一位小数（与详情弹窗一致），VNDB 回退分保持原有两位小数
    cardRatingText(vn) {
      if (this.hasPersonalRating(vn)) return vn.personalRating.toFixed(1);
      return vn.rating?.toFixed(2) || 'N/A';
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

      // 重放当前搜索 + 状态过滤，保持 filteredList 与排序结果同步
      this.filteredList = this.applyFilters(this.vnList);
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
          status: vn.user?.status ?? '', // '' = 未设置（提交时转 null）
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
          status: '',
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
            status: this.editForm.status || null, // '' → null（未设置）
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
            status: this.editForm.status || null, // '' → null（清除状态）
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

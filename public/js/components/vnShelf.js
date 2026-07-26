/**
 * VN Shelf 主页书架组件
 */

import { friendlyErrorMessage, vnAPI, vndbAPI } from '../api.js';
import { t } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { debounce, formatUserPlayTime, lockPageScroll, trapFocus, unlockPageScroll } from '../utils.js';

import { createDetailModal, createTagsView } from './shared.js';

// 与 src/repository.js 的 VN_STATUS_VALUES 保持同步（后端另含预留的 wishlist，首期 UI 不暴露）
const VN_STATUS_OPTIONS = ['playing', 'finished', 'stalled', 'dropped'];

// VNDB ID 直连模式判定（与 src/utils.js isValidVNDBId 同口径）
const VNDB_ID_RE = /^v\d+$/;

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

    // ===== VNDB 搜索（添加弹窗 isNew 分支）=====
    vndbSearchText: '',        // 输入框绑定（选中后由 selectVndbResult 回填 editForm.vndbId）
    vndbSearchResults: [],
    vndbSearchStatus: 'idle',  // idle | searching | done | error
    vndbSearchError: '',       // friendlyErrorMessage 产物，内联展示于下拉区
    vndbSearchOpen: false,
    vndbSearchActiveIndex: -1, // 键盘高亮索引
    vndbSearchSelected: null,  // 已选候选对象（驱动已选卡片）
    _vndbSearchSeq: 0,         // 竞态序号守卫：过期响应不得覆盖新结果
    _vndbComposing: false,     // IME 组字中挂起搜索

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.debouncedSearch = debounce(this.handleSearch.bind(this), 200);
      this.debouncedVndbSearch = debounce(this.runVndbSearch.bind(this), 350);
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

    // ===== VNDB 搜索：双模式输入（v<id> 直连 / 名称模糊搜索）=====

    // 输入是否命中直连模式（v+数字），驱动 hint 切换
    isVndbDirectInput() {
      return VNDB_ID_RE.test(this.vndbSearchText.trim());
    },

    // 重置全部搜索状态（openEdit / closeEdit / 重新选择时收敛），seq 自增丢弃 in-flight 响应
    resetVndbSearch() {
      this.vndbSearchText = '';
      this.vndbSearchResults = [];
      this.vndbSearchStatus = 'idle';
      this.vndbSearchError = '';
      this.vndbSearchOpen = false;
      this.vndbSearchActiveIndex = -1;
      this.vndbSearchSelected = null;
      this._vndbSearchSeq += 1;
      this._vndbComposing = false;
    },

    // 输入分流：^v\d+$ 直连 / ≥2 字符防抖搜索 / 其余关下拉置 idle。
    // IME 组字中（_vndbComposing）不处理，compositionend 后补一次分流。
    onVndbSearchInput() {
      if (this._vndbComposing) return;

      const text = this.vndbSearchText.trim();

      // 任何输入变更先清 vndbId 并使 in-flight 响应过期（直连模式内再回填）
      this.editForm.vndbId = '';
      this._vndbSearchSeq += 1;

      if (VNDB_ID_RE.test(text)) {
        // 直连模式：不发搜索请求，直接回填 ID
        this.editForm.vndbId = text;
        this.vndbSearchOpen = false;
        this.vndbSearchStatus = 'idle';
        this.vndbSearchResults = [];
        this.vndbSearchActiveIndex = -1;
        return;
      }

      if (text.length >= 2) {
        this.vndbSearchStatus = 'searching';
        this.vndbSearchOpen = true;
        this.vndbSearchActiveIndex = -1;
        this.debouncedVndbSearch();
        return;
      }

      this.vndbSearchOpen = false;
      this.vndbSearchStatus = 'idle';
      this.vndbSearchResults = [];
      this.vndbSearchActiveIndex = -1;
    },

    async runVndbSearch() {
      const query = this.vndbSearchText.trim();
      // 防抖等待期间输入可能已切换为直连模式或被清空
      if (VNDB_ID_RE.test(query) || query.length < 2) return;
      // 防抖等待期间用户已主动关闭下拉（Esc / 点击外部）：不重开、不发请求
      if (!this.vndbSearchOpen) return;

      const seq = ++this._vndbSearchSeq;
      this.vndbSearchStatus = 'searching';

      try {
        const res = await vndbAPI.search(query, 10);
        if (seq !== this._vndbSearchSeq) return; // 过期响应丢弃
        this.vndbSearchResults = res.data || [];
        this.vndbSearchStatus = 'done';
        this.vndbSearchActiveIndex = -1;
      } catch (error) {
        if (seq !== this._vndbSearchSeq) return;
        this.vndbSearchResults = [];
        this.vndbSearchStatus = 'error';
        // 失败内联展示于下拉区，不走 toast（避免逐击键刷屏）
        this.vndbSearchError = friendlyErrorMessage(error, t('prefix.searchFailed'));
      }
    },

    selectVndbResult(result) {
      if (!result) return;
      this.vndbSearchSelected = result;
      this.editForm.vndbId = result.id;
      this.vndbSearchOpen = false;
      this.vndbSearchResults = [];
      this.vndbSearchStatus = 'idle';
      this.vndbSearchActiveIndex = -1;
      this._vndbSearchSeq += 1; // 丢弃 in-flight 结果
    },

    // 「重新选择」：清空已选卡片回到输入态，并把焦点还给输入框
    clearVndbSelection() {
      this.resetVndbSearch();
      this.editForm.vndbId = '';
      this.$nextTick(() => this.$refs.vndbSearchInput?.focus());
    },

    closeVndbSearchDropdown() {
      this.vndbSearchOpen = false;
      this.vndbSearchActiveIndex = -1;
      this._vndbSearchSeq += 1; // PRD 竞态防护：关闭时丢弃 in-flight 结果
    },

    // ↑/↓ 移动高亮；Enter 下拉开时选中高亮项（并阻止表单提交）；
    // Esc 下拉开时仅关下拉且 stopPropagation（阻断 window 级关弹窗），关时不拦截保持关弹窗现状
    onVndbSearchKeydown(event) {
      // IME 组字中的按键（确认候选的 Enter、输入法候选导航的 ↑/↓）不参与下拉交互
      if (event.isComposing) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!this.vndbSearchOpen || this.vndbSearchResults.length === 0) return;
        event.preventDefault();
        const count = this.vndbSearchResults.length;
        if (event.key === 'ArrowDown') {
          this.vndbSearchActiveIndex = (this.vndbSearchActiveIndex + 1) % count;
        } else {
          this.vndbSearchActiveIndex = this.vndbSearchActiveIndex <= 0
            ? count - 1
            : this.vndbSearchActiveIndex - 1;
        }
        return;
      }

      if (event.key === 'Enter') {
        if (this.vndbSearchOpen) {
          event.preventDefault();
          this.selectVndbResult(this.vndbSearchResults[this.vndbSearchActiveIndex]);
        }
        return;
      }

      if (event.key === 'Escape' && this.vndbSearchOpen) {
        event.preventDefault();
        event.stopPropagation();
        this.closeVndbSearchDropdown();
      }
    },

    // 候选行元信息：厂商 · 年份（released 前 4 位为数字才显示年份）
    vndbResultMetaText(result) {
      const parts = [];
      if (result.developers?.[0]) parts.push(result.developers[0]);
      if (typeof result.released === 'string' && /^\d{4}/.test(result.released)) {
        parts.push(result.released.slice(0, 4));
      }
      return parts.join(' · ');
    },

    openEdit(vn = null) {
      // 打开即收敛搜索状态（isNew 从干净输入态开始；编辑态不渲染搜索 UI，重置无副作用）
      this.resetVndbSearch();

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
      this.resetVndbSearch();
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
      // 提交守卫：输入了名称但未点选候选（或未输入 ID）时阻止提交。
      // footer「保存」按钮在 <form> 外，HTML required 不生效，JS 守卫是唯一可靠层。
      if (this.editForm.isNew && !this.editForm.vndbId) {
        this.$store.app.addToast(t('index.vndbSearchSelectRequired'), 'error');
        return;
      }

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

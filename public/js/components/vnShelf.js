/**
 * VN Shelf 主页书架组件
 */

import { friendlyErrorMessage, vnAPI, vndbAPI } from '../api.js';
import { VN_STATUS_OPTIONS } from '../constants.js';
import { t } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { createModalGuard, debounce, formatUserPlayTime, statusBadgeLabel, statusIcon } from '../utils.js';
import { mergeVndbIntoListItem } from '../vn-list-item.js';

import { createDetailAdminActions, createDetailModal, createTagsView } from './shared.js';

// VNDB ID 直连模式判定（与 src/utils.js isValidVNDBId 同口径）
const VNDB_ID_RE = /^v\d+$/;

// 渲染窗口化：x-for 只渲染 filteredList 的前 visibleCount 条（首页私有常量，
// 不进 constants.js——那里只放跨端共享约定）。30 条约覆盖 1.5 个桌面首屏。
const RENDER_PAGE_SIZE = 30;
// 自动追加预算：用尽后转「加载更多」手动按钮，保证 footer 可被抵达（无限滚动与页脚的冲突解）
const AUTO_LOAD_BUDGET = 2;

export function vnShelf() {
  return {
    ...createTagsView(),
    ...createDetailModal(),
    ...createDetailAdminActions(),

    // 详情弹窗页脚「编辑」按钮开关（统一模板 detail-modal.js 引用）：
    // 编辑表单仅书架页提供；tier 页编辑注入另立后续任务
    detailCanEdit: true,

    vnList: [],
    filteredList: [],
    searchQuery: '',
    sortBy: 'created_desc',
    statusFilter: 'all',
    isLoading: true,
    showEdit: false,
    editForm: {},
    // 编辑弹窗生命周期守卫（滚动锁 + 焦点陷阱）
    _editModalGuard: createModalGuard(),
    _initialized: false,

    // ===== 渲染窗口化（哨兵自动追加 + 手动「加载更多」）=====
    visibleCount: RENDER_PAGE_SIZE,
    autoLoadsLeft: AUTO_LOAD_BUDGET,
    _renderObserver: null,

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
      // 列表就绪后再挂哨兵：此时 Alpine 已完成首轮 DOM walk，$refs 保证可用；
      // IO 在 observe 时会立即回报一次当前交叉状态，超高首屏靠它 + 复检链自动补窗
      this.setupRenderSentinel();
    },

    // x-for 数据源：filteredList 的窗口切片（getter 由 Alpine 响应式追踪依赖）
    get visibleList() {
      return this.filteredList.slice(0, this.visibleCount);
    },

    get hasMore() {
      return this.filteredList.length > this.visibleCount;
    },

    // 计数文本仅在一窗装不下时出现（R4：≤一窗时哨兵/按钮/计数均不渲染）
    get showRenderStats() {
      return this.filteredList.length > RENDER_PAGE_SIZE;
    },

    // 窗口重置点：loadVNList（含增删改后重载）/ handleSearch /
    // handleStatusFilterChange / handleSortChange 四处显式调用，保持可 grep。
    // applyDetailEntryUpdated（单条目就地刷新）有意不重置，保留滚动位置与已展开窗口。
    resetRenderWindow() {
      this.visibleCount = RENDER_PAGE_SIZE;
      this.autoLoadsLeft = AUTO_LOAD_BUDGET;
    },

    // 「加载更多」按钮：手动追加一窗并恢复自动预算
    loadMore() {
      this.visibleCount += RENDER_PAGE_SIZE;
      this.autoLoadsLeft = AUTO_LOAD_BUDGET;
      this.$nextTick(() => this.recheckRenderSentinel());
    },

    setupRenderSentinel() {
      // 无 IntersectionObserver 的环境降级为全量渲染（R6）
      if (!('IntersectionObserver' in window)) {
        this.visibleCount = Infinity;
        return;
      }
      // rootMargin 预取：哨兵距视口底 400px 即触发，滚动到底前完成追加
      this._renderObserver = new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) {
          this.autoAppendRenderPage();
        }
      }, { rootMargin: '400px' });
      if (this.$refs.renderSentinel) {
        this._renderObserver.observe(this.$refs.renderSentinel);
      }
    },

    autoAppendRenderPage() {
      if (!this.hasMore || this.autoLoadsLeft <= 0) return;
      this.visibleCount += RENDER_PAGE_SIZE;
      this.autoLoadsLeft -= 1;
      // IO 仅在交叉状态跳变时触发：追加后哨兵若仍在视口内（未离开过）不会自动
      // 再触发，故每次追加后手动复检一次（短列表/超高视口边界兜底）
      this.$nextTick(() => this.recheckRenderSentinel());
    },

    recheckRenderSentinel() {
      const el = this.$refs.renderSentinel;
      if (!el || !this.hasMore || this.autoLoadsLeft <= 0) return;
      // x-show 隐藏（hasMore=false）时 getBoundingClientRect 全零，但上面的
      // hasMore 守卫已先行拦截，此处元素必为可见态
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 400) {
        this.autoAppendRenderPage();
      }
    },

    async loadVNList() {
      this.isLoading = true;
      try {
        // 管理员传 no-store 绕过浏览器 HTTP 缓存（访客态副本写后可能陈旧 60s），
        // 访客路径不动：继续吃浏览器 + 边缘两层缓存
        const res = await vnAPI.getList(
          { sort: this.sortBy },
          this.$store.app.isAdmin ? { cache: 'no-store' } : {}
        );
        this.vnList = res.data || [];
        this.filteredList = this.applyFilters(this.vnList);
        this.resetRenderWindow();
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
      this.resetRenderWindow();
    },

    handleStatusFilterChange() {
      this.filteredList = this.applyFilters(this.vnList);
      this.resetRenderWindow();
    },

    // 状态徽章文案/图标：共享层导出（utils.js），卡片与详情弹窗两页同口径
    statusBadgeLabel,
    statusIcon,

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
      this.resetRenderWindow();
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
      this._editModalGuard.open();
      this.showEdit = true;

      if (this.showDetail) {
        // 从详情跳转到编辑：释放详情守卫（但不走 closeDetail，避免清空 selectedVN
        // 进而破坏编辑模态内 getDisplayTags(selectedVN || editForm) 的标签展示）
        this.showDetail = false;
        this._detailModalGuard.close();
      }

      this.$nextTick(() => {
        this._editModalGuard.trap(this.$refs.editModal);
      });
    },

    closeEdit() {
      if (!this.showEdit) return;
      this.showEdit = false;
      this.editForm = {};
      this.resetVndbSearch();
      this._editModalGuard.close();
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

    // ===== 详情管理员动作宿主钩子（覆盖 createDetailAdminActions 空实现）=====

    // 单条目 VNDB 刷新后就地替换列表项（仅 VNDB 派生字段，vn-list-item.js 投影）。
    // 排序不就地重排（避免卡片跳位）；搜索/状态筛选重放，标题变化导致不再匹配时卡片会消失；
    // 有意不 resetRenderWindow（保留滚动位置与已展开窗口）。已打开详情弹窗的同步由 mixin 统一处理。
    applyDetailEntryUpdated(entry) {
      if (!entry?.id) return;
      const idx = this.vnList.findIndex(item => item.id === entry.id);
      if (idx !== -1) {
        this.vnList[idx] = mergeVndbIntoListItem(this.vnList[idx], entry);
        this.filteredList = this.applyFilters(this.vnList);
      }
    },

    // 删除后整表重载（既有行为：loadVNList 语义上耦合渲染窗口重置，删除后回到列表态可接受）
    async applyDetailEntryRemoved() {
      await this.loadVNList();
    },

    renderMarkdown
  };
}

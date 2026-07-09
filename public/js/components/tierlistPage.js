/**
 * VN Shelf Tier List 页组件
 */

import { friendlyErrorMessage, vnAPI, tierAPI } from '../api.js';
import { UNTIERED_KEY, DEFAULT_TIER_COLOR, MAX_BATCH_TIER_UPDATES } from '../constants.js';
import { t } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { computeTierDiff } from '../tier-diff.js';
import { formatUserPlayTime, lockPageScroll, trapFocus, unlockPageScroll } from '../utils.js';

import { createDetailModal, createTagsView } from './shared.js';

export function tierlistPage() {
  return {
    ...createTagsView(),
    ...createDetailModal(),

    tiers: [],
    allVN: [],
    tieredVN: {},
    untieredVN: [],
    isLoading: true,

    showTierEdit: false,
    editingTier: null,
    tierForm: {
      name: '',
      color: DEFAULT_TIER_COLOR
    },
    isSavingTier: false,

    draggedVN: null,
    dragOverTierId: null,
    dropIndicatorTierKey: null,
    dropIndicatorIndex: null,
    // 键盘拖拽状态：与鼠标拖拽互斥（共用 draggedVN/dropIndicator* 状态机）。
    // keyboardDragging=true 期间 onDragStart（鼠标）早退；反之鼠标拖拽期间 onCardKeydown 抓取早退。
    keyboardDragging: false,
    keyboardGrabbedVN: null,

    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.setupTranslationsRefresh();
      this.isLoading = true;
      try {
        await this.loadConfig();
        await this.initTranslations();

        const [tierLoaded, vnLoaded] = await Promise.all([
          this.loadTiers({ silent: true }),
          this.loadVNList({ silent: true })
        ]);

        if (!tierLoaded || !vnLoaded) {
          this.$store.app.addToast(t('toast.tierPageLoadFailed'), 'error');
        }
      } finally {
        this.isLoading = false;
      }
    },

    async loadTiers({ silent = false } = {}) {
      try {
        const res = await tierAPI.getList();
        this.tiers = Array.isArray(res.data)
          ? [...res.data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          : [];
        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        return true;
      } catch (error) {
        this.tiers = [];
        this.rebuildTierGroups();
        if (!silent) {
          this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadTierListFailed')), 'error');
        }
        return false;
      }
    },

    async loadVNList({ silent = false } = {}) {
      try {
        const res = await vnAPI.getList();
        this.allVN = Array.isArray(res.data) ? res.data : [];
        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        return true;
      } catch (error) {
        this.allVN = [];
        this.rebuildTierGroups();
        if (!silent) {
          this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadVnListFailed')), 'error');
        }
        return false;
      }
    },

    normalizeTierSortForAllVN() {
      const groupedByTierId = new Map();

      for (const vn of this.allVN) {
        const tierId = vn?.tierId || null;
        if (!tierId) continue;

        if (!groupedByTierId.has(tierId)) {
          groupedByTierId.set(tierId, []);
        }
        groupedByTierId.get(tierId).push(vn);
      }

      for (const [tierId, items] of groupedByTierId.entries()) {
        const validTier = this.tiers.some(item => item.id === tierId);
        if (!validTier) continue;

        items.sort((a, b) => {
          const aSort = Number.isFinite(Number(a?.tierSort)) ? Number(a.tierSort) : Number.MAX_SAFE_INTEGER;
          const bSort = Number.isFinite(Number(b?.tierSort)) ? Number(b.tierSort) : Number.MAX_SAFE_INTEGER;
          if (aSort !== bSort) return aSort - bSort;
          return (a?.createdAt || '').localeCompare(b?.createdAt || '');
        });

        items.forEach((vn, index) => {
          vn.tierSort = index;
        });
      }
    },

    rebuildTierGroups() {
      const grouped = {};
      for (const tier of this.tiers) {
        grouped[tier.id] = [];
      }

      const untiered = [];
      for (const vn of this.allVN) {
        if (vn?.tierId && grouped[vn.tierId]) {
          grouped[vn.tierId].push(vn);
        } else {
          untiered.push(vn);
        }
      }

      for (const tierId of Object.keys(grouped)) {
        grouped[tierId].sort((a, b) => {
          const aSort = Number.isFinite(Number(a?.tierSort)) ? Number(a.tierSort) : Number.MAX_SAFE_INTEGER;
          const bSort = Number.isFinite(Number(b?.tierSort)) ? Number(b.tierSort) : Number.MAX_SAFE_INTEGER;
          if (aSort !== bSort) return aSort - bSort;
          return (a?.createdAt || '').localeCompare(b?.createdAt || '');
        });
      }

      this.tieredVN = grouped;
      this.untieredVN = untiered;
    },

    getTierItems(tierId) {
      return this.tieredVN[tierId] || [];
    },

    resolveTierKey(tierId) {
      return tierId || UNTIERED_KEY;
    },

    getItemsByTierKey(tierKey) {
      if (tierKey === UNTIERED_KEY) {
        return this.untieredVN || [];
      }
      return this.tieredVN[tierKey] || [];
    },

    clearDropIndicator() {
      this.dropIndicatorTierKey = null;
      this.dropIndicatorIndex = null;
    },

    isDropBefore(tierId, index) {
      return this.dropIndicatorTierKey === this.resolveTierKey(tierId) && this.dropIndicatorIndex === index;
    },

    isDropAtEnd(tierId) {
      const tierKey = this.resolveTierKey(tierId);
      const items = this.getItemsByTierKey(tierKey);
      return this.dropIndicatorTierKey === tierKey && this.dropIndicatorIndex === items.length && items.length > 0;
    },

    openCreateTier() {
      this.editingTier = null;
      this.tierForm = {
        name: '',
        color: DEFAULT_TIER_COLOR
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
      this._trapTierEdit();
    },

    openTierEdit(tier) {
      this.editingTier = tier;
      this.tierForm = {
        name: tier?.name || '',
        color: tier?.color || DEFAULT_TIER_COLOR
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
      this._trapTierEdit();
    },

    _trapTierEdit() {
      this.$nextTick(() => {
        if (this.$refs.tierEditModal) {
          this._tierEditTrapRelease = trapFocus(this.$refs.tierEditModal);
        }
      });
    },

    closeTierEdit() {
      if (!this.showTierEdit) return;
      this.showTierEdit = false;
      this.editingTier = null;
      if (this._tierEditTrapRelease) {
        try {
          this._tierEditTrapRelease();
        } catch {
          // 释放焦点陷阱失败时静默降级
        }
        this._tierEditTrapRelease = null;
      }
      unlockPageScroll();
    },

    async saveTier() {
      const name = (this.tierForm.name || '').trim();
      const color = (this.tierForm.color || '').trim();

      if (!name) {
        this.$store.app.addToast(t('validation.tierNameRequired'), 'error');
        return;
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        this.$store.app.addToast(t('validation.tierColorFormat'), 'error');
        return;
      }

      this.isSavingTier = true;
      try {
        if (this.editingTier?.id) {
          await tierAPI.update(this.editingTier.id, { name, color });
          this.$store.app.addToast(t('toast.tierUpdated'));
        } else {
          await tierAPI.create({ name, color });
          this.$store.app.addToast(t('toast.tierCreated'));
        }

        await this.loadTiers();
        this.closeTierEdit();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.saveTierFailed')), 'error');
      } finally {
        this.isSavingTier = false;
      }
    },

    async deleteTier(id) {
      const ok = await this.$store.app.confirm({
        title: t('confirm.deleteTierTitle'),
        message: t('confirm.deleteTierMessage'),
        confirmText: t('confirm.deleteAction'),
        danger: true
      });
      if (!ok) return;

      try {
        await tierAPI.delete(id);
        this.$store.app.addToast(t('toast.tierDeleted'));
        await Promise.all([this.loadTiers(), this.loadVNList()]);
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.deleteTierFailed')), 'error');
      }
    },

    async moveTier(tierId, direction) {
      const index = this.tiers.findIndex(item => item.id === tierId);
      if (index < 0) return;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= this.tiers.length) return;

      const nextTiers = [...this.tiers];
      const [moved] = nextTiers.splice(index, 1);
      nextTiers.splice(nextIndex, 0, moved);

      try {
        await tierAPI.updateOrder(nextTiers.map(item => item.id));
        this.tiers = nextTiers;
        this.rebuildTierGroups();
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.updateOrderFailed')), 'error');
      }
    },

    onDragStart(vn, event) {
      if (!this.$store.app.isAdmin) return;
      // 键盘拖拽进行中时不抢鼠标拖拽，避免两条路径同时摆弄 draggedVN/dropIndicator
      if (this.keyboardDragging) return;
      this.draggedVN = vn;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', vn.id);
    },

    onDragEnd() {
      // 鼠标拖拽结束清状态；键盘路径由 resetKeyboardDrag 单独管理
      if (this.keyboardDragging) return;
      this.draggedVN = null;
      this.dragOverTierId = null;
      this.clearDropIndicator();
    },

    // =========== 键盘拖拽（K1） ============

    /**
     * VN 当前所属 tier id（null 表示未分类）。
     * @param {Object} vn
     * @returns {string|null}
     */
    vnTierId(vn) {
      return vn?.tierId || null;
    },

    /**
     * VN 在其当前 tier 列表中的全帧索引（含被拖拽项本身）。
     * @param {Object} vn
     * @returns {number}
     */
    currentIndexOf(vn) {
      const tierKey = this.resolveTierKey(this.vnTierId(vn));
      const items = this.getItemsByTierKey(tierKey);
      return items.findIndex(item => item.id === vn?.id);
    },

    /**
     * 键盘可跨 tier 导航的有序 tier key 列表：tiers 顺序 + 末尾未分类。
     * @returns {string[]}
     */
    orderedTierKeys() {
      return [...this.tiers.map(t => t.id), UNTIERED_KEY];
    },

    /**
     * 将键盘 dropIndicator 的“全帧索引”转换为 applyDrop 期望的“去掉被拖拽项”帧索引。
     * 仅当被拖拽项与指示器同 tier 时需要扣 1（跨 tier 时两帧相等）。
     * @param {string} tierKey
     * @param {number} fullIndex
     * @returns {number}
     */
    keyboardFullToWithoutFrame(tierKey, fullIndex) {
      const items = this.getItemsByTierKey(tierKey);
      const draggedId = this.keyboardGrabbedVN?.id || this.draggedVN?.id;
      const draggedFullIndex = items.findIndex(item => item.id === draggedId);
      if (draggedFullIndex < 0 || fullIndex <= draggedFullIndex) {
        return fullIndex;
      }
      return fullIndex - 1;
    },

    /**
     * 跨 tier 移动键盘 dropIndicator：向下到下一 tier 顶部（index=0），
     * 向上到上一 tier 底部（index=items.length）。
     * @param {number} direction - -1=上移、+1=下移
     */
    moveKeyboardDropToNeighborTier(direction) {
      const keys = this.orderedTierKeys();
      const currentIdx = keys.indexOf(this.dropIndicatorTierKey);
      if (currentIdx < 0) return;
      const nextIdx = Math.max(0, Math.min(keys.length - 1, currentIdx + direction));
      if (nextIdx === currentIdx) return;
      const nextKey = keys[nextIdx];
      const nextItems = this.getItemsByTierKey(nextKey);
      this.dropIndicatorTierKey = nextKey;
      // 下移落到下一 tier 顶部、上移落到上一 tier 底部，符合垂直位置语义
      this.dropIndicatorIndex = direction > 0 ? 0 : nextItems.length;
    },

    /**
     * 重置键盘拖拽状态（取消或确认后调用）。
     */
    resetKeyboardDrag() {
      this.keyboardDragging = false;
      this.keyboardGrabbedVN = null;
      this.draggedVN = null;
      this.clearDropIndicator();
    },

    /**
     * 确认键盘落点：捕获当前指示器位置后重置状态，再走与鼠标 onDrop 同一 applyDrop 提交路径。
     */
    confirmKeyboardDrop() {
      const tierKey = this.dropIndicatorTierKey;
      const fullIndex = this.dropIndicatorIndex;
      const draggedId = this.keyboardGrabbedVN?.id;
      this.resetKeyboardDrag();
      if (!draggedId || !tierKey || !Number.isFinite(Number(fullIndex))) return;
      const insertIndex = this.keyboardFullToWithoutFrame(tierKey, Number(fullIndex));
      // applyDrop 内部自带 catch + 失败回滚 loadVNList，无需在此 await
      this.applyDrop(draggedId, tierKey, insertIndex);
    },

    /**
     * 卡片键盘交互：
     * - Enter：抓取 / 再按确认落点（重排）
     * - Space：抓取态下确认落点；非抓取态放行原生 click 打开详情（保留键盘查看详情能力）
     * - ArrowLeft/Right：抓取态同 tier 内移动 dropIndicator
     * - ArrowUp/Down：抓取态跨 tier 移动 dropIndicator
     * - Escape：抓取态取消
     *
     * 与鼠标拖拽互斥：鼠标拖拽中（draggedVN 已置且非键盘态）抓取早退。
     * @param {Object} vn
     * @param {KeyboardEvent} event
     */
    onCardKeydown(vn, event) {
      if (!this.$store.app.isAdmin) return;
      // 鼠标拖拽进行中时不抢键盘抓取
      if (this.draggedVN && !this.keyboardDragging) {
        // 仅处理 Esc 以防意外，其余键交由原生
        return;
      }

      switch (event.key) {
        case 'Enter': {
          event.preventDefault();
          if (!this.keyboardDragging) {
            this.keyboardDragging = true;
            this.keyboardGrabbedVN = vn;
            this.draggedVN = vn;
            // 初始 dropIndicator 落在 vn 当前位置（全帧索引）
            this.dropIndicatorTierKey = this.resolveTierKey(this.vnTierId(vn));
            this.dropIndicatorIndex = Math.max(0, this.currentIndexOf(vn));
          } else {
            this.confirmKeyboardDrop();
          }
          break;
        }
        case ' ': {
          if (this.keyboardDragging) {
            event.preventDefault();
            this.confirmKeyboardDrop();
          }
          // 非抓取态：不 preventDefault，让原生 click 触发 openDetail，保留键盘查看详情
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!this.keyboardDragging) return;
          event.preventDefault();
          const items = this.getItemsByTierKey(this.dropIndicatorTierKey);
          const delta = event.key === 'ArrowLeft' ? -1 : 1;
          // 全帧索引在 [0, items.length] 间夹逼；applyDrop 会再夹到 without-frame
          this.dropIndicatorIndex = Math.max(0, Math.min(items.length, this.dropIndicatorIndex + delta));
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!this.keyboardDragging) return;
          event.preventDefault();
          this.moveKeyboardDropToNeighborTier(event.key === 'ArrowUp' ? -1 : 1);
          break;
        }
        case 'Escape': {
          if (this.keyboardDragging) {
            event.preventDefault();
            this.resetKeyboardDrag();
          }
          break;
        }
        default:
          break;
      }
    },

    onDragOver(tierId, event) {
      if (!this.$store.app.isAdmin) return;
      event.preventDefault();
      this.dragOverTierId = tierId;
      event.dataTransfer.dropEffect = 'move';

      const draggedId = this.draggedVN?.id || event.dataTransfer.getData('text/plain');
      const tierKey = this.resolveTierKey(tierId);
      const originalItems = this.getItemsByTierKey(tierKey);
      const itemsWithoutDragged = originalItems.filter(item => item.id !== draggedId);
      const draggedIndex = originalItems.findIndex(item => item.id === draggedId);

      let insertIndex = itemsWithoutDragged.length;
      const targetCard = event.target?.closest?.('.tier-vn-card');
      // 命中子元素或卡片未注 data-vn-id 时 targetId 为 null → 兑底到当前 tier 末尾
      // （下方 insertIndex 未被覆盖即保持 itemsWithoutDragged.length）。
      const targetId = targetCard?.dataset?.vnId || null;

      if (targetId) {
        const targetIndex = originalItems.findIndex(item => item.id === targetId);
        if (targetIndex >= 0) {
          const rect = targetCard.getBoundingClientRect();
          const isBefore = (event.clientX - rect.left) < rect.width / 2;
          insertIndex = isBefore ? targetIndex : targetIndex + 1;

          if (draggedIndex >= 0 && draggedIndex < insertIndex) {
            insertIndex -= 1;
          }
        }
      }

      this.dropIndicatorTierKey = tierKey;
      this.dropIndicatorIndex = Math.max(0, Math.min(insertIndex, itemsWithoutDragged.length));
    },

    onDragLeave(tierId, event) {
      const currentTarget = event.currentTarget;
      const relatedTarget = event.relatedTarget;
      if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }

      if (this.dragOverTierId === tierId) {
        this.dragOverTierId = null;
      }

      const tierKey = this.resolveTierKey(tierId);
      if (this.dropIndicatorTierKey === tierKey) {
        this.clearDropIndicator();
      }
    },

    async applyTierBatchUpdates(payloads) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return;
      }

      // 分片：扁平 payloads 列表按 MAX_BATCH_TIER_UPDATES 切片，各 chunk 互不相交，
      // 并行提交安全；顺序语义上各片独立落库，最终全片结果一致。
      const chunks = [];
      for (let i = 0; i < payloads.length; i += MAX_BATCH_TIER_UPDATES) {
        chunks.push(payloads.slice(i, i + MAX_BATCH_TIER_UPDATES));
      }
      // 任一 chunk 失败即 reject 整体 Promise，调用方（applyDrop）catch 触发 loadVNList 回滚，
      // 行为与原串行版一致（串行任一失败同样 reject）。
      await Promise.all(chunks.map(chunk => vnAPI.batchUpdateTier(chunk)));
    },

    /**
     * 提交一次 Tier 拖拽/键盘落点：计算 diff、批量提交、本地状态同步、失败回滚。
     * 鼠标 onDrop 与键盘 applyDrop（Step 4）共用，保证两条路径提交语义一致。
     *
     * 调用方负责在结束后清理 draggedVN / dropIndicator（鼠标走 onDrop.finally，
     * 键盘走 resetKeyboardDrag）。
     *
     * @param {string} draggedId - 被移动的 VN id
     * @param {string} targetTierKey - 目标 tier key（UNTIERED_KEY 或 tier.id）
     * @param {number|undefined} insertIndex - 期望插入位置；undefined 时兑底到末尾
     */
    async applyDrop(draggedId, targetTierKey, insertIndex) {
      // diff 计算抽离为纯函数 computeTierDiff（见 public/js/tier-diff.js），便于单测。
      // 此处只负责提交、本地状态同步与失败回滚。
      const payloads = computeTierDiff({ allVN: this.allVN, draggedId, targetTierKey, insertIndex });
      if (payloads.length === 0) {
        return;
      }

      try {
        await this.applyTierBatchUpdates(payloads);

        for (const payload of payloads) {
          const localEntry = this.allVN.find(item => item.id === payload.id);
          if (localEntry) {
            localEntry.tierId = payload.tierId;
            if (payload.tierSort !== undefined) {
              localEntry.tierSort = payload.tierSort;
            } else if (!payload.tierId) {
              localEntry.tierSort = 0;
            }
          }
        }

        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        this.$store.app.addToast(t('toast.tierOrderUpdated'));
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.dragUpdateFailed')), 'error');
        await this.loadVNList({ silent: true });
      }
    },

    async onDrop(tierId, event) {
      if (!this.$store.app.isAdmin) return;

      event.preventDefault();
      const draggedId = this.draggedVN?.id || event.dataTransfer.getData('text/plain');
      this.dragOverTierId = null;

      if (!draggedId) return;

      const targetTierKey = this.resolveTierKey(tierId);
      const insertIndex = this.dropIndicatorTierKey === targetTierKey &&
        Number.isFinite(Number(this.dropIndicatorIndex))
        ? Number(this.dropIndicatorIndex)
        : undefined;

      try {
        await this.applyDrop(draggedId, targetTierKey, insertIndex);
      } finally {
        this.draggedVN = null;
        this.clearDropIndicator();
      }
    },

    async onDropToUntiered(event) {
      await this.onDrop(null, event);
    },

    formatUserPlayTime,

    renderMarkdown
  };
}

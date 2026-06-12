/**
 * VN Shelf Tier List 页组件
 */

import { vnAPI, tierAPI } from '../api.js';
import { renderMarkdown } from '../markdown.js';
import { formatUserPlayTime, lockPageScroll, unlockPageScroll } from '../utils.js';

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
      color: '#ff4757'
    },
    isSavingTier: false,

    draggedVN: null,
    dragOverTierId: null,
    dropIndicatorTierKey: null,
    dropIndicatorIndex: null,

    MAX_BATCH_TIER_UPDATES: 200,
    _initialized: false,

    getErrorMessage(error) {
      return error?.message || '未知错误';
    },

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
          this.$store.app.addToast('加载 Tier 页面数据失败，请稍后重试', 'error');
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
          this.$store.app.addToast('加载 Tier 列表失败: ' + this.getErrorMessage(error), 'error');
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
          this.$store.app.addToast('加载 VN 列表失败: ' + this.getErrorMessage(error), 'error');
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
      return tierId || '__untiered__';
    },

    getItemsByTierKey(tierKey) {
      if (tierKey === '__untiered__') {
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
        color: '#ff4757'
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
    },

    openTierEdit(tier) {
      this.editingTier = tier;
      this.tierForm = {
        name: tier?.name || '',
        color: tier?.color || '#ff4757'
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
    },

    closeTierEdit() {
      if (!this.showTierEdit) return;
      this.showTierEdit = false;
      this.editingTier = null;
      unlockPageScroll();
    },

    async saveTier() {
      const name = (this.tierForm.name || '').trim();
      const color = (this.tierForm.color || '').trim();

      if (!name) {
        this.$store.app.addToast('Tier 名称不能为空', 'error');
        return;
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        this.$store.app.addToast('Tier 颜色必须是 #RRGGBB 格式', 'error');
        return;
      }

      this.isSavingTier = true;
      try {
        if (this.editingTier?.id) {
          await tierAPI.update(this.editingTier.id, { name, color });
          this.$store.app.addToast('Tier 已更新');
        } else {
          await tierAPI.create({ name, color });
          this.$store.app.addToast('Tier 已创建');
        }

        await this.loadTiers();
        this.closeTierEdit();
      } catch (error) {
        this.$store.app.addToast('保存 Tier 失败: ' + error.message, 'error');
      } finally {
        this.isSavingTier = false;
      }
    },

    async deleteTier(id) {
      if (!confirm('删除该 Tier 后，其下条目将变为未分类。确定删除？')) return;

      try {
        await tierAPI.delete(id);
        this.$store.app.addToast('Tier 已删除');
        await Promise.all([this.loadTiers(), this.loadVNList()]);
      } catch (error) {
        this.$store.app.addToast('删除 Tier 失败: ' + error.message, 'error');
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
        this.$store.app.addToast('更新排序失败: ' + error.message, 'error');
      }
    },

    onDragStart(vn, event) {
      if (!this.$store.app.isAdmin) return;
      this.draggedVN = vn;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', vn.id);
    },

    onDragEnd() {
      this.draggedVN = null;
      this.dragOverTierId = null;
      this.clearDropIndicator();
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

      for (let index = 0; index < payloads.length; index += this.MAX_BATCH_TIER_UPDATES) {
        const chunk = payloads.slice(index, index + this.MAX_BATCH_TIER_UPDATES);
        await vnAPI.batchUpdateTier(chunk);
      }
    },

    async onDrop(tierId, event) {
      if (!this.$store.app.isAdmin) return;

      event.preventDefault();
      const draggedId = this.draggedVN?.id || event.dataTransfer.getData('text/plain');
      this.dragOverTierId = null;

      if (!draggedId) return;

      const vn = this.allVN.find(item => item.id === draggedId);
      if (!vn) return;

      const targetTierKey = this.resolveTierKey(tierId);
      const targetTierId = targetTierKey === '__untiered__' ? null : targetTierKey;
      const sourceTierId = vn.tierId || null;
      const sourceTierKey = this.resolveTierKey(sourceTierId);
      const orderedTargetItems = [...this.getItemsByTierKey(targetTierKey)];

      let insertIndex = this.dropIndicatorTierKey === targetTierKey && Number.isFinite(Number(this.dropIndicatorIndex))
        ? Number(this.dropIndicatorIndex)
        : orderedTargetItems.filter(item => item.id !== draggedId).length;

      const payloadMap = new Map();
      const addPayload = (id, nextTierId, nextTierSort = undefined) => {
        if (typeof id !== 'string' || !id) return;
        payloadMap.set(id, { id, tierId: nextTierId, tierSort: nextTierSort });
      };

      const collectReorderDiff = (beforeItems, afterItems, tierIdForItems) => {
        const beforeIndexMap = new Map(beforeItems.map((item, index) => [item.id, index]));
        afterItems.forEach((item, index) => {
          const prevIndex = beforeIndexMap.get(item.id);
          if (prevIndex !== index) {
            addPayload(item.id, tierIdForItems, index);
          }
        });
      };

      if (!targetTierId) {
        if (sourceTierId !== null) {
          addPayload(draggedId, null, undefined);

          const sourceBefore = [...this.getItemsByTierKey(sourceTierKey)];
          const sourceAfter = sourceBefore.filter(item => item.id !== draggedId);
          collectReorderDiff(sourceBefore, sourceAfter, sourceTierId);
        }
      } else {
        const targetBefore = [...orderedTargetItems];
        const targetAfter = orderedTargetItems.filter(item => item.id !== draggedId);

        insertIndex = Math.max(0, Math.min(insertIndex, targetAfter.length));
        targetAfter.splice(insertIndex, 0, vn);

        const nextOrderIds = targetAfter.map(item => item.id);
        const prevOrderIds = targetBefore.map(item => item.id);
        const sameOrder = sourceTierId === targetTierId &&
          nextOrderIds.length === prevOrderIds.length &&
          nextOrderIds.every((id, idx) => id === prevOrderIds[idx]);

        if (sameOrder) {
          this.draggedVN = null;
          this.clearDropIndicator();
          return;
        }

        collectReorderDiff(targetBefore, targetAfter, targetTierId);

        if (sourceTierId && sourceTierId !== targetTierId) {
          const sourceBefore = [...this.getItemsByTierKey(sourceTierKey)];
          const sourceAfter = sourceBefore.filter(item => item.id !== draggedId);
          collectReorderDiff(sourceBefore, sourceAfter, sourceTierId);
        }
      }

      const payloads = Array.from(payloadMap.values());

      try {
        if (payloads.length === 0) {
          return;
        }

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
        this.$store.app.addToast('Tier 顺序更新成功');
      } catch (error) {
        this.$store.app.addToast('拖拽更新失败: ' + this.getErrorMessage(error), 'error');
        await this.loadVNList({ silent: true });
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

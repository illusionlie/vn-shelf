/**
 * 纯函数：根据拖拽落点计算 Tier 批量更新 payloads。
 *
 * 从 `tierlistPage.applyDrop` 抽离，无 `this`、无 API 调用、无副作用，
 * 便于单测覆盖（同 tier 排序 / 跨 tier 移动 / 移到 untiered / 边界 / 批量超 200）。
 *
 * 分组语义对齐 `tierlistPage.rebuildTierGroups` + `getItemsByTierKey`：
 * 按 `tierId` 分桶（null/undefined → untiered），各 tier 桶按 (tierSort, createdAt) 排序。
 * 依赖后端不变量“删除 Tier 时先清空条目归属”——不存在孤立 tierId，故按 tierId 直接分桶
 * 与 `getItemsByTierKey`（仅对 this.tiers 内 tier 建桶）在可达状态下等价。
 */

import { UNTIERED_KEY } from './constants.js';

/**
 * @param {{allVN: Array<{id: string, tierId?: string|null, tierSort?: number, createdAt?: string}>, draggedId: string, targetTierKey: string, insertIndex?: number}} args
 * @returns {Array<{id: string, tierId: string|null, tierSort?: number}>} payloads
 */
export function computeTierDiff({ allVN, draggedId, targetTierKey, insertIndex }) {
  const vn = allVN.find(item => item.id === draggedId);
  if (!vn) return [];

  const { grouped, untiered } = groupItemsByTier(allVN);
  const resolveTierKey = (tierId) => tierId || UNTIERED_KEY;
  const itemsByKey = (tierKey) =>
    tierKey === UNTIERED_KEY ? untiered : (grouped.get(tierKey) || []);

  const targetTierId = targetTierKey === UNTIERED_KEY ? null : targetTierKey;
  const sourceTierId = vn.tierId || null;
  const sourceTierKey = resolveTierKey(sourceTierId);
  const orderedTargetItems = [...itemsByKey(targetTierKey)];

  if (insertIndex === undefined || !Number.isFinite(Number(insertIndex))) {
    insertIndex = orderedTargetItems.filter(item => item.id !== draggedId).length;
  }

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
    // 移到未分类：仅改 draggedId 归属 + 重排源 tier；不重排 untiered 本身。
    if (sourceTierId !== null) {
      addPayload(draggedId, null, undefined);

      const sourceBefore = [...itemsByKey(sourceTierKey)];
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

    if (sameOrder) return [];

    collectReorderDiff(targetBefore, targetAfter, targetTierId);

    if (sourceTierId && sourceTierId !== targetTierId) {
      const sourceBefore = [...itemsByKey(sourceTierKey)];
      const sourceAfter = sourceBefore.filter(item => item.id !== draggedId);
      collectReorderDiff(sourceBefore, sourceAfter, sourceTierId);
    }
  }

  return Array.from(payloadMap.values());
}

/**
 * 按 tierId 分桶并排序，对齐 rebuildTierGroups 语义。
 * @param {Array} allVN
 * @returns {{grouped: Map<string, Array>, untiered: Array}}
 */
function groupItemsByTier(allVN) {
  const grouped = new Map();
  const untiered = [];
  for (const vn of allVN) {
    const tierId = vn?.tierId || null;
    if (tierId) {
      if (!grouped.has(tierId)) grouped.set(tierId, []);
      grouped.get(tierId).push(vn);
    } else {
      untiered.push(vn);
    }
  }
  for (const items of grouped.values()) items.sort(sortByTierSort);
  // untiered 不参与 reorder diff（移入/移出 untiered 均不重排 untiered），保持原序即可。
  return { grouped, untiered };
}

function sortByTierSort(a, b) {
  const aSort = Number.isFinite(Number(a?.tierSort)) ? Number(a.tierSort) : Number.MAX_SAFE_INTEGER;
  const bSort = Number.isFinite(Number(b?.tierSort)) ? Number(b.tierSort) : Number.MAX_SAFE_INTEGER;
  if (aSort !== bSort) return aSort - bSort;
  return (a?.createdAt || '').localeCompare(b?.createdAt || '');
}

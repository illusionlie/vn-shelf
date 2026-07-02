import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTierDiff } from '../../public/js/tier-diff.js';
import { UNTIERED_KEY, MAX_BATCH_TIER_UPDATES } from '../../public/js/constants.js';

/**
 * 构造一个 VN 条目。
 * @param {string} id
 * @param {string|null} tierId
 * @param {number} tierSort
 * @param {string} [createdAt]
 */
function vn(id, tierId, tierSort, createdAt = `2024-01-0${(tierSort % 9) + 1}T00:00:00.000Z`) {
  return { id, tierId, tierSort, createdAt };
}

/** 按 id 顺序提取 payloads 的 tierSort，便于断言。 */
function sortById(payloads) {
  return [...payloads].sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ============ 1. 同 tier 内排序 ============

test('同 tier 内把末位拖到首位：三个条目都得到新 tierSort', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1),
    vn('v3', 'tier-a', 2)
  ];

  const payloads = computeTierDiff({ allVN, draggedId: 'v3', targetTierKey: 'tier-a', insertIndex: 0 });

  // 期望顺序 [v3, v1, v2] → tierSort 0/1/2
  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  assert.equal(byId.v3.tierId, 'tier-a');
  assert.equal(byId.v3.tierSort, 0);
  assert.equal(byId.v1.tierSort, 1);
  assert.equal(byId.v2.tierSort, 2);
  assert.equal(payloads.length, 3);
});

test('同 tier 拖到原位（顺序不变）返回空 payloads', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1)
  ];

  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: 'tier-a', insertIndex: 0 });

  assert.deepEqual(payloads, []);
});

// ============ 2. 跨 tier 移动 ============

test('跨 tier 移动：被拖项改归属，目标 tier 与源 tier 各自重排', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1),
    vn('v3', 'tier-b', 0),
    vn('v4', 'tier-b', 1)
  ];

  // 把 v2 从 tier-a 拖到 tier-b 的 index=1（落在 v3 与 v4 之间）
  const payloads = computeTierDiff({ allVN, draggedId: 'v2', targetTierKey: 'tier-b', insertIndex: 1 });

  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  // v2 → tier-b tierSort 1
  assert.equal(byId.v2.tierId, 'tier-b');
  assert.equal(byId.v2.tierSort, 1);
  // v3 保持 index0 不变（无 payload），v4 从 index1→2
  assert.equal(byId.v4.tierId, 'tier-b');
  assert.equal(byId.v4.tierSort, 2);
  assert.equal(byId.v3, undefined);
  // 源 tier-a：v1 保持 index0 不变（无 payload）
  assert.equal(byId.v1, undefined);
});

// ============ 3. 移到 untiered ============

test('移到 untiered：被拖项 tierId=null tierSort=undefined，源 tier 后续条目前移', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1)
  ];

  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: UNTIERED_KEY, insertIndex: 0 });

  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  assert.equal(byId.v1.tierId, null);
  assert.equal(byId.v1.tierSort, undefined);
  // v2 从 index1→0
  assert.equal(byId.v2.tierId, 'tier-a');
  assert.equal(byId.v2.tierSort, 0);
});

test('已在 untiered 的条目拖到 untiered：无变化返回空', () => {
  const allVN = [
    vn('v1', null, 0),
    vn('v2', 'tier-a', 0)
  ];

  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: UNTIERED_KEY, insertIndex: 0 });

  assert.deepEqual(payloads, []);
});

// ============ 4. 边界：首位 / 末位 / 空 tier / undefined insertIndex ============

test('拖到 tier 末位（insertIndex 兑底到 after 长度）', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1),
    vn('v3', 'tier-a', 2)
  ];

  // v1 拖到末位
  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: 'tier-a', insertIndex: 2 });

  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  // 期望 [v2, v3, v1] → 0/1/2
  assert.equal(byId.v2.tierSort, 0);
  assert.equal(byId.v3.tierSort, 1);
  assert.equal(byId.v1.tierSort, 2);
});

test('拖到空 tier：被拖项落 index0，源 tier 后续前移', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-a', 1),
    // tier-b 为空
  ];

  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: 'tier-b', insertIndex: 0 });

  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  assert.equal(byId.v1.tierId, 'tier-b');
  assert.equal(byId.v1.tierSort, 0);
  assert.equal(byId.v2.tierId, 'tier-a');
  assert.equal(byId.v2.tierSort, 0);
});

test('undefined insertIndex 兑底到目标 tier 末尾', () => {
  const allVN = [
    vn('v1', 'tier-a', 0),
    vn('v2', 'tier-b', 0),
    vn('v3', 'tier-b', 1)
  ];

  // v1 从 tier-a 拖到 tier-b，不指定 insertIndex → 落到 tier-b 末尾
  const payloads = computeTierDiff({ allVN, draggedId: 'v1', targetTierKey: 'tier-b', insertIndex: undefined });

  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  assert.equal(byId.v1.tierId, 'tier-b');
  assert.equal(byId.v1.tierSort, 2);
  // v2/v3 保持 0/1 不变
  assert.equal(byId.v2, undefined);
  assert.equal(byId.v3, undefined);
});

// ============ 5. 批量超 200：分片边界 ============

test('批量超 200：拖动产生 >MAX_BATCH_TIER_UPDATES 条 payloads，索引 200 边界正确', () => {
  // 一个 tier 内 250 个条目，把最后一个拖到首位 → 全部 250 条 tierSort 变化
  const allVN = [];
  for (let i = 0; i < 250; i++) {
    allVN.push(vn(`v${i}`, 'tier-a', i));
  }

  const payloads = computeTierDiff({ allVN, draggedId: 'v249', targetTierKey: 'tier-a', insertIndex: 0 });

  // 全部 250 条都需更新（v249→0，v0→1，... v248→249）
  assert.equal(payloads.length, 250);
  assert.ok(payloads.length > MAX_BATCH_TIER_UPDATES, '应触发多片提交（>200）');

  // 分片边界：第 201 条（索引 200）应有合法 tierSort
  const byId = Object.fromEntries(payloads.map(p => [p.id, p]));
  assert.equal(byId.v249.tierSort, 0);
  assert.equal(byId.v0.tierSort, 1);
  // 索引 200 对应原 v199（整体后移一位）→ tierSort 200
  assert.equal(byId.v199.tierSort, 200);
  assert.equal(byId.v248.tierSort, 249);
  // 全部仍属 tier-a
  for (const p of payloads) assert.equal(p.tierId, 'tier-a');
});

test('draggedId 不存在时返回空数组（无副作用）', () => {
  const allVN = [vn('v1', 'tier-a', 0)];
  const payloads = computeTierDiff({ allVN, draggedId: 'v404', targetTierKey: 'tier-a', insertIndex: 0 });
  assert.deepEqual(payloads, []);
});

// 确保 sortById 引用不会因未来重构失效：payloads 应为纯数据数组
test('payloads 元素结构为 {id, tierId, tierSort}', () => {
  const allVN = [vn('v1', 'tier-a', 0), vn('v2', 'tier-a', 1)];
  const payloads = computeTierDiff({ allVN, draggedId: 'v2', targetTierKey: 'tier-a', insertIndex: 0 });
  for (const p of payloads) {
    assert.ok(typeof p.id === 'string');
    assert.ok(p.tierId === null || typeof p.tierId === 'string');
    assert.ok(p.tierSort === undefined || Number.isFinite(p.tierSort));
  }
  // 触达 sortById 以避免未用警告（保持导出契约自检）
  assert.equal(sortById(payloads).length, payloads.length);
});

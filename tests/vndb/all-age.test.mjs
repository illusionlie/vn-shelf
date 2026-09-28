import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapVnObjectToVndbData } from '../../src/vndb.js';

// ============ 全年龄判定契约回归（详见 spec backend/conventions.md「全年龄判定」） ============
// 三层规则：g23 本体有效 → 否决；g235 有效 → 放行；否则无有效 ero 类目标签 → 全年龄。

function tag(id, rating, category, extra = {}) {
  return { id, name: `tag-${id}`, rating, category, spoiler: 0, ...extra };
}

function allAgeOf(tags) {
  return mapVnObjectToVndbData({ title: 'X', tags }).allAge;
}

test('新作全年龄：无 g235、无 ero 标签 → true（2025 起 VNDB 停发 g235，旧规则漏判的主场景）', () => {
  assert.equal(allAgeOf([tag('g1', 2.5, 'cont'), tag('g2', 1.8, 'cont')]), true);
});

test('18+：g23 本体有效 → false（无 g235）', () => {
  assert.equal(allAgeOf([tag('g23', 1.69, 'ero'), tag('g1', 2.5, 'cont')]), false);
});

test('18+：g23 缺席但其他有效 ero 标签 → false', () => {
  assert.equal(allAgeOf([tag('g84', 2, 'ero')]), false);
});

test('存量全年龄：g235 有效、无强 ero → true', () => {
  assert.equal(allAgeOf([tag('g235', 2.65, 'tech'), tag('g1', 2.5, 'cont')]), true);
});

test('Ever17 画像：g235 有效 + 仅软性 ero 标签（g3247 Off Screen Sex Only）→ true（g235 优先于 ero 类目）', () => {
  assert.equal(allAgeOf([tag('g235', 3, 'tech'), tag('g3247', 2.2, 'ero'), tag('g1', 2, 'cont')]), true);
});

test('Higurashi 画像：g23 弱票（<0.5）不否决，g235 有效 → true', () => {
  assert.equal(allAgeOf([tag('g23', 0.3, 'ero'), tag('g235', 2.5, 'tech')]), true);
});

test('g23 lie 不构成否决：g235 有效 → true', () => {
  assert.equal(allAgeOf([tag('g23', 2, 'ero', { lie: true }), tag('g235', 2.5, 'tech')]), true);
});

test('混录条目：g23 与 g235 双双有效 → false（g23 一票否决，实测如 Manaka de Ikuno!!）', () => {
  assert.equal(allAgeOf([tag('g23', 0.67, 'ero'), tag('g235', 2, 'tech')]), false);
});

test('g235 lie 失效：存在其他有效 ero 标签 → false', () => {
  assert.equal(allAgeOf([tag('g235', 2.5, 'tech', { lie: true }), tag('g3247', 2, 'ero')]), false);
});

test('g235 弱票（<0.5）失效：无其他 ero → true', () => {
  assert.equal(allAgeOf([tag('g235', 0.3, 'tech'), tag('g1', 2, 'cont')]), true);
});

test('ero 标签低于阈值（0.49）→ true', () => {
  assert.equal(allAgeOf([tag('g3247', 0.49, 'ero')]), true);
});

test('阈值边界：ero rating 恰为 0.5 → false', () => {
  assert.equal(allAgeOf([tag('g3247', 0.5, 'ero')]), false);
});

test('ero 标签 lie → 忽略 → true', () => {
  assert.equal(allAgeOf([tag('g3247', 2, 'ero', { lie: true })]), true);
});

test('ero 标签 spoiler=2 仍参与判定 → false（剧透等级不改变内容存在与否）', () => {
  assert.equal(allAgeOf([tag('g3247', 2, 'ero', { spoiler: 2 })]), false);
});

test('tags 为空（新条目票未积累）→ 保守 false', () => {
  assert.equal(allAgeOf([]), false);
});

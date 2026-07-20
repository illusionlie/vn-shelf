import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStats } from '../../src/stats.js';

// vn_entries 原始行（snake_case，对齐 repository.getStats 宽 SELECT 列）
function makeRow(overrides = {}) {
  return {
    id: 'v1',
    title: 'Title',
    title_ja: '',
    title_cn: '',
    title_cn_user: '',
    rating: 0,
    personal_rating: 0,
    play_time_minutes: 0,
    developers: '[]',
    tags: '[]',
    user_tags: '[]',
    status: null,
    start_date: null,
    finish_date: null,
    ...overrides
  };
}

const ZEROS_10 = new Array(10).fill(0);

// ============ 空输入与整体 shape ============

test('空数组 / 非数组输入返回全零 shape', () => {
  const expected = {
    total: 0,
    totalPlayTimeMinutes: 0,
    avgRating: 0,
    avgPersonalRating: 0,
    statusCounts: { playing: 0, finished: 0, stalled: 0, dropped: 0, wishlist: 0, none: 0 },
    ratingHistograms: { vndb: ZEROS_10, personal: ZEROS_10 },
    ratingDiff: { avg: null, count: 0, overrated: [], underrated: [] },
    timeline: { months: [], datedFinished: 0, avgSpanDays: null, spanCount: 0 },
    topDevelopers: [],
    topTags: { vndb: [], user: [] }
  };

  assert.deepEqual(computeStats([]), expected);
  assert.deepEqual(computeStats(null), expected);
  assert.deepEqual(computeStats(undefined), expected);
});

// ============ 既有 4 项语义 ============

test('均分仅计 >0 样本；时长负值/非数字防御为 0', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', rating: 8, personal_rating: 0, play_time_minutes: 90 }),
    makeRow({ id: 'v2', rating: 0, personal_rating: 6, play_time_minutes: -5 }),
    makeRow({ id: 'v3', rating: 7, personal_rating: 9, play_time_minutes: 'abc' })
  ]);

  assert.equal(stats.total, 3);
  assert.equal(stats.totalPlayTimeMinutes, 90);
  assert.equal(stats.avgRating, 7.5);
  assert.equal(stats.avgPersonalRating, 7.5);
});

// ============ 直方图分桶 ============

test('round 取整 clamp 1..10：0.4→桶1、9.5→桶10、脏数据 10.6→桶10、0 不计入', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', rating: 0.4 }),
    makeRow({ id: 'v2', rating: 9.5 }),
    makeRow({ id: 'v3', rating: 10.6 }),
    makeRow({ id: 'v4', rating: 0 }),
    makeRow({ id: 'v5', personal_rating: 7.49 })
  ]);

  assert.equal(stats.ratingHistograms.vndb[0], 1);
  assert.equal(stats.ratingHistograms.vndb[9], 2);
  assert.equal(stats.ratingHistograms.vndb.reduce((a, b) => a + b, 0), 3);
  assert.equal(stats.ratingHistograms.personal[6], 1);
  assert.equal(stats.ratingHistograms.personal.reduce((a, b) => a + b, 0), 1);
});

// ============ 状态计数 ============

test('statusCounts：白名单五值照常计数，非法/缺失归 none', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', status: 'playing' }),
    makeRow({ id: 'v2', status: 'finished' }),
    makeRow({ id: 'v3', status: 'wishlist' }),
    makeRow({ id: 'v4', status: 'weird' }),
    makeRow({ id: 'v5', status: null })
  ]);

  assert.deepEqual(stats.statusCounts, {
    playing: 1, finished: 1, stalled: 0, dropped: 0, wishlist: 1, none: 2
  });
});

// ============ 分歧榜 ============

test('分歧样本 = 双评分均 >0；舍入后 diff 为 0 不入榜但计入均值', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', rating: 7, personal_rating: 7.04 }),
    makeRow({ id: 'v2', rating: 8, personal_rating: 0 }),
    makeRow({ id: 'v3', rating: 0, personal_rating: 9 })
  ]);

  assert.equal(stats.ratingDiff.count, 1);
  assert.equal(stats.ratingDiff.avg, 0.04);
  assert.deepEqual(stats.ratingDiff.overrated, []);
  assert.deepEqual(stats.ratingDiff.underrated, []);
});

test('overrated 降序 / underrated 升序，各截断 5 条，并列按 id 字典序', () => {
  const rows = [];
  // 6 条正分歧：diff = 1..6
  for (let i = 1; i <= 6; i++) {
    rows.push(makeRow({ id: `vover${i}`, rating: 2, personal_rating: 2 + i }));
  }
  // 2 条同 diff（-1.5）验证并列稳定序 + 1 条更大负分歧
  rows.push(makeRow({ id: 'vb', rating: 5, personal_rating: 3.5 }));
  rows.push(makeRow({ id: 'va', rating: 5, personal_rating: 3.5 }));
  rows.push(makeRow({ id: 'vc', rating: 9, personal_rating: 5 }));

  const stats = computeStats(rows);

  assert.deepEqual(stats.ratingDiff.overrated.map(item => item.diff), [6, 5, 4, 3, 2]);
  assert.equal(stats.ratingDiff.overrated.length, 5);
  assert.deepEqual(stats.ratingDiff.underrated.map(item => item.id), ['vc', 'va', 'vb']);
  assert.deepEqual(stats.ratingDiff.underrated.map(item => item.diff), [-4, -1.5, -1.5]);
});

test('DiffItem 标题合并：title_cn_user 优先于 title_cn，title_ja 回退 title', () => {
  const stats = computeStats([
    makeRow({
      id: 'v1',
      title: 'Fallback',
      title_ja: '',
      title_cn: '官方中文',
      title_cn_user: '用户中文',
      rating: 5,
      personal_rating: 8
    })
  ]);

  const item = stats.ratingDiff.overrated[0];
  assert.equal(item.title, 'Fallback');
  assert.equal(item.titleJa, 'Fallback');
  assert.equal(item.titleCn, '用户中文');
  assert.equal(item.personal, 8);
  assert.equal(item.vndb, 5);
  assert.equal(item.diff, 3);
});

// ============ 时间线 ============

test('月度分组：跨年升序、时长记入完成月、YYYY-MM 前缀合法', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', finish_date: '2026-01-15', play_time_minutes: 100 }),
    makeRow({ id: 'v2', finish_date: '2026-01-20', play_time_minutes: 50 }),
    makeRow({ id: 'v3', finish_date: '2025-12-31', play_time_minutes: 30 }),
    makeRow({ id: 'v4', finish_date: '2026-03', play_time_minutes: 10 })
  ]);

  assert.deepEqual(stats.timeline.months, [
    { month: '2025-12', finished: 1, playTimeMinutes: 30 },
    { month: '2026-01', finished: 2, playTimeMinutes: 150 },
    { month: '2026-03', finished: 1, playTimeMinutes: 10 }
  ]);
  assert.equal(stats.timeline.datedFinished, 4);
});

test('日期脏数据跳过不抛错：非字符串、非法前缀、不可解析月份', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', finish_date: 12345 }),
    makeRow({ id: 'v2', finish_date: 'garbage' }),
    makeRow({ id: 'v3', finish_date: '2026-13-01' }),
    makeRow({ id: 'v4', finish_date: '2026-05-01' })
  ]);

  assert.deepEqual(stats.timeline.months, [
    { month: '2026-05', finished: 1, playTimeMinutes: 0 }
  ]);
  assert.equal(stats.timeline.datedFinished, 1);
});

test('通关跨度：双合法日期才计、负跨度剔除、均值 1 位小数', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', start_date: '2026-01-01', finish_date: '2026-01-02' }),
    makeRow({ id: 'v2', start_date: '2026-02-01', finish_date: '2026-02-02' }),
    makeRow({ id: 'v3', start_date: '2026-03-01', finish_date: '2026-03-03' }),
    makeRow({ id: 'v4', start_date: '2026-04-10', finish_date: '2026-04-01' }),
    makeRow({ id: 'v5', start_date: null, finish_date: '2026-05-01' }),
    makeRow({ id: 'v6', start_date: '2026-06-01', finish_date: null })
  ]);

  // 跨度样本 = 1 + 1 + 2 天 → 平均 1.333… → 1.3
  assert.equal(stats.timeline.spanCount, 3);
  assert.equal(stats.timeline.avgSpanDays, 1.3);
  // 负跨度条目仍计入月度完成数（口径独立）
  assert.equal(stats.timeline.datedFinished, 5);
});

// ============ 偏好画像 ============

test('开发商：一条多社各计一次，count desc + name asc，均分仅计已评分且无样本为 null', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', developers: '["Key","Alice Soft"]', personal_rating: 8 }),
    makeRow({ id: 'v2', developers: '["Key"]', personal_rating: 6 }),
    makeRow({ id: 'v3', developers: '["Alice Soft"]' }),
    makeRow({ id: 'v4', developers: '["Circus"]' })
  ]);

  assert.deepEqual(stats.topDevelopers, [
    { name: 'Alice Soft', count: 2, avgPersonalRating: 8 },
    { name: 'Key', count: 2, avgPersonalRating: 7 },
    { name: 'Circus', count: 1, avgPersonalRating: null }
  ]);
});

test('JSON 容错：烂串/非数组/非字符串成员一律跳过不抛错', () => {
  const stats = computeStats([
    makeRow({ id: 'v1', developers: '{bad json', tags: '"not-array"', user_tags: '[1, null, "真雫"]' }),
    makeRow({ id: 'v2', developers: 42, tags: null })
  ]);

  assert.deepEqual(stats.topDevelopers, []);
  assert.deepEqual(stats.topTags.vndb, []);
  assert.deepEqual(stats.topTags.user, [{ name: '真雫', count: 1 }]);
});

test('标签 Top 截断 15 条且 vndb/user 独立计数', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    // tag-01..tag-20：tag-i 出现 i 次，保证 count 严格可排
    for (let n = 0; n < i; n++) {
      rows.push(makeRow({
        id: `v${i}_${n}`,
        tags: JSON.stringify([`tag-${String(i).padStart(2, '0')}`]),
        user_tags: '["only-user"]'
      }));
    }
  }

  const stats = computeStats(rows);

  assert.equal(stats.topTags.vndb.length, 15);
  assert.deepEqual(stats.topTags.vndb[0], { name: 'tag-20', count: 20 });
  assert.deepEqual(stats.topTags.vndb[14], { name: 'tag-06', count: 6 });
  assert.deepEqual(stats.topTags.user, [{ name: 'only-user', count: rows.length }]);
});

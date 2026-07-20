/**
 * 统计聚合纯函数模块
 *
 * computeStats(rows) 接收 vn_entries 的原始行数组（snake_case，宽 SELECT 见
 * repository.getStats），单次遍历产出统计页全部聚合结果。不触碰 D1，测试无需数据库桩。
 *
 * 口径契约（.trellis/tasks/07-20-stats-page-expansion/design.md）：
 * - 既有 4 项（total/totalPlayTimeMinutes/avgRating/avgPersonalRating）语义不变：
 *   均分仅计 >0 样本，无样本为 0（对齐旧 SQL 的 AVG(CASE WHEN >0) + COALESCE）。
 * - 直方图分桶 = round 取整 clamp 1..10，仅评分 >0 计入。
 * - 分歧样本 = 个人与 VNDB 评分均 >0；榜单按 1 位小数舍入后的 diff 过滤与展示。
 * - 时间线按 finish_date 计数，不看 status（「状态与 finishDate 无联动」既有显式决策）；
 *   条目总时长记入完成月（近似口径）。日期脏数据跳过不抛错；通关跨度剔除负值。
 * - wishlist 为预留状态：照常计数，展示策略由前端决定。
 */

const STATUS_KEYS = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];
const TOP_DEVELOPERS_LIMIT = 10;
const TOP_TAGS_LIMIT = 15;
const DIFF_LIST_LIMIT = 5;

// 日期合法性：YYYY-MM 或 YYYY-MM-DD 前缀（后续交给 Date.parse 复核，如 2026-13 会被拒）
const DATE_PREFIX_RE = /^\d{4}-\d{2}(-\d{2})?/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 与 repository.js 私有同名函数语义一致；此处独立副本避免 stats ↔ repository 循环依赖
function safeJSONParse(text, fallback) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// 评分桶下标：round 取整 clamp 1..10 → 0..9
function histogramIndex(rating) {
  return Math.min(10, Math.max(1, Math.round(rating))) - 1;
}

function parseDateMs(value) {
  if (typeof value !== 'string' || !DATE_PREFIX_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// 字典序 asc（不用 localeCompare，避免 ICU 环境差异导致排序不稳定）
function byStringAsc(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// count desc → name 字典序 asc 的稳定排序
function byCountDescNameAsc(a, b) {
  return (b.count - a.count) || byStringAsc(a.name, b.name);
}

function countInto(map, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (typeof value !== 'string' || !value) continue;
    map.set(value, (map.get(value) || 0) + 1);
  }
}

function topFromCountMap(map, limit) {
  return Array.from(map, ([name, count]) => ({ name, count }))
    .sort(byCountDescNameAsc)
    .slice(0, limit);
}

/**
 * @param {Array<Object>} rows - vn_entries 原始行（snake_case）
 * @returns {Object} 统计页响应 data 层（shape 见模块头注）
 */
export function computeStats(rows) {
  const entries = Array.isArray(rows) ? rows : [];

  let totalPlayTimeMinutes = 0;
  let vndbRatingSum = 0;
  let vndbRatingCount = 0;
  let personalRatingSum = 0;
  let personalRatingCount = 0;

  const statusCounts = { playing: 0, finished: 0, stalled: 0, dropped: 0, wishlist: 0, none: 0 };
  const vndbHistogram = new Array(10).fill(0);
  const personalHistogram = new Array(10).fill(0);
  const diffItems = [];
  const monthMap = new Map();
  let spanDaysSum = 0;
  let spanCount = 0;
  const developerMap = new Map();
  const vndbTagMap = new Map();
  const userTagMap = new Map();

  for (const row of entries) {
    const vndbRating = toNonNegativeNumber(row.rating);
    const personalRating = toNonNegativeNumber(row.personal_rating);
    const playTimeMinutes = toNonNegativeNumber(row.play_time_minutes);

    totalPlayTimeMinutes += playTimeMinutes;

    if (vndbRating > 0) {
      vndbRatingSum += vndbRating;
      vndbRatingCount += 1;
      vndbHistogram[histogramIndex(vndbRating)] += 1;
    }

    if (personalRating > 0) {
      personalRatingSum += personalRating;
      personalRatingCount += 1;
      personalHistogram[histogramIndex(personalRating)] += 1;
    }

    statusCounts[STATUS_KEYS.includes(row.status) ? row.status : 'none'] += 1;

    if (vndbRating > 0 && personalRating > 0) {
      diffItems.push({
        id: row.id,
        title: row.title || '',
        titleJa: row.title_ja || row.title || '',
        titleCn: row.title_cn_user || row.title_cn || '',
        personal: personalRating,
        vndb: vndbRating,
        diff: round1(personalRating - vndbRating)
      });
    }

    const finishMs = parseDateMs(row.finish_date);
    if (finishMs !== null) {
      const monthKey = row.finish_date.slice(0, 7);
      const bucket = monthMap.get(monthKey) || { finished: 0, playTimeMinutes: 0 };
      bucket.finished += 1;
      bucket.playTimeMinutes += playTimeMinutes;
      monthMap.set(monthKey, bucket);

      const startMs = parseDateMs(row.start_date);
      if (startMs !== null && finishMs >= startMs) {
        spanDaysSum += (finishMs - startMs) / MS_PER_DAY;
        spanCount += 1;
      }
    }

    const developers = safeJSONParse(row.developers, []);
    if (Array.isArray(developers)) {
      for (const name of developers) {
        if (typeof name !== 'string' || !name) continue;
        const dev = developerMap.get(name) || { count: 0, ratedSum: 0, ratedCount: 0 };
        dev.count += 1;
        if (personalRating > 0) {
          dev.ratedSum += personalRating;
          dev.ratedCount += 1;
        }
        developerMap.set(name, dev);
      }
    }

    countInto(vndbTagMap, safeJSONParse(row.tags, []));
    countInto(userTagMap, safeJSONParse(row.user_tags, []));
  }

  const diffCount = diffItems.length;
  const diffSum = diffItems.reduce((sum, item) => sum + (item.personal - item.vndb), 0);

  const overrated = diffItems
    .filter(item => item.diff > 0)
    .sort((a, b) => (b.diff - a.diff) || byStringAsc(a.id, b.id))
    .slice(0, DIFF_LIST_LIMIT);

  const underrated = diffItems
    .filter(item => item.diff < 0)
    .sort((a, b) => (a.diff - b.diff) || byStringAsc(a.id, b.id))
    .slice(0, DIFF_LIST_LIMIT);

  const months = Array.from(monthMap, ([month, bucket]) => ({ month, ...bucket }))
    .sort((a, b) => byStringAsc(a.month, b.month));

  const topDevelopers = Array.from(developerMap, ([name, dev]) => ({
    name,
    count: dev.count,
    avgPersonalRating: dev.ratedCount > 0 ? round2(dev.ratedSum / dev.ratedCount) : null
  }))
    .sort(byCountDescNameAsc)
    .slice(0, TOP_DEVELOPERS_LIMIT);

  return {
    total: entries.length,
    totalPlayTimeMinutes,
    avgRating: vndbRatingCount > 0 ? vndbRatingSum / vndbRatingCount : 0,
    avgPersonalRating: personalRatingCount > 0 ? personalRatingSum / personalRatingCount : 0,
    statusCounts,
    ratingHistograms: { vndb: vndbHistogram, personal: personalHistogram },
    ratingDiff: {
      avg: diffCount > 0 ? round2(diffSum / diffCount) : null,
      count: diffCount,
      overrated,
      underrated
    },
    timeline: {
      months,
      datedFinished: months.reduce((sum, bucket) => sum + bucket.finished, 0),
      avgSpanDays: spanCount > 0 ? round1(spanDaysSum / spanCount) : null,
      spanCount
    },
    topDevelopers,
    topTags: {
      vndb: topFromCountMap(vndbTagMap, TOP_TAGS_LIMIT),
      user: topFromCountMap(userTagMap, TOP_TAGS_LIMIT)
    }
  };
}

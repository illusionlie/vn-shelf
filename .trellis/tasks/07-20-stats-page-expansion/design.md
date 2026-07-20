# Design：统计页扩展

## 边界与数据流

```
D1 vn_entries ──宽 SELECT(14列)──▶ repository.getStats(env) ──rows──▶ stats.computeStats(rows)（纯函数）
                                                                        │
router.handleGetStats ◀── stats 对象 ────────────────────────────────────┘
        │ successResponse(data)（信封/CORS 不变，/api/stats 已在公开白名单）
        ▼
statsPage.js（Alpine）──派生视图状态──▶ stats.html 纯 CSS 图表
        └─ ...createTagsView() 复用：appearance 配置 + tags 翻译 + 热刷新
```

- `handleGetStats` 不再走 `getVNList`；`getVNList` 同步瘦身为只返回 `{ items }`（stats/updatedAt 改道后零引用，经用户批准移除）。
- `computeStats` 自带模块私有 `safeJSONParse`（repository 的同名函数不导出，且反向导入会造成循环依赖）。

## 宽 SELECT 列

`id, title, title_ja, title_cn, title_cn_user, rating, personal_rating, play_time_minutes, developers, tags, user_tags, status, start_date, finish_date`

## 响应 shape（data 层）

```js
{
  total, totalPlayTimeMinutes, avgRating, avgPersonalRating,      // 既有4项，语义不变（avg 仅 >0 样本，无样本=0）
  statusCounts: { playing, finished, stalled, dropped, wishlist, none },
  ratingHistograms: { vndb: number[10], personal: number[10] },   // 桶 k=round(r) clamp 1..10；仅 r>0
  ratingDiff: {
    avg: number|null,                        // 平均(personal−vndb)，count=0 时 null
    count: number,                           // 样本=两评分均>0
    overrated:  DiffItem[],                  // diff>0 降序 ≤5（私心偏爱）
    underrated: DiffItem[]                   // diff<0 升序 ≤5（不合口味）
  },
  timeline: {
    months: [{ month: 'YYYY-MM', finished, playTimeMinutes }],    // 仅有数据月份，升序；时长记入完成月
    datedFinished: number,                   // 合法 finish_date 条目数
    avgSpanDays: number|null,                // (finish−start)/86400000 均值，1 位小数；负跨度剔除
    spanCount: number
  },
  topDevelopers: [{ name, count, avgPersonalRating: number|null }],  // ≤10；count desc, name asc；一条多社各计一次
  topTags: { vndb: [{ name, count }], user: [{ name, count }] }      // 各 ≤15；同上排序
}
// DiffItem = { id, title, titleJa, titleCn, personal, vndb, diff }
//   titleCn = title_cn_user || title_cn（与 rowToListItem 合并规则一致）；diff 保留 1 位小数
```

日期合法性：`/^\d{4}-\d{2}(-\d{2})?/` 前缀校验 + `Date.parse` 可解析；月份 key 取前 7 位。

## 前端布局（stats.html 六区块）

1. 概览 6 卡：既有 4 卡 + 已完成数 + 完成率（由 statusCounts 前端派生，finished/total）
2. 状态堆叠条 + 图例（计数与百分比）；wishlist 仅 >0 展示；none=灰
3. 评分区：双直方图（绿=个人 / 金=VNDB，循 07-12 配色语义）+ 平均分差说明 + 分歧双榜
   - 榜内标题 `titleCn||titleJa||title`，外链 `https://vndb.org/<id>`（同详情弹窗 index.viewOnVndb 惯例）
4. 时间线：年份 tab（有数据年份降序，默认最新）+ 12 月柱状（0 填充，hover title 含时长）+ 通关跨度卡
5. 厂商 Top10 横条（宽度=count/max，尾缀平均个人分徽章，无样本隐藏徽章）
6. 标签 Top15 chips（count 上标；tagsMode=manual 用 user 列表不翻译，否则 vndb 列表按需翻译）

各区块样本不足 → 显示提示文案（不隐藏区块）。a11y：图表容器 aria-label 文本摘要；`prefers-reduced-motion` 禁用条形动画；480 断点收紧间距。

## 测试影响面（patch 型加载器纪律）

- router 4 桩（envelope/config.update/vn.status/index.start）各补 `export async function getStats()`。
- queue 测试整体 stub router，不受影响；index.js 无新增 import。
- repository.test.mjs：FakeD1 增宽 SELECT 分支、删聚合 SQL 分支。
- i18n key 双向 diff 测试强制 zh-CN/en 同步。

## 回滚

单 commit 功能变更，无 schema 迁移、无配置变更；回滚 = revert 该 commit（旧前端 + 旧 /api/stats 同包回退，无兼容窗口）。

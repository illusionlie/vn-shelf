# 统计页扩展：状态/评分/时间线/偏好四维统计

## Goal

统计页现状只有 4 个聚合值（总数/总时长/双均分），而 `vn_entries` 中 `status`、`start_date`/`finish_date`、`tags`/`user_tags`、`developers` 等字段均未被统计利用。本任务把统计页扩展为四个维度的个人画像页：

1. **状态漏斗**：playing/finished/stalled/dropped 分布与完成率
2. **评分分析**：个人/VNDB 双直方图 + 分歧榜（私心偏爱 / 不合口味）
3. **时间线**：按 `finish_date` 的月度完成柱状图（年份切换）+ 平均通关跨度
4. **偏好画像**：开发商 Top10（含各社平均个人分）、标签 Top15（支持翻译）

范围外（用户明确排除）：阅读速度对比、Tier 分布、记录完整度、年度报告。

## Requirements

- 后端聚合、前端纯渲染：`GET /api/stats` 一次返回全部聚合结果；不扩列表接口、不新增路由。
- 既有 4 项统计值字段名与语义不变（`total`/`totalPlayTimeMinutes`/`avgRating`/`avgPersonalRating`）。
- 聚合逻辑为纯函数（新模块 `src/stats.js`），不依赖 D1 即可测试。
- 图表纯 CSS 手写，不引入图表库；配色循站内语义（绿=个人、金=VNDB、状态循 status-badge 色板）并走主题变量。
- 标签展示按 `tagsMode` 择一（vndb/manual），vndb 模式复用既有翻译管线。
- wishlist 为预留状态：计数返回，前端仅 >0 时防御性展示。
- 口径决策：
  - 时间线按 `finish_date` 计数，不看 `status`（沿用「状态与 finishDate 无联动」既有显式决策）。
  - 直方图分桶 = round 取整 clamp 1..10，仅评分 >0 计入。
  - 分歧样本 = 个人与 VNDB 评分均 >0；月度时长记入完成月（近似口径）。
  - 日期正则校验，脏数据跳过不抛错；通关跨度剔除负值。
- 附带清理（已获用户批准的零引用删除）：`getVNList` 的并行聚合 SQL 与 `stats`/`updatedAt` 返回值在改道后零引用，一并移除。

## Acceptance Criteria

- [x] `GET /api/stats` 返回 design.md 定义的完整 shape，信封仍为 `successResponse(data)`，CORS 行为不变。
- [x] `computeStats` 纯函数测试覆盖：空库、无日期、round 边界、跨年、多开发商、JSON 容错、负跨度、Top 截断与稳定排序、wishlist/none。
- [x] 4 个 router 测试的 repository stub 补 `getStats` 导出，envelope 含 `/api/stats` 形态用例。
- [x] 统计页六区块（概览摘要条/状态条/评分区/时间线/厂商/标签）在明暗主题、480 宽度、空样本下均正常，各区块样本不足显示提示而非隐藏。（用户浏览器验收通过，概览区经两轮迭代定稿）
- [x] zh-CN 与 en 词条同步（i18n key 双向 diff 测试通过）。
- [x] AGENTS.md 与 CLAUDE.md 的结构树、API 说明同步。
- [x] `npm run lint` 与 `npm test` 全绿（174 pass / 0 fail）。

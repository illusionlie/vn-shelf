# 条目游玩状态功能（含 D1 迁移前置）

## 目标与用户价值

为书架条目增加游玩状态（在玩 / 已完成 / 搁置 / 抛弃），消除当前 `finishDate` 为空时"在玩？搁置？弃坑？"的语义歧义；同时为未来"从 VNDB ulist 导入用户列表"功能奠定枚举与映射基础——没有本地状态字段，导入的 labels 无处落地。

## 任务结构（父任务职责）

本任务为父任务，持有需求全集、跨子任务验收与最终集成评审。实现拆分为两个子任务，**必须按序执行**：

1. `07-11-d1-migration` — D1 版本化迁移机制（前置，独立可验证）
2. `07-11-entry-status-field` — 条目游玩状态字段实现（依赖迁移机制落地后才能加列）

## 已确认事实（代码证据）

- `vn_entries` 表无 status 列；`src/db.js` 头注明确记录"CREATE TABLE IF NOT EXISTS 仅适用首次建表，不支持增量迁移，加列需引入版本化迁移机制"。
- 数据映射集中在 `src/repository.js`：`rowToEntry()`（L111）、`entryToRow()`（L148），加字段为各一行改动；`getVNList` 的 SELECT 需同步加列。
- API 白名单式解构：`handleCreateVN`（router.js L536）、`handleUpdateVN`（L625），新增字段需显式加入解构与校验。
- 导入校验宽松（router.js L1324 起，仅验 id 合法 + vndb/user 为对象）：旧备份导入新版 → status 缺省；新备份导入旧版 → 字段被 entryToRow 静默丢弃。**双向兼容，无需备份迁移。**
- VNDB Kana API 已核实：预定义 labels（id<10 全站统一）1=Playing / 2=Finished / 3=Stalled / 4=Dropped / 5=Wishlist / 6=Blacklist / 7=Voted；`GET /authinfo` 可用现存 token 取回 user id 与 permissions（listread 可读私有标签）；`POST /ulist` 返回 vote(10-100)/started/finished/labels，与现有 `personalRating`/`startDate`/`finishDate` 字段一一对应。
- 前端已有徽章先例（`all-age-badge`）与 i18n 体系（`t()` + `data-i18n`）。
- schema 初始化为 Worker 运行时 `initDB()`（db.batch 一次提交），非 wrangler migrations；迁移机制应沿用运行时路径。

## 需求（跨子任务验收）

- [x] D1 具备版本化迁移能力：新列可通过迁移安全添加到已有部署，幂等、可重入，不破坏首次建表路径。（`07-11-d1-migration` 已完成，124 测试全绿）
- [x] 条目支持游玩状态字段：API 可写可读、有枚举校验；前端可编辑、卡片可视化、可筛选；详情弹窗展示。（`07-11-entry-status-field` 已完成）
- [x] 导入导出双向兼容旧备份文件。（宽松归一测试覆盖）
- [x] 枚举设计与 VNDB label 映射规则文档化（本 PRD「决策记录」+ spec/backend/conventions.md「条目游玩状态枚举」），供未来 ulist 导入任务直接引用。
- [x] `npm run lint` 与 `npm run test` 通过（135/135）；AGENTS.md 数据结构文档同步更新。

## 决策记录（逐项确认中）

1. 枚举存储形式：**已确认（2026-07-11）——本地字符串枚举** `'playing'|'finished'|'stalled'|'dropped'`（+预留 `'wishlist'`），NULL=未设置；VNDB 数字 id 仅作导入映射表常量。
2. 是否增加"想玩"（Wishlist）状态：**已确认（2026-07-11）——首期 UI 不加，但枚举校验白名单预留 `wishlist` 值**。前端筛选/编辑下拉首期只暴露四状态；后端校验接受五值，未来 ulist 导入上线时零迁移启用。
3. VNDB 多标签单值化优先级（仅记录，供未来导入使用）：**已确认（2026-07-11）——终态优先** `Finished(2) > Dropped(4) > Stalled(3) > Playing(1)`；仅有 Wishlist(5) 标签的条目在导入时跳过（除非届时启用 wishlist 状态）。
4. 状态与 finishDate 联动：**已确认（2026-07-11）——不联动**。两字段完全独立，后端不做隐式改写，前端编辑表单不做自动填充。

## 明确不做（Out of Scope）

- VNDB ulist 实际导入功能（独立后续任务，本任务仅做枚举与映射设计准备）。
- 向 VNDB 反向写回状态（PATCH /ulist，需 listwrite，远期再议）。
- statsPage 状态分布统计（可选加分项，除非用户明确要求，否则不进入首期）。

## 开放问题

- 见「决策记录」1-4，正在与用户逐项确认。

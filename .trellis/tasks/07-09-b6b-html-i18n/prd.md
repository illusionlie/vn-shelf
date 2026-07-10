# B6b HTML 静态文案 i18n 迁移

> 父任务 `07-09-b6-finish`。B5b 仅迁 JS 动态文案，HTML 静态中文留作本批次。种子 PRD，正式规划在 start 前补全。

## Goal

将五个 HTML 页面的静态中文 UI 文案纳入 i18n 体系，使 HTML 文本随语言切换。

## 已知约束

- 静态中文约 237 行分布：index 73 / settings 75 / tier 46 / stats 26 / login 17（B5b 勘察数据）。
- 类型：导航链接、`placeholder`、`<option>`、`aria-label`、`<title>`/`meta`。
- 当前 `i18n.js` 只有 `t()` 取词能力，**无 DOM 扫描/应用机制**——本任务需扩展（如 `data-i18n` 属性 + 启动时扫描应用，含 `data-i18n-attr` 处理 placeholder/aria-label/title 等属性型文案）。

## Requirements（草案）

- R1 i18n.js 增 DOM 应用能力：扫描 `[data-i18n]`（文本）与属性型标记，用 `t()` 填充。
- R2 五个 HTML 静态文案标注 `data-i18n` key，key 并入词典（zh-CN 全量 + en 对齐）。
- R3 首屏无闪烁（FOUC）——zh-CN 静态导入同步可用，应用时机在渲染前或极早。
- R4 与 Alpine 协调：`x-text`/`:placeholder` 绑定与 `data-i18n` 不冲突（同一节点二选一）。

## Acceptance Criteria

- [ ] TBD（brainstorm 细化：DOM 应用机制选型、FOUC 策略、与 Alpine 指令边界）

## Out of Scope

- JS 动态文案（B5b 已迁）。
- 后端 message 翻译。

## Open Questions

- DOM 应用机制：`data-i18n` 自实现扫描 vs 借 Alpine 指令（`x-text="t(...)"`）？前者独立、后者与现有绑定一致但需全量改模板。
- 依赖 B6a en 词典：可先迁 zh-CN 键、en 待 B6a 补，还是等 B6a 完成再启动？

## B6a 移交的候选项（2026-07-10 check 阶段发现，brainstorm 时决定收编或另立）

- `friendlyErrorMessage` 拼接用硬编码全角冒号 `：`（api.js 8 处），en 模式 toast 呈 "Export failed：..."——分隔符宜随 locale（如 en 用 ": "）。
- `settingsPage.js` 两处 `toLocaleString('zh-CN', ...)` 日期格式化未随 locale；可改传 `getLocale()`（顺带给 getLocale 一个生产消费者）。

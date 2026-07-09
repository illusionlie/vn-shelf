# B6c 后端 API 信封统一（A3）

> 父任务 `07-09-b6-finish`。跨层任务，需 code-spec 深度。种子 PRD，正式规划在 start 前补全（含 design.md 契约表 + implement.md）。

## Goal

统一所有 API 路由的响应信封为 `{success, data, ...}`，消除前端按路由差异化解构的历史包袱。

## 已知约束

- B5a 时前端 `statsPage.js` 删除了 `res.data || res` 兜底，并核对了 `/api/stats` 形态；但**后端全路由信封统一一直未做**（B5a PRD 已声明留独立后端任务）。
- 后端入口：`src/router.js` 路由分发，`src/utils.js` 有 `errorResponse(message, status)` → `{success:false, error}`（无 code）。
- 成功响应形态当前可能不一致（部分裸 data、部分已包 `{success, data}`）——需勘察建表。
- 前端 `api.js apiRequest` + 各组件解构点依赖当前形态，改信封需同步核对回填。

## Requirements（草案）

- R1 勘察所有路由当前返回形态，建"路由 → 现状信封 → 目标信封"映射表。
- R2 后端统一成功响应为 `{success:true, data, ...meta}`；错误响应形态明确（保持 `{success:false, error}` 或纳入统一）。
- R3 前端解构点核对：凡受影响处同步改为统一走 `res.data`；不留新兜底。
- R4 测试覆盖：路由测试断言信封形态（`tests/router/` 下补/改）。

## Acceptance Criteria

- [ ] TBD（brainstorm + design 细化：错误信封是否也纳入、meta 字段约定、分页/列表形态）

## Out of Scope

- 前端 i18n（B6a/B6b）。
- 后端 message 文案翻译（延续 B5b 边界，本任务只统信封结构不改文案语言）。

## Open Questions

- 错误响应是否一并纳入统一（`{success:false, error, code?}`）还是仅统成功响应？
- 是否需要兼容期（前端同时容忍新旧形态）还是一次性切换（静态部署可原子发布，倾向一次性）？
- 列表/分页类响应的 `data` 内部结构约定。

# B6c 后端 API 信封统一（A3）

> 父任务 `07-09-b6-finish`。**跨层复杂任务**（后端信封 + 前端回填 + 测试），需 code-spec 深度：prd + design（含契约表）+ implement。研究材料见 `research/`（backend-shapes / frontend-consumers / tests-and-spec / risk-map，全部带行号引用）。

## Goal

统一所有 API 路由的响应信封为 `{success, data, ...}`，消除前端按路由差异化解构的历史包袱；前端受影响解构点同步回填，不留新兜底。

## 确认事实（2026-07-11 trellis-research 全量盘点）

- **路由现状**（`research/backend-shapes.md`）：25 条路由，19 条已走 `successResponse` → `{success:true, message, data}`；**6 条偏离**（全走 `jsonResponse` 裸出）：
  | # | 端点 | 现状形态 |
  |---|---|---|
  | 1 | `GET /api/auth/status` | 裸 `{initialized, authenticated}` |
  | 6 | `GET /api/vn` | 半信封 `{data, total}`（无 success） |
  | 7 | `GET /api/vn/v\d+` | 裸 entry 对象 |
  | 9 | `GET /api/tier` | 半信封 `{data, total, updatedAt}` |
  | 17 | `GET /api/index/status` | 裸 status 对象 |
  | 24 | `GET /api/export` | 裸导出对象（即导出文件内容） |
- **错误侧已 100% 统一**：`{success:false, error}`，无 code 无 data（含 index.js 顶层 500 手写复刻）。成功/错误信封天然不对称。
- **前端消费点**（`research/frontend-consumers.md`）：21 处；B5a 的 `|| res` 兜底确认已清零。**6 处依赖偏离形态需回填**：C4/C5（loginPage 24/28）、C6（settingsPage 49，auth/status）、C8（settingsPage 83，indexStatus 整包赋值，最脆）、C13（shared.js 112，selectedVN 整包）、C10（settingsPage 169，export——牵连导出文件格式）。半信封 #6/#9 前端只读 `.data`，标准化后**透明兼容**（C14/15/16）。成功 `message` 字段前端全程零消费。
- **测试**（`research/tests-and-spec.md`）：仅 `index.start.test.mjs` 3 个用例断言裸 `payload.status/processed`（392/423/454）需改；若动 `utils.js` 本体，`config.update.test.mjs:151` 与 `index.start.test.mjs:224` 两处 utils 桩必须同步（否则假绿）。
- **不可破坏契约**（B5 沉淀）：`errorResponse` 无 code + 4xx 中文 message 原样透传（`friendlyErrorMessage` 分支 4 依赖）；错误字段名 `error`（`createApiError` 硬依赖）；公开端点 CORS 矩阵；导出文件格式 `{entries,...}`（import 端与历史备份依赖）。
- **切换策略**：wrangler 部署原子替换 Worker + assets，单用户应用无外部 API 消费方——**一次性切换，无兼容期**（种子 PRD 问题消解）。
- **DO 内部端点**（index.js 35–135，`{acquired}/{released}/{lock}`）为 Worker↔DO 内部通信，前端不消费。

## 决策记录（2026-07-11 用户逐项确认）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 统一范围 | **6 条偏离端点全收编**（含 export——前端存 `res.data`，导出文件格式不变 + 往返走查）；DO 内部端点显式豁免 |
| Q2 | 列表 extras | **顶层保留**：`{success, data:[...], total}`（tier 另有 `updatedAt`）；C14/15/16 透明兼容 |
| Q3 | 错误信封 | **不加 code**，维持 `{success:false, error}`；B5 i18n 边界（4xx 中文 message 透传）零变化。code 化留作未来独立任务 |
| Q4 | message 字段 | **保留**：契约记 message 可选、前端不消费；utils 向后兼容扩展第三参 `extra` 承载列表散字段 |

## Requirements（定稿）

- R1 成功信封全 25 路由统一 `{success:true, message?, data, ...extras}`：6 条偏离端点收编（契约表见 design.md）；`successResponse` 扩展第三参 `extra={}`（向后兼容，19 处既有调用零改动）。
- R2 错误信封零改动 `{success:false, error}`（无 code）；`index.js` 顶层 500 手写体改复用 `errorResponse`（一致性重构）。
- R3 前端 6 回填点（C4/C5/C6/C8/C10/C13）统一 `res.data` 解构；不引入任何 `|| res` 兜底；C14/15/16 核对透明。
- R4 测试：index.start 3 用例改断言 `payload.data.*`；新增 `tests/router/envelope.test.mjs` 覆盖 6 端点信封形态；utils 桩漂移核对。
- R5 导出文件格式不变（`{version,exportedAt,entries,tierList,appearance}`），导出→导入往返走查通过，历史备份兼容。
- R6 后端 + 前端回填 + 测试**同一 commit**（原子切换，无兼容期）。

## Acceptance Criteria

- [x] AC1 6 条原偏离端点响应均为 `{success:true, data, ...}`（envelope 测试断言；#6/#9 顶层 total（/updatedAt）在位）。
- [x] AC2（2026-07-11 用户走查通过）错误信封走查零变化：任一 4xx 中文 message 原样出 toast（i18n 边界不破）；无任何错误响应带 code。
- [x] AC3（2026-07-11 用户走查通过）前端 6 回填点功能走查：登录页初始化/已登录分支、设置页准入判定、索引状态显示与轮询、详情弹窗 VNDB/用户信息、导出下载。
- [x] AC4（2026-07-11 用户走查通过）导出文件打开验证仍为 `{version,exportedAt,entries,...}` 原格式；重新导入成功（往返完整）。
- [x] AC5 主页/Tier/统计列表加载正常（透明兼容点无回归）。
- [x] AC6 `npm run lint && npm run test` 全绿（含新 envelope 测试与改后 index.start 断言）；`grep '|| res'` 零命中。
- [x] AC7 quality-guidelines/backend spec 契约核对：4xx 中文透传、error 字段名、CORS 矩阵均未被触碰。

## Out of Scope

- 前端 i18n（B6a/B6b 已完）；后端 message 文案语言（B5b 边界）。
- 错误信封 code 化（Q3 决策：留作未来独立任务）。
- DO 内部端点（显式豁免）。
- 分页机制重设计（total 仅信息性保留）。

## Open Questions

（无——四项决策已于 2026-07-11 逐项确认，见决策记录；契约表见 design.md。）

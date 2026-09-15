# PUT /api/config 校验前置：newPassword 先落库与后续字段校验失败的半提交问题

## Goal

消除 `handleUpdateConfig`（`src/router.js`）的半提交窗口：当前 newPassword 分支**先**执行 `setAdminPassword()`（写密码哈希 + 轮换 jwtSecret），**后**才逐字段校验；若后续字段（如 `ownerName` 非字符串、`newPassword` 之外的校验失败项）返回 400，凭据已经变更——调用方收到"失败"响应，但旧会话 token 已失效、密码已被改写。

## Background

- 发现于 09-15-site-owner-name 独立质量检查（P2 级遗留）：为 ownerName 增加显式 400 校验后，混合字段请求（`newPassword` + 非法 `ownerName`）可触达"凭据已变 + 响应报错"的不一致终态。
- 触达面：前端表单从不混发（密码与外观分表单提交），仅手工/程序化构造请求可触发——属正确性地雷而非线上故障。
- 关联契约：`.trellis/spec/backend/conventions.md`「外观字段扩展契约」明确了展示型字段的显式 400 风格，本任务使该风格与密码写入顺序兼容。

## Requirements

- R1：`PUT /api/config` 对请求体**全部字段先校验、后写入**——任一字段校验失败时，不得发生任何持久化变更（密码哈希、jwtSecret、settings blob 均不变）。
- R2：校验失败路径的响应语义与现状一致（400 + 中文 message，信封格式不变）。
- R3：既有成功路径行为不变：合法请求的单字段/多字段更新、密码修改后的 token 重签发（`createJWT` + `setAuthCookie`）与响应体保持现状。
- R4：纯后端重构，不改 API shape、不动前端。

## Acceptance Criteria

- [ ] AC1 混合请求（`newPassword` + 非法 `ownerName`）→ 400，且 `verifyAdminPassword(旧密码)` 仍通过、旧 token 仍可过 `authMiddleware`（凭据零变更）。
- [ ] AC2 合法混合请求（`newPassword` + 合法 `ownerName` 等）→ 200，密码生效、字段落库、响应携新 token（现状保持）。
- [ ] AC3 既有全部 config.update 测试不回归；`npm run lint` + `npm run test` 全绿。
- [ ] AC4 新增用例断言校验失败路径 `saveSettings` / 密码写入零调用（沿用 `saveSettingsCalls.length === 0` 桩计数手法）。

## Notes

- 实现形态留给 planning/design（如：校验收集器先跑全字段再统一 apply，或仅将 newPassword 写入挪到全部校验之后）；PRD 只锁定"失败 = 零持久化"不变量。
- 轻量任务，PRD-only 起草；开工前按 1.1 判断是否需要 design.md。

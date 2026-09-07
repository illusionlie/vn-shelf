# 部署 Action 自动预检/创建 D1 与 Queue 资源

## Goal

让 `.github/workflows/deploy.yml`（手动 `workflow_dispatch` 部署）在部署前自动预检 Cloudflare 侧依赖资源：
D1 数据库与 Queue 队列**缺失即创建、存在即复用**，并在运行时按名解析 D1 `database_id` 注入 `wrangler.toml`。
目标是把部署前置条件从「4 个必填 Secret + 2 步控制台手工建资源」收敛为「`WORKER_NAME` + `CF_API_TOKEN` 两个 Secret 即可首次部署成功」。

## Background

- 现状：`deploy.yml` 仅负责部署，要求 `CF_D1_DATABASE_ID` 必填；D1 与 Queue 都需要用户先在控制台手工创建（README「获取 D1 Database ID」「创建 Queue」两节）。
- 已核实（wrangler 4.92 源码/CLI）：
  - `wrangler deploy` **不会**自动创建 Queue，缺失时硬报错 `Queue "x" does not exist. To create it, run: wrangler queues create x`。
  - `wrangler d1 list --json` 返回 `[{uuid,name,...}]`，可按名解析 id；`wrangler d1 create <name>` 创建；`wrangler queues info <name>` 可用退出码判存在（`queues list` 无 `--json`）。
  - Durable Object（`[[migrations]]`）与 Assets（`[assets]`）部署时自动创建，无需预检。
  - wrangler 内建的 `--x-provision` 是隐藏 experimental flag 且不覆盖 Queue，**不采用**（用户已确认走显式 preflight 路线）。

## Requirements

### R1 D1 预检与解析

- 资源名固定为模板中的 `database_name = "vn-shelf-db"`；preflight 以此名为查找键。
- `CF_D1_DATABASE_ID` 由必填降级为**可选覆盖**：
  - 提供时：校验该 uuid 存在于账号内；不存在则 `::error::` 失败，**不创建**。
  - 未提供时：按名查找；找到则复用其 uuid；未找到则 `wrangler d1 create vn-shelf-db` 后再查一次拿 uuid，并输出 `::warning::`（明确提示「新建了一个空库」，防止 DB 被误删后静默新建导致"数据消失"无感知）。
- 解析出的 uuid 通过 step output 传给「Generate wrangler.toml」步骤替换 `__D1_DATABASE_ID__`；日志中对完整 uuid 做 `::add-mask::`（与项目「D1 id 视为敏感信息」的既有口径一致）。

### R2 Queue 预检

- 队列名固定为模板中的 `vn-index-queue`。
- `wrangler queues info vn-index-queue` 成功 → 复用；失败 → 打印 info 的错误输出后执行 `wrangler queues create vn-index-queue`；create 失败则整步失败（不吞掉鉴权/权限错误）。

### R3 Secrets 校验调整

- 「Validate Secrets」步骤仅强制 `WORKER_NAME` 与 `CF_API_TOKEN`；`CF_D1_DATABASE_ID` 改为可选（有值时进入 R1 覆盖路径）。
- 保留 `CF_ACCOUNT_ID`（可选）与 `CUSTOM_DOMAIN`（可选）现有行为。

### R4 幂等与顺序

- preflight 步骤重复运行不产生副作用（已存在的资源不会被重复创建/报错）。
- 步骤顺序：Checkout → Validate Secrets → Setup Node → npm ci → Fetch Account ID → **Ensure Cloudflare resources（新）** → Generate wrangler.toml → Deploy。
- preflight 运行时 `wrangler.toml` 尚未生成，所有 wrangler 命令须在无配置文件状态下可用（`d1 list/create`、`queues info/create` 均满足）。

### R5 文档同步

- `README.md`「GitHub Actions 部署指南」：
  - Secrets 列表：`CF_D1_DATABASE_ID` 标注为可选（仅在需要绑定既有/非默认名数据库时填写）。
  - API Token 权限：在 Queues Edit 之外**明确增加 D1 Edit**（创建 D1 必需）。
  - 「获取 D1 Database ID」「创建 Queue」两节改为「自动创建说明 + 可选手工路径」。
- `AGENTS.md`「测试与 CI」段落补一句 deploy 工作流的资源预检行为。
- `ci.yml` 的 dry-run 不触远端，**不改**。

## Non-Goals

- 不把解析出的 id 回写 GitHub Secrets（Action 无 secrets 写权限，且按名解析成本仅一次 API 调用，无需持久化）。
- 不引入 `wrangler deploy --x-provision`。
- 不处理 `Fetch Account ID` 在多账号 token 下取 `result[0]` 的既有脆弱性（可在 README 提示用 `CF_ACCOUNT_ID` 显式指定）。
- 不改 `wrangler.toml.example` 结构（`database_id` 占位符保留，由 Action 注入）。

## Constraints

- 遵守 spec「wrangler 配置双轨」：本任务不改模板绑定，无需同步本地 `wrangler.toml`。
- shell 使用 `set -euo pipefail`；`jq` 使用 ubuntu-latest 预装版本。
- 不在日志中明文打印完整 D1 uuid。

## Acceptance Criteria

- [ ] 仅配置 `WORKER_NAME` + `CF_API_TOKEN`（token 含 Workers/D1/Queues Edit）时，`Deploy to Cloudflare` 工作流在全新账号可一次成功：自动创建 `vn-shelf-db` 与 `vn-index-queue`，并成功部署。 *（stub 模拟路径 2 已通过：warning → d1 create → 再查拿 id → queues create；真实账号首次运行待用户触发验证）*
- [x] 上述成功后再次运行：日志显示两资源均「已存在，复用」，无 create 调用，部署成功。 *（stub 模拟路径 1：仅 `d1 list` + `queues info` 两次调用，无 create）*
- [x] 配置了有效 `CF_D1_DATABASE_ID`（指向任意名字的既有库）时，preflight 不创建 D1，使用该 id 部署（向后兼容既有用户）。 *（stub 模拟路径 3：id 指向 `other-db`，`GITHUB_OUTPUT` 为该 id，无 create）*
- [x] 配置了无效 `CF_D1_DATABASE_ID` 时，preflight 以 `::error::` 失败且不创建任何资源。 *（stub 模拟路径 4：exit 1，仅一次 `d1 list`）*
- [x] 未配置 `CF_D1_DATABASE_ID` 且 D1 缺失时，日志出现 `::warning::` 提示新建空库。 *（stub 模拟路径 2）*
- [x] 日志中完整 D1 uuid 被 mask。 *（`::add-mask::` 先于 `GITHUB_OUTPUT` 写入；仅打印末 4 位）*
- [x] `Validate Secrets` 不再因缺 `CF_D1_DATABASE_ID` 失败。
- [x] `actionlint`（若可用）或 YAML 语法检查通过；`bash -n` 通过内嵌脚本语法检查。 *（js-yaml 解析 + 步骤顺序断言 + `bash -n` 通过；本机无 actionlint）*
- [x] README / AGENTS.md 文案已同步；`npm run lint` 与 `npm run test` 保持通过（本任务不触及 src/public，属回归确认）。 *（lint 0 error，test 187/187）*

## 实现期补充

- 发现并处理：wrangler 版本 banner 走 stdout，preflight 步骤 env 显式 `WRANGLER_HIDE_BANNER="true"` + `WRANGLER_SEND_METRICS="false"`（详见 `research/wrangler-provisioning.md` 补充节）。
- 子代理通道（`anyrouter-cc`）在 implement / check 两次派发均 `Service Unavailable`（0 次工具调用），实现与校验改为主会话 inline 完成。

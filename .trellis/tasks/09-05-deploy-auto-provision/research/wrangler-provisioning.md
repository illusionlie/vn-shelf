# wrangler 4.92 资源创建能力核实（2026-09-05）

> 目的：为 deploy.yml preflight 方案提供一手依据。来源：本仓库 `node_modules/wrangler`（4.92.0）的 `--help` 输出与 `wrangler-dist/cli.js` 源码 grep。

## CLI 能力

| 命令 | 可用 | 关键点 |
|---|---|---|
| `wrangler d1 list --json` | ✅ | 返回数组 `[{uuid, name, created_at, version, num_tables, file_size}]`，按 `name` 过滤即可拿 `uuid` |
| `wrangler d1 info <name> --json` | ✅ | 不存在时非零退出（可作存在性判断，但 list+jq 一次拿 id 更省一次调用） |
| `wrangler d1 create <name>` | ✅ | 无 `--json`；有 `--update-config`/`--binding`（本任务不用，因 toml 尚未生成）。同名已存在会报错 → 必须先查再建 |
| `wrangler queues list` | ✅ | **无 `--json`**（只有 `--page`），不适合脚本解析 |
| `wrangler queues info <name>` | ✅ | 不存在时非零退出 → 作为存在性判断 |
| `wrangler queues create <name>` | ✅ | 同名已存在会报错 → 必须先查再建 |

## `wrangler deploy` 对缺失资源的行为

- **Queue：不会自动创建**。源码硬编码错误：
  ```
  Queue "${queueName}" does not exist. To create it, run: wrangler queues create ${queueName}
  ```
  → Queue 预检是必需项，不是优化项。
- **D1：有内建 provisioning，但是隐藏 experimental**：
  - 入口 `if (getFlag("RESOURCES_PROVISION")) await provisionBindings(...)`，flag 来自 `args.experimentalProvision ?? false`（`--x-provision` / `--experimental-provision`，`deploy --help` 不显示）。
  - `D1Handler` 逻辑：`isFullySpecified()`（有 `database_id`）→ 跳过；否则 `canInherit(settings)`（已部署 Worker 同名绑定且 DB 名一致）→ 继承；否则 `isConnectedToExistingResource()` 按 `database_name` 查现有（`APIError 7404` 视为不存在）→ 连接；再否则 `createD1Database(name)`。
  - `HANDLERS` 仅含 `kv_namespace / d1 / r2_bucket / ai_search_namespace`，**不含 Queue**。
  - 非交互（CI）下不回写配置文件（`isNonInteractiveOrCI()` 分支跳过 patchConfig）。
  - 结论：能力存在且幂等，但把部署管线押在隐藏 experimental flag 上不值，且仍需单独处理 Queue。**不采用**。
- **Durable Object**：`[[migrations]] new_sqlite_classes` 部署时自动创建，无需预检。
- **Assets**：`[assets] directory` 部署时自动上传，无需预检。

## 无配置文件运行

preflight 执行时 `wrangler.toml` 还未由 sed 生成。`d1 list/create`、`queues info/create` 均为账号级命令，仅依赖 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 环境变量，无配置文件可正常运行。

## Token 权限

- 创建/列举 D1 需要 **D1:Edit**；README 现有 token 步骤只提到「编辑 Cloudflare Workers」模板 + Queues Edit，需补 D1 Edit（模板是否已含 D1 未核实，显式加上无害）。

## 相关既有约定

- `.trellis/spec/backend/conventions.md`「wrangler 配置双轨」：D1 id 被视为敏感信息（toml 被 gitignore）。→ preflight 日志对 uuid 做 `::add-mask::`。
- `.trellis/spec/backend/conventions.md`「D1 schema 迁移契约」：schema 初始化走 Worker 运行时 `initDB()`，不用 wrangler d1 migrations → 新建空库无需额外 migration 步骤，首个请求自建表。

## 补充（实现期核实）：banner 走 stdout

- `printWranglerBanner()` 通过 `logger.log` → `console.log` 写 **stdout**。实测（无效 token 触发早退，banner 逻辑在 handler 之前执行）：
  - `wrangler d1 list` → stdout 84 bytes（`\n ⛅️ wrangler 4.92.0\n────\n`）
  - `wrangler d1 list --json` → stdout 1 byte（仅 `\n`，jq 可容忍前导空白）
  - `WRANGLER_HIDE_BANNER=true wrangler d1 list`（无 --json）→ stdout 1 byte
- `--json` 的 banner 抑制路径在 bundle 里没定位到显式代码（`d1 list` 的 `behaviour: {}` 按默认应打印），不把脚本正确性押在它上面 → preflight 步骤 env 显式设 `WRANGLER_HIDE_BANNER: "true"`（`getBooleanEnvironmentVariableFactory({ variableName: "WRANGLER_HIDE_BANNER" })`，官方支持）。
- 遥测 banner（`printMetricsBanner`）只在 `printMetricsBanner: true` 的命令（dev/deploy/versions upload）打印，`d1 list` 不受影响；但 preflight 时 `wrangler.toml`（含 `send_metrics = false`）尚未生成，顺手设 `WRANGLER_SEND_METRICS: "false"` 与项目口径一致。
- `d1 list --json` 内部分页拉全（`while (results.length % pageSize === 0)`），输出为纯数组，无需脚本侧分页。

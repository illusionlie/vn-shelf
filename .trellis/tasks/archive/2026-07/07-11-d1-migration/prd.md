# D1 版本化迁移机制

## Goal

为 D1 引入运行时版本化 schema 迁移能力，使已有部署可以安全地增量变更表结构（首个消费者：`vn_entries` 加 `status` 列，见兄弟任务 `07-11-entry-status-field`）。兑现 `src/db.js` 头注中预留的方向："schema_version 设置项 + ALTER 语句"。

## 背景约束（代码证据）

- 现状：`initDB()` 仅执行 `CREATE TABLE IF NOT EXISTS`（一次 `db.batch` 提交），对已存在的表不做任何结构变更。
- schema 初始化走 Worker 运行时路径（每 isolate 首次请求触发，WeakSet 缓存防重入），**不是** wrangler migrations；迁移机制必须沿用运行时路径，不引入部署期步骤。
- D1 的 `db.exec()` 对多行 SQL 有已知缺陷（见 db.js 头注），所有语句保持单行、经 `prepare` + `batch` 执行。
- 多 isolate 并发冷启动是真实场景：迁移必须容忍并发竞争（两个 isolate 同时尝试同一 ALTER）。

## Requirements

- 迁移版本号持久化于 `settings` 表（key `schema_version`），缺失视为 0。
- `SCHEMA_SQL` 冻结为 v0 基线，此后**任何**表结构变更只能通过新增迁移条目表达；全新安装 = 建 v0 基线 + 顺序回放全部迁移（消除"新装 vs 存量"的版本歧义）。
- 每个迁移原子应用：迁移语句 + 版本号写入在同一个 `db.batch` 中。
- 幂等可重入：重复调用 `initDB` 不重复应用；并发竞争时败者能识别"已被他人应用"并继续，识别不了才抛错。
- 机制本期交付时 `MIGRATIONS` 为空数组（首个真实迁移由 `07-11-entry-status-field` 添加），但机制本身有完整单测覆盖。
- 前向兼容回滚：迁移只向前；回滚 = 重新部署旧版 Worker 代码（现有代码全部显式列名读写，多出的列无害）。

## Acceptance Criteria

- [x] 全新数据库：`initDB` 后所有表存在，`schema_version` = 最新版本号。
- [x] 存量 v0 数据库（无 `schema_version` 键）：`initDB` 顺序应用全部待做迁移并落版本号。
- [x] 已最新的数据库：`initDB` 不执行任何迁移语句。
- [x] 并发竞争模拟：迁移 batch 失败但版本号已被他方推进时，静默视为已应用；版本号未推进的失败原样抛出。
- [x] `npm run test` 与 `npm run lint` 通过；`src/db.js` 头注更新为描述新机制。
- [x] 现有测试（依赖 `initDB` 的 repository/router/queue 套件）全部不回归。

## Out of Scope

- 任何真实迁移条目（属兄弟任务）。
- 数据回填类迁移（DML）——机制预留 statements 数组即可表达，本期不做专项设计。
- wrangler d1 migrations 部署期方案。

## Notes

- 父任务：`07-11-entry-status`（决策记录与跨任务验收见其 prd.md）。

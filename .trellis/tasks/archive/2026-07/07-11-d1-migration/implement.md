# 执行计划：D1 版本化迁移机制

## 前置检查

- [x] **已确认（2026-07-11）**：`saveSettings`（repository.js L291）仅 `INSERT OR REPLACE` 单键 `config:settings`，不做全表覆盖；`schema_version` 作为 settings 表独立键不会被业务写入路径触碰（同 `TIER_LIST_META_KEY` 先例）。无需额外防护。

## 实施清单（顺序执行）

1. [ ] `src/db.js`：新增 `SCHEMA_VERSION_KEY`、`MIGRATIONS = []`、`LATEST_SCHEMA_VERSION`（由 MIGRATIONS 推导，空数组时为 0）。
2. [ ] `src/db.js`：实现 `readSchemaVersion(db)`（缺失/非法 → 0）与 `applyPendingMigrations(db, migrations, currentVersion)`：按 version 升序逐个 `db.batch([...statements, upsert version])`；batch 异常时重读版本号，已 ≥ 目标版本则继续，否则抛出。
3. [ ] `src/db.js`：将迁移应用接入 `initDB` 的 initializationPromise（基线 batch 之后），保持 WeakSet/WeakMap 防重入语义不变。
4. [ ] `src/db.js`：更新头注——声明"SCHEMA_SQL 为 v0 冻结基线，结构变更只允许追加 MIGRATIONS"，并保留单行 SQL 书写约定说明。
5. [ ] 新增 `tests/d1/migrations.test.mjs`，覆盖验收全部场景：
   - 全新库：基线建表 + 注入迁移全部应用 + 版本号落库
   - 存量 v0 库（无版本键）：待做迁移按序应用
   - 已最新库：零迁移语句执行
   - 版本连续性：注入乱序/跳号迁移表时行为明确（升序排序后应用或显式报错，实现时定并写入断言）
   - 并发竞争：batch 编程性失败 + 版本号已推进 → 静默继续；版本号未推进 → 抛错
   - `resetDBInitFlag` 后重入不重复应用
6. [ ] 回归确认：`tests/d1/repository.test.mjs` 等现有套件的 FakeD1Database 会收到新的 `SELECT ... schema_version` 查询——如 fake 对未知 SQL 抛错，需补充最小支持。

## 验证命令

```bash
npm run lint
npm run test
npx wrangler dev   # 手动冒烟：本地 D1 冷启动一次，确认无 SQLITE 错误（可选）
```

## 风险文件与回滚点

- 唯一风险文件 `src/db.js`：处于全部请求的冷启动路径。回滚点 = 单文件 revert，无数据回滚需求（本期 MIGRATIONS 为空，不产生实际 DDL）。

## task.py start 前检查

- [ ] design.md 中"settings 全量覆盖风险"已有结论并体现在实现里
- [ ] 验收标准逐条映射到测试用例

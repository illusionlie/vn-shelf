# 设计：D1 版本化迁移机制

## 架构与边界

改动收敛在 `src/db.js` 单文件（+新测试文件）。对外接口 `initDB(db)` / `resetDBInitFlag()` 签名不变，调用方（repository.js 全部入口）零改动。

```text
initDB(db)
  ├─ db.batch(SCHEMA_SQL)            # v0 基线，冻结不再改
  ├─ readSchemaVersion(db)           # SELECT value FROM settings WHERE key='schema_version'，缺失=0
  └─ for m of MIGRATIONS where m.version > current（按 version 升序）:
       db.batch([...m.statements, upsert schema_version = m.version])   # 单迁移原子
```

## 数据结构

```js
// version 必须从 1 起连续递增；statements 单行 SQL 字符串数组
const MIGRATIONS = [
  // { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] }  ← 由后续任务添加
];
const SCHEMA_VERSION_KEY = 'schema_version';   // 复用 settings 表，不新建表
```

版本号以字符串存 settings.value（与该表现有用法一致），读取时 `Number.parseInt` + 非法值视为 0。

## 关键决策与权衡

1. **基线冻结 + 全量回放，而非"新装即最新"**：`SCHEMA_SQL` 永远停留在 v0，新装数据库也走迁移链。代价是新装冷启动多 N 个 batch（N=迁移数，个位数量级，可忽略）；换来"缺 `schema_version` 键 = v0"的单一语义，彻底消除新装/存量歧义。这是本设计最重要的不变量：**今后任何人不得再编辑 SCHEMA_SQL 的表结构，只能追加 MIGRATIONS**（写入 db.js 头注 + spec）。
2. **并发竞争容忍**：SQLite 的 `ALTER TABLE ADD COLUMN` 无 `IF NOT EXISTS`。两个 isolate 竞争时，胜者 batch 成功并推进版本号；败者 batch 整体回滚（batch 原子）后抛错。处理：捕获 batch 异常 → 重读 `schema_version` → 若已 ≥ 目标版本则视为已应用、继续下一迁移；否则原样抛出。不引入 Durable Object 锁——竞争窗口极窄且后果可恢复，锁的复杂度不成比例。
3. **每迁移一个 batch，而非全部迁移一个 batch**：版本号与其语句同批落库，任何一步失败都停在明确版本上，可安全重试。
4. **isolate 内缓存不变**：沿用现有 WeakSet/WeakMap 防重入，迁移检查每 isolate 只发生一次；已最新时代价仅一条 SELECT。

## 兼容与回滚

- 旧 Worker 代码遇到新列：repository 全部显式列名 SELECT/INSERT，多余列不读不写，无害 → 回滚 = 重部署旧代码，schema 不回退。
- `settings` 表新增一个保留 key：`getSettings`/`saveSettings` 若有全量读写需确认不会误删该键（实现时验证；若 saveSettings 是整表覆盖式则需把 `schema_version` 排除在外——风险点，见 implement.md）。

## 可测试性

- 导出 `applyPendingMigrations(db, migrations)`（或等价内部函数）供测试注入自定义迁移表，不依赖真实 MIGRATIONS 内容。
- 复用 `tests/d1/repository.test.mjs` 的 FakeD1Database 模式：新测试文件自建轻量 fake，记录执行过的 SQL 并模拟 settings 表读写、可编程 batch 失败（模拟 duplicate column 竞争）。

## 运维注意

- 迁移在请求路径上同步执行：单个 ALTER 毫秒级，可接受；若未来出现慢迁移（大表回填），需另行设计后台化——记入 spec 备忘，本期不做。

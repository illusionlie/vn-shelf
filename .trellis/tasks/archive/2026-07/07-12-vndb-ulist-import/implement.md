# 执行计划：VNDB ulist 用户列表导入

## 前置检查

- [ ] 确认 `INDEX_START_LOCK` Durable Object 的锁语义可否被导入任务复用（同一把锁 = 索引与导入互斥）；若不可直接复用，评估加同类锁的成本。
- [ ] 确认 `reconcileIndexStatusFromItems` / `getIndexStatus` 在加 `type`/`skipped` 列后返回体扩展不破坏现有前端索引进度绑定（字段只增不改）。
- [ ] 确认 wrangler queue 消费配置：本方案不新增队列（waitUntil 分页循环），无需改 queue 绑定——核对无遗漏。

## 实施清单（后端 → 迁移 → 测试 → 前端 → 文档）

### 1. VNDB 客户端（src/vndb.js）
1. [ ] 改造 `request(endpoint, body, method='POST')`：GET 不带 body；现有 `/vn` 调用保持默认 POST 不变。
2. [ ] 抽出 `mapVnObjectToVndbData(vn)`：把 `getVN` 内联的标题提取/tags 过滤/g235/rating/length 逻辑移入；`getVN` 改为调用它，输出逐字段不变。
3. [ ] `getAuthInfo()`：GET /authinfo，校验 permissions 含 listread，返回 `{id, username, permissions}`；缺 token/权限抛明确错误。
4. [ ] `fetchUList(userId, {page, results})`：POST /ulist，fields 含用户字段 + `vn.*` 所需，返回 `{results, more}`。
5. [ ] 映射常量 + `mapUListItemToEntry(item)`：终态优先单值化、纯 wishlist skip、vote/日期映射、VN 元数据经共享函数。

### 2. D1 迁移（src/db.js）
6. [ ] MIGRATIONS 追加 v2（单迁移两语句）：`ALTER TABLE index_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'index'` + `ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0`。
7. [ ] repository：`saveIndexStatus`/`getIndexStatus` 读写 `type`、`skipped`；`createBaseIndexTaskStatus` 加字段默认。

### 3. 导入管线（src/ 新模块或 index-task.js 扩展 + router.js）
8. [ ] `startUListImport(env, ctx)`：authinfo 取 uid → 建 type='ulist_import' 任务 → 预载已存在 id 集合 → waitUntil 分页循环（拉页→映射→过滤 skip/已存在→分批 saveVNEntry→更新进度）→ 终态汇总。与索引任务互斥（锁）。
9. [ ] `handleStartUListImport` + 路由 `POST /api/ulist/import`（认证 + 信封）。
10. [ ] 进度查询：复用 `/index/status`（返回体已含 type/skipped）或新增 `/api/ulist/status`——按 design 复用现有。
11. [ ] api.js 加 `ulistAPI.import()` / 复用 indexAPI.getStatus。

### 4. 测试
12. [ ] `tests/vndb/ulist-mapping.test.mjs`：mapUListItemToEntry 全边界（决策 5 各条 + 多 label 优先级）。
13. [ ] `getVN` 回归：mapVnObjectToVndbData 抽出后输出不变。
14. [ ] `getAuthInfo`/`fetchUList`：mock fetch，方法/body/错误分支。
15. [ ] 导入端点：mock 客户端，跳过已存在 + skipped 计数 + 鉴权失败信封 + 分页汇总。
16. [ ] 迁移 v2：存量库加列（复用 migrations.test 模式）。

### 5. 前端
17. [ ] settings.html「VNDB」区加「导入我的 ulist」按钮 + 进度显示（复用 index 进度条模板，按 type 区分文案）。
18. [ ] settingsPage.js：`startUListImport()` + 复用轮询；i18n zh-CN/en 文案。

### 6. 文档
19. [ ] AGENTS.md VNDB 集成段（新增 authinfo/ulist 方法、导入管线）。
20. [ ] backend/conventions.md：ulist 导入契约（映射规则落地位置、任务表 type 语义、skipped 计数）。
21. [ ] wrangler.toml + example：本方案若无新绑定则无需改；若加锁绑定则双轨同步。

## 验证命令
```bash
npm run lint
npm run test
npx wrangler dev   # 手动冒烟：配置 token → 导入 → 观察进度条 imported/skipped → 书架出现新条目 → 重复导入全 skipped
```

## 风险文件与回滚点
- `src/vndb.js` `request()` 改签名 + `getVN` 抽函数：现有索引/添加条目全依赖 getVN，回归测试必须先绿再继续。
- `index_tasks` 迁移：加列有默认值、低风险；回滚 = revert（列无害留存）。
- 执行模型 waitUntil 墙钟边界：超大列表 partial 断点续传是首期约定，测试覆盖"部分完成置 partial"。

## task.py start 前检查
- [ ] design 开放问题（执行模型、任务表泛化、锁互斥）均已在 design.md 定案
- [ ] 映射决策 5 各边界 → 测试用例一一映射
- [ ] getVN 回归保护到位
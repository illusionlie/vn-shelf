# 执行计划：条目游玩状态字段

## 前置条件

- [ ] `07-11-d1-migration` 已完成并合入（MIGRATIONS 机制可用）。

## 实施清单（顺序执行，后端 → 测试 → 前端 → 文档）

### 后端

1. [ ] `src/db.js`：追加迁移 `{ version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] }`。
2. [ ] `src/repository.js`：导出 `VN_STATUS_VALUES` 与 `normalizeStatus()`；`rowToEntry`（user.status，经 normalizeStatus）、`entryToRow`（status 列，经 normalizeStatus）、INSERT 列清单/绑定追加至列尾、`getVNList` SELECT + `rowToListItem` 加 status。
3. [ ] `src/router.js`：`handleCreateVN` 解构 status + 白名单校验（非法 → 400）；`handleUpdateVN` 三态语义（undefined 保持 / null 清除 / 合法设置 / 非法 400）。

### 测试

4. [ ] `tests/d1/repository.test.mjs`：FakeD1Database 绑定映射加 `status: bindings[26]`、SELECT 前缀串同步；新增断言：保存带 status 条目往返一致、非法值归一 null。
5. [ ] router 侧测试（沿用现有 tests/router 模式新增或扩展）：create/update 校验矩阵全场景 + 导入含非法 status 落 null。

### 前端

6. [ ] `public/index.html`：编辑模态加状态 `<select>`（data-i18n 文案）；卡片 `.vn-card-image-wrapper` 加状态徽章；工具栏加状态筛选下拉；详情弹窗元信息区加状态行。
7. [ ] `public/js/components/vnShelf.js`：editForm 增加 status（openEdit 读取 `vn.user?.status ?? ''`，saveEdit 提交 `'' → null`）；`statusFilter` 状态 + `applyFilters`（搜索 ∧ 状态叠加），替换 `applySearchFilter` 的三个调用点（loadVNList/handleSearch/handleSortChange）。
8. [ ] `public/css/cards-detail.css`：`.status-badge` 及四状态变体，基于现有 CSS 变量，明暗主题各自校验对比度。
9. [ ] `public/js/locales/`：全部词典文件加 status 域 key，运行时确认无缺 key warn。

### 文档

10. [ ] `AGENTS.md`：两处数据结构 JSON 示例（完整条目 user 域 + 列表项）加 `status`。

## 验证命令

```bash
npm run lint
npm run test
npx wrangler dev   # 手动冒烟：存量库首次请求触发迁移 → 加条目设状态 → 筛选/徽章/详情/导出导入往返
```

## 风险文件与回滚点

- `src/repository.js` INSERT 绑定顺序（26→27 列，位置敏感）：漏改测试 fake 会静默错位——步骤 2/4 必须同一次提交。
- 回滚点：本任务全部改动可整体 revert；status 列留在库中无害（旧代码不读写）。

## task.py start 前检查

- [ ] 兄弟任务已完成、机制单测在 master 全绿
- [ ] 校验矩阵每格均有对应测试用例编号

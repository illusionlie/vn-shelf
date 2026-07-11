# 设计：条目游玩状态字段

## 数据流（全链路）

```text
D1 vn_entries.status (TEXT, NULL)
  ↕ src/repository.js  rowToEntry/entryToRow/rowToListItem（归一化唯一入口 normalizeStatus）
  ↕ src/router.js      handleCreateVN / handleUpdateVN（API 校验层，白名单五值）
  ↕ public/js/api.js   vnAPI.create/update 透传
  ↕ 前端组件            editForm.status（vnShelf）/ 卡片徽章（index.html）/ statusFilter / 详情弹窗
```

## 枚举常量的放置

前后端无共享模块（src/ 是 Worker，public/js 是浏览器 ESM，无构建步骤无法互引）。因此：

- 后端：`src/repository.js` 导出 `VN_STATUS_VALUES = ['playing','finished','stalled','dropped','wishlist']` + `normalizeStatus(value)`（合法返回原值，否则 null）；router.js 引用做 API 校验。
- 前端：`public/js/components/vnShelf.js`（或 shared.js，若详情弹窗也需要）内联四值列表（UI 不含 wishlist）。两处常量各自加注释互指（"与 src/repository.js VN_STATUS_VALUES 保持同步"）。
- **接受这份重复**：项目已有同类先例（前端 applySearchFilter 注释声明与后端语义一致）。

## 校验矩阵（遵循 .trellis/spec/backend/conventions.md 信封契约）

| 场景 | 输入 | 行为 |
|---|---|---|
| create | 缺省 / null | `user.status = null` |
| create | 白名单五值 | 落库 |
| create | 其他任意值 | 400 `状态值无效，仅支持 playing/finished/stalled/dropped/wishlist` |
| update | 字段未出现 | 保持原值（与 titleCn 等现有 patch 语义一致，`!== undefined` 判定） |
| update | null | 清除为 null |
| update | 白名单/非法 | 同 create |
| import | 非法/缺失 | `normalizeStatus` 归一为 null，不拒包（宽松导入哲学） |

注意 update 现有代码用 `x !== undefined ? x : entry.user.x` 形态，status 沿用同型；但 null 是合法目标值，三元条件天然支持（null !== undefined）。

## 迁移条目（依赖 d1-migration 机制）

```js
{ version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] }
```

不建索引：`getVNList` 全量加载（无分页），筛选在前端内存进行；SQL 层无按 status 查询的路径。

## repository 改动细节（高风险点）

`INSERT OR REPLACE INTO vn_entries` 列清单从 26 列变 27 列——**绑定顺序是位置敏感的**，`tests/d1/repository.test.mjs` 的 FakeD1Database 按 bindings 下标解构（L198-223），status 追加在列尾（`tier_sort` 之后）以最小化下标扰动，测试同步加 `status: bindings[26]`。`getVNList` 的 SELECT 语句字符串同样被 fake 按前缀匹配（L342），需同步更新两侧。

## 前端设计

- **编辑表单**（index.html 编辑模态 + vnShelf.openEdit/saveEdit）：`<select>` 五项（未设置 + 四状态），editForm.status 缺省 ''，提交时 `'' → null`。
- **卡片徽章**：位于 `.vn-card-image-wrapper` 内（与 all-age-badge 同容器、不同角落），`status-badge status-{value}` 双类；配色语义：playing=进行蓝、finished=完成绿、stalled=搁置琥珀、dropped=弃置灰红；具体色值实现期在 `cards-detail.css` 用现有 CSS 变量体系derive，需同时适配明暗主题。
- **筛选**：vnShelf 增加 `statusFilter: 'all'`；将现有 `applySearchFilter` 调用点改为 `applyFilters`（搜索 ∧ 状态），`handleSortChange`/`handleSearch` 复用同一函数，保证叠加语义。选项含 `none`（未设置，匹配 status == null）。
- **详情弹窗**：detail-header 元信息区加一行状态文本（i18n）。
- **i18n key 规划**：`status.playing/finished/stalled/dropped/none` + `index.filterStatusAll` 等，落 `locales/` 下全部词典文件。

## 兼容性

- 旧备份导入新版：无 status → null。新备份导入旧版：entryToRow（旧代码）无该字段映射，静默丢弃，不报错。已实测导入校验仅验 id/vndb/user 形状（router.js L1324）。
- 旧 Worker 代码 + 新 schema（回滚场景）：显式列名读写，多余列无害。

## 未来 ulist 导入接口（仅文档，本任务不实现）

映射规则固化于父任务 PRD 决策记录 3；届时映射函数建议落 `src/vndb.js`（labels 数组 → 按终态优先级取单值），入参出参均为本任务定义的字符串枚举。

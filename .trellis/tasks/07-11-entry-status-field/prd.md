# 条目游玩状态字段实现

## Goal

为每个条目增加游玩状态（在玩 / 已完成 / 搁置 / 抛弃），端到端打通：D1 列 → repository 映射 → API 校验 → 前端编辑/徽章/筛选/详情展示，并使导入导出双向兼容旧备份。同时以本枚举为基准，固化未来 VNDB ulist 导入的映射规则（仅文档，不实现导入）。

## 依赖

**硬依赖 `07-11-d1-migration`**：本任务的加列操作必须以"追加 MIGRATIONS 条目"的方式表达，禁止直接修改 SCHEMA_SQL 基线。迁移机制未合入前本任务不得 `task.py start`。

## 已确认决策（引用父任务 prd.md 决策记录）

1. 存储形式：字符串枚举 `'playing' | 'finished' | 'stalled' | 'dropped' | 'wishlist'（预留）`，NULL = 未设置。
2. Wishlist：首期 UI 不暴露，后端校验白名单包含 `wishlist`（未来导入零迁移启用）。
3. VNDB label 映射（文档化备用，不实现）：`1→playing, 2→finished, 3→stalled, 4→dropped, 5→wishlist`；多标签单值化取终态优先 `Finished(2) > Dropped(4) > Stalled(3) > Playing(1)`；仅 Wishlist 条目导入时跳过。
4. 与 `finishDate` 完全独立，无任何联动/自动填充。

## Requirements

### 后端

- 迁移 v1：`ALTER TABLE vn_entries ADD COLUMN status TEXT`（可空，无默认值；列表全量加载后前端筛选，不建索引）。
- `rowToEntry` → `user.status`（非法值防御性归一为 null）；`entryToRow` → `status`；INSERT 列清单与绑定同步；`getVNList` SELECT 与 `rowToListItem` 增加 status。
- `POST /api/vn`：可选 `status`，缺省 null；非白名单值 → 400 中文文案（遵循后端信封契约：`{success:false, error}` 无 code）。
- `PUT /api/vn/:id`：`status` 未提供 = 保持；`null` = 清除；合法字符串 = 设置；非法 → 400。
- 导入：宽松策略——`status` 非法/缺失一律落 null，不拒绝整包（归一点在 `entryToRow`，与现有导入哲学一致）。导出经 `exportData` 自动携带，无需专门改动。

### 前端

- 编辑表单：状态下拉（未设置 + 四状态）。
- 书架卡片：状态徽章（四状态各配色，未设置不显示；沿用 `all-age-badge` 的定位模式，样式落 `cards-detail.css`）。
- 书架工具栏：状态筛选下拉（全部/四状态/未设置），与现有搜索过滤叠加生效。
- 详情弹窗：展示状态。
- i18n：状态名与筛选文案进入 `public/js/locales/` 全部词典（zh-CN 及其余已存在语言）。
- Tier List 页迷你卡片**不加**徽章（空间不足，首期不做）。

### 文档

- AGENTS.md「数据结构」两处 JSON 示例加 `status` 字段；VNDB 映射规则常量**不进代码**（避免死代码），只落本任务 design.md 与父任务 PRD。

## Acceptance Criteria

- [ ] 存量部署升级后 `vn_entries` 具有 status 列，旧数据 status 为 NULL，应用正常。
- [ ] `POST /api/vn` 携带 `status:'playing'` 持久化成功；`status:'xxx'` → 400。
- [ ] `PUT` 三态语义（缺省保持 / null 清除 / 合法设置）各有测试覆盖。
- [ ] `GET /api/vn` 列表项与 `GET /api/vn/:id` 的 `user.status` 均返回。
- [ ] 旧备份（无 status）导入成功且 status 为 null；备份含 `status:'weird'` 导入后落 null。
- [ ] UI：编辑可改状态、卡片显示徽章、筛选与搜索叠加正确、详情弹窗展示、i18n 双语无缺 key 警告。
- [ ] `npm run lint`、`npm run test` 通过；repository 既有测试的绑定序号更新无遗漏。

## Out of Scope

- ulist 导入实现、statsPage 状态分布、Tier 页徽章、状态排序选项、VNDB 反向写回。

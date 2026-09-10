# Implement：管理员单条目 VNDB 刷新按钮

> 执行顺序按依赖排列；每步末尾给出验证命令。全程不改 `src/` 业务代码。

## Step 0 — 前置

- [ ] 读 `prd.md` → `design.md` → `research/current-state.md`。
- [ ] `npm run lint && npm test` 基线绿。

## Step 1 — 纯模块 + 单测（先写测试）

- [ ] 新建 `public/js/vn-list-item.js`，导出 `mergeVndbIntoListItem(item, entry)`（契约见 design §2.1）。文件头注释指向 `src/repository.js rowToListItem` 并说明「跨端同值约定，改一侧须同步另一侧」。
- [ ] 新建 `tests/public/vn-list-item.test.mjs`（样板 `tests/public/tier-diff.test.mjs`），用例：
  1. VNDB 派生字段（title/titleJa/titleCn/image/imageNsfw/rating/developers/allAge）被 entry 覆盖；
  2. 用户字段（personalRating/playTimeMinutes/tierId/tierSort/status/createdAt/id）保持 item 原值；
  3. `titleCn` 回退链：`user.titleCn` 优先 → `vndb.titleCn` → `''`；
  4. `titleJa` 回退 `vndb.title`；
  5. `rating` 非有限/负数 → 0；`developers` 非数组 → `[]`；
  6. 不修改入参（`Object.isFrozen` 或 deepEqual 快照）。
- 验证：`node --test tests/public/vn-list-item.test.mjs`

## Step 2 — 后端回归测试（不改后端代码）

- [ ] `tests/router/vn.status.test.mjs`：
  - 文件头注释补一句「同时覆盖 `handleUpdateVN` 的 `refreshVNDB` 分支」。
  - `vndbStubCode` 的 `fetchVNDB` 增加哨兵：`if (id === 'v500') throw new Error('upstream down');`。
  - 新增 section `// ============ refreshVNDB ============`：
    1. `PUT /api/vn/v17 { refreshVNDB: true }` → 200；`payload.data.vndb.title === 'Stub VN v17'`、`rating === 8`；`payload.data.user` deepEqual 刷新前的 user；`state.saveCalls.length === 1`。
    2. `PUT /api/vn/v500 { refreshVNDB: true }` → 500；`payload.success === false`；`payload.error` 以 `VNDB API错误` 开头；`state.saveCalls.length === 0`；`state.entries.v500.vndb` 与刷新前 deepEqual。
- 验证：`node --test tests/router/vn.status.test.mjs`

## Step 3 — i18n

- [ ] `public/js/locales/zh-CN.js` / `en.js` 同步新增（design §3.4）：`common.refreshVndb`、`common.refreshing`、`index.refreshVndbAriaLabel`（含 `{title}`）、`toast.refreshOk`、`prefix.refreshFailed`。放在各域相邻语义 key 旁（`common.saving` 后、`toast.updateOk` 后、`prefix.updateFailed` 后、`index.*AriaLabel` 旁）。
- 验证：`node --test tests/public/i18n.keys.test.mjs`

## Step 4 — 组件逻辑 `public/js/components/vnShelf.js`

- [ ] `import { mergeVndbIntoListItem } from '../vn-list-item.js';`
- [ ] 状态：`refreshing: {}` + 注释（per-id busy map；不同 id 可并行）。
- [ ] 方法（放在 `deleteVN` 之后、`renderMarkdown` 之前）：
  ```js
  isRefreshing(id) { return Boolean(id && this.refreshing[id]); },

  // 单条目 VNDB 刷新：只传 refreshVNDB，用户字段由后端三态语义原样保留。
  // 成功后就地合并（不走 loadVNList，避免重置渲染窗口/滚动）。
  async refreshVN(id) {
    if (!id || this.refreshing[id]) return;
    this.refreshing[id] = true;
    try {
      const res = await vnAPI.update(id, { refreshVNDB: true });
      this.applyRefreshedEntry(res.data);
      this.$store.app.addToast(t('toast.refreshOk'));
    } catch (error) {
      this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.refreshFailed')), 'error');
    } finally {
      delete this.refreshing[id];
    }
  },

  applyRefreshedEntry(entry) {
    if (!entry?.id) return;
    const idx = this.vnList.findIndex(item => item.id === entry.id);
    if (idx !== -1) {
      this.vnList[idx] = mergeVndbIntoListItem(this.vnList[idx], entry);
      this.filteredList = this.applyFilters(this.vnList);   // 不 resetRenderWindow
    }
    if (this.selectedVN?.id === entry.id) {
      this.selectedVN = entry;
    }
  },
  ```
- [ ] 在 `loadVNList` 的窗口重置注释（`resetRenderWindow` 上方「四处显式调用」）补一句：`applyRefreshedEntry` 有意不重置。
- 验证：`npm run lint`

## Step 5 — 页面 `public/index.html`

- [ ] 卡片：在 `.vn-card-image-wrapper` 内 `.all-age-badge` 之后插入 design §3.1 的 `<template x-if="$store.app.isAdmin">` 按钮块。
- [ ] 详情页脚：替换为 design §3.2（刷新按钮 + 编辑/删除加 `:disabled="isRefreshing(selectedVN.id)"`）。所有新按钮 `type="button"`。
- 检查：`data-i18n` 不与 `x-text` 同节点；icon-only 按钮有 `:aria-label`；无硬编码文案。

## Step 6 — 样式

- [ ] `public/css/cards-detail.css`：在 `.vn-card-image-wrapper .all-age-badge` 规则之后新增 `.vn-card-refresh-btn` 块（design §3.1：定位/尺寸/玻璃底/opacity 显现/hover/`:disabled`/`[aria-busy="true"] svg` spin/`@media (hover: none)`），带中文块注释说明 z-index 阶梯（::before 1 < nsfw 5 < badge/btn 10）与显现策略。**不写 `outline`**。
- [ ] `public/css/base.css`：
  - `.btn-sm` 之后新增 `.btn:disabled { opacity: 0.6; pointer-events: none; }` + 注释「共享禁用态；pointer-events 同时压掉 hover 位移」。
  - `.modal-footer` 之后新增 `.modal-footer-start { margin-right: auto; }`。
- 手工验证（`npm run dev`，管理员登录）：
  - 桌面 hover 卡片 → 右上角钮显现；Tab 到卡片 → 显现；点击 → 旋转 → toast → 卡片字段更新、滚动不动。
  - DevTools 切触屏模拟（hover: none）→ 钮常显。
  - NSFW 模糊封面上按钮可点且不触发「点击显示」。
  - 详情弹窗页脚三按钮布局；刷新中编辑/删除变灰；成功后弹窗内容更新且不关闭。
  - 360px 视口页脚不溢出。
  - 访客模式：卡片无按钮（Elements 面板确认无 `.vn-card-refresh-btn`）。
  - 暗色模式按钮可读。

## Step 7 — 文档

- [ ] `AGENTS.md`：
  - 架构树 `public/js/` 加 `vn-list-item.js  # 纯函数：完整条目 → 列表项 VNDB 字段合并（镜像 rowToListItem）`；
  - 页面组件表 `vnShelf` 说明追加「管理员单条目 VNDB 刷新（卡片图标 + 详情页脚，就地更新）」；
  - `tests/public/` 树加 `vn-list-item.test.mjs`。

## Step 8 — 质量门

- [ ] `npm run lint && npm test` 全绿。
- [ ] 逐条对照 `prd.md` AC1–AC9 勾选。
- [ ] 派 `trellis-check` 子代理复核（spec 合规、跨层一致：`mergeVndbIntoListItem` ↔ `rowToListItem` 字段口径）。

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `public/css/base.css` `.btn:disabled` | 影响 settings 页已有禁用按钮外观（预期为改善） | 删除该规则 |
| `public/index.html` 卡片模板 | `x-for` 内嵌 `x-if` + 事件 `.stop`；若漏 `.stop` 会误开详情 | git checkout 该文件 |
| `tests/router/vn.status.test.mjs` stub 改动 | 哨兵 id 只影响 `v500`，既有用例用 `v17` | 还原 stub |

## 后续（不在本任务）

- `saveVN` 成功后也可改用 `applyRefreshedEntry` 风格就地更新替代 `loadVNList`（需全字段投影 `entryToListItem`），另开任务。
- Tier 页卡片刷新按钮（若有需求）。
- 后端 PUT 并发写的乐观锁（`updatedAt` 比对）——根治 `INSERT OR REPLACE` 覆盖/复活问题。

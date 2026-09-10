# Design：管理员单条目 VNDB 刷新按钮

## 1. 架构与边界

| 层 | 改动 | 说明 |
|---|---|---|
| 后端 `src/` | **无代码改动** | 复用 `PUT /api/vn/{id}` + `{ refreshVNDB: true }`；仅补测试 |
| 前端组件 `public/js/components/vnShelf.js` | 新增 `refreshing` busy map、`isRefreshing(id)`、`refreshVN(id)`、`applyRefreshedEntry(entry)` | 组件本地状态，不进 `$store.app` |
| 前端纯模块 `public/js/vn-list-item.js`（新） | `mergeVndbIntoListItem(item, entry)` | 零 DOM 依赖，可 node:test；镜像 `rowToListItem` 的 VNDB 派生字段口径 |
| 页面 `public/index.html` | 卡片封面右上角图标按钮；详情页脚文字按钮；编辑/删除按钮加 `:disabled` | `x-if="$store.app.isAdmin"` 包裹卡片按钮 |
| 样式 `public/css/cards-detail.css` | `.vn-card-refresh-btn` 及其 hover/focus-within/busy/`(hover: none)` 规则 | 卡片归属文件 |
| 样式 `public/css/base.css` | `.btn:disabled` 通用禁用态；`.modal-footer-start` | `.btn`/`.modal-footer` 归属文件（共享面变更，见 §6） |
| i18n `public/js/locales/{zh-CN,en}.js` | 5 个新 key | parity 测试强制 |
| 测试 | `tests/router/vn.status.test.mjs` +2 用例；`tests/public/vn-list-item.test.mjs` 新增 | |
| 文档 `AGENTS.md` | 架构树加 `vn-list-item.js`；vnShelf 描述补「单条目刷新」 | |

## 2. 数据流

```
[卡片图标 @click.stop] ──┐
                         ├─> refreshVN(id)
[详情页脚按钮 @click] ───┘      │
                                ├─ guard: !id || refreshing[id] → return
                                ├─ refreshing[id] = true            (按钮 disabled + aria-busy + spin)
                                ├─ res = await vnAPI.update(id, { refreshVNDB: true })
                                │     后端: fetchVNDB → entry.vndb 覆盖 → saveVNEntry → { data: entry }
                                ├─ success:
                                │     applyRefreshedEntry(res.data)
                                │       ├─ idx = vnList.findIndex(id)
                                │       │    vnList[idx] = mergeVndbIntoListItem(vnList[idx], entry)
                                │       │    filteredList = applyFilters(vnList)      ← 不 resetRenderWindow
                                │       └─ selectedVN?.id === id → selectedVN = entry  ← 详情弹窗就地刷新
                                │     toast t('toast.refreshOk')
                                ├─ error:
                                │     toast friendlyErrorMessage(error, t('prefix.refreshFailed'))  (数据不动)
                                └─ finally: delete refreshing[id]
```

### 2.1 `mergeVndbIntoListItem(item, entry)` 契约

```js
// public/js/vn-list-item.js
export function mergeVndbIntoListItem(item, entry) → 新对象（不可变，不修改入参）
  title      = vndb.title || ''
  titleJa    = vndb.titleJa || vndb.title || ''
  titleCn    = user.titleCn || vndb.titleCn || ''        // 镜像 row.title_cn_user || row.title_cn
  image      = vndb.image || ''
  imageNsfw  = Boolean(vndb.imageNsfw)
  rating     = Number.isFinite(n) && n >= 0 ? n : 0      // 镜像 toNonNegativeNumber
  developers = Array.isArray(vndb.developers) ? vndb.developers : []
  allAge     = Boolean(vndb.allAge)
  其余字段（id/personalRating/playTimeMinutes/tierId/tierSort/status/createdAt）沿用 item
```

口径来源：`src/repository.js rowToListItem`（`:258-277`）。文件头注释必须指向该函数，任何一侧改动需同步（与 `constants.js` 同类「跨端同值约定」）。

### 2.2 为什么不重拉列表 / 不改后端

- 重拉 `GET /api/vn`：一次点击换全表传输，且 `loadVNList` 语义耦合渲染窗口重置；就地合并 8 个字段成本极低。
- 后端返回列表项投影：改变 PUT 响应契约，PRD 明确 out of scope。

## 3. UI 设计

### 3.1 卡片图标按钮（`.vn-card-refresh-btn`）

```html
<!-- 放在 .vn-card-image-wrapper 内、.all-age-badge 之后 -->
<template x-if="$store.app.isAdmin">
  <button
    type="button"
    class="vn-card-refresh-btn"
    :aria-disabled="isRefreshing(vn.id) ? 'true' : 'false'"
    :aria-busy="isRefreshing(vn.id) ? 'true' : 'false'"
    :aria-label="$t('index.refreshVndbAriaLabel', { title: vn.titleCn || vn.titleJa || vn.title })"
    :title="$t('common.refreshVndb')"
    @click.stop="refreshVN(vn.id)"
    @keydown.enter.space.stop
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <!-- feather refresh-cw -->
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  </button>
</template>
```

- 事件隔离：`@click.stop` 阻断整卡 `openDetail`；`@keydown.enter.space.stop` 阻断整卡 `@keydown.enter.space.prevent`（原生 button 的 Enter/Space 仍触发自身 click）。同 `.nsfw-overlay @click.stop` 先例。
- 视觉：32px 圆形深色玻璃钮（`rgba(0,0,0,.45)` + `backdrop-filter: blur(6px)` + 白色 16px 图标 + 细白边），与主题变量解耦（同状态章策略），在任何封面上可读。hover → `var(--accent-color)` 底。
- 显现策略：
  - 默认 `opacity: 0`；`.vn-card:hover .vn-card-refresh-btn`、`.vn-card:focus-within .vn-card-refresh-btn`（卡片自身获焦即匹配）、`[aria-busy="true"]` → `opacity: 1`。
  - `@media (hover: none) { .vn-card-refresh-btn { opacity: 1 } }` 触屏常显。
  - 不隐藏 hit-test（opacity 不影响可点击），但桌面上鼠标在卡片上时按钮必已显现，无「隐形误触」。
- 层级：`z-index: 10`（> `.nsfw-overlay` 5 > `.vn-card::before` 1），NSFW 模糊封面上仍可点。位置 `top:12px; right:12px` 与左上 `.all-age-badge` 对称。
- Busy：`[aria-busy="true"] svg { animation: spin .8s linear infinite }`（复用 `base.css @keyframes spin`）；`[aria-busy="true"] { cursor: progress }`。
- **触发按钮的 busy 态用 `aria-disabled` 而非 `disabled`**（实现期 Playwright 实证）：原生 `disabled` 会让 Chrome 把焦点丢到 `<body>`——卡片上键盘用户失位，弹窗内焦点直接逃出 `trapFocus`。重入由 `refreshVN` 的 `refreshing[id]` 守卫拦截（连击 Enter/Enter/Space 只发 1 次 PUT）。编辑/删除不是触发时的焦点元素，保留真 `disabled`。spinner 为功能性反馈，按规范在 reduced-motion 下保留；opacity 过渡非位移，无需 reduce 规则。
- 焦点环：原生 `<button>` 自动获得全局 `:focus-visible` 规则，**不写组件级 outline**。

### 3.2 详情弹窗页脚

```html
<div class="modal-footer" x-show="$store.app.isAdmin">
  <button type="button" class="btn btn-secondary modal-footer-start"
    :aria-disabled="isRefreshing(selectedVN.id) ? 'true' : 'false'"
    :aria-busy="isRefreshing(selectedVN.id) ? 'true' : 'false'"
    @click="refreshVN(selectedVN.id)">
    <span x-text="isRefreshing(selectedVN.id) ? $t('common.refreshing') : $t('common.refreshVndb')"></span>
  </button>
  <button class="btn btn-secondary" :disabled="isRefreshing(selectedVN.id)" @click="openEdit(selectedVN)" data-i18n="common.edit"></button>
  <button class="btn btn-danger" :disabled="isRefreshing(selectedVN.id)" @click="deleteVN()" data-i18n="common.delete"></button>
</div>
```

- 布局：`[刷新 VNDB] ················ [编辑] [删除]` —— `.modal-footer-start { margin-right: auto }` 把「从源同步」与「改我的数据」两类操作在视觉上分开。
- 文案动态切换走 `$t`（`x-text` 与 `data-i18n` 互斥，故内层 `<span>` 用 `x-text`）。
- **编辑 / 删除在同一条目刷新中禁用**：后端 `INSERT OR REPLACE` 整行写入，在途刷新落库会复活已删行 / 覆盖并发编辑（research §1）。窗口约 1-2s。

### 3.3 `.btn:disabled`（base.css 新增）

```css
.btn:disabled,
.btn[aria-disabled="true"] { opacity: 0.6; pointer-events: none; }
```

`aria-disabled` 分支服务需要保持键盘焦点的 busy 按钮（见 §3.1）。

`pointer-events: none` 同时压掉 `.btn-*:hover` 的位移/变色。这是共享面变更：settings 页已有多处 `:disabled="isLoading"` 按钮将首次获得禁用态视觉——属修正而非回归。

### 3.4 i18n 新 key

| key | zh-CN | en |
|---|---|---|
| `common.refreshVndb` | 刷新 VNDB | Refresh VNDB |
| `common.refreshing` | 刷新中... | Refreshing... |
| `index.refreshVndbAriaLabel` | 从 VNDB 刷新「{title}」 | Refresh "{title}" from VNDB |
| `toast.refreshOk` | VNDB 数据已刷新 | VNDB data refreshed |
| `prefix.refreshFailed` | 刷新失败 | Refresh failed |

## 4. 状态与并发

- `refreshing: {}`（组件本地，Alpine 响应式对象；`this.refreshing[id] = true` / `delete this.refreshing[id]`）。用对象而非 `Set`，避免依赖集合类型的响应式细节。
- 同 id 重入守卫在 `refreshVN` 开头；不同 id 可并行。
- `applyRefreshedEntry` 按 id `findIndex`：期间若列表已因排序切换重载，仍能正确定位；找不到（已删除）则跳过列表更新。
- 排序不就地重排（例如按评分排序时评分变化，位置保持到下次加载）——避免卡片跳位，接受。
- 搜索/状态筛选通过 `applyFilters` 重放：标题变化导致不再匹配搜索词时卡片会消失，属正确行为。

## 5. 错误处理

- VNDB 500 → `friendlyErrorMessage` 第 3 支通用文案（不泄露上游 message）；404（条目已删）→ 第 5 支「资源不存在」；网络 → NETWORK。均为 `prefix.refreshFailed` 前缀。
- 失败不改任何本地数据；`finally` 清 busy。

## 6. 兼容性 / 风险 / 回滚

- 访客：`x-if` 不渲染卡片按钮；页脚整块 `x-show` 已隐藏。DOM 与现状一致。
- Tier 页使用同一 `createDetailModal` mixin 但页脚属各页 HTML，本任务不动 `tier.html`；`isRefreshing` 只定义在 `vnShelf`，不进 mixin。
- 共享面变更仅 `.btn:disabled` 与 `.modal-footer-start`；回滚 = 还原两处 CSS。
- 全部改动无迁移、无后端行为变化；回滚为纯前端文件还原。

## 7. 备选方案（已否决）

| 方案 | 否决原因 |
|---|---|
| 刷新后 `loadVNList()` | 重置渲染窗口 / 滚动位置（用户已决策就地更新） |
| 新端点 `POST /api/vn/{id}/refresh` | 现有 PUT 已覆盖；增加契约面 |
| 卡片按钮常显（桌面） | 管理员模式下每卡一个常显按钮噪声大；hover/focus-within 显现 + 触屏常显足够 |
| 用 `Set` 存 busy id | Alpine 集合响应式细节风险，对象 map 更直白 |

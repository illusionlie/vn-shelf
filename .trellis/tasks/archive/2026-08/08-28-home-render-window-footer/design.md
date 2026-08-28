# 技术设计：首页渲染窗口化 + 全站 Footer

## 一、渲染窗口化（方案 A）

### 数据流

```
vnList (全量，一次拉取)
  → applyFilters (搜索 ∧ 状态，纯函数，保持现有契约)
  → filteredList (全量过滤结果，供计数)
  → visibleList = filteredList.slice(0, visibleCount)  (getter)
  → x-for 渲染 visibleList
```

API 契约、过滤/排序逻辑零改动；只是 x-for 的数据源从 `filteredList` 换成窗口切片。

### vnShelf.js 新增状态与方法

```js
const RENDER_PAGE_SIZE = 30;   // 模块级常量（首页私有，不进 constants.js——那里只放跨端共享约定）
const AUTO_LOAD_BUDGET = 2;    // 自动追加预算，用尽转手动按钮

// data:
visibleCount: RENDER_PAGE_SIZE,
autoLoadsLeft: AUTO_LOAD_BUDGET,

// getter（Alpine data 对象支持 getter，响应式正常追踪）:
get visibleList() { return this.filteredList.slice(0, this.visibleCount); },
get hasMore()     { return this.filteredList.length > this.visibleCount; },

// 方法:
resetRenderWindow() { this.visibleCount = RENDER_PAGE_SIZE; this.autoLoadsLeft = AUTO_LOAD_BUDGET; },
loadMore()          { this.visibleCount += RENDER_PAGE_SIZE; this.autoLoadsLeft = AUTO_LOAD_BUDGET; },
```

### 哨兵与自动加载

- `index.html` 网格后放 `<div x-ref="renderSentinel" x-show="hasMore" aria-hidden="true">`；`display:none` 时不产生交叉，天然停火。
- `init()` 内建 `IntersectionObserver`（`rootMargin: '400px'` 预取）：回调中 `hasMore && autoLoadsLeft > 0` 才追加（`visibleCount += PAGE_SIZE; autoLoadsLeft--`）。
- **IO 只在交叉状态跳变时触发**：追加后若哨兵仍在视口内（未离开过），不会自动再触发。因此每次追加后 `$nextTick` 手动复检一次哨兵位置，仍相交且预算未用尽则继续追加（短视口边界情形兜底）。
- 无 `IntersectionObserver`：降级 `visibleCount = Infinity` 全量渲染（R6）。
- MPA 无需 teardown（与 `setupTranslationsRefresh` 同一前提）。

### 重置时机（4 处显式调用 `resetRenderWindow()`）

`loadVNList`（含增删改后的重载）、`handleSearch`、`handleStatusFilterChange`、`handleSortChange`。显式调用而非 `$watch`，保持本项目可 grep 的显式风格。

### index.html 改动

- `x-for="vn in filteredList"` → `x-for="vn in visibleList"`（仅此一处换绑）。
- 网格后新增：哨兵 div + 「加载更多」按钮 + 计数文本：

```html
<div class="render-window-controls" x-show="!isLoading && filteredList.length > 0">
  <span class="render-window-count text-muted"
        x-text="$t('index.showingCount', { shown: Math.min(visibleCount, filteredList.length), total: filteredList.length })"></span>
  <button class="btn btn-secondary" x-show="hasMore && autoLoadsLeft === 0"
          @click="loadMore()" data-i18n="index.loadMore"></button>
  <div x-ref="renderSentinel" x-show="hasMore" aria-hidden="true"></div>
</div>
```

按钮用既有 `.btn .btn-secondary`（原生 `<button>`，焦点环/free a11y）；计数用 `$t` magic 插值（dynamic 绑定不加 data-i18n，遵守互斥规则）。

## 二、全站 Footer

### 注入（layout.js）

新增 `export function injectFooter()`，与 `injectShell()` 同模式（模板字符串 + DOM 写入 + 幂等守卫）：

- 挂载点：`document.body.appendChild`（in-flow 内容，**不能**进 `#app-shell`——那里全是 `position:fixed` 元素且位于 body 顶部）。
- 跳过条件：`document.body.classList.contains('login-page')`（登录页 `overflow:hidden` 全屏布局，footer 不可见也无意义）或已有 `.site-footer`（幂等）。
- 调用点：`app.js` 中 `injectShell();` 之后、`applyI18nDom();` 之前——这样首遍 i18n 扫描即可翻译 footer 的 `data-i18n` 标记，第二遍幂等兜底。

###  markup 契约

```html
<footer class="site-footer">
  <span>© <span data-footer-year></span> VN Shelf</span>   <!-- 年份由 injectFooter 内 JS 填 new Date().getFullYear() -->
  <span data-i18n="footer.dataFrom"></span> <a href="https://vndb.org" target="_blank" rel="noopener noreferrer">VNDB</a>
  <a href="https://github.com/illusionlie/vn-shelf" target="_blank" rel="noopener noreferrer" data-i18n-aria-label="nav.githubRepo">GitHub</a>
</footer>
```

- 「© 2026 VN Shelf」为品牌+符号+数字，跨语言同形，不占 i18n key（避免 `data-i18n` 不支持 `{year}` 插值的问题；`applyI18nDom` 只做 textContent 替换）。
- `footer.dataFrom`（数据来自 / Data from）与链接文字分离成兄弟节点，遵守 data-i18n **leaf-only** 规则。
- GitHub 链接 aria-label **复用**既有 `nav.githubRepo` key（code-reuse 原则），链接文本 "GitHub" 为品牌名，双语同值。

### i18n 新增 key（zh-CN / en 双语同步，parity 测试强制）

| key | zh-CN | en |
|-----|-------|----|
| `footer.dataFrom` | 数据来自 | Data from |
| `index.loadMore` | 加载更多 | Load more |
| `index.showingCount` | 已显示 {shown} / {total} 条 | Showing {shown} / {total} |

（`footer` 为词典新增域，同步更新 zh-CN.js 顶部域注释。）

### CSS（base.css）

footer 是 `layout.js` 注入的共享 DOM + 3+ 页面使用 → 按契约进 `base.css`：

- `.site-footer`：`border-top: 1px solid var(--border-color)` + `background: var(--header-bg-color)` + `backdrop-filter: blur(8px) saturate(180%)`（与 `.main-header` 呼应），`padding: 12px 5%`，居中 flex，间距 gap，小字 muted 色（用既有文本 token，不新增颜色变量）。
- **贴底布局**：`body { display: flex; flex-direction: column; }` + `main.container { flex: 1 0 auto; }`。
  - 兼容性已评估：`.main-header` fixed 不受影响；`#app-shell` 子元素全 fixed；`.container` 的 `max-width:1500px + margin:0 auto` 在 column flex 下由 stretch+max-width+auto margin 正常居中。
  - 须逐一核实 `tier.html`/`stats.html`/`settings.html` 的 main 是否同为 `.container`；若有个别页 main 无此类名，补统一类名而非写页面特例。
  - 登录页（`body.login-page`，`overflow:hidden` + `.login-container min-height:100vh`）在 flex column 下宽度/居中应保持不变——实现后目检回归。
- 断点 480/768/1024 内 footer 无特殊规则（padding 与 header 同为 5%）；无新动效，无需 reduced-motion 对应块。

## 三、质量门

- `npm run lint && npm run test` 全绿（i18n 双向 parity 自动覆盖新 key）。
- 窗口化为 Alpine 组件内逻辑，暂无 node --test 可挂载点；按 PRD 的 AC1–AC8 手工验证并在完成汇报中记录。

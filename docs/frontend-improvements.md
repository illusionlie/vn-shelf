# 前端改进计划（VN Shelf）

> 侦察日期：2026-06-28
> 范围：`public/` 全量（5 个 HTML + `js/` 11 个模块 + `css/style.css`）
> 方法：人工通读 + 定位核对（行号均经二次核验）
> 目标：把侦察发现的可改进点归档成可执行修复方案，并按性价比拆分批次与任务。

---

## 第一部分：问题清单

每条记录：**定位 / 现状 / 影响 / 修复方法 / 验收标准**。类别分为 架构 · 安全 · 性能 · 可访问性(a11y) · 可维护性 · 用户体验(UX)。

---

### 1. 架构

#### A1. MPA 页首/导航/Toast 在五个 HTML 中逐字重复
- **定位**：`public/index.html`、`public/tier.html`、`public/settings.html`、`public/stats.html`、`public/login.html` 的 `<header>` + 导航 + 移动菜单 + `#toast-container` + 进度条 + 背景 overlay。
- **现状**：相同结构在 5 个文件里重复粘贴，改一处需同步改五处，极易遗漏产生风格漂移。
- **影响**：可维护性最严重债务；任何全局壳层调整成本线性放大。
- **修复方法**（二选一，见 §3 决策点 D-A）：
  - **渐进方案**：新增 `public/js/layout.js`，在 `alpine:init` 前（或 `DOMContentLoaded`）把公共壳层作为模板字符串注入到各 HTML 的 `<div id="app-shell">` 占位；HTML 仅保留占位 + 各自的 `<main>` 主体。
  - **彻底方案**：迁移到单页 SPA（hash 路由），壳层只渲染一次。工作量较大但根治重复。
- **验收**：壳层结构只在单一出处定义；新增一个 nav 项只需改一处后五个页面同步生效；`npm run lint` 与 `npm run test` 通过。

#### A2. `getAppearance` 跨页面重复请求且无 Store 缓存
- **定位**：`public/js/theme.js:96 initBackground`、`public/js/components/shared.js:42 loadConfig`。
- **现状**：每个页面初始化都各发一次 `/api/config/appearance`；translations 侧每页还拉一次 `version.json`（见 P2）。
- **影响**：MPA 模型下每个页面切换多一次往返；首屏渲染依赖。
- **修复方法**：在 `Alpine.store('app')` 内增加 `appearance` 字段与 `loadAppearance()`，带 `Promise` 去重（同次首屏并发只发一次）；`theme.js` 与 `shared.js` 改为从 Store 读取；用 `sessionStorage` 缓存首次结果作为下一页冷启动直读（键带简单版本号）。
- **验收**：单页内 `/api/config/appearance` 至多 1 次；刷新页面命中 sessionStorage 直读后台静默更新。

#### A3. API 信封不统一（`res.data || res`）
- **定位**：`public/js/components/statsPage.js:25`。
- **现状**：`this.stats = res.data || res` 的兜底揭示后端 `/api/stats` 等接口信封与其它 `{data}` 包裹不一致。
- **影响**：前端处处防御性兜底，类型语义模糊。
- **修复方法**：统一后端信封为 `{success, data, ...}`（或前端 `apiRequest` 统一解包），删除前端 `|| res` 兜底。**此项偏后端，本计划标记为关联项，不在前端批次内单独执行**，仅记录。
- **验收**：所有 `apiRequest` 调用点对返回形态有统一假设，无 `|| res` 残留。

#### A4. `settingsPage` 四处 `save*` 样板重复
- **定位**：`public/js/components/settingsPage.js`：`saveVndbToken`、`changePassword`、`saveTagsConfig`、`saveAppearanceConfig`（各含 `isLoading=true / try-catch / addToast / finally isLoading=false`）。
- **现状**：同构错误处理 ×4。
- **影响**：错误处理风格漂移、补丁易漏。
- **修复方法**：抽 `withLoading(async fn, { successMsg, errorPrefix })`，封装 `isLoading`/`try-catch`/`toast`；四处调用改为单行。
- **验收**：四处 save 方法行数显著下降；单点修改 toast 行为即可全局生效。

---

### 2. 安全

#### S1. Alpine CDN `@3.x.x` 未锁定版本 + 无 SRI + 第三方依赖
- **定位**：`public/index.html:10`、`public/login.html:9`、`public/settings.html:9`、`public/stats.html:9`、`public/tier.html:9`。
- **现状**：`https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js`——`3.x.x` 浮动，无 `integrity`/SRI，依赖 jsdelivr 可用性。
- **影响**：供应链漂移与可用性单点；任意次版本升级可破站。
- **修复方法**：自托管——下载指定版本（如 `3.14.x`）的 `cdn.min.js` 放到 `public/js/vendor/alpine.min.js`，五处 HTML 改为 `/js/vendor/alpine.min.js`。自托管场景下 SRI 非必需（无中间人威胁面）；改为在 `package.json` 记录 alpine 版本与下载脚本便于升级审计。
- **验收**：五个 HTML 不再引用第三方 CDN；离线/断网 CDN 下站内功能不受影响；`npm run deploy` 正常。

#### S2. 手写 Markdown 解析器维护成本与攻击面
- **定位**：`public/js/markdown.js:1-445`（`isSafeUrl:55-75`、`escapeHtml`、`parseInline:80`）。通过 `x-html` 渲染于 `public/index.html:270`、`public/tier.html:297` 的 review 字段。
- **现状**：自实现 Markdown → HTML，依赖手写净化；`isSafeUrl` 对无协议字符串（`example.com/path`）一律放行视为相对路径；重复转义链路脆弱。
- **影响**：长期与攻击面赛跑，单测仅覆盖安全用例（`tests/public/markdown.security.test.mjs`），缺语法正确性测试。
- **修复方法**（决：整体替换 marked + DOMPurify）：自托管 `marked.min.js` 与 `purify.min.js` 到 `public/js/vendor/`；`public/js/markdown.js` 改为薄封装——`marked.parse(text)` 后过 `DOMPurify.sanitize(html, {USE_PROFILES:{html:true}})`；删除自实现解析器与手写 `escapeHtml/isSafeUrl`；回归 review 渲染样式（粗体/斜体/链接/图片/代码块/列表）。
- **验收**：新增 fuzz 测试用例（含 `javascript:` 链接、`data:` 图片、CSS 注释断链、嵌套转义）通过；现有 markdown 安全测试迁移后全绿；review 渲染样式与原先一致。

#### S3. 背景图 URL CSS 注入面
- **定位**：`public/js/theme.js:108` `const safeUrl = config.backgroundUrl.replace(/["\\]/g, '\\$&')`。
- **现状**：仅转义 `"` 与 `\`，未拦截换行与 CSS 注释；源是 admin 配置（信任级较高但仍可被注入）。
- **影响**：背景字段可越权改写 body style 注入额外 CSS。
- **修复方法**：用 `URL` 构造器解析后白名单校验 protocol（`https:`/`http:`，或相对路径）再赋值；拒绝带换行/`;`/注释的 URL；或直接 `encodeURIComponent` 后再拼。
- **验收**：注入 `\n;--` 等变体不生效；正常 URL 仍正常显示。

#### S4. 用户面错误直接拼 `error.message`
- **定位**：`public/js/components/shared.js:95`、`public/js/components/vnShelf.js:142`、`public/js/components/settingsPage.js` 多处。
- **现状**：`addToast('失败: ' + error.message, 'error')` 把后端技术文本透传用户。
- **影响**：UX 与信息泄露。
- **修复方法**：约定错误 toast 文案表（按 `error.code` 映射友好提示），`withLoading` 内统一兜底；`error.message` 仅 `console.warn`。
- **验收**：用户面 toast 全部为友好文案，无裸 stack/HTTP 文本。

---

### 3. 性能

#### P1. 搜索 `@input` 无防抖
- **定位**：`public/index.html:100`（`@input="handleSearch()"`）+ `public/js/components/vnShelf.js:79 handleSearch`。
- **现状**：每次按键全表过滤。
- **影响**：大列表下输入卡顿。
- **修复方法**：`utils.js` 新增 `debounce(fn, ms=200)`，`handleSearch` 包裹防抖；或用 Alpine 的 `x-effect` + debounce 模式。
- **验收**：连续快速输入 5 字仅触发一次过滤；过滤结果正确。

#### P2. 翻译 `version.json` 每页拉取，无节流
- **定位**：`public/js/translations.js:259 checkForUpdatesInBackground`（每次 `initTranslations` 即每页访问都拉）。
- **现状**：无 last-check 时间戳，每次进站都比对远端版本。
- **影响**：每页多一个请求；远端 version.json 压力。
- **修复方法**：`localStorage` 存 `lastVersionCheckAt`，24h 内跳过远端检查，超时再后台比对。
- **验收**：单日内多次切换页面，`version.json` 仅请求一次。

#### P3. IndexedDB 连接不缓存
- **定位**：`public/js/translations.js:31 openTranslationsDB`。
- **现状**：每次调用 `open` 新连接、用完不缓存 `IDBDatabase` 实例。
- **影响**：连接建立开销重复。
- **修复方法**：模块级缓存 `let _db`，`openTranslationsDB` 命中缓存直接 resolve；DB 关闭事件清理。
- **验收**：多次 `getFromIndexedDB` 只触发一次 `onsuccess`。

#### P4. Tier 批量分片串行
- **定位**：`public/js/components/tierlistPage.js:285 applyTierBatchUpdates`。
- **现状**：分片 await 串行。
- **影响**：大批量拖拽提交缓慢。
- **修复方法**：保持分片边界顺序（同 vn 不跨片），用 `Promise.all` 并行提交各片；失败回滚沿用 `loadVNList`。
- **验收**：200+ 条目提交耗时下降；提交顺序语义不变。

#### P5. 单文件 1918 行 CSS 全量阻塞首屏
- **定位**：`public/css/style.css:1-1918`（仅 1 个 `@media` 1462 行）。
- **现状**：单文件首屏阻塞；平板/宽屏无适配，靠 `desktop-only/mobile-only` 硬切。
- **影响**：首屏渲染慢 + 中间断点体验差。
- **修复方法**：拆分 `style.css` 为 `base.css` + 各组件 css，按页面按需引入；增补断点（`480 / 768 / 1024`）；引入 critical CSS 内联头部、余 `media` 异步。
- **验收**：首屏阻塞 CSS 体积下降；中间断点布局合理；`npm run lint` 无未用规则告警。

#### P6. 进度条双轨逻辑
- **定位**：`public/js/utils.js:74 initProgressBar`。
- **现状**：`window.addEventListener('load')` 与 3s `setTimeout` 兜底并存，可能在 load 已触发后误判。
- **影响**：进度条隐藏时机偶发错乱。
- **修复方法**：以单一来源（`load` 事件 + `pageshow` bfcache）为准；`setTimeout` 仅作为极端兜底且检查 `document.readyState`。
- **验收**：刷新/前进后退均正确隐藏进度条。

---

### 4. 可访问性（a11y）

#### K1. 拖拽无键盘替代
- **定位**：`public/js/components/tierlistPage.js:185-326`（`onDragStart/DragEnd/DragOver/Drop`）+ `public/tier.html:117/179`（仅 `draggable`）。
- **现状**：完全无 `keydown`/`aria-grabbed`/`aria-dropeffect`，键盘用户无法重排 Tier。
- **影响**：核心功能对键盘用户不可达。
- **修复方法**：为 `.tier-vn-card` 加 `tabindex="0"` + `role="button"`；监听 `ArrowLeft/ArrowRight` 移动当前节点、`Enter` 开始抓取、方向键在抓取态移动、`Esc` 取消；拖拽中用 `aria-grabbed="true"`；Tier 容器 `role="list"` + `aria-label`。
- **验收**：纯键盘可完成"把某 VN 从 A tier 移到 B tier 并改顺序"；屏幕阅读器播报位置变化。

#### K2. 卡片点击不可键盘聚焦
- **定位**：`public/index.html:154 @click="openDetail(vn)"`、`public/tier.html:120`。
- **现状**：卡片用 `@click` 打开详情，无 `role`/`tabindex`/`keydown`。
- **修复方法**：卡片容器加 `tabindex="0"` `role="button"` `aria-label="<title>"` 并监听 `@keydown.enter.space.prevent="openDetail(vn)"`.
- **验收**：Tab 可聚焦全部卡片，Enter/Space 打开详情。

#### K3. 模态无 role / 焦点陷阱 / Esc
- **定位**：`public/index.html:152`、`public/tier.html:212/306`（仅 `@click.self` 关闭）。
- **修复方法**：`utils.js` 新增 `trapFocus(el)`/`releaseFocus()` 与 `openModal`/`closeModal` 工具；模态容器加 `role="dialog" aria-modal="true" aria-labelledby`；打开时聚焦首个可聚焦项，Esc 关闭，关闭后还原触发元素焦点。
- **验收**：Tab 在模态内循环不外溢；Esc 关闭；关闭后焦点回到触发按钮。

#### K4. Toast 无 `aria-live`
- **定位**：各 HTML `#toast-container`（如 `index.html:283`）。
- **修复方法**：容器加 `role="status" aria-live="polite"`；error 型 toast 用 `aria-live="assertive"`。
- **验收**：屏幕阅读器即时播报 toast。

#### K5. 关闭按钮 `&times;` 无 `aria-label`
- **定位**：`public/index.html:155`、`public/tier.html:218/310`。
- **修复方法**：加 `aria-label="关闭"`；图标按钮统一 `class="icon-btn"`。
- **验收**：屏幕阅读器读出"关闭"。

#### K6. 主题暗色 FOUC（亮→暗闪烁）
- **定位**：`public/js/theme.js:73 initTheme` 在 `alpine:init`（defer 后）才加 `dark-mode`。
- **修复方法**：在五 HTML `<head>` 内联一段 blocking `<script>`，先读 `localStorage.theme` 提前加 class，再让 Alpine 接管。
- **验收**：刷新无亮→暗闪。

#### K7. 表单控件缺 `<label>`
- **定位**：`public/index.html:96 search-input`、`public/index.html:101 sort-select` 等。
- **修复方法**：补 `<label for>` 或 `aria-label`。
- **验收**：表单控件均有可访问名称。

#### K8. `:focus-visible` 覆盖薄弱
- **定位**：`public/css/style.css`（全文件仅 7 处 focus 选择器）。
- **修复方法**：补全各交互控件的 `:focus-visible` 样式（2px outline + offset）。
- **验收**：键盘 Tab 走查所有交互项有清晰焦点环。

#### K9. `toggleMobileMenu` 无 ARIA / 外部关闭
- **定位**：`public/js/utils.js:46`。
- **修复方法**：按钮 `aria-expanded`/`aria-controls`；点外部关闭；Esc 关闭。
- **验收**：ARIA 状态正确；外部点击关闭。

---

### 5. 可维护性

#### M1. 关键逻辑无单测
- **定位**：`public/js/components/tierlistPage.js:256-326 onDrop diff`（纯函数化后可测）；`public/js/markdown.js` 仅安全测试缺语法测试。
- **修复方法**：抽 `computeTierDiff` 纯函数 + 单测覆盖"同 tier 排序/跨 tier 移动/边界"；markdown 加语法正确性快照测试。
- **验收**：`npm run test` 新增用例全绿。

#### M2. 魔法字符串硬编码
- **定位**：`__untiered__`（`tierlistPage.js:117/137`）、`#ff4757` 默认色（`tierlistPage.js:60/190`）、`MAX_BATCH=200`（应与后端 `src/router.js` 常量同源）。
- **修复方法**：前端建 `public/js/constants.js`，后端常量在 `AGENTS.md` 注明出处，前端通过 `/api` 元信息或构建期同步。
- **验收**：全仓 `__untiered__` 单一来源。

#### M3. 状态管理散落
- **定位**：`Alpine.store('app')` 仅含 `isAdmin/isLoading/toasts`；配置/翻译/背景各自管。
- **修复方法**：与 A2 合并，扩展 Store 承载 `appearance/translations` 缓存与加载态。
- **验收**：跨页共享态集中可读。

---

### 6. 用户体验（UX）

#### U1. 用 `confirm()` 当二选一入口
- **定位**：`settingsPage.js:205`（导入模式）、`settingsPage.js:270`（清缓存）、`tierlistPage.js:253`（删 Tier）、`vnShelf.js:218`（删 VN）。
- **现状**：原生阻塞对话框，不可样式化、不可访问、反直觉（"确定=合并/取消=替换"）。
- **修复方法**：新增 `Alpine.data('confirmDialog')` 组件 + 全局 `app.confirm({title,message,confirm,cancel,danger})` 返回 Promise；导入模式改为"合并/替换"双按钮明确选择；删除动作用红色 danger 按钮二次确认。
- **验收**：四点全部替换；`confirm` 全仓零调用（迁移完成后）；可 Tab/Enter/Esc 操作。

#### U2. 背景/外观预览无"恢复/重置"
- **定位**：`settingsPage.js:319 previewBackground`。
- **修复方法**：预览区增"恢复上次保存"与"重置默认"按钮。
- **验收**：可一键撤销预览改动。

#### U3. i18n 全站硬编码中文
- **定位**：`settingsPage.js:217 formatStatus` map、各 toast 文案、`error.message` 拼接。
- **现状**：无 i18n 框架，文案散落 JS。
- **修复方法**：引入轻量 i18n（自托管 `i18next` 或自写 `t(key)` + JSON 词典）；先把 toast/status 文案迁入词典。
- **验收**：切换语言后 toast 与状态文案随之切换（结构上就绪，非本计划强制多语言上线）。

#### U4. NSFW 占位 data-URI 重复内联
- **定位**：`public/index.html:160/222`。
- **修复方法**：抽 CSS class `.nsfw-placeholder` + 单一 SVG background。
- **验收**：占位资源单一来源。

### 7. 小 Bug（立即可修）

#### B1. `api.js` headers 合并顺序导致 Content-Type 丢失
- **定位**：`public/js/api.js:33-39`
  ```js
  const config = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options            // ← 末尾展开会把合并好的 headers 整体覆盖
  };
  ```
- **影响**：调用方只要传任何 `headers`，`config.headers` 最终只剩 `options.headers`，`Content-Type` 丢失。
- **修复方法**：先展开 `options` 再单独合并 headers：
  ```js
  const config = { ...options };
  config.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  ```
- **验收**：传自定义 header 的请求仍带 `Content-Type: application/json`；现有测试全绿。

#### B2. Toast id 用 `Date.now()` 同毫秒碰撞
- **定位**：`public/js/app.js:44` `const id = Date.now()`。
- **影响**：同毫秒并发 toast id 冲突，`removeToast` 可能误删。
- **修复方法**：模块级递增计数器 `_toastSeq` 或 `crypto.randomUUID()`。
- **验收**：连续 `addToast` 两次 id 不重复。

#### B3. `onDragOver` 取 `dataset.vnId` 可能取不到
- **定位**：`public/js/components/tierlistPage.js:~233` `const targetId = targetCard?.dataset?.vnId || null`，依赖 `event.target.closest('.tier-vn-card')`，命中子元素时若卡片未标注 `data-vn-id` 则落空。
- **修复方法**：确保所有 `.tier-vn-card` 元素均渲染 `:data-vn-id="vn.id"`（已在部分节点存在，需全量核对）；并对 null 做 fallback 到末尾。
- **验收**：拖到子元素/空隙均能正确定位插入点。

---

## 第二部分：修复路线（5 批次）

按"性价比（影响/工作量）"排序，前批不依赖后批；每批可独立交付并通过现有 lint+test。

| 批次 | 主题 | 含问题 | 风险 | 预估 |
|---|---|---|---|---|
| B1 | 健壮性与供应链 | B1 B2 S1 | 低 | 小 |
| B2 | 缓存与重复消除 | A2 P1 P2 P3 A4 | 低-中 | 中 |
| B3 | 交互可达性与确认 UI | U1 K3 K2 K4 K9 A1(渐进) | 中 | 中 |
| B4 | 拖拽键盘化 + 安全兜底 | K1 B3 S2 S3 S4 | 中-高 | 中-大 |
| B5 | 工程化收尾 | P4 P5 P6 M1 M2 U3 M3 A3 | 中 | 大 |

**批次依赖**：B3 的 A1（壳层抽离）若选"彻底 SPA"方案会波及后续所有页，需先与用户拍板（D-A）；B5 的 M3 依赖 B2 的 Store 扩展就位。

---

## 第三部分：任务拆分（可派单元）

> 格式：`TID · 标题 · [文件] · 验收 · 依赖 · 风险`
> 工作量：S(<1h) / M(1-4h) / L(>4h)

### 批次 B1
- **T1-S1** · 自托管 Alpine + 五处 HTML 改本地引用 · [新增 `public/js/vendor/alpine.min.js`；`index.html:10`/`login.html:9`/`settings.html:9`/`stats.html:9`/`tier.html:9`；`package.json` 加版本与下载脚本] · 离线可用、无第三方 CDN · 无 · 低 · S
  - 决策点：需选锁定版本（建议当前最新 3.14.x 稳定版）。
- **T1-B1** · 修复 `apiRequest` headers 合并顺序 · [`public/js/api.js:33-39`] · 传自定义 header 仍带 Content-Type · 无 · 低 · S
- **T1-B2** · Toast id 改递增计数器 · [`public/js/app.js:44`] · 并发 toast id 不重复 · 无 · 低 · S

### 批次 B2
- **T2-A2** · Store 扩展 `appearance` 缓存 + sessionStorage · [`public/js/app.js`、`public/js/theme.js:96`、`public/js/components/shared.js:42`] · 单页 appearance 单请求、跨页直读 · 无 · 低 · M
- **T2-P1** · 搜索 debounce 200ms · [`public/js/utils.js` 新增 `debounce`、`public/js/components/vnShelf.js:79`、`public/index.html:100`] · 快速输入仅一次过滤 · 无 · 低 · S
- **T2-P2** · 翻译 version.json 24h 节流 · [`public/js/translations.js:259`] · 单日一次远端检查 · 无 · 低 · S
- **T2-P3** · IDB 连接缓存 · [`public/js/translations.js:31`] · 多次读取一次 onsuccess · 无 · 低 · S
- **T2-A4** · `withLoading` 抽象 + 四处 save 改造 · [`public/js/components/settingsPage.js`] · 行数下降、行为不变 · 无 · 低 · M

### 批次 B3
- **T3-U1** · `confirmDialog` 组件 + 全局 `app.confirm()`
  - [新增 `public/js/components/confirmDialog.js` + 注册到 `app.js`；HTML 增 `<div x-data="confirmDialog()">`；替换 `settingsPage.js:205/270`、`tierlistPage.js:253`、`vnShelf.js:218`]
  - 验收：四处替换、`confirm` 全仓零调用、键盘可达
  - 依赖：无 · 中 · M
- **T3-K3** · `trapFocus` 工具 + 模态 a11y · [`public/js/utils.js` 增 `trapFocus/releaseFocus`；`index.html:152`、`tier.html:212/306`] · Tab 不外溢、Esc 关闭、焦点还原 · 依赖 T3-U1（共用） · 中 · M
- **T3-K2/K4/K5/K7** · 卡片 role+键盘、Toast aria-live、关闭按钮 aria-label、表单 label · [多文件批量小修] · 走查通过 · 无 · 低 · M
- **T3-K9** · `toggleMobileMenu` ARIA + 外部关闭 · [`public/js/utils.js:46`] · aria-expanded 正确 · 无 · 低 · S
- **T3-A1** · 公共壳层抽离（渐进方案） · [新增 `public/js/layout.js`；五 HTML 改占位] · 单一出处 · 决策点 D-A · 中-高 · L
  - **决策点 D-A**：渐进 JS 注入 vs SPA 迁移。建议先走渐进方案，SPA 留作单独大任务。

### 批次 B4
- **T4-K1** · 拖拽键盘化 · [`tierlistPage.js` 监听 keydown + 状态机；`tier.html` 加 tabindex/role/aria-grabbed] · 纯键盘完成 Tier 重排 · 无 · 高 · L
  - 需配套单测（见 T5-M1）。
- **T4-B3** · `onDragOver` dataset fallback · [`tierlistPage.js:233`、`tier.html` 核对 `data-vn-id` 再次到达末尾] · 子元素命中不丢失 · 无 · 低 · S
- **T4-S2** · Markdown 整体替换 marked + DOMPurify（决策 D-S = 整体替换） · [新增 `public/js/vendor/marked.min.js` + `purify.min.js`；`public/js/markdown.js` 改为 marked.parse + DOMPurify.sanitize 薄封装，删除自实现解析器；迁移 `tests/public/markdown.security.test.mjs`；新增 fuzz 用例] · 注入用例全拦截且渲染样式不变 · 无 · 中-高 · M+L
- **T4-S3** · 背景图 URL 白名单校验 · [`theme.js:108`] · 换行/注释注入失效 · 无 · 中 · S
- **T4-S4** · 错误 toast 友好化（code→文案） · [约定 code 表；`withLoading` 兜底；`shared.js:95`/`vnShelf.js:142`/settings 多处] · 用户面无裸 stack · 依赖 T2-A4 · 低 · M

### 批次 B5
- **T5-P4** · Tier 分片并行提交 · [`tierlistPage.js:285`] · 顺序语义不变、耗时下降 · 无 · 中 · S
- **T5-P5** · CSS 拆分 + 断点补全 · [`public/css/style.css` → base + 组件] · 首屏体积下降、断点合理 · 无 · 中 · L
- **T5-P6** · 进度条单轨逻辑 · [`utils.js:74`] · bfcache/前进后退正确 · 无 · 低 · S
- **T5-M1** · `computeTierDiff` 纯函数化 + 单测；markdown 语法测试 · [`tierlistPage.js`、`tests/`] · 新增用例全绿 · 依赖 T4-K1 · 中 · M
- **T5-M2** · `constants.js` 统一魔法字符串（与后端常量同源） · [`public/js/constants.js`、`tierlistPage.js`、`router.js` 注释] · 单一来源 · 无 · 低 · M
- **T5-U3** · i18n 框架接入 + 文案迁移 · [`public/js/i18n.js` + 词典] · 切语言 toast 状态随变 · 无 · 中 · L
- **T5-M3/A3** · Store 承载 translations/config；删除 `|| res` 兜底 · 受 B2/M3 前置 · 无 · 中 · M
- 人工走查：键盘 Tab 全屏走查（含模态、拖拽、卡片、toast、表单）→ 出走查报告。

### 验收门禁
- 命令门禁：`npm run lint && npm run test`（eslint 与 node --test）。
- 每批 PR/提交附"走查 checklist"截图或文字描述。

### 风险与回滚
- 自托管 vendor 文件需纳入版本控制与 `AGENTS.md` 升级流程。
- DOMPurify / Alpine 锁定版本后建立升级检查点（变更日志 diff + 重跑安全测试）。
- a11y 改造可能微调现有交互视觉，需保留设计回退点。

---

## 附：决策点（已拍板 2026-06-28）

1. **D-A（壳层抽离路径）**：✅ **渐进 JS 注入**（新增 `public/js/layout.js`，壳层模板注入占位 div，保留 MPA 架构，A1 纳入 B3 批）。SPA 迁移不采用。
2. **D-S（Markdown 方案）**：✅ **整体替换为 marked + DOMPurify**（自托管两份 vendor，删除自实现解析器，回归 review 渲染样式）。保守 DNS 兜底方案不采用。
3. **D-V（Alpine 锁定版本）**：实现时取最新稳定 3.14.x patch，自托管到 `public/js/vendor/alpine.min.js`，版本记入 `package.json` + 下载脚本。
4. **D-i18n**：B5 阶段把 i18n 框架做结构就绪并迁移 toast/状态文案,多语言上线非本轮强制目标。

> 执行流程(已拍板)：**纳入 Trellis 任务流程管理**,按 .trellis 流程逐任务立项/执行/检查。首批从 **B1 健壮性与供应链** 开工。

---

## 附：关联文档

- `AGENTS.md` — 项目架构、API 路由、Worker 模型与开发注意事项。
- `tests/public/markdown.security.test.mjs` — 现有 Markdown 安全测试（S2 改造需扩展）。
- `.trellis/` — 任务管理目录（若按 Trellis 流程拆任务）。
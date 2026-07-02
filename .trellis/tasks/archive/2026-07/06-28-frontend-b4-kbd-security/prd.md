# PRD — B4 前端拖拽键盘化与安全兜底

> 上下文：`docs/frontend-improvements.md` 批次 B4（K1 / B3-small / S2 / S3 / S4）。
> 决策（已拍板 2026-06-28）：D-S 整体替换 marked + DOMPurify；Markdown **保留** `md-code-*` 自定义类名（marked renderer 复刻）；B4 一个任务完成 5 项。

## 背景

B1–B3 完成供应链/缓存/交互可达性后，B4 收口"拖拽键盘化"与"安全兜底"两组中-高风险遗留：Tier List 拖拽完全无键盘替代（核心功能对键盘用户不可达）、`onDragOver` dataset 命中子元素时可能取不到 `vnId`、手写 Markdown 解析器维护成本高、背景 URL 净化仅转义 `"`/`\`、错误 toast 直接拼 `error.message` 暴露后端技术文本。

## 技术验证（已做，关键前提）

marked 18 + 自定义 renderer 可逐场景复刻现有自实现输出形态：
- `<pre class="md-code-block"><code class="md-code[ language-xxx]">${text}</code></pre>`
- 内联 `<code class="md-code-inline">${text}</code>`
- 语言名经 `/^[a-z0-9]{1,32}$/i` 白名单；恶意/标点/超长/无语言名降级为不带 `language-`。

5 个测试用例（合法/恶意引号注入/无语言/标点 c++/超长 33a）输出已逐一对应现有 `markdown.security.test.mjs` 断言。**替换 marked 不需改现有测试断言**，零回归风险，是本决策可行性的核心依据。

## 目标（5 个独立可验证交付物）

### 1. Tier 拖拽键盘化（K1）
- 现状：`tierlistPage.js onDragStart/onDragOver/onDrop`（约 185-326 行）纯鼠标；`tier.html:120` 卡片仅 `draggable`。
- 目标：键盘可达——卡片 `tabindex="0"`、`aria-grabbed` 状态、`@keydown`：
  - `Enter` 进入"抓取态"（`aria-grabbed=true`，视觉高亮）
  - 抓取态下 `ArrowLeft/ArrowRight` 在当前 tier 内移动光标位置（`dropIndicator`），`ArrowUp/ArrowDown` 跨 tier 移动；`Enter` 确认落点（调用既有 `applyTierBatchUpdates` 路径），`Esc` 取消（清状态）
  - tier 容器 `role="list"`、卡片 `role="listitem"` + `aria-label="<title> · <tier>"`；非 admin 时键盘路径禁用（与拖拽一致）
- 共享：复用既有 `draggedVN/dropIndicatorTierKey/dropIndicatorIndex` 状态机，键盘与鼠标走同一 `applyTierBatchUpdates` 提交路径。

### 2. `onDragOver` dataset fallback（B3-small bug）
- 现状：`tierlistPage.js:~233` `targetCard?.dataset?.vnId || null`——若命中子元素或卡片未注 `data-vn-id` 则落空。
- 目标：核对所有 `.tier-vn-card` 均渲染 `:data-vn-id`（已确认 `tier.html:120` 有）；`onDragOver`/`onDrop` 对 `targetId=null` 的 fallback 明确落到当前 tier 末尾（已有 `insertIndex = itemsWithoutDragged.length` 兜底，确认逻辑无缺口）。本项以核对+补充注释为主，若发现 fallback 不健壮则补强。

### 3. Markdown 整体替换 marked + DOMPurify（S2）
- 现状：`public/js/markdown.js`（445 行自实现解析器）经 `x-html` 渲染于 `index.html:265`、`tier.html:292` 的 review 字段。
- 目标：
  - 自托管 `public/js/vendor/marked.min.js`（18.x）+ `public/js/vendor/purify.min.js`（3.x），用 `fetch:vendor` 风格脚本与 `package.json` 锁版本（`markedVersion`/`purifyVersion`）对齐 B1 约定。
  - `markdown.js` 改为薄封装：`marked.parse(text, { renderer })` 后过 `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })`；自定义 `renderer.code`/`renderer.codespan` 复刻 `md-code-block/md-code[ language-x]/md-code-inline`。
  - 删除自实现 `escapeHtml/isSafeUrl/parseInline/parseCodeBlock/...` parser 逻辑（DOMPurify 接管安全兜底）。
  - 保留 `renderMarkdown` 导出签名不变（`renderMarkdown(text) => html`），2 调用点 + 测试不动。
  - 现有 `markdown.security.test.mjs` 在替换后必须 5/5 绿；另补 fuzz 用例（`javascript:` 链接、`data:` 图片、CSS 注释断链、嵌套转义）。

### 4. 背景图 URL 白名单校验（S3）
- 现状：`theme.js:~108` `const safeUrl = config.backgroundUrl.replace(/["\\]/g, '\\$&')`——仅转义 `"`/`\`，未拦换行/CSS 注释。
- 目标：用 `URL` 构造器解析 + 白名单 protocol（`http:`/`https:`，或相对路径），拒绝含 `\n`/`;`/`/* */` 的 URL；赋值前 `encodeURIComponent` 或直接用属性 API。

### 5. 错误 toast 友好化（S4）
- 现状：14 处 `addToast('<prefix>: ' + error.message, 'error')` 把后端技术文本透传。
- 目标：抽 `friendlyErrorMessage(error, prefix)`（`utils.js` 或 `api.js`）：按 `error.code` 映射友好文案表，无 code 时回退到 `<prefix>` + 通用"操作失败，请稍后重试"（不拼 `error.message`）；`error.message` 仅 `console.warn`。14 处改用 `friendlyErrorMessage`。B2 的 `withLoading` 错误路径也接入。
- 约定：本文案表放 `api.js`（与 `createApiError` 同源），前端约定 `code` 字段优先于 `message`。

## 范围外

- 后端接口信封统一（A3）。
- i18n / CSS 拆分（B5）。
- a11y 壳层 A1b（header 抽离）——仍留后续。
- 不改后端 API、不改 tests/router/* 与 tests/queue/*。

## 约束

- 无构建步骤；vendor 自托管走 `package.json` `markedVersion`/`purifyVersion` + `fetch:vendor`。
- 不引入运行时第三方 CDN。
- `renderMarkdown` 签名与 2 调用点字面不变。
- 不破坏 B3 已沉淀 spec：模态 role/焦点陷阱/`$store.app.confirm` 一律复用。
- vendor min.js 不进 lint glob（沿用 B1 约定）。

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | 纯键盘可完成"把 VN 从 A tier 移到 B 并改内序"：Enter 抓取→方向键移动→Enter 确认；Esc 取消 | 键盘走查 + aria-grabbed 状态正确 |
| AC2 | 非管理员键盘路径不可触发（与拖拽一致） | 切未登录走查 |
| AC3 | `onDragOver`/`onDrop` dataset fallback 末端落位明确 | 代码审查 + 拖至空隙命中子元素 |
| AC4 | `vendor/marked.min.js` + `vendor/purify.min.js` 存在；`package.json` 记录两版本 + `fetch:vendor` 可重复下载（sha256） | 文件 + `npm run fetch:vendor` |
| AC5 | `markdown.js` 删除自实现 parser；`renderMarkdown` 输出形态 = 现有（`md-code-*` 类保留） | 5 现有测断言全绿 + 新 fuzz 用例 |
| AC6 | 无运行时 CDN；`grep -rn "cdn.jsdelivr" public/*.html` 无输出 | grep |
| AC7 | 现有 `markdown.security.test.mjs` 5/5 通过；新增 fuzz 用例（js:链接/data:图片/CSS 注释/嵌套转义）通过 | `npm run test` |
| AC8 | 背景图 URL 含 `\n`/`;`/`/* */` 注入不生效；正常 http/https URL 仍正常 | 手测 + 代码审查 |
| AC9 | 14 处错误 toast 不再含裸 `error.message`；友好文案按 code 映射 | grep `error.message` 仅余 console.warn |
| AC10 | `npm run lint` 退出 0 | 命令 |
| AC11 | `npm run test` 退出 0 | 命令 |
| AC12 | 本地 `npm run dev` 五页面功能正常（Tier 键盘重排、详情 review 渲染样式视觉一致、背景、设置错误路径） | 手动冒烟 |

## 风险与回滚

- **风险**：marked 18 renderer API 在未来升级变更 → 锁版本 + sha256，升级走审计。
- **风险**：DOMPurify 默认白名单误删某 review 元素 → 冒烟核对 review 内现有格式（粗体/斜体/链接/图片/列表/代码块/表格/引述）渲染一致；必要时调 `ADD_TAGS/ADD_ATTR`。
- **风险**：键盘拖拽状态机与既有鼠标路径冲突 → 共享同一 `draggedVN` 状态，互斥；抓取态时禁用鼠标拖拽（反之亦然）。
- **风险**：friendlyErrorMessage 未覆盖的 code 回退技术文本 → 回退到通用文案而非技术文本。
- **回滚**：5 交付物按文件分提交；Markdown 替换若大量回归可整批 revert 回自实现 parser，其它 4 项独立保留。
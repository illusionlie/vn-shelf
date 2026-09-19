# Design — 三项遗留修复

三改动相互独立、无共享状态，可按任意顺序实施、独立回滚。

涉及文件：

| 改动 | 文件 |
|---|---|
| D1 verify→status | `public/js/app.js`、`public/js/api.js` |
| D2 markdown 扩展 | `public/js/markdown.js`、`tests/public/markdown.syntax.test.mjs` |
| D3 NSFW 键盘可达 | `public/index.html`、`public/tier.html`、`public/js/detail-modal.js`、`public/css/tier.css`、`public/js/locales/zh-CN.js`、`public/js/locales/en.js` |

---

## D1 checkAuth 切 `/api/auth/status`

**现状**：全局 Store `checkAuth()`（app.js:169-179）调 `authAPI.verify()` → `GET /api/auth/verify`；匿名（无 cookie）时 `handleVerify`（router.js:479-485）走 `authMiddleware` 早退分支返回 401，浏览器 Network 面板每页首访一条红色 401。loginPage / settingsPage 已用 `authAPI.status()`，仅全局 Store 未切。

**改动**：

```js
// app.js checkAuth
const res = await authAPI.status();
this.isAdmin = !!res.data?.authenticated;
// catch 分支保留，warn 文案 '[app] auth verify failed' → '[app] auth status failed'
```

- `api.js` 删除 `authAPI.verify()` 方法（切换后全库无调用点；仓库死代码零容忍）。
- **后端 `/api/auth/verify` 端点保留不动**：属公开 API 契约（AGENTS.md 路由表），仅前端不再消费。（check 阶段核实：该端点本无专测用例，行为不变由 src/ 零改动保证。）

**开销 trade-off**：`handleAuthStatus` 对匿名会多一次 `isInitialized()`→`getSettings()` 的 D1 单键读（verify 只走 authMiddleware 无 cookie 早退）；与 login/settings 页既有用量同级，接受。status 不在公开只读缓存端点清单（vn/stats/tier/appearance），无缓存/`no-store` 契约牵扯。

**兼容**：status 恒 200，`res.data.authenticated` 两态判定与原 `res.success` 等价；catch 从「401 + 网络错误」收敛为纯网络错误路径。

---

## D2 marked inline extensions 恢复三标记

**语义基准**（迁移前自实现 parser，git `f028393^` 版本 parseInline 101-114 行）：

| 原正则（global, 作用在单行内联文本） | 输出 |
|---|---|
| `/==(.+?)==/g` | `<mark class="md-mark">$1</mark>` |
| `/\^([^^]+)\^/g` | `<sup class="md-sup">$1</sup>` |
| `/(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g` | `<sub class="md-sub">$1</sub>` |

**实现**：`markdown.js` 现有 `marked.use({ renderer, breaks, gfm })` 增加 `extensions` 数组，三个 `level: 'inline'` 扩展。tokenizer 正则锚定 `^`（marked 逐位置喂入剩余文本）：

- mark：`/^==(.+?)==/`（惰性、内容 ≥1 字符、`.` 不跨行——与原版一致）
- sup：`/^\^([^^]+)\^/`
- sub：`/^~([^~]+)~(?!~)/`

每个扩展带 `start(src)` 提示（`src.indexOf('==')` 等）。tokenizer 返回 `{ type, raw, tokens: this.lexer.inlineTokens(content) }`，renderer 用 `this.parser.parseInline(token.tokens)` 产出 `<mark|sup|sub class="md-mark|md-sup|md-sub">`。

**不劫持 `~~删除线~~` 的论证**：扩展 tokenizer 先于内置 del 尝试，但 sub 的 `[^~]+` 无法匹配第二个 `~`（`~~del~~` 首字符后紧跟 `~` 即失配），自然落回 GFM del；`(?!~)` 尾守卫对齐原版语义（拒绝 `~a~~`）。

**对原版的改进（有意）**：原实现是字符串顺序替换，`==**b**==` 会把已生成的 strong 标签包进 mark 内容；token 树方案下嵌套内联正确递归解析。测试按新语义锁定。

**安全与降级**：mark/sup/sub 均在 DOMPurify html profile 白名单内；Node 无 DOM 降级路径不变（renderer 侧产出已定形）。

**CSS 零改动**：`.md-mark/.md-sup/.md-sub` 及暗色适配仍在 cards-detail.css:684/691/696、:877。

**新增测试**（markdown.syntax.test.mjs，沿用 cache-bust import 模式）：三标记基础渲染；`==a=b==`（内容含单 `=`）；`~~del~~` 与 `~sub~` 同段共存；`====`/`^^`/`~~~` 不匹配；`==**b**==` 嵌套；`~a~~` 不产 sub。

---

## D3 NSFW 遮罩键盘可达（4 处）

**统一属性模板**（4 处一致）：

```html
role="button" tabindex="0"
:aria-label="$t('common.revealNsfwCover')"
@keydown.enter.space.stop.prevent="showNsfw = true"
```

- 焦点环由 base.css `:is(..., [role="button"], ...):focus-visible` 全局规则覆盖，零 CSS 新增。
- aria-label 用 Alpine `$t` 绑定而非 `data-i18n-aria-label`：detail-modal 是 JS 注入 DOM，`$t` 不依赖 applyI18nDom 时序，四处统一。
- `common.clickToShow` 保留作 hover title 提示；新 key `common.revealNsfwCover`：zh「显示 NSFW 封面」/ en 'Reveal NSFW cover'（parity 测试强制双语）。
- 揭示后遮罩 `x-show` 移除（display:none）自动退出 Tab 序，无残留焦点问题。

**分点方案**：

1. **index.html:153（书架卡片）**：父容器是 `div[role=button]`，就地加属性——与 `.vn-card-refresh-btn`（真 button 嵌 role=button 卡片）同构，spec quality-guidelines.md:53 已立先例。`.stop` 阻断卡片级 `@keydown.enter.space.prevent="openDetail"`。
2. **detail-modal.js:56（详情弹窗）**：父容器是普通 relative div，就地加属性；进弹窗 trapFocus 的 Tab 序。
3. **tier.html:148 / 218（tier 卡片 ×2）**：父容器是真 `<button class="tier-vn-card">`，HTML 规范禁止 button 内 interactive content，**必须出嵌**：
   - 新增 `.tier-vn-card-wrap`（`position: relative; border-radius: 6px;` 同卡片）包住 button；overlay 成为 wrap 的子节点（button 的兄弟）。
   - `x-data="{ showNsfw: false }"` 从 button 上移到 wrap——img 的 `:class`（button 内）与 overlay 的 `x-show`（button 外）共享作用域。
   - overlay 点击不再需要 `.stop`（非 button 后代，且绝对定位 z-5 覆盖在卡片上方，点击天然到不了 button）；键盘事件仍 `.stop`（wrap 无键盘处理器，纯防御）。
   - tier.css：`.tier-vn-card .nsfw-overlay` 选择器改为 `.tier-vn-card-wrap .nsfw-overlay`（border-radius 6px 覆盖），wrap 尺寸跟随内容（button 定宽高，flex 布局下 wrap 收缩包裹即可）。
   - 键盘拖拽不受影响：`onCardKeydown` 挂在 button 上，overlay 键盘事件 `.stop` 不冒泡；`.tier-drop-indicator` 为 slot 级 flex 子项，层级与 overlay 无叠压（indicator 在卡片外侧）。

**Tab 序（NSFW 卡片）**：卡片 → 遮罩（存在且未揭示时）→（管理员）刷新钮 / 下张卡片；与视觉序一致。

---

## 兼容与回滚

- D1/D2 均为纯替换式小改，`git checkout -- <file>` 即回滚。
- D3 的 tier DOM 结构改动是最大 hunk（两个 x-for 模板 + CSS），回滚点独立于其余两处。
- 无数据结构、API 契约、缓存契约变更。

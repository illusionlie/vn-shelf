# Implement — B4 前端拖拽键盘化与安全兜底

> 5 步独立交付，按"低风险→高风险"顺序：S3 URL白名单 → S4 friendlyError → B3-small dataset → K1 拖拽键盘化 → S2 Markdown 替换。每步独立提交便于回滚。
> 关键前提（已验证）：marked 18 + 自定义 renderer 复刻 `md-code-*` 5 场景输出与现有断言逐一对应。

## Step 0 — 前置约定

- vendor 自托管走 `package.json` `markedVersion`/`purifyVersion` + `fetch:vendor`（沿用 B1 模式，扩展 `fetch-alpine.cjs` 或新增并列脚本）。
- `renderMarkdown` 签名 + 2 调用点字面不变。
- 不破坏 B3 spec：模态 role/焦点/`$store.app.confirm` 复用；禁止 native confirm、禁止 Date.now() id、禁止 {...options} headers、禁止 runtime CDN。
- 每步附 lint/test；Review Gate 通过再进下一步。

## Step 1 — 背景图 URL 白名单校验（S3）

1.1 `public/js/theme.js` `applyBackground` 中替换 `safeUrl = url.replace(/["\\]/g, '\\$&')`：
```js
function safeBackgroundUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  // 拒绝换行/注释/分号等越权写额外 CSS
  if (/[\n\r;]/.test(url) || url.includes('/*')) return null;
  try {
    const u = new URL(url, window.location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null; // 不合法 URL 不渲染
  }
}
```
赋值改用属性 API（数值更稳）：`document.body.style.backgroundImage = safe ? \`url("${safe}")\` : ''`（保留引号但 safe 已白名单）。支持当前既有相对路径测试：`./bg.webp` 与 `/bg.webp` 经 `new URL(..., origin)` 解析为同源 http(s)，通过。注：原行为允许 `data:` 协议——本批次按 PRD 收紧到 http/https，若现有外观数据有 data: URI 需先确认（recon 未发现 data: 背景用例）。

**验证**：注入 `\n;--` / `javascript:alert(1)` 不渲染；正常 URL 仍显示。
```bash
npm run lint && npm run test
```
**Review Gate G1**：AC8 满足。

## Step 2 — 错误 toast 友好化（S4）

2.1 `public/js/api.js` 新增导出 `friendlyErrorMessage(error, prefix)`：
```js
const FRIENDLY_CODE_MAP = {
  UNAUTHORIZED: '请先登录',
  FORBIDDEN: '没有权限执行此操作',
  NOT_FOUND: '资源不存在',
  VALIDATION: '输入内容有误',
  CONFLICT: '操作冲突，请刷新后重试',
  RATE_LIMIT: '操作过于频繁，请稍后再试',
  SERVER_ERROR: '服务器暂时不可用，请稍后重试',
  NETWORK: '网络连接失败，请检查后重试'
};

export function friendlyErrorMessage(error, prefix = '操作失败') {
  // network/HTTP 错误：按 status 映射
  const code = error?.code;
  let friendly = FRIENDLY_CODE_MAP[code];
  if (!friendly && error?.status >= 500) friendly = FRIENDLY_CODE_MAP.SERVER_ERROR;
  if (!friendly && error?.status === 401) friendly = FRIENDLY_CODE_MAP.UNAUTHORIZED;
  if (!friendly && error?.status === 403) friendly = FRIENDLY_CODE_MAP.FORBIDDEN;
  if (!friendly && error?.status === 404) friendly = FRIENDLY_CODE_MAP.NOT_FOUND;
  if (!friendly && error?.status === 409) friendly = FRIENDLY_CODE_MAP.CONFLICT;
  if (!friendly && error?.status === 429) friendly = FRIENDLY_CODE_MAP.RATE_LIMIT;
  console.warn('[friendlyErrorMessage]', { prefix, code, status, error: error?.message || String(error) });
  return friendly ? `${prefix}：${friendly}` : prefix;
}
```
（前端 `createApiError` 已填 `code`/`status`，本函数自然衔接。）

2.2 14 处 `addToast('<prefix>: ' + error.message, 'error')` 改为 `addToast(friendlyErrorMessage(error, '<prefix>'), 'error')`：
- `settingsPage.js` 7 处：加载配置/启动索引/导出/导入/退出/清除缓存/…（第 75/159/177/218/230/326…行）
- `shared.js:122`、`statsPage.js:25`
- `tierlistPage.js:264/284/304`
- `vnShelf.js:42/238/257`
- B2 的 `withLoading`（`utils.js`）错误路径也接入：`friendlyErrorMessage(error, errorPrefix)`。

2.3 `importData` 的本地校验错误（`throw new Error('无效的导入文件格式')`）属前端可控友好文案，可保留为 friendly 直出或经 friendlyErrorMessage 包一层（无 code 走 prefix 回退）。

**验证**：
```bash
grep -rn "error.message" public/js/ | grep -v "//" | grep -v "console.warn"   # 仅余 console.warn
npm run lint && npm run test
```
**Review Gate G2**：AC9 满足。

## Step 3 — `onDragOver`/`onDrop` dataset fallback 核对（B3-small）

3.1 核对 `tier.html` 所有 `.tier-vn-card` 渲染 `:data-vn-id="vn.id"`（`tier.html:120` 已确认）。

3.2 `tierlistPage.js` `onDragOver`：`targetId` 为 null 时 `insertIndex = itemsWithoutDragged.length`（已兜底到末端）；核对该 fallback 在 `onDrop` 路径一致。补注释说明"命中子元素/空隙 → 落到当前 tier 末尾"。

3.3 若发现 `onDrop` 中 fetch `targetCard` 与 `onDragOver` 不一致则统一抽出 `resolveDropTarget(event, tierId)` helper 返回 `{ insertIndex, tierKey }`，鼠标与 Step4 键盘路径共用。

**验证**：拖至卡片内子元素/空隙不丢插入点。
```bash
npm run lint && npm run test
```
**Review Gate G3**：AC3 满足。

## Step 4 — Tier 拖拽键盘化（K1）

4.1 `tier.html` 卡片（`:120` `<button ... :draggable="$store.app.isAdmin">`）补：
- `tabindex="$store.app.isAdmin ? 0 : -1"`（非 admin 不进 tab 序）
- `:aria-grabbed="draggedVN?.id === vn.id && keyboardDragging ? 'true' : 'false'"`
- `:aria-label="vn.titleCn || vn.titleJa || vn.title"`
- `@keydown="onCardKeydown(vn, $event)"`
- 容器 `.tier-items` 补 `role="list" aria-label="<tier name>"`，卡片 `role="listitem"`（button role 不允许 listitem，改为外层 `<div class="tier-vn-slot" role="listitem">` 包裹 button，button 自身 role 不变——核对语义不冲突）。

4.2 `tierlistPage.js` 增键盘状态与方法：
```js
keyboardDragging: false,
keyboardGrabbedVN: null,

onCardKeydown(vn, event) {
  if (!this.$store.app.isAdmin) return;
  // 已在鼠标拖拽中时不抢键盘
  if (this.draggedVN && !this.keyboardDragging) return;

  switch (event.key) {
    case 'Enter':
    case ' ': {
      event.preventDefault();
      if (!this.keyboardDragging) {
        this.keyboardDragging = true;
        this.keyboardGrabbedVN = vn;
        this.draggedVN = vn;
        // 初始 dropIndicator 落在 vn 当前位置
        this.dropIndicatorTierKey = this.resolveTierKey(this.vnTierId(vn));
        this.dropIndicatorIndex = this.currentIndexOf(vn);
      } else {
        // 确认落点
        this.applyDrop(this.dropIndicatorTierKey, this.dropIndicatorIndex);
        this.resetKeyboardDrag();
      }
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!this.keyboardDragging) return;
      event.preventDefault();
      // 同 tier 内移动 dropIndicator
      const items = this.getItemsByTierKey(this.dropIndicatorTierKey);
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      this.dropIndicatorIndex = Math.max(0, Math.min(items.length, this.dropIndicatorIndex + delta));
      break;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!this.keyboardDragging) return;
      event.preventDefault();
      // 跨 tier：切到上/下 tier，dropIndicator 落到该 tier 末尾或开头
      this.moveKeyboardDropToNeighborTier(event.key === 'ArrowUp' ? -1 : 1);
      break;
    }
    case 'Escape': {
      if (this.keyboardDragging) {
        event.preventDefault();
        this.resetKeyboardDrag();
      }
      break;
    }
  }
},

resetKeyboardDrag() {
  this.keyboardDragging = false;
  this.keyboardGrabbedVN = null;
  this.draggedVN = null;
  this.clearDropIndicator();
},

applyDrop(tierKey, index) {
  // 复用既有 onDrop 的提交逻辑：抽出 onDrop 的 body 到 applyTierBatchUpdatesOnDrop(targetTierKey, insertIndex)
  // 此处调用同一函数
}
```

4.3 重构 `onDrop`：抽出 `applyTierBatchUpdatesOnDrop(targetTierKey, insertIndex)` 纯逻辑函数，鼠标 `onDrop` 与键盘 `applyDrop` 共用；保留 `onDragEnd` 清状态。

4.4 CSS：抓取态卡片视觉（已有 `.dragging` 类用于鼠标，复用；键盘态同样加该类，`:class="{ dragging: draggedVN?.id === vn.id }"`）。

4.5 抽 `vnTierId(vn)` / `currentIndexOf(vn)` helper 解析 tier 归属与索引（基于 `this.tieredVN`/`this.untieredVN` 现有结构）。

**验证**：
- 键盘路径纯 Tab 到某卡 → Enter 抓取（高亮）→ 方向键移动 dropIndicator → Enter 确认（提交批量更新）→ 刷新顺序正确
- Esc 中途取消，无副作用
- 非管理员 Tab 不可聚焦（`tabindex=-1`），onCardKeydown 早退
- 鼠标与键盘互斥：抓取态不响应鼠标 onDragStart
```bash
npm run lint && npm run test
```
**Review Gate G4**：AC1/AC2 满足。

## Step 5 — Markdown 整体替换 marked + DOMPurify（S2）

5.1 vendor 拉取：扩展 `fetch:vendor` 脚本或新增 `fetch-vendor.cjs`，从 `package.json` `markedVersion`/`purifyVersion` 下载 `marked.min.js`（取 `marked@<v>/lib/marked.umd.js` 或 npm 上的 minified bundle）+ `dompurify@<v>/dist/purify.min.js` 到 `public/js/vendor/`。锁版本写 `package.json`：`"markedVersion": "18.x"`、`"purifyVersion": "3.x"`。校验 sha256。

> 注：marked npm 包的 minified bundle 路径以实际包为准（`marked@18` 可在 `dist/marked.min.js` 或 UMD 入口）。实现时先 `npm view marked@<v> dist` 确认文件名；若无现成 minified，可用 `marked.umd.js` + 在 `markdown.js` 内 `import` 后由构建期不属于本项目……改用 ESM `import { marked } from './vendor/marked.min.js'` 或 UMD 全局。

5.2 重写 `public/js/markdown.js` 为薄封装：
```js
import { marked } from './vendor/marked.min.js';
import DOMPurify from './vendor/purify.min.js';

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const safeLang = /^[a-z0-9]{1,32}$/i.test(lang || '') ? lang : '';
  const langClass = safeLang ? ` language-${safeLang}` : '';
  return `<pre class="md-code-block"><code class="md-code${langClass}">${text}</code></pre>`;
};
renderer.codespan = ({ text }) => `<code class="md-code-inline">${text}</code>`;

marked.use({ renderer, breaks: true, gfm: true });

export function renderMarkdown(text) {
  if (!text) return '';
  const raw = marked.parse(text);
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
```
删除全部自实现 `escapeHtml/isSafeUrl/parseInline/parseCodeBlock/parseBlock/parseDocument/...`。

5.3 扩展 `tests/public/markdown.security.test.mjs` 加 fuzz 用例：
- `javascript:alert(1)` 链接：`[x](javascript:alert(1))` → 无 `javascript:` 输出（DOMPurify 删 href）
- `data:text/html` 图片：`![x](data:text/html,...)` → 无 data: 图片
- CSS 注释断链、嵌套转义等
- 保留现有 5 用例（合法/恶意引号/无语言/标点 c++/超长 33a）

5.4 调用点 + CSS 不动（`index.html:265`、`tier.html:292` 的 `x-html="renderMarkdown(...)"` 保留；`style.css` 的 `.md-code-*`/`.detail-review-content .md-*` 选择器全保留）。

5.5 冒烟核对 review 渲染：粗体/斜体/删除线/链接/图片/无序有序列表/代码块/引用/表格/分割线视觉与替换前一致。

**验证**：
```bash
ls -l public/js/vendor/marked.min.js public/js/vendor/purify.min.js
grep -rn "cdn.jsdelivr" public/*.html                              # 无输出
npm run lint && npm run test                                        # 含扩展 fuzz
```
**Review Gate G5**：AC4/AC5/AC6/AC7 满足。

## Step 6 — 端到端冒烟

6.1 `npm run dev`。6.2 走查：
- Tier 页：键盘 Tab→卡→Enter 抓取→方向键→Enter 提交；Esc 取消；非 admin 不可用；鼠标拖拽仍正常。
- 详情 review 渲染样式与替换前一致（粗体/斜体/链接/图片/列表/代码/引用/表格）。
- 设置：各错误路径（断网/超时/404）toast 显示友好文案，无裸 stack。
- 背景：配置换行/`;`/`javascript:` URL 不渲染；正常 URL 正常。
- 五页面无 console 报错，无 vendor 404。
6.3 清缓存冷启动一次确认 fallback。

**Review Gate G6**：AC12 满足。

## 验收门禁

```bash
npm run lint && npm run test
```
任一红回到对应 Step。

## 回滚点

- S1：还原 theme.js URL 净化为 replace(/["\\]/g, '\\$&')。
- S2：还原 14 处 error.message 拼接；删 friendlyErrorMessage。
- S3：还原 dataset fallback 注释/helper（仅注释则几乎不可回归）。
- S4：还原 tier.html 卡片原属性 + 删 onCardKeydown/keyboardDragging 状态；还原 onDrop 与 applyDrop 合并。
- S5：还原自实现 markdown.js；删 vendor marked/purify + 测试扩展（整批 revert）。
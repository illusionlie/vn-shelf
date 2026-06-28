# Implement — B3 前端交互可达性与确认 UI

> 8 步独立交付，按风险从低到高：aria 属性补全(K4/K5/K7) → 卡片键盘(K2) → 移动菜单 ARIA(K9) → confirmDialog(U1) → 焦点陷阱(K3) → 壳层抽离(A1a)。每步独立提交。
> 关键修正：tier 卡片已 button，K2 仅动 index;多数 aria-label 已存在,只补缺口。

## Step 0 — 前置约定

- 不引入第三方库；仅改 `public/*.html`、`public/js/`、新增 `public/js/components/confirmDialog.js`、`public/js/layout.js`。
- 注入 DOM 与原字面一致（class/Alpine 指令）
- 每步附 lint/test；Review Gate 通过再进下一步。
- 模态焦点陷阱与 `lockPageScroll` 解耦：滚动锁已存在于 `openDetail/openEdit/closeXxx`，trapFocus 单独管理焦点，不动滚动锁调用点。

## Step 1 — Toast aria-live + close aria-label + 表单 label（K4/K5/K7）

1.1 5 页 `toast-container`（index.html:410 / login.html:99 / settings.html:349 / stats.html:136 / tier.html:353）加 `role="status" aria-live="polite"`。

1.2 modal-close 4 处（index.html:169 + 288、tier.html:218、tier.html:310）加 `aria-label="关闭"`。

1.3 `index.html:81` search-input 加 `aria-label="搜索视觉小说"`；`index.html:83` sort-select 加 `aria-label="排序方式"`。

**验证**：
```bash
grep -c "aria-live" public/*.html          # 5
grep -n "aria-label=\"关闭\"" public/*.html # 4
grep -n "aria-label=\"搜索视觉小说\"" public/index.html
npm run lint && npm run test
```
**Review Gate G1**：AC5/AC6/AC7 满足。

## Step 2 — 首页卡片键盘可达（K2）

2.1 `index.html:125`：
```html
<div class="vn-card" role="button" tabindex="0"
     :aria-label="vn.titleCn || vn.titleJa || vn.title"
     @click="openDetail(vn)"
     @keydown.enter.space.prevent="openDetail(vn)">
```
仅 index.html；tier 卡片已 button 不动。

**验证**：Tab 聚焦卡片，Enter/Space 打开详情。
```bash
npm run lint && npm run test
```
**Review Gate G2**：AC4 满足。

## Step 3 — 移动菜单 ARIA + 外部关闭（K9）

3.1 `public/js/utils.js` 改 `toggleMobileMenu`，同步 toggle 按钮 `aria-expanded`，监听点外部/Esc 关闭。模块级守卫避免重复挂全局监听：
```js
let _mobileMenuInitialized = false;

export function toggleMobileMenu() {
  const menu = document.getElementById('more-menu');
  const toggleBtn = document.querySelector('.more-menu-toggle-btn');
  if (!menu || !toggleBtn) return;
  const willOpen = !menu.classList.contains('open');
  menu.classList.toggle('open');
  toggleBtn.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    // 点外部/Esc 关闭（仅打开时挂监听，关闭即卸载）
    menu._closeHandler = (e) => {
      if (!menu.contains(e.target) && !toggleBtn.contains(e.target)) {
        closeMobileMenu(menu, toggleBtn);
      }
    };
    menu._escHandler = (e) => {
      if (e.key === 'Escape') closeMobileMenu(menu, toggleBtn);
    };
    setTimeout(() => document.addEventListener('click', menu._closeHandler), 0);
    document.addEventListener('keydown', menu._escHandler);
  } else {
    closeMobileMenu(menu, toggleBtn);
  }
}

function closeMobileMenu(menu, toggleBtn) {
  menu.classList.remove('open');
  toggleBtn.setAttribute('aria-expanded', 'false');
  if (menu._closeHandler) document.removeEventListener('click', menu._closeHandler);
  if (menu._escHandler) document.removeEventListener('keydown', menu._escHandler);
  menu._closeHandler = null; menu._escHandler = null;
}
```
3.2 5 页 toggle 按钮（`:61`）初始化 `aria-expanded="false"`、`aria-controls="more-menu"`；menu 容器加 `role="menu"`、菜单项 `<a>` 加 `role="menuitem"`。

**验证**：导航/手机视口点击按钮打开菜单 `aria-expanded=true`；点外部关闭、Esc 关闭；再开按钮焦点正常。
```bash
grep -n "aria-expanded=\"false\"" public/*.html | wc -l  # 5
npm run lint && npm run test
```
**Review Gate G3**：AC8 满足。

## Step 4 — confirmDialog 组件 + Store.app.confirm（U1 基础）

4.1 新增 `public/js/components/confirmDialog.js`：
```js
export function confirmDialog() {
  return {
    visible: false,
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    _resolve: null,
    _lastFocus: null,
    confirm() { this.visible = false; this._resolve?.(true); this._releaseFocus(); },
    cancel() { this.visible = false; this._resolve?.(false); this._releaseFocus(); },
    _releaseFocus() { if (this._lastFocus) { try { this._lastFocus.focus(); } catch {} } this._lastFocus = null; }
  };
}
```
4.2 `public/js/app.js` Store 增 `confirm(opts)`：绑定共享 `confirmDialog` 实例（通过 Alpine.store 或一个 module-scoped ref）。简化方案：Store 持有 `_confirmState` + `confirm(opts)` 返回 Promise，confirmDialog 组件 `x-init` 把自身方法挂到 store 或监听 store 状态变化。
- 推荐握手：confirmDialog 组件 `x-data="confirmDialog()" x-init="$store.app._confirmDialog = this"`；Store `confirm(opts)` 把 opts 写到 `_confirmDialog` 各字段并 `visible=true`，记录 Promise resolver。
4.3 confirmDialog 模板（含 5 页注入形态）：
```html
<div x-data="confirmDialog()" x-init="$store.app._confirmDialog = this" x-cloak>
  <div class="modal-overlay" :class="{ active: visible }" @click.self="cancel()" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" @keydown.escape.window="cancel()">
    <div class="modal confirm-dialog" x-show="visible" x-transition>
      <div class="modal-header"><h2 id="confirmTitle" class="modal-title" x-text="title"></h2></div>
      <div class="modal-body"><p x-text="message"></p></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="cancel()" x-text="cancelText"></button>
        <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="confirm()" x-text="confirmText"></button>
      </div>
    </div>
  </div>
</div>
```
5 页各加一处挂载（在 toast-container 旁）。本步先建组件与 store 握手，**不替换 confirm() 调用**。

4.4 `utils.js` 提取/暴露 `trapFocus`（Step5 用），本步先验证 confirmDialog 能弹起+键盘确认/取消。

**验证**：在控制台 `Alpine.store('app').confirm({title:'测试', message:'确认?'})` 返回 Promise；界面弹出 dialog，Tab 在两按钮间循环，Enter=confirm、Esc=cancel、点遮罩=cancel。
```bash
npm run lint && npm run test
```
**Review Gate G4**：组件基础就绪。

## Step 5 — 替换 4 处 confirm()（U1）

5.1 `settingsPage.js:193` 导入模式：**双按钮方案**——先弹 confirmDialog 让用户选"合并/替换"，再 `dataAPI.import(data, mode)`：
```js
// 弹一个二选一：用 danger=true 提示替换清空
const choice = await this.$store.app.confirm({
  title: '导入模式',
  message: '合并：保留现有数据并追加；替换：清空现有数据后写入。',
  confirmText: '合并',
  cancelText: '替换',
  danger: false
});
const mode = choice ? 'merge' : 'replace'; // confirm=合并 / cancel=替换
```
注：用 confirm/cancel 表达二选一仍有歧义，更佳是自定义双按钮组件（实际可接受：UI 上是两个明确文字按钮，比 confirm() 反直觉已好得多）。**或增强 confirmDialog 支持 `secondaryText` 给出第三按钮**——本步先保持双按钮。

5.2 `settingsPage.js:299` 清缓存：`if (!await this.$store.app.confirm({title:'清除翻译缓存', message:'下次使用时需要重新下载翻译数据。', confirmText:'清除', danger:true})) return;`

5.3 `tierlistPage.js:253` 删 Tier：`if (!await this.$store.app.confirm({title:'删除 Tier', message:'删除该 Tier 后，其下条目将变为未分类。', confirmText:'删除', danger:true})) return;`

5.4 `vnShelf.js:219` 删 VN：`if (!await this.$store.app.confirm({title:'删除条目', message:'确定要删除这个条目吗？', confirmText:'删除', danger:true})) return;`

**验证**：
```bash
grep -rn "confirm(" public/js/ | grep -v "//" | grep -v "\*"   # 仅剩注释残留
npm run lint && npm run test
```
**Review Gate G5**：AC1 满足；4 流程走查。

## Step 6 — 模态焦点陷阱 + role（K3）

6.1 `utils.js` 新增 `trapFocus(el)` 返回清理函数 + `releaseFocus`：
```js
const focusableSel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
export function trapFocus(el) {
  const lastFocus = document.activeElement;
  const focusFirst = () => {
    const f = el.querySelector(focusableSel); f?.focus?.();
  };
  focusFirst();
  const onKeydown = (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...el.querySelectorAll(focusableSel)].filter(el => el.offsetParent !== null || el.getClientRects().length);
    if (!focusables.length) { e.preventDefault(); return; }
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('keydown', onKeydown);
  return () => { el.removeEventListener('keydown', onKeydown); try { lastFocus?.focus?.(); } catch {} };
}
```
6.2 详情/编辑/Tier 编辑模态：
- 容器 `.modal` 加 `role="dialog" aria-modal="true" :aria-labelledby="<titleId>"`；标题 `<h2>` 加对应 id。
- 组件 `openDetail`(shared.js) / `closeDetail` / vnShelf `openEdit`/`closeEdit` / tierlistPage `openTierEdit`/`closeTierEdit` 引入 trapFocus，open 时调用拿 `_trapRelease`，close 时 release。
- 加 `@keydown.escape.window="closeXxx()"`（已有 `@click.self` 关闭，补 Esc）。

**验证**：打开各模态 Tab 循环不外溢，Esc 关闭，关闭后焦点回到触发按钮。
```bash
grep -n "role=\"dialog\"" public/*.html | wc -l   # 期望 ≥4（含 confirmDialog）
npm run lint && npm run test
```
**Review Gate G6**：AC3 满足。

## Step 7 — 公共壳层渐进抽离 A1a（A1，最小子集）

7.1 新增 `public/js/layout.js`：导出 `injectShell()`，把**进度条 + background-overlay + toast-container + confirmDialog 挂载点**统一为模板字符串注入到各 HTML 的占位 `<div id="app-shell" x-cloak></div>`（放在 `<body>` 顶部，紧随 `<body>` 开标签）。
- 仅抽这四块（不含 header/nav，因 active 与 actions 因页而异；留 A1b）。
- 注入时机：模块顶层立即执行（脚本 `type="module"` defer 自然在 DOM 就绪后），写 `document.getElementById('app-shell').innerHTML = SHELL_TEMPLATE`。
- toast 容器加 `role="status" aria-live="polite"`（已在 Step1 各页加过，抽离后集中在 layout.js 一处）。
7.2 5 页 HTML：删除原有这三块（进度条 / background-overlay / toast-container），改为 `<div id="app-shell"></div>` 一行占位。body 顶部紧随开标签。`app.js` import `layout.js`（已 type=module）触 发注入。
7.3 active nav 高亮不受影响（header 未抽离，仍各页硬编码）。
7.4 确认 CSS `[x-cloak]` 规则存在（style.css 检索若无则补）。

**验证**：
```bash
# 5 页 body 第一个子元素为 <div id="app-shell" x-cloak></div>
grep -c "app-shell" public/*.html   # 5
# 进度条/背景/toast 不再直接出现在 5 页 body
grep -c "loading-progress-bar\|background-overlay\|toast-container" public/*.html | awk -F: '$2>0'   # 期望 0 或仅 layout.js
npm run lint && npm run test
```
**Review Gate G7**：AC9/AC10 满足；DevTools 对比抽离前后首屏 DOM 一致。

## Step 8 — 端到端冒烟

8.1 `npm run dev`。8.2 五页面走查：
- 首页：Tab 到 VN 卡片可聚焦，Enter/Space 打开详情；详情模态 Tab 循环 Esc 关闭焦点还原；编辑模态同样；搜索/排序正常；删除弹 confirmDialog 走键盘。
- Tier：卡片已有 button 支持，删 Tier 弹 confirmDialog danger；Tier 编辑模态焦点陷阱。
- 设置：4 底 Tab 保存行为不变；导入模式双按钮；清缓存弹框；导航 active。
- 移动视口：more-menu aria-expanded 正确，点外部/Esc 关闭。
- 统计/登录：背景/进度条正常。
8.3 DevTools 对比抽离前后 DOM 一致；无 console 报错。

**Review Gate G8**：AC13 满足。

## 验收门禁

```bash
npm run lint && npm run test
```
任一红回到对应 Step。

## 回滚点

- S1：还原 5 页 aria 属性补漏（不影响功能）。
- S2：还原 index.html vn-card 为 div@click。
- S3：还原 toggleMobileMenu 与 5 页 menu 标签。
- S4/S5：删除 confirmDialog.js + 还原 4 处 confirm()（最易整批 revert）。
- S6：还原模态属性 + 删除 trapFocus 引用。
- S7：删除 layout.js + 还原 5 页三块公共 DOM（整批 revert）。
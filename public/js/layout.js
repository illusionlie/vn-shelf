/**
 * 公共壳层渐进抽离（A1a）
 *
 * 把五页完全一致、无页面差异的三块公共 DOM（加载进度条 / 背景遮罩 / Toast 容器）
 * 以及 confirmDialog 挂载点统一为模板字符串，注入到各 HTML body 顶部的
 * `<div id="app-shell"></div>` 占位。header 因 active nav / actions 因页而异，本批不抽（留 A1b）。
 *
 * 注入时机：app.js（type=module，defer）在 Alpine 初始化前调用 injectShell()，
 * 因此 Alpine 启动扫描 DOM 时已能看到注入节点并正常接管 x-for / x-data / x-init。
 *
 * 字面一致性：注入的 DOM 与原 HTML 结构、class、Alpine 指令保持一致；
 * toast 容器统一用更稳健的 `$store.app?.toasts || []`（index.html 原为 `$store.app.toasts`，
 * 归一化后行为等价且在 Store 未就绪时不抛错）。
 *
 * 三块均为 position:fixed，DOM 位置变更不影响视觉层级。
 */

const SHELL_TEMPLATE = `
  <!-- 加载进度条 -->
  <div class="loading-progress-bar">
    <div class="progress-fill"></div>
  </div>

  <!-- 背景-overlay -->
  <div class="background-overlay"></div>

  <!-- 确认对话框（层级高于内容模态，但低于 toast 播报层） -->
  <div x-data="confirmDialog()" x-cloak>
    <div class="modal-overlay confirm-dialog-overlay" :class="{ active: visible }" @click.self="thirdText ? third() : cancel()">
      <div class="modal confirm-dialog" x-ref="dialog" x-show="visible" x-transition role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" @keydown.escape.stop="thirdText ? third() : cancel()">
        <div class="modal-header">
          <h2 id="confirmDialogTitle" class="modal-title" x-text="title"></h2>
        </div>
        <div class="modal-body">
          <p x-text="message"></p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-secondary"
            x-show="thirdText"
            @click="third()"
            x-text="thirdText"
            x-cloak
          ></button>
          <button class="btn btn-secondary" @click="cancel()" x-text="cancelText"></button>
          <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="confirm()" x-text="confirmText"></button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast通知 -->
  <div class="toast-container" role="status" aria-live="polite">
    <template x-for="toast in $store.app?.toasts || []" :key="toast.id">
      <div class="toast" :class="'toast-' + toast.type">
        <span x-text="toast.message"></span>
      </div>
    </template>
  </div>
`;

/**
 * 把公共壳层模板写入 #app-shell 占位。幂等：重复调用仅覆写相同内容。
 * 若页面未放占位（如未来新增页面未接入），静默跳过，不影响主体。
 */
export function injectShell() {
  const shell = document.getElementById('app-shell');
  if (shell) {
    shell.innerHTML = SHELL_TEMPLATE;
  }
}

// 站点页脚（08-28）。与 SHELL_TEMPLATE 不同：footer 是 in-flow 内容，必须挂在 body
// 末尾而非 #app-shell（壳层全是 position:fixed 元素且位于 body 顶部）。
// 「© 年份 VN Shelf」为品牌+符号+数字，跨语言同形不占 i18n key（年份由 JS 填，
// 绕开 applyI18nDom 不支持 {year} 插值的限制）；链接文本 VNDB / GitHub 为品牌名，
// 与 header 导航硬编码 "Tier List" 同一先例。
const FOOTER_TEMPLATE = `
  <footer class="site-footer">
    <span class="site-footer-copy">© <span data-footer-year></span> VN Shelf</span>
    <span class="site-footer-source">
      <span data-i18n="footer.dataFrom"></span>
      <a href="https://vndb.org" target="_blank" rel="noopener noreferrer">VNDB</a>
    </span>
    <a
      class="site-footer-github"
      href="https://github.com/illusionlie/vn-shelf"
      target="_blank"
      rel="noopener noreferrer"
      data-i18n-aria-label="nav.githubRepo"
    >GitHub</a>
  </footer>
`;

/**
 * 把站点页脚追加到 body 末尾。幂等：已有 .site-footer 时静默跳过。
 * 登录页（body.login-page，overflow:hidden 全屏布局）跳过——footer 不可见也无意义。
 * 调用时机须在 applyI18nDom 首遍扫描之前（见 app.js），footer 的 data-i18n
 * 标记才能随首遍翻译就位。
 */
export function injectFooter() {
  if (document.body.classList.contains('login-page')) return;
  if (document.querySelector('.site-footer')) return;

  const template = document.createElement('template');
  template.innerHTML = FOOTER_TEMPLATE.trim();
  const footer = template.content.firstElementChild;
  footer.querySelector('[data-footer-year]').textContent = new Date().getFullYear();
  document.body.appendChild(footer);
}

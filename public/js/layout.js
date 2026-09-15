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
 *
 * 09-12 增：返回顶部 FAB + 显隐哨兵（见 setupBackToTop），同为壳层成员，
 * 纯 DOM API 接线（无 Alpine 依赖），aria-label 走 data-i18n-aria-label 由
 * applyI18nDom 首遍扫描就位。
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
    <div class="modal-overlay confirm-dialog-overlay" x-show="visible" x-cloak
         x-transition:enter="modal-fade-enter" x-transition:enter-start="modal-fade-enter-start" x-transition:enter-end="modal-fade-enter-end"
         x-transition:leave="modal-fade-leave" x-transition:leave-start="modal-fade-leave-start" x-transition:leave-end="modal-fade-leave-end"
         @click.self="thirdText ? third() : cancel()">
      <div class="modal confirm-dialog" x-ref="dialog" x-show="visible"
           x-transition:enter="modal-scale-enter" x-transition:enter-start="modal-scale-enter-start" x-transition:enter-end="modal-scale-enter-end"
           x-transition:leave="modal-scale-leave" x-transition:leave-start="modal-scale-leave-start" x-transition:leave-end="modal-scale-leave-end"
           role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" @keydown.escape.stop="thirdText ? third() : cancel()">
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
      <div class="toast" :class="['toast-' + toast.type, toast.leaving ? 'leaving' : '']">
        <span x-text="toast.message"></span>
      </div>
    </template>
  </div>

  <!-- 返回顶部显隐哨兵：锚文档原点，供 setupBackToTop 的 IO 观测（见下方注释） -->
  <div class="back-to-top-sentinel" aria-hidden="true"></div>

  <!-- 返回顶部 FAB：默认隐藏，滚过阈值后 .visible（setupBackToTop 控制） -->
  <button type="button" class="back-to-top" data-i18n-aria-label="common.backToTop">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
  </button>
`;

/**
 * 把公共壳层模板写入 #app-shell 占位。幂等：重复调用仅覆写相同内容。
 * 若页面未放占位（如未来新增页面未接入），静默跳过，不影响主体。
 */
export function injectShell() {
  const shell = document.getElementById('app-shell');
  if (shell) {
    shell.innerHTML = SHELL_TEMPLATE;
    setupBackToTop(shell);
  }
}

/**
 * 返回顶部 FAB 接线（09-12）。
 *
 * 显隐 = IO 哨兵反向信号：哨兵为锚定 ICB 原点（文档 y=0）的 1px absolute 元素——
 * 不用 in-flow 定位是因为 body 有 padding-top:120px（fixed header 让位），
 * 会把阈值偏移掉一个 header 高度。rootMargin 上扩 600px 后，哨兵不可见 ⇔
 * scrollY > 600 ⇔ FAB 显示。与首页 render-sentinel 同构（IO 惯例），免 scroll
 * 监听/rAF 节流；bfcache 前后进退、iOS 弹性滚动负 scrollY、虚拟键盘引起的
 * 视口缩放均由 IO 自动重算，无需手动同步。
 *
 * 点击 scrollTo 不带 behavior：交给 CSS html{scroll-behavior:smooth}，
 * prefers-reduced-motion 下自动降级 instant（base.css 07-19 契约）。
 *
 * 无 IO 环境降级为常显（登录页无滚动，由 CSS body.login-page 隐藏）。
 * 重复 injectShell 覆写时旧 IO 持有已脱离节点，至多对游离节点触发一次
 * 无害回调，随 GC 回收，不需显式 disconnect。
 */
function setupBackToTop(shell) {
  const btn = shell.querySelector('.back-to-top');
  const sentinel = shell.querySelector('.back-to-top-sentinel');
  if (!btn || !sentinel) return;

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0 });
  });

  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver((entries) => {
    const atTop = entries.some((entry) => entry.isIntersecting);
    btn.classList.toggle('visible', !atTop);
  }, { rootMargin: '600px 0px 0px 0px' }).observe(sentinel);
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

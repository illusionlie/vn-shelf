/**
 * Markdown 渲染模块（薄封装）
 *
 * 实现：marked（GFM + breaks）+ 自定义 renderer 复刻原自实现解析器的 `md-*` 类名输出，
 * 再过 DOMPurify 做纵深防御净化。删除了原手写 escapeHtml/isSafeUrl/parseInline/parseBlock
 * /parseDocument 等解析逻辑——安全兜底由 renderer 侧 URL/HTML 过滤 + DOMPurify 共同承担。
 *
 * 设计要点：
 * - `renderMarkdown(text) => html` 签名不变（2 个 x-html 调用点与安全测试均依赖）。
 * - renderer.code/codespan 复刻 `md-code-block`/`md-code[ language-x]`/`md-code-inline`，
 *   语言名经 `/^[a-z0-9]{1,32}$/i` 白名单，非法/标点/超长/无语言名降级为不带 `language-`。
 * - 其余 renderer（heading/list/link/image/table/blockquote/strong/em/del/...）补回 `md-*` 类，
 *   保持 style.css `.detail-review-content .md-*` 选择器视觉一致。
 * - link/image 在 renderer 侧即做 URL 白名单（http/https/mailto/相对/锚点），拒绝 javascript:
 *   /data:/vbscript: 等；html renderer 转义裸 HTML——二者使安全测试可在无 DOM 的 Node 下验证，
 *   DOMPurify 在浏览器侧再过一遍作为纵深防御。
 * - DOMPurify 在无 DOM 环境（Node 测试）下其 default 导出的 sanitize 不可用，renderMarkdown
 *   探测后降级为直接返回 marked 输出（此时 renderer 侧过滤已保证安全）。
 */

import { t } from './i18n.js';
import { marked, Renderer } from './vendor/marked.min.js';
import DOMPurify from './vendor/purify.min.js';

/**
 * URL 安全校验：仅允许 http/https/mailto、相对路径与锚点。
 * 拒绝 javascript:/data:/vbscript:/file: 等任何其它显式协议，以及协议相对 URL（//host）。
 * @param {string} url
 * @returns {boolean}
 */
function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('#')) return true;
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return true;
  }
  // 绝对路径相对路径放行，但拒绝协议相对 URL（//example.com）
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

  // 任何其它显式协议一律拒绝；无协议的裸路径（example.com/x）视为相对路径放行
  if (/^[a-z][a-z0-9+.-]*:/i.test(lower)) return false;
  return true;
}

/** 双引号转义用于属性值拼接 */
function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

const renderer = new Renderer();

// 代码块：复刻 `<pre class="md-code-block"><code class="md-code[ language-x]">${text}</code></pre>`
// marked 已对 text 做转义，无需手动 escape。
renderer.code = function code({ text, lang }) {
  const safeLang = /^[a-z0-9]{1,32}$/i.test(lang || '') ? lang : '';
  const langClass = safeLang ? ` language-${safeLang}` : '';
  return `<pre class="md-code-block"><code class="md-code${langClass}">${text}</code></pre>`;
};

renderer.codespan = function codespan({ text }) {
  return `<code class="md-code-inline">${text}</code>`;
};

renderer.heading = function heading({ tokens, depth }) {
  return `<h${depth} class="md-heading md-h${depth}">${this.parser.parseInline(tokens)}</h${depth}>`;
};

renderer.hr = function hr() {
  return '<hr class="md-hr">';
};

renderer.blockquote = function blockquote({ tokens }) {
  return `<blockquote class="md-blockquote">${this.parser.parse(tokens)}</blockquote>`;
};

renderer.paragraph = function paragraph({ tokens }) {
  return `<p class="md-paragraph">${this.parser.parseInline(tokens)}</p>`;
};

renderer.strong = function strong({ tokens }) {
  return `<strong class="md-strong">${this.parser.parseInline(tokens)}</strong>`;
};

renderer.em = function em({ tokens }) {
  return `<em class="md-em">${this.parser.parseInline(tokens)}</em>`;
};

renderer.del = function del({ tokens }) {
  return `<del class="md-del">${this.parser.parseInline(tokens)}</del>`;
};

renderer.br = function br() {
  return '<br class="md-br">';
};

renderer.link = function link({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  if (!isSafeUrl(href)) {
    return `<span class="md-link-unsafe" title="${escapeAttr(t('markdown.unsafeLink'))}">${text}</span>`;
  }
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  return `<a href="${escapeAttr(href)}"${titleAttr} target="_blank" rel="noopener noreferrer" class="md-link">${text}</a>`;
};

renderer.image = function image({ href, title, text }) {
  if (!isSafeUrl(href)) {
    return `<span class="md-image-unsafe" title="${escapeAttr(t('markdown.unsafeImage'))}">${t('markdown.imagePlaceholder')}</span>`;
  }
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy" class="md-image">`;
};

renderer.list = function list(e) {
  const tag = e.ordered ? 'ol' : 'ul';
  const listClass = e.ordered ? 'md-list md-list-ordered' : 'md-list md-list-unordered';
  let body = '';
  for (const item of e.items) {
    body += this.listitem(item);
  }
  const startAttr = e.ordered && e.start != null && e.start !== 1 ? ` start="${e.start}"` : '';
  return `<${tag} class="${listClass}"${startAttr}>\n${body}\n</${tag}>`;
};

renderer.listitem = function listitem(e) {
  const content = this.parser.parse(e.tokens);
  if (e.task) {
    // 任务列表项：marked 的 checkbox token 已在 e.tokens 内被 parse 为 <input>，
    // 用 .md-task label 包裹以复刻原样式。
    return `<li class="md-list-item md-task-item"><label class="md-task">${content}</label></li>\n`;
  }
  return `<li class="md-list-item">${content}</li>\n`;
};

renderer.table = function table(e) {
  let header = '';
  for (const cell of e.header) header += this.tablecell(cell);
  let body = '';
  for (const row of e.rows) {
    let cells = '';
    for (const cell of row) cells += this.tablecell(cell);
    body += this.tablerow({ text: cells });
  }
  return `<table class="md-table">\n<tr class="md-row md-row-header">\n${header}\n</tr>\n${body}\n</table>`;
};

renderer.tablerow = function tablerow({ text }) {
  return `<tr class="md-row">\n${text}\n</tr>\n`;
};

renderer.tablecell = function tablecell(e) {
  const content = this.parser.parseInline(e.tokens);
  const tag = e.header ? 'th' : 'td';
  const alignAttr = e.align ? ` align="${e.align}"` : '';
  return `<${tag} class="md-cell"${alignAttr}>${content}</${tag}>\n`;
};

// 裸 HTML 视为文本转义（与原自实现一致：原解析器对非 Markdown 行经 escapeHtml 后落段落），
// 既保持渲染样式又避免 XSS；浏览器侧 DOMPurify 再过一遍作纵深防御。
renderer.html = function html({ text }) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

marked.use({ renderer, breaks: true, gfm: true });

/**
 * 渲染 Markdown 文本为 HTML 字符串。
 * @param {string} text - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const raw = marked.parse(text);
  // 无 DOM 环境（Node 测试）下 DOMPurify.sanitize 不可用，降级返回 marked 输出
  // （此时 renderer 侧 URL/HTML 过滤已保证安全）。
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }
  return raw;
}

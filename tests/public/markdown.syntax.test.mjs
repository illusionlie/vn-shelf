import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'public', 'js', 'markdown.js');

/**
 * 加载 markdown.js 模块（cache-bust in-place import）。
 *
 * markdown.js 通过相对路径 import ./vendor/marked.min.js 与 ./vendor/purify.min.js，
 * 拷贝到临时目录会丢失 vendor 依赖，故直接对仓库内文件做 cache-bust import。
 * Node 无 DOM，DOMPurify 降级不影响语法正确性断言（renderer 侧已产出 md-* class）。
 */
async function loadMarkdownModule() {
  const moduleUrl = `${pathToFileURL(sourcePath).href}?test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  return import(moduleUrl);
}

// ============ 行内格式 ============

test('粗体渲染为 <strong class="md-strong">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('**bold**');
  assert.match(html, /<strong class="md-strong">bold<\/strong>/);
});

test('斜体渲染为 <em class="md-em">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('*italic*');
  assert.match(html, /<em class="md-em">italic<\/em>/);
});

test('删除线渲染为 <del class="md-del">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('~~strike~~');
  assert.match(html, /<del class="md-del">strike<\/del>/);
});

// ============ 链接与图片 ============

test('链接渲染为 <a class="md-link" href="..."> 且 target=_blank', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('[label](https://example.com/x)');
  assert.match(html, /<a href="https:\/\/example\.com\/x"[^>]*class="md-link"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, />label<\/a>/);
});

test('图片渲染为 <img class="md-image" src="..." alt="...">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('![alt text](https://example.com/x.png)');
  assert.match(html, /<img src="https:\/\/example\.com\/x\.png"[^>]*class="md-image"/);
  assert.match(html, /alt="alt text"/);
  assert.match(html, /loading="lazy"/);
});

// ============ 列表 ============

test('无序列表渲染为 <ul class="md-list md-list-unordered"> 与 md-list-item', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('- one\n- two\n- three');
  assert.match(html, /<ul class="md-list md-list-unordered"/);
  assert.match(html, /<li class="md-list-item">one<\/li>/);
  assert.match(html, /<li class="md-list-item">two<\/li>/);
  assert.match(html, /<li class="md-list-item">three<\/li>/);
});

test('有序列表渲染为 <ol class="md-list md-list-ordered">，起始为 1 时不输出 start 属性', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('1. first\n2. second');
  assert.match(html, /<ol class="md-list md-list-ordered">/);
  assert.doesNotMatch(html, /start=/);
  assert.match(html, /<li class="md-list-item">first<\/li>/);
});

test('有序列表起始非 1 时输出 start 属性', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('3. third\n4. fourth');
  assert.match(html, /<ol class="md-list md-list-ordered" start="3">/);
});

// ============ 代码块 ============

test('带语言名代码块渲染为 md-code-block + md-code language-x', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown(['```js', 'const x = 1;', '```'].join('\n'));
  assert.match(html, /<pre class="md-code-block">/);
  assert.match(html, /<code class="md-code language-js">const x = 1;<\/code>/);
});

test('无语言名代码块渲染为 md-code（无 language- 前缀）', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown(['```', 'plain', '```'].join('\n'));
  assert.match(html, /<pre class="md-code-block"><code class="md-code">plain<\/code><\/pre>/);
  assert.doesNotMatch(html, /language-/);
});

// ============ 引用 / 表格 / 分割线 ============

test('引用渲染为 <blockquote class="md-blockquote">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('> quoted line');
  assert.match(html, /<blockquote class="md-blockquote">/);
  assert.match(html, /quoted line/);
});

test('表格渲染为 <table class="md-table"> 含 md-row / md-cell', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown(['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<tr class="md-row md-row-header">/);
  assert.match(html, /<th class="md-cell">A<\/th>/);
  assert.match(html, /<td class="md-cell">1<\/td>/);
});

test('分割线渲染为 <hr class="md-hr">', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('text\n\n---\n\nafter');
  assert.match(html, /<hr class="md-hr">/);
});

// ============ 综合段落包裹 ============

test('普通段落被 <p class="md-paragraph"> 包裹', async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const html = renderMarkdown('a plain paragraph');
  assert.match(html, /<p class="md-paragraph">a plain paragraph<\/p>/);
});

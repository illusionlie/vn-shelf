import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'public', 'js', 'markdown.js');

/**
 * 加载 markdown.js 模块。
 *
 * 直接对仓库内 markdown.js 做 cache-bust import（而非拷贝到临时目录），因为替换后的
 * markdown.js 通过相对路径 import ./vendor/marked.min.js 与 ./vendor/purify.min.js，
 * 拷贝到临时目录会丢失 vendor 依赖。cache-bust 查询串避免跨用例的模块缓存。
 *
 * 注：Node 无 DOM，DOMPurify 的 default 导出 sanitize 不可用，renderMarkdown 会降级
 * 返回 marked 输出；此时 renderer 侧的 URL 白名单与 html 转义已承担安全兜底，fuzz 用例
 * 可在无 DOM 环境下验证。浏览器侧 DOMPurify 作为纵深防御再过一遍。
 */
async function loadMarkdownModule() {
  const moduleUrl = `${pathToFileURL(sourcePath).href}?test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const markdownModule = await import(moduleUrl);
  return { markdownModule };
}

test('代码块合法语言名会保留到 class 属性', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown(['```typescript', 'const value = 1;', '```'].join('\n'));

  assert.match(html, /<code class="md-code language-typescript">const value = 1;<\/code>/);
});

test('代码块恶意语言名不会注入到 class 属性', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown(['```js" onclick="alert(1)', 'console.log(1);', '```'].join('\n'));

  assert.match(html, /<code class="md-code">console\.log\(1\);<\/code>/);
  assert.doesNotMatch(html, /language-js/);
  assert.doesNotMatch(html, /onclick=/i);
});

test('代码块无语言名与异常语言名会降级为空语言 class', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const noLang = markdownModule.renderMarkdown(['```', 'plain code', '```'].join('\n'));
  const punctLang = markdownModule.renderMarkdown(['```c++', 'int main() {}', '```'].join('\n'));
  const tooLongLang = markdownModule.renderMarkdown([`\`\`\`${'a'.repeat(33)}`, 'long language', '```'].join('\n'));

  assert.match(noLang, /<code class="md-code">plain code<\/code>/);
  assert.doesNotMatch(noLang, /language-/);

  assert.match(punctLang, /<code class="md-code">int main\(\) \{\}<\/code>/);
  assert.doesNotMatch(punctLang, /language-/);

  assert.match(tooLongLang, /<code class="md-code">long language<\/code>/);
  assert.doesNotMatch(tooLongLang, /language-/);
});

// ============ 新增 fuzz 用例（B4 S2） ============

test('javascript: 链接被禁用，不输出 javascript: 协议', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown('[x](javascript:alert(1))');

  assert.doesNotMatch(html, /javascript:/i);
  // 落到 md-link-unsafe 占位 span，而非 <a href>
  assert.match(html, /<span class="md-link-unsafe"/);
});

test('data: 图片被禁用，不输出 data: 协议的 img src', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown('![x](data:text/html,<script>alert(1)</script>)');

  assert.doesNotMatch(html, /src="data:/i);
  assert.doesNotMatch(html, /<img[^>]*data:/i);
  assert.match(html, /<span class="md-image-unsafe"/);
});

test('裸 <script> 被转义，不输出可执行 script 标签', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown('<script>alert(1)</script>');

  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;/);
});

test('CSS 注释注入（<style> 块）被转义，不输出可执行 style 标签', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown('<style>x{background:url(/*inj*/)}</style>');

  assert.doesNotMatch(html, /<style/i);
  assert.match(html, /&lt;style&gt;/);
});

test('嵌套转义：含事件属性的裸 HTML 被转义，不输出活属性', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const html = markdownModule.renderMarkdown('<b onclick="alert(1)">hi</b>');

  // 不应出现未转义的活标签起始 <b
  assert.doesNotMatch(html, /<b[ >]/i);
  // onclick 仅能以转义形式出现在文本中
  assert.match(html, /&lt;b onclick=/);
});

test('合法 http 链接与图片正常渲染并保留 md-* 类', async () => {
  const { markdownModule } = await loadMarkdownModule();

  const link = markdownModule.renderMarkdown('[a](https://example.com/x)');
  assert.match(link, /<a href="https:\/\/example\.com\/x"[^>]*class="md-link"/);

  const image = markdownModule.renderMarkdown('![alt](https://example.com/x.png)');
  assert.match(image, /<img src="https:\/\/example\.com\/x\.png"[^>]*class="md-image"/);
});

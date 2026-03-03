import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'public', 'js', 'markdown.js');

async function loadMarkdownModule() {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-markdown-test-'));
  const modulePath = path.join(tempDir, 'markdown.module.mjs');

  await fs.writeFile(modulePath, sourceCode, 'utf8');

  const moduleUrl = `${pathToFileURL(modulePath).href}?test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const markdownModule = await import(moduleUrl);

  return {
    markdownModule,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

test('代码块合法语言名会保留到 class 属性', async () => {
  const { markdownModule, cleanup } = await loadMarkdownModule();

  try {
    const html = markdownModule.renderMarkdown(['```typescript', 'const value = 1;', '```'].join('\n'));

    assert.match(html, /<code class="md-code language-typescript">const value = 1;<\/code>/);
  } finally {
    await cleanup();
  }
});

test('代码块恶意语言名不会注入到 class 属性', async () => {
  const { markdownModule, cleanup } = await loadMarkdownModule();

  try {
    const html = markdownModule.renderMarkdown(['```js" onclick="alert(1)', 'console.log(1);', '```'].join('\n'));

    assert.match(html, /<code class="md-code">console\.log\(1\);<\/code>/);
    assert.doesNotMatch(html, /language-js/);
    assert.doesNotMatch(html, /onclick=/i);
  } finally {
    await cleanup();
  }
});

test('代码块无语言名与异常语言名会降级为空语言 class', async () => {
  const { markdownModule, cleanup } = await loadMarkdownModule();

  try {
    const noLang = markdownModule.renderMarkdown(['```', 'plain code', '```'].join('\n'));
    const punctLang = markdownModule.renderMarkdown(['```c++', 'int main() {}', '```'].join('\n'));
    const tooLongLang = markdownModule.renderMarkdown([`\`\`\`${'a'.repeat(33)}`, 'long language', '```'].join('\n'));

    assert.match(noLang, /<code class="md-code">plain code<\/code>/);
    assert.doesNotMatch(noLang, /language-/);

    assert.match(punctLang, /<code class="md-code">int main\(\) \{\}<\/code>/);
    assert.doesNotMatch(punctLang, /language-/);

    assert.match(tooLongLang, /<code class="md-code">long language<\/code>/);
    assert.doesNotMatch(tooLongLang, /language-/);
  } finally {
    await cleanup();
  }
});

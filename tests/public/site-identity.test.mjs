import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const i18nPath = path.join(repoRoot, 'public', 'js', 'i18n.js');
const siteIdentityPath = path.join(repoRoot, 'public', 'js', 'site-identity.js');

/**
 * composeSiteName 组合纯函数测试（zh / en / 空串 / 纯空白四态）。
 *
 * 与 i18n.test.mjs 的 cache-bust 手法相反：这里 i18n.js 与 site-identity.js
 * 均**不带查询串**直接 import——site-identity.js 内部静态导入的 ./i18n.js
 * 与本文件直导的 i18n.js 解析为同一 URL，共享同一模块实例，
 * setLocale 切换才能作用于 composeSiteName 内部的 t()。
 * 因此各用例开头显式 setLocale 复位（模块状态跨用例保留）。
 */
const i18n = await import(pathToFileURL(i18nPath).href);
const siteIdentity = await import(pathToFileURL(siteIdentityPath).href);

test('composeSiteName：zh 词典拼接「{name} 的 VN Shelf」', async () => {
  await i18n.setLocale('zh-CN');
  assert.equal(siteIdentity.composeSiteName('小明'), '小明 的 VN Shelf');
  // 首尾空白在组合层 trim
  assert.equal(siteIdentity.composeSiteName('  小明  '), '小明 的 VN Shelf');
});

test('composeSiteName：空串 / 纯空白 / null / undefined 回退品牌名', async () => {
  await i18n.setLocale('zh-CN');
  assert.equal(siteIdentity.composeSiteName(''), 'VN Shelf');
  assert.equal(siteIdentity.composeSiteName('   '), 'VN Shelf');
  assert.equal(siteIdentity.composeSiteName(null), 'VN Shelf');
  assert.equal(siteIdentity.composeSiteName(undefined), 'VN Shelf');
});

test('composeSiteName：setLocale(en) 后拼接 "{name}\'s VN Shelf"', async () => {
  await i18n.setLocale('en');
  assert.equal(siteIdentity.composeSiteName('Alice'), "Alice's VN Shelf");
  assert.equal(siteIdentity.composeSiteName('  Alice  '), "Alice's VN Shelf");
  // 回退分支与语言无关
  assert.equal(siteIdentity.composeSiteName(''), 'VN Shelf');
});

test('composeSiteName：含 HTML 字符的输入仅按字面进入返回串（渲染侧走 textContent）', async () => {
  await i18n.setLocale('zh-CN');
  // 组合层不做任何转义/过滤——注入防护由 applySiteIdentity 的纯文本赋值路径保证
  assert.equal(siteIdentity.composeSiteName('<img src=x>'), '<img src=x> 的 VN Shelf');
});

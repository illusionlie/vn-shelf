import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const appSourcePath = path.join(repoRoot, 'public', 'js', 'app.js');

/**
 * appearance 缓存新鲜度机制测试（任务 09-15-appearance-cache-freshness，方案 c）：
 *
 * 契约：appearance 的所有网络路径（冷路径 / force / 后台静默刷新）恒传
 * cache:'no-store'，冷启动首屏陈旧上界 0s；sessionStorage（键
 * vn-shelf:appearance:v1）只管暖路径即时首绘，是唯一客户端缓存层——
 * 新鲜度永远来自当次加载的 no-store 源站请求。端点响应头 max-age=300
 * 仅服务外部 API 消费者，前端不依赖 HTTP 缓存。
 *
 * app.js 顶层即操作 document/Alpine，无法静态 import，故采用静态源码分析
 * （读源码做字符串断言，与 tests/public/i18n.keys.test.mjs 的"读源断言"同风格）。
 */

const APPEARANCE_CACHE_KEY = 'vn-shelf:appearance:v1';
const NO_STORE_CALL = "getAppearance({ cache: 'no-store' })";

const FIX_HINT =
  "修复指引：appearance 的任何网络获取都必须恒传 cache:'no-store'（不得按 force 条件化、" +
  '不得回落默认缓存模式）——sessionStorage 只管即时首绘，新鲜度永远来自当次加载的 ' +
  'no-store 源站请求。契约见任务 09-15-appearance-cache-freshness 与 ' +
  '.trellis/spec/frontend/state-management.md';

/** 截取源码中 [startMarker, endMarker) 的片段（含起点标记）。 */
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `app.js 缺少起始标记「${startMarker}」，appearance Store 结构可能已被重构`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `app.js 缺少结束标记「${endMarker}」，appearance Store 结构可能已被重构`);
  return source.slice(start, end);
}

test('冷路径网络请求恒 no-store，无 force 条件化 / 默认缓存残留', async () => {
  const source = await fs.readFile(appSourcePath, 'utf8');
  const loadRegion = sliceBetween(source, 'async loadAppearance', 'async _refreshAppearanceBackground');

  assert.ok(
    loadRegion.includes(NO_STORE_CALL),
    `loadAppearance 网络路径未恒传 no-store。${FIX_HINT}`
  );
  for (const stale of ['getAppearance(force ?', 'getAppearance({})', 'getAppearance()']) {
    assert.ok(
      !loadRegion.includes(stale),
      `loadAppearance 内残留条件化 / 默认缓存调用形态「${stale}」。${FIX_HINT}`
    );
  }
});

test('sessionStorage 暖路径即时首绘 intact（直读 + 写回）', async () => {
  const source = await fs.readFile(appSourcePath, 'utf8');
  const loadRegion = sliceBetween(source, 'async loadAppearance', 'async _refreshAppearanceBackground');

  assert.ok(
    loadRegion.includes(`sessionStorage.getItem('${APPEARANCE_CACHE_KEY}')`),
    `loadAppearance 不再直读 sessionStorage 键 ${APPEARANCE_CACHE_KEY}——暖路径即时首绘回归。${FIX_HINT}`
  );
  assert.ok(
    loadRegion.includes(`sessionStorage.setItem('${APPEARANCE_CACHE_KEY}'`),
    `loadAppearance 不再写回 sessionStorage 键 ${APPEARANCE_CACHE_KEY}——下次页面加载将失去即时首绘。${FIX_HINT}`
  );
});

test('_refreshAppearanceBackground 后台静默刷新仍恒 no-store', async () => {
  const source = await fs.readFile(appSourcePath, 'utf8');
  const refreshRegion = sliceBetween(source, 'async _refreshAppearanceBackground', 'async checkAuth');

  assert.ok(
    refreshRegion.includes(NO_STORE_CALL),
    `_refreshAppearanceBackground 未传 no-store——后台刷新的目的就是拿最新值。${FIX_HINT}`
  );
});

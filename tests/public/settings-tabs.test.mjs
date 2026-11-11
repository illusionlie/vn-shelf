import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  resolveSettingsTab,
  nextSettingsTab
} from '../../public/js/settings-tabs.js';

/**
 * 设置页分类分页契约测试（任务 11-10-settings-tabs-layout）：
 *
 * 纯函数直测覆盖 hash 解析与键盘漫游；另有一段源码断言，钉住
 * `public/settings.html` 里手写的 tab / panel 与 SETTINGS_TABS 同序同值——
 * id 漂移会让 aria-controls 指向不存在的面板（键盘与读屏静默失效）。
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const settingsHtmlPath = path.join(repoRoot, 'public', 'settings.html');

// ============ resolveSettingsTab ============

test('分类顺序与默认分类', () => {
  assert.deepEqual([...SETTINGS_TABS], ['vndb', 'appearance', 'tags', 'security', 'data']);
  assert.equal(DEFAULT_SETTINGS_TAB, 'vndb');
});

test('hash 解析：带 # 与不带 # 都认', () => {
  assert.equal(resolveSettingsTab('#appearance'), 'appearance');
  assert.equal(resolveSettingsTab('appearance'), 'appearance');
  assert.equal(resolveSettingsTab('#data'), 'data');
});

test('hash 解析：空值与非法值回落默认分类', () => {
  for (const value of ['', '#', null, undefined, 42, {}, '#nonsense', '#Security', '#tags ', '#tags/x']) {
    assert.equal(
      resolveSettingsTab(value),
      DEFAULT_SETTINGS_TAB,
      `resolveSettingsTab(${JSON.stringify(value)}) 应回落 ${DEFAULT_SETTINGS_TAB}`
    );
  }
});

test('hash 解析：原型链键不当作分类', () => {
  assert.equal(resolveSettingsTab('#constructor'), DEFAULT_SETTINGS_TAB);
  assert.equal(resolveSettingsTab('#__proto__'), DEFAULT_SETTINGS_TAB);
  assert.equal(resolveSettingsTab('#toString'), DEFAULT_SETTINGS_TAB);
});

// ============ nextSettingsTab ============

test('方向键在分类间前后移动', () => {
  assert.equal(nextSettingsTab('vndb', 'ArrowDown'), 'appearance');
  assert.equal(nextSettingsTab('appearance', 'ArrowUp'), 'vndb');
  assert.equal(nextSettingsTab('vndb', 'ArrowRight'), 'appearance');
  assert.equal(nextSettingsTab('appearance', 'ArrowLeft'), 'vndb');
});

test('方向键在首尾循环', () => {
  assert.equal(nextSettingsTab('data', 'ArrowDown'), 'vndb');
  assert.equal(nextSettingsTab('vndb', 'ArrowUp'), 'data');
  assert.equal(nextSettingsTab('data', 'ArrowRight'), 'vndb');
  assert.equal(nextSettingsTab('vndb', 'ArrowLeft'), 'data');
});

test('Home / End 跳首尾', () => {
  assert.equal(nextSettingsTab('tags', 'Home'), 'vndb');
  assert.equal(nextSettingsTab('vndb', 'End'), 'data');
  assert.equal(nextSettingsTab('data', 'Home'), 'vndb');
});

test('非导航键返回 null', () => {
  for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown', '#']) {
    assert.equal(nextSettingsTab('vndb', key), null, `${key} 不应触发分类切换`);
  }
});

test('当前分类非法时按默认分类起算', () => {
  assert.equal(nextSettingsTab('nonsense', 'ArrowDown'), 'appearance');
  assert.equal(nextSettingsTab('nonsense', 'ArrowUp'), 'data');
  assert.equal(nextSettingsTab(undefined, 'End'), 'data');
});

test('当前分类经 resolveSettingsTab 归一（容忍前导 #）', () => {
  assert.equal(nextSettingsTab('#tags', 'ArrowUp'), 'appearance');
  assert.equal(nextSettingsTab('#tags', 'ArrowDown'), 'security');
});

// ============ settings.html 一致性（防手写标记与 id 表漂移） ============

/** 提取全部匹配的第一个捕获组，保持出现顺序。 */
function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

test('settings.html 的 tab / panel 与 SETTINGS_TABS 同序同值', async () => {
  const html = await fs.readFile(settingsHtmlPath, 'utf8');

  assert.deepEqual(
    collectMatches(html, /id="settings-tab-(\w+)"/g),
    [...SETTINGS_TABS],
    'settings.html 的 settings-tab-* 顺序或取值与 SETTINGS_TABS 不一致'
  );
  assert.deepEqual(
    collectMatches(html, /id="settings-panel-(\w+)"/g),
    [...SETTINGS_TABS],
    'settings.html 的 settings-panel-* 顺序或取值与 SETTINGS_TABS 不一致'
  );
});

test('settings.html 的 tab 与 panel 互相指向', async () => {
  const html = await fs.readFile(settingsHtmlPath, 'utf8');

  for (const id of SETTINGS_TABS) {
    const tabTag = html.match(new RegExp(`<button[^>]*id="settings-tab-${id}"[^>]*>`))?.[0];
    assert.ok(tabTag, `缺少 id="settings-tab-${id}" 的导航按钮`);
    assert.ok(tabTag.includes(`aria-controls="settings-panel-${id}"`), `settings-tab-${id} 的 aria-controls 未指向 settings-panel-${id}`);
    assert.ok(tabTag.includes(`role="tab"`), `settings-tab-${id} 缺少 role="tab"`);

    const panelTag = html.match(new RegExp(`<div[^>]*id="settings-panel-${id}"[^>]*>`))?.[0];
    assert.ok(panelTag, `缺少 id="settings-panel-${id}" 的面板`);
    assert.ok(panelTag.includes(`aria-labelledby="settings-tab-${id}"`), `settings-panel-${id} 的 aria-labelledby 未指向 settings-tab-${id}`);
    assert.ok(panelTag.includes(`role="tabpanel"`), `settings-panel-${id} 缺少 role="tabpanel"`);
    assert.ok(panelTag.includes('x-show='), `settings-panel-${id} 应使用 x-show 保留各分类内的输入态`);
    assert.ok(panelTag.includes('x-cloak'), `settings-panel-${id} 缺少 x-cloak（Alpine 接管前会闪现全部分类）`);
  }
});

test('settings.html 主内容区不再有内联样式（R7）', async () => {
  const html = await fs.readFile(settingsHtmlPath, 'utf8');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

  assert.ok(main.length > 0, '未找到 <main> 区块');
  assert.equal(
    /\sstyle="/.test(main),
    false,
    '设置页主内容区仍有内联 style——布局样式应落在 settings.css 的 settings-* 类上'
  );
});

test('settings.html 的 tablist 朝向取自渲染结果而非写死', async () => {
  const html = await fs.readFile(settingsHtmlPath, 'utf8');

  assert.ok(
    /:aria-orientation="navOrientation"/.test(html),
    'tablist 的 aria-orientation 应绑定 navOrientation（桌面纵向 / 窄屏横排由 CSS 断点决定，JS 读 computed flex-direction 同步），不要写死 vertical'
  );
});

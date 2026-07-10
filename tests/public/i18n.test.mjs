import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'public', 'js', 'i18n.js');

/**
 * 加载 i18n.js 模块（cache-bust import，隔离各用例的模块内状态：
 * currentLocale / currentDict / warnedKeys）。
 *
 * 直接 import 仓库内文件而非拷贝临时目录：i18n.js 通过相对路径静态导入
 * ./locales/zh-CN.js 并动态导入 ./locales/<locale>.js，拷贝会丢依赖。
 */
async function loadI18n({ storage } = {}) {
  // mock localStorage（Node 无 localStorage；i18n.js 经 globalThis.localStorage 安全访问）
  const store = new Map(Object.entries(storage || {}));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };

  const moduleUrl = `${pathToFileURL(sourcePath).href}?test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const i18n = await import(moduleUrl);
  return { i18n, store };
}

test('t() 两级 key 取词返回 zh-CN 文案', async () => {
  const { i18n } = await loadI18n();

  assert.equal(i18n.t('status.idle'), '空闲');
  assert.equal(i18n.t('toast.exportOk'), '导出成功');
  assert.equal(i18n.getLocale(), 'zh-CN');
});

test('t() 支持 {name} 插值', async () => {
  const { i18n } = await loadI18n();

  assert.equal(i18n.t('toast.indexStarted', { total: 5 }), '索引已启动，共5个条目');
  assert.equal(
    i18n.t('toast.importOk', { action: '合并', total: 3 }),
    '导入成功（合并），共3个条目'
  );
});

test('t() params 缺失时保留占位符原样', async () => {
  const { i18n } = await loadI18n();

  assert.equal(i18n.t('toast.indexStarted'), '索引已启动，共{total}个条目');
  assert.equal(i18n.t('toast.indexStarted', {}), '索引已启动，共{total}个条目');
  assert.equal(
    i18n.t('toast.importOk', { total: 3 }),
    '导入成功（{action}），共3个条目'
  );
});

test('t() 缺 key 回退到 key 本身', async () => {
  const { i18n } = await loadI18n();

  assert.equal(i18n.t('nonexistent.key'), 'nonexistent.key');
  // 非叶子节点（对象而非字符串）同样回退 key
  assert.equal(i18n.t('toast'), 'toast');
});

// B6a 前此用例断言「en 词典为空 → 回退 zh-CN」的过渡态；en 填充后改为断言
// 词典切换 + 英文插值。en 与 zh-CN 的键完整性由 i18n.keys.test.mjs 结构性守护，
// 加载失败回退 zh-CN 由下方用例覆盖。
test('setLocale(en) 加载已填充的 en 词典，t() 返回英文', async () => {
  const { i18n } = await loadI18n();

  await i18n.setLocale('en');
  assert.equal(i18n.getLocale(), 'en');
  assert.equal(i18n.t('status.idle'), 'Idle');
  assert.equal(i18n.t('toast.indexStarted', { total: 2 }), 'Index started, 2 items in total');
  // 非默认词典下缺 key 仍走完整回退链（en → zh-CN → key 本身）：
  // en 填满后真实词典无法制造单 key 缺口，用不存在的 key 保住该分支的执行覆盖
  assert.equal(i18n.t('nonexistent.key'), 'nonexistent.key');
});

test('setLocale 持久化到 localStorage，initI18n 读取偏好', async () => {
  const { i18n, store } = await loadI18n();

  await i18n.setLocale('en');
  assert.equal(store.get('locale'), 'en');

  // 新实例（模拟刷新）从 localStorage 恢复
  const { i18n: fresh } = await loadI18n({ storage: { locale: 'en' } });
  await fresh.initI18n();
  assert.equal(fresh.getLocale(), 'en');
});

test('setLocale 加载失败回退 zh-CN 不抛错', async () => {
  const { i18n } = await loadI18n();

  await i18n.setLocale('no-such-locale');
  assert.equal(i18n.getLocale(), 'zh-CN');
  assert.equal(i18n.t('status.idle'), '空闲');
});

test('setLocale(zh-CN) 切回默认词典', async () => {
  const { i18n, store } = await loadI18n();

  await i18n.setLocale('en');
  await i18n.setLocale('zh-CN');
  assert.equal(i18n.getLocale(), 'zh-CN');
  assert.equal(store.get('locale'), 'zh-CN');
  assert.equal(i18n.t('common.unknown'), '未知');
});

/**
 * 前端 UI i18n 核心（自托管，无第三方库）。
 *
 * - t(key, params?)：两级 key 取词 + {name} 插值 + 回退链（当前语言 → zh-CN → key 本身）。
 * - setLocale(locale)：持久化 localStorage['locale'] + 非默认语言懒加载词典。
 * - getLocale() / initI18n()：读取当前 locale；应用启动时（Alpine 组件注册前）调用 initI18n()。
 *
 * 与 translations.js（VNDB tags 领域翻译，IndexedDB + 远端词典）是两套独立体系，
 * 互不共享任何状态；本模块只管 UI 文案。
 *
 * i18n 边界（AC5）：后端 errorResponse 返回的 4xx 中文友好 message（无 code 字段）
 * 由 friendlyErrorMessage 原样透传，**不经过本模块翻译**——后端 message 暂不纳入 i18n，
 * 仅前端自产文案（toast / 状态 / 校验 / 确认框等）走词典。
 */

import zhCN from './locales/zh-CN.js';

const DEFAULT_LOCALE = 'zh-CN';
const STORAGE_KEY = 'locale';

let currentLocale = DEFAULT_LOCALE;
let currentDict = zhCN;

// 缺 key 只 warn 一次/每 key，防刷屏
const warnedKeys = new Set();

/**
 * localStorage 安全读写（Node 测试环境 / 隐私模式下不可用时静默降级）。
 */
function safeStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // 存储不可用时静默降级（本次会话仍生效，刷新后回默认）
  }
}

/**
 * 从两级嵌套词典按 `<域>.<语义名>` 取值。
 * @param {Object} dict
 * @param {string} key
 * @returns {string|undefined}
 */
function lookup(dict, key) {
  if (!dict) return undefined;
  const segments = key.split('.');
  let node = dict;
  for (const segment of segments) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * {name} 占位符插值；params 缺失对应字段时保留占位符原样（便于发现漏传）。
 * @param {string} template
 * @param {Object} [params]
 * @returns {string}
 */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/**
 * 取词：当前语言词典 → zh-CN 词典 → key 本身（warn 一次/每 key）。
 * @param {string} key - 两级 key，如 'toast.indexStarted'
 * @param {Object} [params] - 插值参数，如 {total: 5}
 * @returns {string}
 */
export function t(key, params) {
  let value = lookup(currentDict, key);
  if (value === undefined && currentDict !== zhCN) {
    value = lookup(zhCN, key);
  }
  if (value === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] missing key: ${key} (locale: ${currentLocale})`);
    }
    return key;
  }
  return interpolate(value, params);
}

/**
 * 当前 locale 字符串（默认 'zh-CN'）。
 * @returns {string}
 */
export function getLocale() {
  return currentLocale;
}

/**
 * 切换语言：先持久化偏好，再懒加载词典（加载完成前继续用当前词典）。
 * 词典加载失败时回退 zh-CN 并 console.warn（不 throw，不炸功能）。
 *
 * @param {string} locale - 如 'zh-CN' / 'en'
 * @returns {Promise<void>}
 */
export async function setLocale(locale) {
  if (!locale || typeof locale !== 'string') return;

  safeStorageSet(STORAGE_KEY, locale);

  if (locale === DEFAULT_LOCALE) {
    currentLocale = DEFAULT_LOCALE;
    currentDict = zhCN;
    return;
  }

  try {
    const mod = await import(`./locales/${locale}.js`);
    currentDict = mod.default || {};
    currentLocale = locale;
  } catch (error) {
    console.warn('[i18n] load locale failed, fallback to zh-CN', {
      locale,
      error: error?.message || String(error)
    });
    currentLocale = DEFAULT_LOCALE;
    currentDict = zhCN;
  }
}

/**
 * 应用启动时调用（app.js，Alpine 组件注册前）：读 localStorage 偏好，
 * 非默认语言则预载对应词典（异步；加载完成前 t() 用 zh-CN，不阻塞首帧）。
 * @returns {Promise<void>}
 */
export function initI18n() {
  const stored = safeStorageGet(STORAGE_KEY);
  if (stored && stored !== DEFAULT_LOCALE) {
    return setLocale(stored);
  }
  return Promise.resolve();
}

// 便于控制台验证（本轮无可见切换 UI，D2）
if (typeof window !== 'undefined') {
  window.setLocale = setLocale;
  window.getLocale = getLocale;
}

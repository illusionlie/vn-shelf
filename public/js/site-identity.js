/**
 * VN Shelf 站点身份模块（ownerName 个性化）
 *
 * 职责：把外观配置中的 ownerName 组合为站点名，写入：
 * - 四页（index/tier/stats/settings）顶部 banner `.banner-title` 与登录页
 *   `h1.login-title`（品牌名硬编码先例，无 data-i18n，本模块独占写入，
 *   不存在与 applyI18nDom 扫描的竞争）；
 * - 五页 `<title>`：保留 meta.*Title 词典 key 的 data-i18n 静态应用路径，
 *   词典文案就位后做品牌段替换（'VN Shelf' → 站点名；ownerName 为空时
 *   站点名即 'VN Shelf'，替换为幂等 no-op）。
 *
 * 注入时机（三处覆盖，与 theme.js init/listener 双保险同形态）：
 * - app.js store init() 调 initSiteIdentity()：appearance 就绪（含 sessionStorage
 *   缓存直读）后应用；
 * - app.js i18nReady.then() 词典就绪重放 reapplySiteIdentity()：en 懒加载会经
 *   applyI18nDom 重写 <title>，需在其后重放。重放路径用模块级 _lastConfig
 *   重算，不读 Alpine store——该回调触发时 store 可能尚未初始化（app.js 先于
 *   alpine.min.js 执行，见 app.js 头注）；
 * - 'appearance-refreshed' 事件：跨标签页/缓存过期后台静默刷新后重应用
 *   （幂等挂载一次）。
 *
 * XSS 防护：全程仅 textContent / document.title 赋值，禁止 innerHTML；
 * 后端已做类型校验 + trim + 30 字符限长。
 */

import { t } from './i18n.js';

const BRAND_NAME = 'VN Shelf';

// 最近一次应用的 appearance 配置：i18n 词典就绪重放路径的数据源（见头注）
let _lastConfig = null;

// 标记是否已挂载后台刷新监听，避免重复 addEventListener
let _appearanceRefreshListenerBound = false;

/**
 * 站点名组合纯函数：有 ownerName 时按当前词典拼接
 * （zh「{name} 的 VN Shelf」/ en "{name}'s VN Shelf"），
 * 空串/纯空白回退品牌名。
 * @param {string} ownerName - appearance.ownerName（可能 undefined/null）
 * @returns {string}
 */
export function composeSiteName(ownerName) {
  const name = String(ownerName || '').trim();
  return name ? t('site.ownerTitle', { name }) : BRAND_NAME;
}

/**
 * 应用站点身份到当前文档（幂等，可重复调用）。
 * @param {Object|null} config - appearance 配置（{ ownerName, ... }，可为 null）
 */
export function applySiteIdentity(config) {
  _lastConfig = config || null;
  const siteName = composeSiteName(config?.ownerName);

  document.querySelectorAll('.banner-title, .login-title')
    .forEach(el => { el.textContent = siteName; });

  // <title>：取 title 元素自身 data-i18n key 重取词后做品牌段替换。
  // 执行时机约定：须在 applyI18nDom 之后（meta.*Title 文案已就位）
  const titleEl = document.querySelector('title');
  const key = titleEl?.getAttribute('data-i18n');
  if (key) {
    document.title = t(key).replaceAll(BRAND_NAME, siteName);
  }
}

/**
 * 用最近一次的配置重算站点身份（i18n 词典就绪后的重放入口）。
 */
export function reapplySiteIdentity() {
  applySiteIdentity(_lastConfig);
}

export async function initSiteIdentity() {
  try {
    const cfg = await Alpine.store('app').loadAppearance();
    applySiteIdentity(cfg);
  } catch (error) {
    console.warn('[site-identity] init', {
      error: error?.message || String(error)
    });
  }

  // 监听 Store 后台刷新事件，重新应用站点身份（幂等挂载一次）
  if (!_appearanceRefreshListenerBound) {
    _appearanceRefreshListenerBound = true;
    window.addEventListener('appearance-refreshed', (event) => {
      applySiteIdentity(event?.detail || null);
    });
  }
}

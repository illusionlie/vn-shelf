/**
 * 纯函数：设置页分类分页的 id 表、hash 解析与键盘漫游目标。
 *
 * 抽为独立模块（同 tier-diff.js 的口径：零 DOM / API / i18n import、无副作用），
 * 便于 node:test 直测 `public/settings.html` 中手写的 5 个 tab / panel id 与
 * 键盘行为的对应关系。
 *
 * 约定：分类 id 同时是 URL hash（`/settings#tags`）与 DOM id 后缀
 * （`settings-tab-<id>` / `settings-panel-<id>`）——三处必须同值。
 */

/** 分类顺序即导航与面板的显示顺序；首个为默认分类。 */
export const SETTINGS_TABS = Object.freeze(['vndb', 'appearance', 'tags', 'security', 'data']);

export const DEFAULT_SETTINGS_TAB = SETTINGS_TABS[0];

/**
 * hash → 分类 id。仅接受完全匹配的分类 id（大小写敏感），其余（空 / 未知 /
 * 非字符串 / `#constructor` 这类原型键）一律回落默认分类。
 *
 * @param {string|null|undefined} hash - 形如 `#tags`，也容忍不带 `#`
 * @returns {string} 有效分类 id
 */
export function resolveSettingsTab(hash) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  return SETTINGS_TABS.includes(raw) ? raw : DEFAULT_SETTINGS_TAB;
}

/**
 * 按键盘事件 key 计算目标分类；非导航键返回 null。
 *
 * 两轴都映射（←/↑ 上一个、→/↓ 下一个）：同一个 tablist 在桌面是纵向侧栏、
 * 窄屏是横向条，按两轴都能用比按断点切换键位更稳。Home / End 跳首尾。
 *
 * @param {string} current - 当前分类 id（非法值先归一到默认分类）
 * @param {string} key - KeyboardEvent.key
 * @returns {string|null} 目标分类 id；不处理该键时 null
 */
export function nextSettingsTab(current, key) {
  const index = SETTINGS_TABS.indexOf(resolveSettingsTab(current));

  if (key === 'Home') return SETTINGS_TABS[0];
  if (key === 'End') return SETTINGS_TABS[SETTINGS_TABS.length - 1];

  const backward = key === 'ArrowUp' || key === 'ArrowLeft';
  const forward = key === 'ArrowDown' || key === 'ArrowRight';
  if (!backward && !forward) return null;

  const step = forward ? 1 : -1;
  return SETTINGS_TABS[(index + step + SETTINGS_TABS.length) % SETTINGS_TABS.length];
}

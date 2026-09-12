/**
 * 前端共享常量。
 *
 * 值须与后端约定一致——后端独立定义，跨 Worker/前端边界无构建步骤、无 import 共享，
 * 两端各自定义但值必须保持同步，修改一端时必须同步另一端。
 */

/** 未分类 Tier 的逻辑键（与 tierlistPage / tier-diff 内部约定）。 */
export const UNTIERED_KEY = '__untiered__';

/** 新建/重置 Tier 时的默认颜色。 */
export const DEFAULT_TIER_COLOR = '#ff4757';

/**
 * 单次批量 Tier 更新的最大条目数。
 * 与后端 src/router.js:35 MAX_BATCH_TIER_UPDATES 同源约定，勿单独修改一端。
 */
export const MAX_BATCH_TIER_UPDATES = 200;

/**
 * 前端 UI 暴露的游玩状态白名单（状态徽章 / 筛选选项）。
 * 与后端 src/repository.js VN_STATUS_VALUES 同源约定——后端另含预留的 wishlist，
 * 首期 UI 不暴露；修改一端时必须同步另一端。
 */
export const VN_STATUS_OPTIONS = ['playing', 'finished', 'stalled', 'dropped'];

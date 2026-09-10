/**
 * 纯函数：把完整条目（`GET/PUT /api/vn/:id` 的 `data`）中的 VNDB 元数据合并进列表项。
 *
 * 用于单条目 VNDB 刷新后的就地更新（vnShelf.applyRefreshedEntry），
 * 避免为一条记录重拉整表并重置渲染窗口。
 *
 * 【跨端同值约定】字段口径镜像 `src/repository.js` 的 `rowToListItem`：
 *   title      = vndb.title || ''
 *   titleJa    = vndb.titleJa || vndb.title || ''
 *   titleCn    = user.titleCn || vndb.titleCn || ''     // row.title_cn_user || row.title_cn
 *   image      = vndb.image || ''
 *   imageNsfw  = Boolean(vndb.imageNsfw)
 *   rating     = 非有限 / 负数 → 0                       // toNonNegativeNumber
 *   developers = 数组原样，否则 []
 *   allAge     = Boolean(vndb.allAge)
 * 任一侧改动都必须同步另一侧（与 constants.js 同类约定）。
 *
 * 只覆盖 VNDB 派生字段；用户 / 行元数据字段（id、personalRating、playTimeMinutes、
 * tierId、tierSort、status、createdAt）保持列表项原值。无 DOM / API / i18n 依赖，可直接 node:test。
 */

/**
 * @param {number|string|null|undefined} value
 * @returns {number} 非有限或负数归 0
 */
function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num;
}

/**
 * @param {Object} item - 现有列表项（不会被修改）
 * @param {{ vndb?: Object, user?: Object }} entry - 完整条目
 * @returns {Object} 新的列表项对象
 */
export function mergeVndbIntoListItem(item, entry) {
  const vndb = entry?.vndb || {};
  const user = entry?.user || {};

  return {
    ...item,
    title: vndb.title || '',
    titleJa: vndb.titleJa || vndb.title || '',
    titleCn: user.titleCn || vndb.titleCn || '',
    image: vndb.image || '',
    imageNsfw: Boolean(vndb.imageNsfw),
    rating: toNonNegativeNumber(vndb.rating),
    developers: Array.isArray(vndb.developers) ? vndb.developers : [],
    allAge: Boolean(vndb.allAge)
  };
}

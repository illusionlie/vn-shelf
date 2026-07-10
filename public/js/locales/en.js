/**
 * en 词典（英文 UI 文案，已填充）。
 *
 * 结构契约：与 locales/zh-CN.js 完全一致——两级嵌套、同名叶子 key、
 * `{name}` 插值占位符逐 key 对齐。该契约由 tests/public/i18n.keys.test.mjs
 * 的 key-diff 单测守护（叶子路径集合双向相等 / 占位符集合一致 / 值非空 string）。
 *
 * 新增文案时先在 zh-CN.js 加 key，再同步本文件，否则单测失败。
 */
export default {
  common: {
    unknown: 'Unknown',
    notRecorded: 'Not recorded',
    ok: 'OK',
    cancel: 'Cancel'
  },
  error: {
    unauthorized: 'Please log in first',
    forbidden: 'You do not have permission to perform this action',
    notFound: 'Resource not found',
    validation: 'Invalid input',
    conflict: 'Conflict detected, please refresh and try again',
    rateLimit: 'Too many requests, please try again later',
    serverError: 'Server temporarily unavailable, please try again later',
    network: 'Network connection failed, please check and try again',
    networkRequestFailed: 'Network request failed'
  },
  status: {
    idle: 'Idle',
    starting: 'Starting',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    partial: 'Partially completed',
    startFailed: 'Start failed'
  },
  toast: {
    vndbTokenSaved: 'VNDB API token saved',
    passwordUpdated: 'Password updated',
    indexStarted: 'Index started, {total} items in total',
    exportOk: 'Export successful',
    importOk: 'Import successful ({action}), {total} items in total',
    importInvalidJson: 'Import failed: file is not valid JSON',
    importInvalidFormat: 'Import failed: invalid import file format',
    translationCacheCleared: 'Translation cache cleared',
    tagsConfigSaved: 'Tags settings saved',
    appearanceSaved: 'Appearance settings saved',
    addOk: 'Added successfully',
    updateOk: 'Updated successfully',
    deleteOk: 'Deleted successfully',
    tierCreated: 'Tier created',
    tierUpdated: 'Tier updated',
    tierDeleted: 'Tier deleted',
    tierOrderUpdated: 'Tier order updated',
    tierPageLoadFailed: 'Failed to load tier list page data, please try again later'
  },
  prefix: {
    operationFailed: 'Operation failed',
    loadFailed: 'Load failed',
    loadConfigFailed: 'Failed to load config',
    loadStatsFailed: 'Failed to load stats',
    loadDetailFailed: 'Failed to load details',
    loadTierListFailed: 'Failed to load tier list',
    loadVnListFailed: 'Failed to load VN list',
    saveFailed: 'Save failed',
    updateFailed: 'Update failed',
    deleteFailed: 'Delete failed',
    startIndexFailed: 'Failed to start index',
    exportFailed: 'Export failed',
    importFailed: 'Import failed',
    logoutFailed: 'Logout failed',
    loginFailed: 'Login failed',
    clearCacheFailed: 'Failed to clear cache',
    saveTierFailed: 'Failed to save tier',
    deleteTierFailed: 'Failed to delete tier',
    updateOrderFailed: 'Failed to update order',
    dragUpdateFailed: 'Drag update failed'
  },
  validation: {
    passwordRequired: 'Please enter a password',
    passwordMin: 'Password must be at least 6 characters',
    passwordMismatch: 'Passwords do not match',
    playTimeHoursInvalid: 'Play time hours must be a non-negative number',
    playTimeMinutesInvalid: 'Play time minutes must be a non-negative number',
    tierNameRequired: 'Tier name cannot be empty',
    tierColorFormat: 'Tier color must be in #RRGGBB format'
  },
  confirm: {
    importTitle: 'Import mode',
    importMessage: 'Merge: keep existing data and append; Replace: clear existing data before writing.',
    importMerge: 'Merge',
    importReplace: 'Replace',
    importAbort: 'Cancel import',
    clearCacheTitle: 'Clear translation cache',
    clearCacheMessage: 'Translation data will need to be downloaded again on next use.',
    clearCacheAction: 'Clear',
    deleteVnTitle: 'Delete entry',
    deleteVnMessage: 'Are you sure you want to delete this entry?',
    deleteAction: 'Delete',
    deleteTierTitle: 'Delete tier',
    deleteTierMessage: 'After deleting this tier, its entries will become uncategorized.'
  },
  time: {
    hours: '{h}h',
    minutes: '{m}m',
    hoursMinutes: '{h}h {m}m',
    daysHours: '{d}d {h}h'
  },
  theme: {
    switchToLight: 'Switch to light theme',
    switchToDark: 'Switch to dark theme'
  },
  markdown: {
    unsafeLink: 'Unsafe link disabled',
    unsafeImage: 'Unsafe image link disabled',
    imagePlaceholder: '[Image]'
  }
};

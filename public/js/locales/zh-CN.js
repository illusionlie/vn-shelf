/**
 * zh-CN 默认词典（静态导入，保证 t() 首帧同步可用）。
 *
 * 结构约定：两级嵌套对象，key 形如 `<域>.<语义名>`：
 * - common.*     通用词（未知/未记录/确定/取消等）
 * - error.*      friendlyErrorMessage 的 code→文案映射
 * - status.*     索引任务状态（settingsPage.formatStatus）
 * - toast.*      成功/提示类 toast
 * - prefix.*     错误 toast 的业务前缀（friendlyErrorMessage prefix）
 * - validation.* 表单校验提示
 * - confirm.*    确认对话框标题/正文/按钮
 * - time.*       时长格式化单位模板
 * - theme.*      主题切换 aria-label
 * - markdown.*   Markdown 渲染安全降级文案
 *
 * 插值占位符用 `{name}`，由 t(key, params) 替换。
 */
export default {
  common: {
    unknown: '未知',
    notRecorded: '未记录',
    ok: '确定',
    cancel: '取消'
  },
  error: {
    unauthorized: '请先登录',
    forbidden: '没有权限执行此操作',
    notFound: '资源不存在',
    validation: '输入内容有误',
    conflict: '操作冲突，请刷新后重试',
    rateLimit: '操作过于频繁，请稍后再试',
    serverError: '服务器暂时不可用，请稍后重试',
    network: '网络连接失败，请检查后重试',
    networkRequestFailed: '网络请求失败'
  },
  status: {
    idle: '空闲',
    starting: '启动中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    partial: '部分完成',
    startFailed: '启动失败'
  },
  toast: {
    vndbTokenSaved: 'VNDB API Token已保存',
    passwordUpdated: '密码已更新',
    indexStarted: '索引已启动，共{total}个条目',
    exportOk: '导出成功',
    importOk: '导入成功（{action}），共{total}个条目',
    importInvalidJson: '导入失败：文件不是有效的 JSON',
    importInvalidFormat: '导入失败：无效的导入文件格式',
    translationCacheCleared: '翻译缓存已清除',
    tagsConfigSaved: 'Tags 设置已保存',
    appearanceSaved: '外观设置已保存',
    addOk: '添加成功',
    updateOk: '更新成功',
    deleteOk: '删除成功',
    tierCreated: 'Tier 已创建',
    tierUpdated: 'Tier 已更新',
    tierDeleted: 'Tier 已删除',
    tierOrderUpdated: 'Tier 顺序更新成功',
    tierPageLoadFailed: '加载 Tier 页面数据失败，请稍后重试'
  },
  prefix: {
    operationFailed: '操作失败',
    loadFailed: '加载失败',
    loadConfigFailed: '加载配置失败',
    loadStatsFailed: '加载统计失败',
    loadDetailFailed: '加载详情失败',
    loadTierListFailed: '加载 Tier 列表失败',
    loadVnListFailed: '加载 VN 列表失败',
    saveFailed: '保存失败',
    updateFailed: '更新失败',
    deleteFailed: '删除失败',
    startIndexFailed: '启动索引失败',
    exportFailed: '导出失败',
    importFailed: '导入失败',
    logoutFailed: '退出失败',
    loginFailed: '登录失败',
    clearCacheFailed: '清除缓存失败',
    saveTierFailed: '保存 Tier 失败',
    deleteTierFailed: '删除 Tier 失败',
    updateOrderFailed: '更新排序失败',
    dragUpdateFailed: '拖拽更新失败'
  },
  validation: {
    passwordRequired: '请输入密码',
    passwordMin: '密码长度至少6位',
    passwordMismatch: '两次输入的密码不一致',
    playTimeHoursInvalid: '游玩时长小时必须是非负数字',
    playTimeMinutesInvalid: '游玩时长分钟必须是非负数字',
    tierNameRequired: 'Tier 名称不能为空',
    tierColorFormat: 'Tier 颜色必须是 #RRGGBB 格式'
  },
  confirm: {
    importTitle: '导入模式',
    importMessage: '合并：保留现有数据并追加；替换：清空现有数据后写入。',
    importMerge: '合并',
    importReplace: '替换',
    importAbort: '取消导入',
    clearCacheTitle: '清除翻译缓存',
    clearCacheMessage: '下次使用时需要重新下载翻译数据。',
    clearCacheAction: '清除',
    deleteVnTitle: '删除条目',
    deleteVnMessage: '确定要删除这个条目吗？',
    deleteAction: '删除',
    deleteTierTitle: '删除 Tier',
    deleteTierMessage: '删除该 Tier 后，其下条目将变为未分类。'
  },
  time: {
    hours: '{h}小时',
    minutes: '{m}分钟',
    hoursMinutes: '{h}小时{m}分钟',
    daysHours: '{d}天{h}小时'
  },
  theme: {
    switchToLight: '切换到亮色主题',
    switchToDark: '切换到暗色主题'
  },
  markdown: {
    unsafeLink: '不安全的链接已禁用',
    unsafeImage: '不安全的图片链接已禁用',
    imagePlaceholder: '[图片]'
  }
};

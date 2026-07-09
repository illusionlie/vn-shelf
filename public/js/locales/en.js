/**
 * en 词典 —— 留空框架。
 *
 * 当前为空对象：setLocale('en') 后所有 key 走回退链（en 缺失 → zh-CN → key 本身），
 * UI 仍显示 zh-CN 文案，不报错。实际英文翻译由后续任务填充，
 * 结构须与 locales/zh-CN.js 完全一致（两级嵌套，同名 key）。
 */
export default {};

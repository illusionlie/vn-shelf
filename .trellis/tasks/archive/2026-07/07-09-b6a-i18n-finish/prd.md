# B6a i18n 收尾：en 词典 + key-diff 单测 + 语言切换入口

> 父任务 `07-09-b6-finish`。承接 B5b 设计文档记录的三项 i18n 后续。轻量任务（PRD-only）。

## Goal

让 B5b 落地的 i18n 框架真正"可切英文"：填充 en 词典、加键一致性单测、在设置页提供语言切换入口。

## 确认事实（2026-07-10 代码勘察）

- **i18n.js 契约**（`public/js/i18n.js`）：
  - `t(key, params)`：两级 key、`{name}` 插值（缺参保留占位符）、回退链 当前语言→zh-CN→key（缺 key 每键 warn 一次）。
  - `setLocale(locale)`：**先**写 `localStorage['locale']`，**再**懒加载 `import('./locales/<locale>.js')`；加载失败回退 zh-CN 词典并 warn（不 throw）。
  - `initI18n()`：app.js 在 Alpine 注册前调用；非默认语言异步预载，不阻塞首帧。
  - `t()` 在事件/渲染时求值——切语言后新产生文案用新词典，已渲染文本刷新后生效（B5b 语义）。
- **词典**：`locales/zh-CN.js` 87 个叶子 key、10 域（common 4 / error 9 / status 7 / toast 18 / prefix 20 / validation 7 / confirm 13 / time 4 / theme 2 / markdown 3）；`en.js` 为空 `export default {}`，头注释要求结构与 zh-CN 完全一致。
- **D2 脚手架**：`window.setLocale/getLocale` 挂载注释明示为"无可见切换 UI 时的控制台验证"权宜——本任务落地 UI 后即零引用。
- **设置页**（`settings.html` + `settingsPage.js`）：7 个 `settings-section`（VNDB API / 管理员密码 / 数据索引 / Tags 显示 / 外观设置 / 数据管理 / 账户）；控件惯例 = `radio-group` + `x-model` + `@change` 立即保存（Tags 来源即此形态），全页无 `<select>`。
- **存储边界**：外观/Tags 设置存后端 config（configAPI）；语言偏好为 localStorage 纯本地（B5b 决策），不进后端。
- **spec 守则**（quality-guidelines.md）：切换刷新生效是 by design，"不要在没有需要即时切换的任务时把 locale 改成 Alpine 响应式 store"；UI 动态文案必须走 `t()`。
- **测试布局**：`node --test`，前端纯逻辑测试先例在 `tests/public/`（markdown.security.test.mjs）；词典为 ESM 可直接 import 断言。
- **B6b 依赖关系**：HTML 静态中文（含设置页分区标题）属 B6b——B6a 切到 en 后页面为"JS 动态文案英文 + HTML 骨架中文"的混合态，属批次内已知过渡状态。

## 决策记录（2026-07-10 用户逐项确认）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 切换生效语义 | **自动 `location.reload()`**：`await setLocale(locale)` 后整页重载，动态文案一致切换；守住 spec"刷新生效 by design" |
| Q2 | 入口位置 | **独立「语言 / Language」settings-section**，置于「外观设置」之后；radio-group（简体中文 / English）+ `@change` 立即生效；与后端 config 的存储语义分离 |
| Q3 | D2 脚手架 | **移除** `window.setLocale/getLocale` 挂载（UI 落地后零引用，经用户确认删除） |

## Requirements（定稿）

- R1 `en.js` 填充：87 个叶子 key 与 zh-CN 完全对齐，英文由 AI 拟定、走查抽查；`{name}` 占位符逐 key 保持一致。
- R2 键一致性单测（`tests/public/i18n.keys.test.mjs`）：
  - 递归叶子路径集合 **双向相等**（en ≡ zh-CN，强于种子 PRD 的 ⊆——本任务后不允许任一方向漂移）；
  - 每个 key 的 `{placeholder}` 名称集合一致（防插值参数漂移）；
  - 叶子值均为非空 string。
- R3 设置页语言切换入口：
  - `settings.html` 新增独立 `settings-section`「语言 / Language」（外观设置之后）：radio-group，选项文案用各语言母语（"简体中文"/"English"）；
  - **radio 初始态绑定存储偏好而非 `getLocale()`**——`getLocale()` 反映已加载词典，懒加载完成前有竞态；i18n.js 新增导出 `getStoredLocale()`（`safeStorageGet(STORAGE_KEY) ?? DEFAULT_LOCALE`），组件用它初始化；
  - `@change`：`await setLocale(locale)` → `location.reload()`。
- R4 移除 i18n.js 尾部 `window.setLocale/getLocale` 挂载及其 D2 注释。

## Acceptance Criteria

- [x] AC1 `en.js` 87 个叶子 key 全部填充，结构与 zh-CN 完全一致。
- [x] AC2 新单测三组断言（叶子路径集合双向相等 / 逐 key `{placeholder}` 集合一致 / 叶子值非空 string）纳入 `npm run test` 且通过。
- [x] AC3（2026-07-10 用户走查通过）设置页出现「语言 / Language」独立分区：radio 正确反映当前偏好（含 en 持久化后刷新再进入），切换后页面自动重载且语言保持。
- [x] AC4（2026-07-10 用户走查通过）en 模式走查：toast（如导出成功）、索引状态文案、删除确认框均为英文；控制台无 `[i18n] missing key` warn；HTML 骨架仍中文属 B6b 已知过渡态，不计回归。切回 zh-CN 一切如常。
- [x] AC5 `window.setLocale/getLocale` 挂载移除，`grep -r "window.setLocale" public/` 零命中。
- [x] AC6 `npm run lint && npm run test` 全绿。

## Out of Scope

- HTML 静态文案迁移（B6b，含设置页既有分区标题）。
- 后端 message 翻译（延续 B5b 边界）。
- 语言偏好后端持久化（维持 localStorage 本地语义）。
- translations.js（VNDB tags 翻译体系）不动。

## Open Questions

（无——三项决策已于 2026-07-10 逐项确认，见决策记录。）

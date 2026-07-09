# B5b 前端 i18n 框架接入

> 父任务：`07-03-frontend-b5-engineering`（T5-U3）。自托管轻量 i18n，不引第三方库。

## Goal

为前端建立可扩展的 i18n 基础设施（`i18n.js` + JSON 词典），并将现有硬编码中文 UI 文案迁入词典，使切换语言后动态文案（toast / 状态 / 校验提示）随之切换。多语言上线非强制：zh-CN 全量 + en 词典留空即算达标。

## 已确认事实（代码勘察）

- UI 中文字面量分布（JS，含注释的中文行计数）：`api.js` 错误映射 8 条 + friendlyErrorMessage、`app.js` toast、`components/settingsPage.js` formatStatus 7 态、`confirmDialog.js` / `tierlistPage.js` / `vnShelf.js` / `shared.js` / `loginPage.js` / `statsPage.js` 各有校验与确认文案；`utils.js` / `layout.js` / `theme.js` / `markdown.js` 少量。
- HTML 静态中文约 237 行（index 73 / settings 75 / tier 46 / stats 26 / login 17）：导航、placeholder、`<option>`、aria-label、`<title>`/meta。
- `translations.js` 是 VNDB tags 领域翻译（IndexedDB + 远端词典），与 UI i18n 独立，不在本任务范围。
- 语言偏好可沿用 `theme.js` 的 `localStorage` 模式。
- 后端 `errorResponse` 返回中文 message（无 code）；`friendlyErrorMessage` 对 4xx 直接沿用后端文案——i18n 边界：后端 message 暂不翻译，需在文档中说明（父 PRD 已决策）。

## Requirements

- R1 自托管 `public/js/i18n.js`：`t(key, params?)` 取词 + 参数插值 + 缺 key 回退（回退到 zh-CN 或 key 本身）。
- R2 词典 JSON：`zh-CN` 全量；`en` 留空框架就位。
- R3 迁移 JS 侧动态 UI 文案：toast、formatStatus、表单校验抛错、确认对话框等字符串字面量。
- R4 语言偏好持久化（localStorage）+ 切换入口（TBD，见 Open Questions）。
- R5 文档说明后端中文 message 与 i18n 的边界。

## Out of Scope

- `translations.js`（VNDB tags 翻译体系）。
- 后端 message 翻译（A3 信封统一亦不在此）。
- 第三方 i18n 库。
- en 词典的实际翻译内容。

## 已决策

- D1 本次**仅迁 JS 动态文案**；HTML 静态文案（约 237 行）不迁移，留待后续灰度批次（框架能力需支持后续 HTML 迁移即可）。
- D2 本轮**无可见切换 UI**：`setLocale(locale)` + localStorage 持久化，控制台验证；en 词典就绪后另立小任务补设置页入口。
- D3 词典承载：zh-CN 以 JS 模块静态导入（无构建步骤下保证 `t()` 同步可用）；en 等非默认语言切换时懒加载。缺 key 回退顺序：当前语言 → zh-CN → key 本身。

## Acceptance Criteria

- [ ] AC1 `public/js/i18n.js` 存在并导出 `t(key, params?)` / `setLocale(locale)` / `getLocale()`；zh-CN 词典模块就位，en 词典留空框架就位。
- [ ] AC2 toast 文案、`settingsPage.js formatStatus` 状态 map、表单校验抛错、确认对话框文案等 JS 侧 UI 字符串字面量全部经 `t()` 取词（`grep` 目标文件不再有裸中文 UI 字面量；注释中的中文不算）。
- [ ] AC3 控制台 `setLocale('en')` 后，新触发的 toast/状态文案走回退链（en 为空 → 显示 zh-CN），无报错、无 "undefined"/裸 key 泄漏到 UI（回退到 key 仅在词典缺失时兜底）。
- [ ] AC4 语言偏好写入 localStorage，刷新后保持。
- [ ] AC5 `friendlyErrorMessage` 的后端中文 message 边界在 i18n 文档/注释中说明（后端 message 暂不翻译）。
- [ ] AC6 `npm run lint && npm run test` 全绿；`t()` 核心逻辑（取词/插值/回退）有单测。
- [ ] AC7 五页面手工走查：登录、添加/编辑 VN、Tier 操作、设置索引、统计页，动态文案显示与迁移前一致（zh-CN 无回归）。

## Open Questions

（无——技术细节见 design.md）

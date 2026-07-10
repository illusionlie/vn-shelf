# B6b HTML 静态文案 i18n 迁移

> 父任务 `07-09-b6-finish`。B5b 仅迁 JS 动态文案，HTML 静态中文留作本批次。**复杂任务**（框架扩展 + 5 页 + 双词典），需 design.md + implement.md。

## Goal

将五个 HTML 页面的静态中文 UI 文案纳入 i18n 体系，使 HTML 文本随语言切换；en 模式下页面不再是"英文动态文案 + 中文骨架"混合态。

## 确认事实（2026-07-10 代码勘察）

- **文案量**：五页含中文行 252（index 77 / settings 79 / tier 52 / stats 27 / login 17），其中 **41 行为 HTML 注释**（不迁移）。有效目标 ≈ 210 行；估计净新增词典键 ~130–160（导航等跨页重复项合并）。
- **形态分布**：属性型 52 处（`placeholder` 17 / `aria-label` 13 / `title` 11 / `<option>` 6 / `<title>`+`meta` 5——每页一个 title，仅 index 有 meta description）；其余为静态文本节点（导航、分区标题、label、hint、按钮、空态、表头）。
- **B5b 盲区——内联 Alpine 表达式中文字面量 11 处**：如 `x-text="isSavingTier ? '保存中...' : '保存'"`、`x-text="... || '未知'"`、`:aria-label="... + ' · 未分类'"`。`t()` 是模块导入，Alpine 表达式作用域不可达——需 `Alpine.magic('t')`（`$t('key')`）或组件方法承接。
- **启动时序**（app.js）：`initI18n()` 为**不阻塞**调用（en 词典异步预载，注释明示"不阻塞首帧"）；`injectShell()` → `alpine:init` 注册。DOM 应用若不等 `initI18n()` resolve，en 用户首屏会应用到 zh-CN 词典。**不能改成 top-level await**：app.js（module）与 alpine.min.js（defer classic）的执行顺序在 TLA 下不保证，Alpine 可能先启动导致组件注册全丢。
- **layout.js 注入模板无用户可见中文**（确认框文案走 store 参数、B5b 已 t() 化）——零迁移量。
- **`<html lang="zh-CN">` 硬编码 ×5**：切 en 后 lang 不随，屏幕阅读器发音错误——应用机制应同步 `documentElement.lang`。
- **测试协同**：B6a 的 `i18n.keys.test.mjs` 断言双向键相等 + 占位符一致——本任务新增键漏译 en 会直接挂 `npm run test`。
- **依赖**：B6a 已归档（en 词典 87 键就位），种子 PRD 的"先迁键还是等 B6a"问题已消解。

## 决策记录（2026-07-10 用户逐项确认）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | DOM 应用机制 | **`data-i18n` 扫描器（静态，含 `<template>.content` 递归）+ `Alpine.magic('t')`（仅 11 处内联表达式）混合** |
| Q2 | FOUC 策略 | **`initI18n().then(applyI18nDom)` 两遍应用**：zh 默认用户零观感；en 用户容忍首屏短暂中文闪现（几十 ms），记录为已知取舍。禁用 top-level await（defer 时序硬约束） |
| Q3 | B6a 移交项 | **两项全收编**：api.js 全角冒号 →`t('common.colon')`；settingsPage 日期 → `toLocaleString(getLocale())` |

## Requirements（定稿）

- R1 `i18n.js` 新增 `applyI18nDom(root=document)`：`data-i18n`（textContent）+ 四属性标记（placeholder / aria-label / title / content）；递归处理 `<template>.content`（84/200 中文行在模板内）；同步 `documentElement.lang`。
- R2 五页非注释中文（≈200 行）标注迁移；新增 ~130–160 键并入 zh-CN + en 双词典（zh 值 = 现字面量等值替换；键域 nav/meta/页域/common 扩充）。
- R3 11 处内联 Alpine 表达式中文字面量 → `$t('key')`（`alpine:init` 注册 magic）。
- R4 app.js 接线：`initI18n()` 保持不阻塞；`applyI18nDom()` 同步第一遍 + `.then()` 第二遍（幂等）。
- R5 `data-i18n` 与 Alpine 绑定同节点/同属性互斥；`data-i18n` 仅标叶子元素。
- R6 收编项：`common.colon` 键（api.js 8 处拼接）；日期格式化随 `getLocale()`（2 处）。
- R7 白名单：语言分区 radio"简体中文"保持母语不迁移（B6a 决策延续）。

## Acceptance Criteria

- [x] AC1（2026-07-10 用户走查通过）en 模式五页走查：导航、分区/弹窗标题、placeholder、`<option>`、aria-label、页面 `<title>`（及 index meta）全英文；控制台零 `[i18n] missing key`。
- [x] AC2（2026-07-10 用户走查通过）zh-CN 模式五页走查零观感变化（等值替换）。
- [x] AC3 `grep -n '[一-鿿]' public/*.html` 非注释命中仅剩白名单（"简体中文"radio）。
- [x] AC4 11 处内联表达式随语言切换（保存中/未知/已配置/编辑 Tier 等）。
- [x] AC5 en 模式错误 toast 分隔符为 ": "（zh 仍 '：'）；设置页缓存日期格式随 locale。
- [x] AC6 `document.documentElement.lang` 随语言（en → 'en'）。
- [x] AC7 详情弹窗、确认框、Tier 拖拽、登录流程双语走查无功能回归；模板 stamp 的克隆节点文案正确（模板递归生效）。
- [x] AC8 `npm run lint && npm run test` 全绿（keys 单测自动守护新键 en 对齐）。

## Out of Scope

- JS 文件内动态文案（B5b 已迁）。
- 后端 message 翻译（B5b 边界）。
- layout.js 注入模板（勘察确认无中文）。
- 新增第三方 i18n 库（延续自托管原则）。
- 语言分区 radio 母语标签（白名单，永不翻译）。

## Open Questions

（无——三项决策已于 2026-07-10 逐项确认，见决策记录；机制细节见 design.md。）

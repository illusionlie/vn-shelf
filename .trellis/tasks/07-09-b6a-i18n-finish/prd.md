# B6a i18n 收尾：en 词典 + key-diff 单测 + 语言切换入口

> 父任务 `07-09-b6-finish`。承接 B5b 设计文档记录的三项 i18n 后续。种子 PRD，正式规划在 start 前用 brainstorm 补全。

## Goal

让 B5b 落地的 i18n 框架真正"可切英文"：填充 en 词典、加键一致性单测、在设置页提供语言切换入口。

## 已知约束（B5b 遗留）

- `public/js/i18n.js` 已就位：`t/setLocale/getLocale/initI18n`，回退链 当前语言→zh-CN→key，缺 key warn 去重。
- `public/js/locales/zh-CN.js` 87 词条（10 域），`en.js` 当前为空 `export default {}`。
- `setLocale` 已挂 `window`（B5b D2 为控制台验证），已 localStorage 持久化。
- B5b 设计文档建议：en 填充需附 key-diff 单测（en 键集 ⊆ zh-CN）。

## Requirements（草案）

- R1 `en.js` 填充：对齐 zh-CN 全部叶子 key，提供英文翻译（含 `{name}` 插值占位保持）。
- R2 单测：断言 en 键集与 zh-CN 键集结构一致（至少 en ⊆ zh-CN，理想相等）。
- R3 设置页语言切换入口：下拉/按钮，调 `setLocale` + 反映当前 `getLocale()`；切换后动态文案随之（刷新生效语义沿用 B5b）。

## Acceptance Criteria

- [ ] TBD（brainstorm 细化：切换是否需即时重渲染 vs 刷新生效；入口 UI 形态）

## Out of Scope

- HTML 静态文案（B6b）。
- 后端 message 翻译（延续 B5b 边界）。

## Open Questions

- 语言切换后是否要求即时重渲染（涉及 Alpine 响应式 locale store），还是沿用 B5b 的"刷新生效"？

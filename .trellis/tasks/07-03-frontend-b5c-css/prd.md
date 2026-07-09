# B5c CSS 拆分与断点补全

> 父任务：`07-03-frontend-b5-engineering`（T5-P5）。不破坏现有视觉；首屏阻塞 CSS 体积下降。

## Goal

将 1928 行单文件 `public/css/style.css` 拆为 base + 组件/页面模块，按页面按需引入；断点从单一 700px 补全为 480/768/1024 三档；降低首屏阻塞 CSS 体积。

## 已确认事实（代码勘察）

- `style.css` 1928 行，31 个 `/* ===== */` 注释分区，边界清晰（Variables/Reset/Header/Nav/Buttons/Modal/Forms/VN Cards/Detail/Tier/Stats/Login/Settings/Toast/Markdown 等）。
- 全站仅一个断点：`@media screen and (max-width: 700px)`（约 1472–1557 行），集中一处而非分散。
- 五个 HTML 页面均只有一行 `<link rel="stylesheet" href="css/style.css">`，无内联样式块。
- 页面专属分区可辨：Tier List Page（1067–1276）、Stats（1277–1324）、Login（1325–1353）、Settings（1354–1383）、Detail Page（866–1066，属详情弹窗，index/tier 共用）。
- 无构建步骤：拆分即多 `<link>` 或 `@import`，无打包合并。

## Requirements

- R1 拆分为 `base.css`（Variables/Reset/Header/Nav/Buttons/Toast 等全站共用）+ 组件/页面 css，按页面按需 `<link>`。
- R2 断点补全 480 / 768 / 1024，覆盖手机/平板/宽屏；现有 700px 断点行为迁入新档位。
- R3 视觉零回归（五页面 + 深色模式 + 移动端）。
- R4 首屏阻塞 CSS 体积对比拆分前下降（每页只加载所需模块即为达成）。
- R5 critical CSS 策略：TBD（见 Open Questions）。

## 已决策

- D1 **砍掉 critical CSS 内联**：无构建步骤下手维 5 份内联副本必然腐化；R4 由"拆分 + 按页按需 `<link>`"达成（Workers 边缘同域小文件，RTT 成本低）。
- D2 **700px 规则整体迁入 768 档**：700–768px 区间从桌面布局改为移动布局，视为改善并豁免于 R3；不保留 700 为独立档位。
- D3 **粗拆粒度**：`base.css`（全站共用）+ 共用组件文件 + 每页一文件；避免 31 分区细拆导致每页 10+ 请求。具体归属见 design.md。

## Acceptance Criteria

- [ ] AC1 `public/css/` 拆分后不再有单一 `style.css`（或其仅作兼容入口）；每页 `<link>` 只引入 base + 该页所需模块。
- [ ] AC2 每页首屏阻塞 CSS 总行数/字节 < 拆分前 1928 行全量（给出每页对比数字）。
- [ ] AC3 断点体系为 480 / 768 / 1024 三档；原 700px 规则全部迁入 768 档，无 700px 残留。
- [ ] AC4 五页面 × { 桌面 ≥1024、768–1024、480–768、<480 } × { 亮色、深色 } 走查无视觉回归（700–768px 区间档位变化除外，属 D2 预期）。
- [ ] AC5 拆分是纯搬运：规则内容逐字不变（断点增补与迁移除外），可用拆分前后规则集 diff 佐证。
- [ ] AC6 `npm run lint && npm run test` 全绿（CSS 不在 lint 范围，但不得引入 JS/测试回归）。
- [ ] AC7 深色模式变量（CSS Variables 区）与自定义背景遮罩在拆分后所有页面正常。

## Out of Scope

- critical CSS 内联（D1 砍掉）。
- 不改 JS/HTML 结构（`<head>` 内 link 标签除外）。
- 不引入 CSS 预处理器/打包器。
- 不做视觉重设计——纯工程拆分与断点适配；480/1024 档只做保守增补（间距/栅格密度），不改设计语言。

## Open Questions

（无——粒度归属等技术细节见 design.md）

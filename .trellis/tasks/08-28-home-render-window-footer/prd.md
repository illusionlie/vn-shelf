# 首页列表渲染窗口化与全站 Footer

## Goal

解决首页在大数据量下的真实瓶颈（Alpine 全量渲染的 DOM 节点数），并为全站页面补上底栏收尾。坚持「一次拉取、本地即时搜索/排序」的现有架构资产，**不引入服务端分页**。

## Background / Necessity

- 现状：`GET /api/vn` 全量返回（瘦 payload，约 300–500 B/条），前端 `vnShelf` 一次拉全量后搜索/状态过滤/排序全部本地完成，体验即时。
- 真实瓶颈不在数据加载（1000 条 ≈ 400KB JSON，gzip 后约 100KB，D1/Worker/网络均无压力），而在 `x-for` 全量渲染：每卡约 15 个节点、10 个响应式绑定，千条级时移动端首屏明显卡顿。
- 结论：传统页码分页会摧毁本地即时搜索/排序的架构资产且增加点击成本；服务端分页属过度工程（仅 >1 万条才有意义）。**渲染窗口化**（只渲染可视窗口内的卡片）以约 30 行前端改动解决唯一真实瓶颈。
- Footer：全站目前无底栏；需要 VNDB 数据署名（API 使用礼仪）、GitHub 链接收口、视觉上给自定义背景一个收尾。

## Scope

1. **首页渲染窗口化**：`filteredList` 保留全量（供计数/过滤），`x-for` 改绑窗口切片；哨兵元素 + IntersectionObserver 自动追加；自动加载预算用完后转「加载更多」按钮（保证 footer 可达）。
2. **全站共享 Footer**：由 `layout.js` 统一注入四个内容页（首页/Tier/统计/设置）；登录页为全屏 `overflow:hidden` 布局，排除在外。

## Non-Goals

- 不改 `GET /api/vn` 接口契约，不引入任何服务端分页参数。
- 不改 Tier List 页、统计页的列表加载方式。
- 不做虚拟滚动（variable-height 网格 + Alpine 下复杂度不成比例）。
- 不新增运行时第三方依赖。

## Requirements

### 渲染窗口化

- R1: 初始仅渲染第一窗（30 条），滚动接近底部时自动追加，每次 30 条。
- R2: 自动追加最多连续发生 2 次；之后若仍有剩余，显示「加载更多」按钮转为手动（点击后恢复 2 次自动预算），确保 footer 可被抵达。
- R3: 搜索、状态过滤、排序、列表重载（增删改后）发生时，窗口重置为第一窗 + 预算重置。
- R4: 过滤后总数不超过一窗时，哨兵/按钮/计数均不出现。
- R5: 显示「已显示 X / Y」计数，与窗口状态实时同步。
- R6: 无 IntersectionObserver 的环境降级为全量渲染（不报错、不白屏）。
- R7: 追加加载时无卡片闪烁、无 CLS（沿用现有 `aspect-ratio` + `loading="lazy"` 契约）。

### Footer

- R8: 四个内容页（`/` `/tier` `/stats` `/settings`）底部出现统一 footer；登录页不出现。
- R9: footer 内容：© 年份 + VN Shelf 署名、VNDB 数据来源致谢链接、GitHub 仓库链接。
- R10: 样式与 header 呼应（玻璃拟态、主题变量），亮/暗双主题正常；条目极少时 footer 仍贴底（sticky-bottom 布局）。
- R11: 注入幂等（重复调用不产生重复 footer），且在 Alpine 启动前完成注入。

### i18n 与质量门

- R12: 所有新增用户可见文案走 `t()` / `data-i18n*` 体系，`zh-CN.js` 与 `en.js` 同步加 key（双向 parity 测试必须通过）。
- R13: `npm run lint && npm run test` 全绿。

## Acceptance Criteria

- [ ] AC1: 造 100+ 条测试数据（或临时调小窗高），首屏只渲染 30 张卡片（DOM 中 `.vn-card` 数量 = 30）；滚动到底自动追加至 90 后出现「加载更多」按钮；点击后再恢复自动追加。
- [ ] AC2: 输入搜索词 / 切换状态过滤 / 切换排序后，窗口重置为前 30 条，按钮与预算状态复位。
- [ ] AC3: 过滤结果 ≤30 条时无按钮、无计数异常；空结果时空状态文案正常。
- [ ] AC4: 「已显示 X / Y」计数随滚动/点击/过滤实时正确。
- [ ] AC5: `/`、`/tier`、`/stats`、`/settings` 四页底部出现一致 footer；`/login` 无 footer 且布局无变化。
- [ ] AC6: footer 在亮/暗主题、480/768/1024 断点两侧均无样式异常；条目为 0 的首页 footer 贴底。
- [ ] AC7: `npm run lint && npm run test` 退出码 0（含 i18n keys 双向 parity）。
- [ ] AC8: DevTools 禁用 IntersectionObserver（或老内核模拟）时列表全量渲染不报错。

## Notes

- 技术方案见 `design.md`。

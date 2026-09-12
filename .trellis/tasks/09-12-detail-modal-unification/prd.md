# 详情弹窗统一与弹窗生命周期重构

## Goal

书架页与 Tier 页的两份详情弹窗模板收敛为**单一注入实现**，消除已发生的呈现漂移；抽取统一弹窗生命周期守卫，替换 4 处逐字重复代码。约束：a11y 契约、i18n、NSFW 遮罩等行为逐项不回退。

## Confirmed Facts（仓库已验证）

- 详情弹窗 HTML 两份：public/index.html:225-356（~133 行）与 public/tier.html:239-333（~95 行）；stats.html 无详情弹窗（grep 验证）。逻辑层已共享：shared.js `createDetailModal`（shared.js:104-142）被 vnShelf / tierlistPage 复用，但模板是复制粘贴。
- 已发生漂移：index 数字评分（index.html:296-299）vs tier 十星级行（tier.html:278-285）；tier 版无状态徽章、无管理员按钮（刷新 / 编辑 / 删除）。
- 09-09 任务明确把「Tier 页刷新按钮」列为 Out of Scope——tier 页管理能力是**未决产品决策**，非既成事实。
- 弹窗生命周期 4 处逐字重复（lockPageScroll → trapFocus → try{release()}catch{} → unlockPageScroll）：shared.js:131-138、vnShelf.js:481-488、tierlistPage.js:228-235、confirmDialog.js:113-120。
- DOM 注入先例：layout.js `injectShell()` / `injectFooter()` 纯 DOM 注入、无 Alpine 依赖；JS 注入的共享 DOM 样式归 base.css（CSS 模块归属契约）。
- a11y 现状：`role="dialog"` + `aria-modal` + `labelledby` + trapFocus + Esc 关闭；i18n 双词典由 tests/public/i18n.keys.test.mjs 强制对齐。
- 管理员判定统一 `$store.app.isAdmin`；单条目刷新已有就地更新场景沉淀（spec frontend/component-guidelines 09-09 Scenario：不重置渲染窗口、busy 按钮 aria-disabled 保焦点）。

## User Decisions

| 决策 | 结论 |
|------|------|
| Tier 页管理员能力范围 | **刷新 + 删除**：复用 09-09 就地更新场景与确认框；编辑表单注入另立后续任务（2026-09-12 确认） |
| 评分呈现统一口径 | **统一为单 ★ + 数字 + 颜色语义**（绿=个人 / 金=VNDB，07-12 既有契约），弃 tier 版十星级行（2026-09-12 确认） |

## Requirements

### R1 单一详情弹窗实现

- 新建共享注入模块（layout.js 模式，如 `public/js/detail-modal.js`），页面初始化时注入唯一模板；index 与 tier 共用同一 DOM 结构与字段口径。
- 注入时机在 Alpine.start 之前、且位于页面 x-data 根内（沿用 injectShell 契约）。
- 两页 HTML 中的弹窗模板删除；弹窗专属样式按归属契约归位（共享部分进 base.css / cards-detail.css）。

### R2 呈现口径统一

- 评分展示、状态徽章、NSFW 遮罩、全年龄徽章、tags 视图、简评 Markdown 渲染在两页完全一致（口径以 User Decisions 确认值为准）。
- 四级标题回退链（user.titleCn → vndb.titleCn → titleJa → title）保持。

### R3 withModalGuard 抽取

- 将 4 处重复的「锁滚动 + 焦点陷阱 + release 静默降级 + 解锁」抽为共享工具（public/js/utils.js 或独立模块），4 处全部替换，语义不变（含 try/catch 静默降级）。
- confirmDialog 同步替换。

### R4 Tier 页管理员能力（范围待决策）

- 【若选刷新+删除】刷新复用 09-09 就地更新场景（PUT refreshVNDB → 就地合并列表项与已打开弹窗）；删除复用 confirmDialog + 就地移除；编辑按钮不出现。
- 【若选完整对齐】额外把编辑表单弹窗注入 tier 页（范围显著扩大，执行时建议拆子任务推进）。
- 【若选纯展示】统一模板后 tier 页无管理按钮，行为与现状一致。

### R5 不回退清单

- a11y：role / aria-modal / labelledBy / Esc / trapFocus 逐项保留；键盘可达性不降。
- i18n：新增或迁移的 key 双词典同步；无硬编码文案。
- 访客视图与统一前 index 版一致。

## Acceptance Criteria

- [ ] AC1 index 与 tier 详情弹窗 DOM 结构一致（同字段、同呈现），两页 HTML 中不再各自内联详情弹窗模板。
- [ ] AC2 评分展示两页统一且符合颜色语义契约；状态徽章两页一致。
- [ ] AC3 弹窗生命周期 4 处重复被共享工具替换（grep 无重复块残留），各弹窗开关 / 滚动锁 / 焦点陷阱行为不回退。
- [ ] AC4 a11y 手测：Esc 关闭、焦点陷阱、aria 属性在两页通过。
- [ ] AC5 【视决策】tier 页管理员可见刷新 + 删除并就地生效；访客无管理按钮且 DOM 不含。
- [ ] AC6 i18n parity 测试通过；zh-CN / en key 同步。
- [ ] AC7 `npm run lint`、`npm test` 通过；两页详情弹窗手测回归（含 NSFW 遮罩、简评渲染）。

## Out of Scope

- 编辑表单弹窗注入（除非决策选完整对齐，且执行时建议独立子任务）。
- 弹窗动画 / 视觉重设计。
- stats 页（无详情弹窗）。
- 骨架屏、PWA。

## Open Questions

- 无。技术方案见 `design.md`，执行计划见 `implement.md`。

# 执行计划：详情弹窗统一与弹窗生命周期重构

单 commit 内聚交付，按依赖顺序分四步。全局验证：`npm run lint && npm test`。

## 前置定位（动手前）

- [ ] 定位 `statusBadgeLabel` / `statusIcon` / `formatUserPlayTime` 现定义位置（vnShelf 私有 or 共享层），确定上移方案
- [ ] grep `.stars-container` / `.star.empty` 的全部引用，确认删除安全
- [ ] 确认两页 x-data 根元素范围（mount 位置的祖先链）

## S1 withModalGuard 抽取（独立可验证，先行）

- [ ] `public/js/utils.js` 新增 `createModalGuard()`（design.md 语义）
- [ ] 替换 4 处：shared.js:131-138、vnShelf.js:481-488、tierlistPage.js:228-235、confirmDialog.js:113-120
- [ ] 手测各弹窗：打开 / Esc / overlay 点击 / 滚动锁 / Tab 焦点循环 / 关闭后焦点归还
- [ ] 验证：`npm run lint && npm test`

**回滚点：S1 可独立成 commit 先行合入（纯重构，行为零变化）。**

## S2 统一模板注入

- [ ] 新建 `public/js/detail-modal.js`：统一模板字符串（index 版为基准 + design.md 口径表）+ `injectDetailModal()`（mount 缺失时空操作）
- [ ] `index.html` / `tier.html`：删除内联详情弹窗 → `<div id="detail-modal-mount"></div>`（原位置，x-data 根内）
- [ ] `app.js`：`injectFooter()` 后调用 `injectDetailModal()`
- [ ] 共享 helper 上移（若前置定位判定需要）：statusBadgeLabel / statusIcon / formatUserPlayTime → utils.js 或 constants.js 导出，两组件引用
- [ ] CSS：删除 `.stars-container` 十星样式；grep 确认无残留引用
- [ ] 验证：`npm run lint && npm test`；两页手测详情弹窗字段齐全（含 tier 页状态徽章、标题链接）

## S3 管理员动作 mixin + Tier 页接入

- [ ] `shared.js` 新增 `createDetailAdminActions({ onEntryUpdated, onEntryRemoved })`（design.md 契约）
- [ ] vnShelf：`refreshVN` / `deleteVN` 重构为委托 mixin，`onEntryUpdated` 走 vn-list-item.js 既有投影合并——行为零变化（09-09 spec Scenario 不回退：就地更新不重置渲染窗口）
- [ ] tierlistPage：混入 mixin + `detailCanEdit: false` + `onEntryUpdated` / `onEntryRemoved` 在 tier 分组结构中的实现
- [ ] 模板页脚：刷新 + 删除恒在（admin），编辑 `x-show="detailCanEdit"`
- [ ] 验证：`npm run lint && npm test`

## S4 回归验收（对应 AC）

- [ ] AC1：两页 DOM 结构一致；两 HTML 无内联详情模板
- [ ] AC2：评分单 ★ + 数字 + 颜色语义（绿=个人 / 金=VNDB）；状态徽章两页一致
- [ ] AC3：grep 四处生命周期重复块零残留；各弹窗行为手测（S1 清单）
- [ ] AC4：a11y 手测——role / aria-modal / labelledBy / Esc / trapFocus 两页通过
- [ ] AC5：tier 页管理员刷新 + 删除就地生效（刷新中页脚按钮 aria-disabled；删除走确认框）；访客无管理按钮且 DOM 不含（x-if/x-show 按 09-09 先例选不渲染进 DOM 的方案）
- [ ] AC6：i18n parity 测试通过（预计零新增 key，若新增则双词典同步）
- [ ] AC7：`npm run lint && npm test` 全绿；两页详情弹窗手测回归（NSFW 遮罩点击显示、简评 Markdown 渲染、外链新标签）
- [ ] 手测记录写回本文件

## 风险文件

`public/index.html` / `public/tier.html`（模板迁移，diff 应只删不增）、`public/js/components/vnShelf.js`（refreshVN/deleteVN 重构，09-09 场景回归重点）、`public/js/components/shared.js`（mixin 扩展，三页复用面）。

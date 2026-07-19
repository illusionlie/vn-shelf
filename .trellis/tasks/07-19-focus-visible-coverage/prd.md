# 全站 focus-visible 键盘焦点样式覆盖

## Goal

全站只有 GitHub 链接（`base.css:244`）和 Tier 添加占位符（`tier.css:153`）有 `:focus-visible` 样式，其余交互元素（书架卡片、按钮、导航、主题切换、modal 关闭等）键盘聚焦时无可见焦点。焦点陷阱已把焦点圈在模态内（`utils.js trapFocus`），但用户看不见焦点在哪。补齐统一的可见焦点样式，仅键盘触发（`:focus-visible`），不影响鼠标点击。

## Requirements

1. 新增焦点环 token：`base.css` 定义 `--focus-ring`（形如 `2px solid var(--accent-color)`）与 outline-offset 约定，两主题下在毛玻璃背景上均清晰可见。
2. 用统一规则覆盖以下交互元素的 `:focus-visible`（优先一条合并选择器，避免逐类重复）：
   - 书架卡片 `.vn-card`（`role="button" tabindex="0"`，index.html:130）
   - `.btn` 全部变体（primary/secondary/danger/sm）
   - 导航 `.banner-nav a`、移动菜单 `.more-menu a`
   - 图标按钮 `.theme-toggle-btn`、`.more-menu-toggle-btn`、`.modal-close`、`.vndb-link-btn`
   - 输入控件 `.search-input`、`.sort-select`（已有 `:focus` 边框，需保证键盘态不弱于现状即可）
   - Tier 页 `.tier-vn-card`、`.tier-row-actions` 内按钮
   - 详情弹窗 `.detail-title-link`
3. 鼠标点击不出现焦点环（即用 `:focus-visible` 而非 `:focus`；表单输入类元素两种触发方式均显示属正常）。
4. 卡片类元素（`.vn-card`、`.tier-vn-card`）焦点环不得被相邻元素或自身 `overflow: hidden` 裁切（注意 `.vn-card` 有 `overflow: hidden`，需用 outline + offset 或外描边方案验证）。

## Acceptance Criteria

- [ ] 各页面（index / tier / stats / settings / login）纯键盘 Tab 遍历，每个可聚焦停留点都有清晰可见的焦点指示，明暗两主题均验证。
- [ ] 鼠标点击按钮/卡片不出现焦点环。
- [ ] 焦点环在 `.vn-card` 上完整可见，不被圆角/overflow 裁切吃掉。
- [ ] 已有的 `banner-github-link`、`tier-add-placeholder` 焦点样式并入新 token 体系，消除双标准。
- [ ] `npm run lint` 通过；`npm run test` 通过。

## Notes

- 推荐实现：`:is(a, button, [role="button"], select, input, textarea):focus-visible { outline: var(--focus-ring); outline-offset: 2px; }` 起步，再对个别元素微调 offset，比逐类写更抗遗漏。
- NSFW 揭示层的键盘可达性是另一个独立问题（overlay 是 div+click，本批未立项）；等它可聚焦后自然继承本任务的统一规则。

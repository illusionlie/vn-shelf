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

- [x] 各页面纯键盘 Tab 遍历，每个可聚焦停留点都有清晰可见的焦点指示（实现：全局 `:is(a, button, [role="button"], select, input, textarea):focus-visible` 规则，PRD 清单元素逐一核对均命中——`.vn-card` 走 `[role="button"]`，其余均为原生元素；两主题下 accent 蓝环对玻璃背景均可见。真机 Tab 走查待人工复核）。
- [x] 鼠标点击按钮/卡片不出现焦点环（仅用 `:focus-visible`，未动 `:focus`）。
- [x] 焦点环在 `.vn-card` 上完整可见（outline 绘制于 border-box 之外，元素自身 `overflow: hidden` 不裁切 outline；祖先容器 `.cards-grid` 无 overflow 裁切，20px gap 容纳 2px 环 + 2px offset）。
- [x] 已有的 `banner-github-link` 专属规则删除并入全局（样式等价）；`tier-add-placeholder` 的 focus-visible 增强样式保留，焦点环由全局规则叠加，token 单一来源。
- [x] `outline: none` 四处逐一核验：三处为基态声明会被 `:focus-visible`（优先级 0,1,1 > 0,1,0）覆盖；`.form-input:focus` 自带 accent 边框 + 光晕为合格焦点指示，按 PRD"不弱于现状"豁免。
- [x] `npm run lint` 通过；`npm run test` 通过（159 tests，无回归）。

## Notes

- 推荐实现：`:is(a, button, [role="button"], select, input, textarea):focus-visible { outline: var(--focus-ring); outline-offset: 2px; }` 起步，再对个别元素微调 offset，比逐类写更抗遗漏。
- NSFW 揭示层的键盘可达性是另一个独立问题（overlay 是 div+click，本批未立项）；等它可聚焦后自然继承本任务的统一规则。

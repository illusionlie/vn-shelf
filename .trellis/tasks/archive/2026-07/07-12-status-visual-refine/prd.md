# 卡片与详情页状态视觉重构

## 目标与用户价值

上一任务（07-11 游玩状态字段）功能正确但视觉观感差：主页卡片封面同时出现全年龄徽章（左上）与状态徽章（右上），左一个右一个割裂；详情页新增的状态块把原本正好一行的两个时长块挤成孤儿块。本任务重构状态的展示形态，并顺带修正一直存在的评分星冗余问题与徽章圆角。纯前端视觉改动，不动数据层与 API。

## 已确认决策（与用户逐项敲定）

1. **卡片评分行改 A1 单星紧凑式**：移除十颗星（`x-for i in 10`），改为金色单星 `★` + 评分数字靠左；右侧空出的位置放**图标 + 文字的完整状态章**（不再依赖 hover）。
2. **状态离开封面**：卡片封面只保留全年龄徽章；状态从 `.vn-card-image-wrapper` 移到 `.vn-card-meta` 评分行右侧。
3. **游玩时长不上卡片**。
4. **状态章图标用内嵌 SVG**，不用 Unicode 字符（▶✓⏸✕ 在 Windows 易被 emoji 字体劫持渲染成彩色）。四状态：在玩=播放三角、已完成=对勾、搁置=暂停双竖、抛弃=叉。
5. **详情页**：
   - 状态从 `.detail-meta` 网格中移除，升格为头部彩色状态章（图标+文字完整版），置于标题信息区。
   - `.detail-meta` 网格 `repeat(2, 1fr)` → `repeat(auto-fit, minmax(140px, 1fr))`，移除状态后剩两个时长块正好一行，且未来加块自动排布。
   - 详情页两组评分星（VNDB `.vndb-rating` + 个人 `.personal-rating`，各十颗星）一并改为单星紧凑式，与卡片一致；保留 VNDB 金色 / 个人绿色的双色区分。
6. **全年龄徽章更圆润**：`border-radius` 加大成胶囊感（`border-radius: 999px` 或等效），卡片版与详情版（`.detail-title .all-age-badge`）同步；状态章沿用同款胶囊圆角保持一致。

## 需求

### 卡片（public/index.html + vnShelf.js + cards-detail.css）
- [ ] 移除封面右上角 `.status-badge`（`.vn-card-image-wrapper` 内那行）。
- [ ] `.vn-card-rating` 从十星容器改为单金星 + 数字；`.vn-card-meta` 保持 `space-between`，右侧新增状态章。
- [ ] 状态章：彩色胶囊（沿用现有四色渐变）+ 内嵌 SVG 图标 + 状态文字；无状态（null/未设置/wishlist 等白名单外）时整章不渲染，右侧留空无破绽。
- [ ] `title` + `aria-label` 提供无障碍文字。
- [ ] `statusBadgeLabel` 复用现有降级逻辑（白名单外不显示）；图标按状态值映射，建议新增 `statusIcon(status)` 或在模板内条件渲染 SVG。

### 详情页（public/index.html + cards-detail.css）
- [ ] 头部信息区加状态章（与卡片同组件观感，文字完整）。
- [ ] `.detail-meta` 移除状态项，网格改 auto-fit。
- [ ] 两组评分星改单星紧凑式，双色保留。

### 徽章圆角
- [ ] 全年龄徽章（卡片版 + 详情版）与状态章统一胶囊圆角。

## 验收标准

- [x] 主页卡片封面仅左上角全年龄徽章；无全年龄作品封面无任何徽章。
- [x] 评分行：左"★ 7.43"、右状态章（有状态时），视觉不再拥挤；无状态时仅左侧评分。
- [x] 状态章图标在 Windows Chrome/Edge 下为单色 SVG（非彩色 emoji）。
- [x] 详情页状态在头部显示，两个时长块回到一行；VNDB/个人评分为单星紧凑式且双色可辨。
- [x] 徽章呈胶囊圆角。
- [x] 明暗主题下状态章、评分、徽章均可读（对比度不回退）。
- [x] `npm run lint` 通过；i18n 无缺 key 警告；无既有测试回归（`npm run test`，135/135）。
- [x] 浏览器冒烟：含/不含全年龄、含/不含状态、四种状态、明暗主题各扫一遍（Playwright 真实渲染验证 PASS）。
- [x] 移动端（≤768px）工具栏由四行竖排压缩为两行：搜索框独占首行，排序+状态筛选（+添加按钮）共享第二行（390/360px、admin/guest 双态验证）。

## 明确不做

- 数据层 / API / 状态枚举语义（上一任务已定，不动）。
- 游玩时长上卡片、卡片尺寸调整、Tier 页徽章。
- 状态章 stat 条以外的详情页大改版（仅做本 PRD 列出的范围）。

## 备注

- 复用现有四色状态渐变（cards-detail.css 的 `.status-badge.status-*`）。
- 参考 spec：`.trellis/spec/frontend/quality-guidelines.md`（CSS 模块归属、i18n t()/data-i18n、a11y）、`component-guidelines.md`。
- SVG 图标先例：项目内 NSFW 眼睛、VNDB 外链均为内嵌 SVG。

# 主页卡片评分改为个人评分优先（回退 VNDB 分）

## Goal

主页书架卡片的评分展示从"固定显示 VNDB 评分"改为"个人评分优先、无个人评分时回退 VNDB 评分"，并用配色区分两种来源。个人书架应以个人数据为主视角，同时修复"按个人评分排序时卡片显示 VNDB 分导致视觉乱序"的隐性不一致。

## Requirements

1. 卡片评分展示逻辑（`public/index.html` 卡片网格，约 152-155 行）：
   - `vn.personalRating > 0` → 显示个人评分（后端将"未评分"存为 `0`，falsy 判断即为回退条件）。
   - 否则回退显示 `vn.rating`（VNDB 分）；两者皆无时保持现有 `N/A` 行为。
2. 配色约定（沿用详情弹窗既有约定，`cards-detail.css` 中 `personal-rating` 为绿 `#6bff6b`，VNDB 为金 `#FFD700`）：
   - 显示个人评分时：星标与数字均为绿色。
   - 回退 VNDB 分时：保持现状金星 + accent 色数字，样式零变化。
3. 数据来源：列表接口已返回扁平化的 `personalRating` 字段（`vnShelf.js` 排序逻辑已在用），不改后端、不改 API。
4. 范围限定：仅主页卡片。Tier List 页卡片不显示评分，详情弹窗已同时展示两种评分，均不动。

## Acceptance Criteria

- [x] 有个人评分（>0）的条目：卡片显示个人评分，绿星 + 绿色数字。
- [x] 无个人评分（=0 或缺失）的条目：卡片显示 VNDB 评分，金星 + accent 色数字，与改动前视觉一致。
- [x] 个人评分与 VNDB 分均无时显示 `N/A`（保持原有 `vn.rating?.toFixed(2) || 'N/A'` 行为，rating 为 0 时同原逻辑显示 `0.00`）。
- [x] "按个人评分排序"下卡片显示的分值与排序结果视觉一致（不再乱序观感）。
- [x] `npm run lint` 通过；`npm run test` 通过（159 tests，无回归）。
- [x] 后端代码与 API 契约零改动（数据来源为既有 `rowToListItem` 扁平化字段 `personalRating`，`repository.js:267`）。

## Notes

- 数字精度：个人评分沿用一位小数（与详情弹窗 `toFixed(1)` 一致）；VNDB 回退分保持现有 `toFixed(2)`。
- 若模板表达式变复杂，可在 `vnShelf.js` 加小 helper（如 `cardRating(vn)`），但以最小改动为先。

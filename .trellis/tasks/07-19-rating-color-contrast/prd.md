# 个人评分绿色对比度修复（token 化评分色）

## Goal

个人评分绿 `#6bff6b` 在亮色模式的浅色毛玻璃背景上对比度约 1.3:1（WCAG 大号文本要求 3:1、正文要求 4.5:1），卡片和详情弹窗里的个人评分几乎不可读。将评分色收口为主题 token 并分明暗两档，保持"绿=个人 / 金=VNDB"的既有语义不变。

## Requirements

1. 新增 token：在 `base.css` 的 `:root` 与 `body.dark-mode` 各定义一档 `--personal-rating-color`：
   - 亮色档：深绿，对白底/浅玻璃背景对比度 ≥ 4.5:1（覆盖 0.85rem 级别的星标场景）。
   - 暗色档：可沿用现有亮绿（`#6bff6b` 在 `#121212` 上约 14.7:1，无问题），以最小化暗色模式视觉变化。
2. 替换硬编码：`cards-detail.css` 中三处 `#6bff6b`（约 238、424、433 行，`.vn-card-rating.personal-rating` 与 `.detail-stars.personal-rating`）全部改引 token。
3. 语义不变：绿=个人评分、金星+accent 数字=VNDB 评分的区分约定保持（见 `.trellis/spec/frontend/quality-guidelines.md:38`）；卡片"个人优先、VNDB 回退"逻辑零改动。
4. 范围限定：本任务只处理个人评分绿。VNDB 金星 `#FFD700` 亮色下对比度也偏弱但属行业惯例色，不在本任务内动。

## Acceptance Criteria

- [ ] 亮色模式下，卡片与详情弹窗的个人评分（星标+数字）对其实际背景对比度 ≥ 4.5:1（可用浏览器 devtools 对比度检查器验证）。
- [ ] 暗色模式下个人评分视觉与改动前一致或差异可忽略。
- [ ] `public/css/` 内不再存在硬编码 `#6bff6b`，评分绿只有 `--personal-rating-color` 一个来源。
- [ ] "绿=个人 / 金=VNDB"扫视区分在两个主题下依然成立（个人分与 VNDB 回退分肉眼可辨）。
- [ ] `.trellis/spec/frontend/quality-guidelines.md:38` 的评分色契约同步更新为 token 描述（含明暗两档值）。
- [ ] `npm run lint` 通过；`npm run test` 通过。

## Notes

- 亮色档候选：`#15803d`（对白底约 5.0:1，与状态章 finished 渐变的深绿同族，视觉上有延续性）；不强制，满足对比度且仍读作"绿"即可。
- 卡片数字 1.2rem/700 属大号文本（3:1 即达标），但详情弹窗星标 1.2rem 常规字重、语义上按 4.5:1 收紧一档更稳。

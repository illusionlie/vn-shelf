# 书架与 Tier 页封面图懒加载

## Goal

书架网格与 Tier 页的封面 `<img>` 均无 `loading="lazy"` / `decoding="async"`（markdown 渲染器里的图片反而有，`markdown.js:115`）。收藏量大时首屏并发请求全部封面，浪费带宽且拖慢首屏。为列表型封面图补懒加载属性。

## Requirements

1. `public/index.html` 书架卡片封面 `img`（约 132-138 行）：增加 `loading="lazy"` 与 `decoding="async"`。
2. `public/tier.html` 两处封面 `img`（tier 行内约 128-133 行、未分级区约 189-195 行）：同样增加两个属性。
3. 详情弹窗大图（`index.html` detail-image）按需打开且单张，不加 `loading="lazy"`（弹窗内立即可见，lazy 无意义），可只加 `decoding="async"`。
4. 现有行为零回归：`@error` 占位图回退、NSFW 模糊、`aspect-ratio: 7/10` 占位防 CLS（见 `.trellis/spec/frontend/quality-guidelines.md:37`）均不受影响。

## Acceptance Criteria

- [x] 书架卡片、Tier 行、未分级区三处列表封面 `img` 均带 `loading="lazy"` + `decoding="async"`；两处详情弹窗大图仅加 `decoding="async"`（git diff 核验，共 5 处）。
- [ ] 书架页 DevTools Network 验证：首屏视口外的封面不随页面加载立即请求，滚动接近时才加载（属性为浏览器原生行为，待人工在真实数据下复核）。
- [ ] Tier 页同样验证懒加载生效（同上，待人工复核）。
- [x] 断图 URL 仍正确回退到灰色占位 SVG；NSFW 模糊揭示流程不变（`@error` 与 `:class` 绑定零改动，仅新增静态属性）。
- [x] 滚动过程中无新增布局跳动（`aspect-ratio: 7/10` 占位规则未动）。
- [x] `npm run lint` 通过；`npm run test` 通过（159 tests，无回归）。

## Notes

- 属性是渐进增强，旧浏览器忽略即回到现状，无兼容风险。
- 卡片由 Alpine `x-for` 模板克隆生成，属性写在模板 `img` 上即可全量生效。

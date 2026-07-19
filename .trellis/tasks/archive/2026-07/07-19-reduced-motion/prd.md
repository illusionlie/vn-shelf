# prefers-reduced-motion 动画降级

## Goal

全站动画（卡片 -8px 上浮、封面光扫、进度条 shimmer、hover 缩放、modal scale、toast 滑入、平滑滚动）均无条件播放，未响应用户的"减少动态效果"系统偏好。为装饰性动画提供 `prefers-reduced-motion: reduce` 降级，保留必要的功能性反馈。

## Requirements

1. 在 `base.css` 增加 `@media (prefers-reduced-motion: reduce)` 块，覆盖以下装饰性动画：
   - 进度条 shimmer（`base.css:139` animation）
   - 卡片 hover 位移/阴影/封面缩放与光扫（`cards-detail.css:75-129`）
   - stat 卡 hover 位移（`stats.css:31`）
   - tier 卡 hover 缩放（`tier.css:117`）
   - modal 打开 scale 变换（`base.css:475`，可保留纯 opacity 淡入）
   - toast slideIn 滑入（`base.css:646`，可改为直接出现或纯淡入）
   - `html { scroll-behavior: smooth }`（`base.css:66`）降级为 `auto`
2. 保留功能性动效：loading spinner（加载状态的必要反馈）与进度条宽度变化本体可保留，仅去掉 shimmer 装饰层。
3. 降级只影响动效，不改变任何最终视觉状态（hover 后的阴影/边框变色等静态样式保留，只去掉位移与过渡）。
4. 实现方式自选：推荐"选择性关停上述清单"而非一刀切 `* { transition: none }`——后者会顺带杀掉 spinner 与主题切换过渡，需逐项豁免，维护成本反而高；若实现时论证一刀切+豁免更简洁亦可，PRD 不锁死。

## Acceptance Criteria

- [x] 降级覆盖逐项落地：卡片 hover 位移/封面缩放/光扫（cards-detail.css）、stat 卡位移（stats.css）、tier 卡缩放（tier.css）、进度条 shimmer、toast slideIn、modal scale、`scroll-behavior: auto`（base.css）；DevTools `prefers-reduced-motion: reduce` 模拟走查待人工复核。
- [x] 降级模式下所有交互功能与最终视觉状态不变（仅中和 transform/animation；hover 的阴影/边框/背景色静态反馈、overlay 透明度淡入全部保留）。
- [x] 未开启偏好的用户视觉零变化（全部规则包在 `@media (prefers-reduced-motion: reduce)` 内，改动为纯新增）。
- [x] loading spinner 在降级模式下保留旋转（功能性反馈，未纳入降级清单）。
- [x] `npm run lint` 通过；`npm run test` 通过（159 tests，无回归）。

### 实现要点（偏离与补充）

- 按"选择性关停"路线实现，规则按 spec 惯例落在各组件所属 CSS 文件的文件尾媒体块。
- 范围小幅外扩：`.btn` 三变体与 GitHub 链接的 hover `translateY` 位移属同类装饰动效，PRD 未列举，一并纳入降级。
- 关键发现：模态挂了 Alpine `x-transition`，过渡期间以**内联样式**写 transform（内联高于普通声明），故 `.modal { transform: none }` 必须 `!important` 才能压住缩放；opacity 淡入不受影响。已记录进 spec。

## Notes

- 本任务是 frontend-design 质量底线项（reduced motion respected），与 focus-visible 任务同属可访问性批次，无相互依赖，可并行。

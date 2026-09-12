# PRD: 返回顶部悬浮按钮（全站壳层注入）

## 背景

书架主列表（渲染窗口化，可达数百条）、Tier 拖拽页在移动端滚动距离长，无快速回顶手段。现有 fixed 元素（header z-100 / modal z-1000 / toast z-2000 右上）均不在右下角，右下角为空白区。

## 方案概要（用户已确认）

- **覆盖范围**：全站壳层注入（`layout.js` `SHELL_TEMPLATE`），一处实现五页生效
- **形态**：右下 48px 圆形玻璃拟态 FAB（≤480px 缩至 44px 触控最小值），风格对齐 header/toast（`backdrop-filter` + 主题变量）
- **显隐策略**：IntersectionObserver 顶部哨兵 + `rootMargin` 阈值，滚过 ~600px 显示，回顶自动隐藏。免 scroll 监听/rAF 节流

## 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 显隐用 IO 哨兵（文档顶部 1px absolute 元素，`rootMargin: '600px 0 0 0'`）而非 scroll 监听 | 与首页 `render-sentinel` 同构；bfcache 前进后退自动正确；iOS 弹性滚动负 scrollY 免疫；无监听器清理负担 |
| D2 | 哨兵 `position:absolute; top:0` 锚定 ICB | body 有 `padding-top:120px`（fixed header 让位），in-flow 哨兵会偏移阈值；absolute 锚到文档 y=0，阈值精确 600px |
| D3 | 点击 `window.scrollTo({ top: 0 })` 不带 behavior | 交给 CSS `html { scroll-behavior: smooth }`，reduced-motion 下自动降级 instant（spec 07-19 契约） |
| D4 | 隐藏态 `visibility:hidden + opacity:0 + pointer-events:none`，过渡只动 opacity | opacity 属于"反馈"类过渡，reduced-motion 惯例保留，无需新增 reduce 规则；pointer-events:none 保证不挡底层卡片点击 |
| D5 | `body.modal-open .back-to-top` 强制隐藏 | modal 打开时滚动锁定，FAB 无意义且叠在 overlay 下闪；CSS 单规则解决 |
| D6 | `bottom/right: calc(Npx + env(safe-area-inset-*))` | 手势条/横屏刘海兜底；当前 viewport meta 无 `viewport-fit=cover`，env 为 0 无害，未来开启自动生效 |
| D7 | z-index 90（header 100 之下、modal 1000 之下） | 右下角与 header 无重叠；modal 打开时被 overlay 覆盖 + D5 双保险 |
| D8 | 无 IO 环境降级为常显（`body.login-page` 由 CSS 隐藏） | 对齐 vnShelf R6 降级哲学：老浏览器功能可用，仅损失显隐优化；登录页 overflow:hidden 本无滚动 |
| D9 | aria-label 走 `data-i18n-aria-label="common.backToTop"` | 按钮含 SVG 子元素，attribute 型标记不受 leaf-only 限制；zh/en 双语 parity 测试强制同步 |

## 移动端已覆盖场景

- 44px 触控目标（Apple HIG 最小值）；safe-area 手势条/刘海横屏；虚拟键盘弹出 → 视口缩放 IO 自动重算；弹性滚动（IO 免疫负 scrollY）；modal/confirm 打开时隐藏；暗色模式（主题变量自动）；bfcache 恢复；与右上 toast、居中「加载更多」按钮错位无冲突

## 改动面

| 文件 | 改动 |
|------|------|
| `public/js/layout.js` | SHELL_TEMPLATE 增哨兵 + FAB 按钮；`injectShell()` 内增 `setupBackToTop()`（IO + 点击绑定，无 Alpine 依赖） |
| `public/css/base.css` | `.back-to-top` 样式（壳层 DOM 归属 base，spec B5c）+ 480 断点 + `body.modal-open`/`body.login-page` 隐藏规则 |
| `public/js/locales/zh-CN.js` / `en.js` | `common.backToTop`（返回顶部 / Back to top） |
| `AGENTS.md` | layout.js 与 base.css 职责描述行同步提及返回顶部 |

## 验收标准（全部通过，证据见 implement.md）

- [x] 五页（index/tier/settings/stats，login 除外）注入后：滚过约 600px FAB 淡入，点击平滑回顶、FAB 自动淡出
- [x] reduced-motion 下点击瞬时回顶（无平滑滚动）、FAB 无位移动画
- [x] 详情/编辑/确认弹窗打开时 FAB 隐藏，关闭后随滚动状态恢复
- [x] 移动视口（≤480px）FAB 44px、避开手势条区域；与「加载更多」/toast 无重叠
- [x] 键盘 Tab 可聚焦 FAB 且有全局 focus ring；aria-label 双语正确
- [x] `npm run lint` + `npm run test`（含 i18n 双向 parity）全绿
- [x] Playwright 移动视口实测：滚动出现 → 点击回顶 → FAB 消失

## 非目标

- 不做滚动方向感知的智能显隐；不做滚动进度指示；不做双击回底；不引入设置项开关

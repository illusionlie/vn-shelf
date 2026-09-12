# 实现记录：返回顶部 FAB

## 改动清单

| 文件 | 改动 |
|------|------|
| `public/js/layout.js` | `SHELL_TEMPLATE` 尾部增 `.back-to-top-sentinel` + `.back-to-top` 按钮（chevron-up SVG，`data-i18n-aria-label="common.backToTop"`）；新增 `setupBackToTop(shell)` 由 `injectShell()` 调用：点击 `window.scrollTo({top:0})`（不带 behavior）+ IO（`rootMargin: '600px 0px 0px 0px'`）观测哨兵反向控制 `.visible` |
| `public/css/base.css` | Toast 块后新增 Back-to-top FAB 段：哨兵（absolute 锚 ICB 原点）、FAB（48px、z-90、`calc(Npx + env(safe-area-inset-*))`、隐藏三件套 + visibility 参与 transition 的离散插值说明）、`body.modal-open / body.login-page` 隐藏规则（特异度 (0,2,1) 压过 `.visible` 的 (0,2,0)，免 !important）；480 断点收敛 44px/16px 贴边 |
| `public/js/locales/zh-CN.js` / `en.js` | `common.backToTop`（返回顶部 / Back to top），置于 `close` 之后保持双语同位 |
| `AGENTS.md` | base.css / layout.js 职责行同步提及返回顶部 FAB |

## 关键实现决策（与 PRD 对照）

- D2 哨兵 `position:absolute; top:0`：#app-shell 无 positioned 祖先 → 锚 ICB 文档原点，绕开 body `padding-top:120px` 对阈值的偏移
- D4 隐藏态 = `visibility + opacity + pointer-events` 三件套，transition 只含 opacity/visibility（离散插值特性：两端任一可见则全程可见，淡出不中途消失）；无 transform 动画 → 无需新增 reduced-motion 规则
- 无 IO 降级常显（对齐 vnShelf R6 哲学）；登录页由 CSS 规则兜底隐藏，降级态也安全

## 验证记录（Playwright，390×844 移动视口 + wrangler dev 本地实例）

| 场景 | 结果 |
|------|------|
| 阈值边界 scrollY 0/560/700/1200/401 | 隐藏/隐藏/显示/显示/隐藏 ✓ |
| 隐藏态 pointer-events | none（不拦截底层卡片点击）✓ |
| 点击回顶 | 平滑滚动至 0（CSS smooth 生效），FAB 自动淡出 ✓ |
| reduced-motion 模拟（覆写 scroll-behavior:auto） | 60ms 内瞬移到 0，降级链成立 ✓ |
| 详情弹窗打开 | body.modal-open，FAB opacity 0 + visibility hidden；关闭后恢复且滚动位置保留（1483px）✓ |
| 暗色模式 | 主题变量生效（bg rgba(44,44,46,.9)）✓ |
| 移动断点 | 44×44px、右 24px（16+safe-area-inset-right 8）、下 16px、z-90 ✓ |
| 键盘可达 | 原生 `<button type="button">`、tabIndex 0、吃全局 focus ring ✓ |
| i18n | zh「返回顶部」/ en「Back to top」，docLang 同步 ✓ |
| Tier 页（1931px 高） | 底部显示、顶部隐藏 ✓ |
| 登录页 | 注入但 visibility:hidden（无滚动 + CSS 兜底双保险）✓ |
| 落底与「加载更多」 | 自动加载耗尽后按钮不渲染，无重叠；FAB 矩形右下独立 ✓ |
| 质量门 | `npm run lint` 干净；`npm run test` 197/197（含 i18n 双向 parity）✓ |

## 返工记录（用户视觉反馈）

- **问题**：hover 边框用 `--border-glow`（rgba(0,122,255,0.25)）单独作 1px 边框，亮色磨砂面上几乎不可见。
- **修复**：hover 改实色 `--accent-color` 边框 + `box-shadow` 追加 `0 0 0 3px var(--border-glow)` 光晕环（亮/暗模式各自适配）；box-shadow 声明整体替换敆重新声明基础投影。
- **实测**（Playwright 真悬停）：亮色 hover 边框 `rgb(0,122,255)` + 晕环 `rgba(0,122,255,0.25) 3px`；暗色晕环 0.275+；idle 态不变。

## 遗留

- 无。非目标（滚动方向感知显隐/进度指示/回底）未实现，按 PRD 约定不做。

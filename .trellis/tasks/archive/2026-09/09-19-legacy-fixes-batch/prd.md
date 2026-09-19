# 三项遗留修复：checkAuth 切 auth/status、NSFW 遮罩键盘可达、markdown 三标记恢复

## Goal

收掉三项核查确认仍存在的遗留问题（来源：06-12 清理任务 / 06-28 marked 迁移 / 07-19 a11y 批次，均记录于 journal-1.md 为已知遗留）：

1. 匿名访客首访触发 `/api/auth/verify` 401（控制台噪音）
2. Markdown 迁移后 `==高亮==` / `^上标^` / `~下标~` 三标记不再渲染（用户已决策：恢复支持）
3. NSFW 遮罩纯 hover/click 交互，键盘用户无法揭示封面

## Requirements

### R1 checkAuth 切换公开状态端点

- 全局 Store `checkAuth()`（public/js/app.js）改用 `GET /api/auth/status`（公开端点，匿名返回 200 + `authenticated:false`），消除匿名首访 401。
- 前端 `authAPI.verify()` 封装随之无调用点，删除（死代码）；后端 `GET /api/auth/verify` 端点与 API 契约保持不变。
- 管理员/匿名两态下 `isAdmin` 判定结果与现状一致。

### R2 Markdown 三标记恢复

- `renderMarkdown` 恢复对 `==text==`（`<mark class="md-mark">`）、`^text^`（`<sup class="md-sup">`）、`~text~`（`<sub class="md-sub">`）的渲染，语义对齐迁移前自实现 parser（`~~删除线~~` 不受影响）。
- 实现走 marked inline extension（项目 vendor 自托管 marked 18），输出类名与既有 CSS（cards-detail.css，未删除）对齐，样式零新增。
- 补语法测试锁行为（含与删除线共存的边界）。

### R3 NSFW 遮罩键盘可达

- 全部 4 处遮罩（index.html 书架卡片 ×1、tier.html ×2、detail-modal.js 详情弹窗 ×1）可 Tab 聚焦、Enter/Space 揭示封面，焦点环走 base.css 既有 `:focus-visible` 规则。
- 遮罩需有可读的 aria-label（新 i18n key，zh-CN / en 双语同步）。
- tier 页卡片是真 `<button>`，不得引入交互元素嵌套（HTML 规范禁止 button 内 interactive content）——overlay 须移出 button。
- 鼠标 / 触屏交互与现状完全一致：点遮罩揭示、点卡片开详情、管理员拖拽排序不受影响。

## Acceptance Criteria

- [ ] AC1 匿名（无 auth_token）打开任意页面，Network 面板无 `/api/auth/verify` 请求，`isAdmin=false`
- [ ] AC2 管理员登录态下 `isAdmin=true`；`/api/auth/verify` 端点行为不变（router 测试全绿）
- [ ] AC3 4 处 NSFW 遮罩均可 Tab 聚焦（焦点环可见），Enter 与 Space 揭示封面；再聚焦无残留（揭示后遮罩 x-show 移除、退出 Tab 序）
- [ ] AC4 tier 页卡片不出现 button 嵌套 interactive 元素；拖拽（鼠标 + 键盘 onCardKeydown 流程）与点击开详情行为不变
- [ ] AC5 `==x==` / `^x^` / `~x~` 分别渲染为 mark/sup/sub（md-* 类名）；`~~x~~` 仍为 del；`==**b**==` 等内联嵌套正常
- [ ] AC6 新增 i18n key 在 zh-CN.js 与 en.js 双语齐备（既有 parity 测试通过）
- [ ] AC7 `npm run lint` 与 `npm run test` 全绿

## Notes

- 三项改动相互独立，任一项可单独回滚。
- markdown 标记语义基准 = 迁移前实现（git f028393^ 版本 parseInline 规则），design.md 有逐条对照。

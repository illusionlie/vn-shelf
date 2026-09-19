# Implement — 执行计划

前置基线：`npm run lint && npm run test` 全绿（撰写时记 265 例，实施时代价核对实际基线 268；终态 277 = 268 + 新增 9）。

## 顺序清单

### S1 · D1 checkAuth 切 status（~10 行）

- [ ] `public/js/app.js` `checkAuth()`：`authAPI.verify()` → `authAPI.status()`，`isAdmin = !!res.data?.authenticated`，warn 文案改 `[app] auth status failed`
- [ ] `public/js/api.js` 删除 `authAPI.verify()` 方法
- [ ] 验证：`npm run test`（router 的 verify 端点用例不受影响）＋ 全库 grep `authAPI.verify` 无残留

### S2 · D2 markdown 三标记扩展

- [ ] `public/js/markdown.js`：`marked.use` 增加 3 个 inline extension（mark/sup/sub，正则与 renderer 见 design.md）
- [ ] `tests/public/markdown.syntax.test.mjs` 新增 6 组用例（基础 ×3、`==a=b==`、`~~del~~`+`~sub~` 共存、`====` 等不匹配、`==**b**==` 嵌套、`~a~~` 拒绝）
- [ ] 验证：`npm run test`（markdown 域全绿）

**Review gate**：S2 涉及渲染安全面，新增用例须含「三标记内容中夹恶意 URL/HTML 不被放大」的确认（沿用既有 fuzz 断言思路）。

### S3 · D3 NSFW 键盘可达

- [ ] `public/js/locales/zh-CN.js` + `en.js`：`common.revealNsfwCover`（zh「显示 NSFW 封面」/ en 'Reveal NSFW cover'）
- [ ] `public/index.html:153`：overlay 加 role/tabindex/aria-label/keydown（就地）
- [ ] `public/js/detail-modal.js:56`：同上（就地）
- [ ] `public/tier.html` ×2（148、218）：`.tier-vn-card-wrap` 包裹 + overlay 出嵌 + `x-data` 上移
- [ ] `public/css/tier.css`：wrap 规则 + `.tier-vn-card-wrap .nsfw-overlay` 选择器替换
- [ ] 验证：`npm run lint && npm run test`（i18n parity 卡双语）

**Review gate**：S3 后核对 Tab 序与 tier 键盘拖拽流程未被破坏（Enter 抓取/方向键/Esc 均在 button 层）。

### S4 · 全量验证

- [ ] `npm run lint` ＋ `npm run test` 全绿
- [ ] 对照 prd.md AC1-AC7 逐条勾验（AC1/AC3/AC4/AC5 的浏览器侧行为列入手工复核清单）

### S5 · Spec 更新（对应 Phase 3.3）

- [ ] `.trellis/spec/frontend/quality-guidelines.md:53`：`.nsfw-overlay` 先例补全键盘面（`.stop` 双事件 + role=button/tabindex + 出嵌规则：真 button 内禁嵌 interactive）
- [ ] 若 markdown 相关约定散落处（frontend/index.md 等）提及「三标记不支持」，同步修订

## 验证命令

```bash
npm run lint
npm run test
```

## 手工复核清单（`npm run dev`，不阻塞归档）

1. 无痕窗口（匿名）打开 `/`：Network 无 `/api/auth/verify` 请求
2. 书架 NSFW 卡片：Tab 聚焦遮罩（焦点环）→ Enter / Space 揭示
3. 详情弹窗、Tier 页、未分级区同上
4. Tier 页管理员拖拽（鼠标 + 键盘 Enter 抓取）不受影响
5. 评测区输入 `==高亮==`、`H~2~O`、`x^2^`、`~~删除~~` 渲染正确

## 回滚点

- S1 / S2 / S3 互相独立，任一阶段 `git checkout -- <该阶段文件>` 即回滚
- tier DOM 结构（S3 后半）为最大 hunk，单独成 commit 粒度

# Implement — 动效修复与打磨

执行计划。需求见 `prd.md`，技术方案见 `design.md`。步骤按依赖排序，每步可独立验证。

## 前置

- [ ] `npm run lint && npm run test` 基线绿（确认起点干净）。
- [ ] `npm run dev` 起本地服务，浏览器开 index 页备用（modal/toast 手工验收用）。

## Step 1 — Modal 类钩子样板（detail-modal.js 先行）

- [ ] `public/js/detail-modal.js:29-30`：overlay `:class="{active: showDetail}"` → `x-show="showDetail"` + 6 个类钩子属性；主体裸 `x-transition` → 全套类钩子（类名风格 `modal-fade-*` / `modal-scale-*`，见 design §2）。
- [ ] `public/css/base.css` Modal 段：删 `.modal-overlay` 的 `opacity/visibility` 基础态与 `transition: all`；删 `.modal` 的 `transform: scale(0.95)` 基础态与 `transition: all`；删 `.modal-overlay.active` 与 `.modal-overlay.active .modal` 两条；新增钩子类（open 250 / close 150 / smooth-out）。
- [ ] **手工验证**：首页开详情弹窗——开合各一次，overlay 与主体同步；Esc / 点击遮罩 / 关闭钮三条关闭路径正常；Tab 焦点仍在弹窗内（焦点陷阱未受影响）。

## Step 2 — 同步其余 3 处 modal

- [ ] `public/js/layout.js:33-34`（confirmDialog）
- [ ] `public/index.html:227-228`（编辑弹窗）
- [ ] `public/tier.html:241-242`（Tier 编辑弹窗）
- [ ] 每处改完对照 Step 1 样板核对属性齐全（漏 `leave-end` 类会导致下次开启动画跳变）。
- [ ] 手工验证：Tier 页弹窗 + 任一确认对话框（删除条目触发）开合正常。

## Step 3 — reduced-motion 补丁退役与补齐

- [ ] `base.css:918-922`：删 `.modal { transform: none !important }` 及注释；reduce 块新增钩子类的 `transform: none`（opacity 保留）。
- [ ] `base.css` reduce 块新增 `.more-menu` 位移停用（design §5）。
- [ ] 手工验证：DevTools Rendering → Emulate CSS `prefers-reduced-motion: reduce`，开合 modal：无缩放、仅淡入淡出；more-menu 开合无位移。

## Step 4 — Toast 退出动画

- [ ] `public/js/app.js:167-175`：`addToast` push 带 `leaving: false`；`removeToast` 改防重入 + leaving 标记 + 350ms 后 filter（design §3）。
- [ ] `public/js/layout.js:59`：`:class` 加 leaving 分支。
- [ ] `base.css` Toast 段：`slideIn` easing 对齐 smooth-out；新增 `.toast.leaving` + `slideOut` keyframes（350ms forwards）。
- [ ] 手工验证：触发保存成功 toast → 3s 后向右滑出淡出离场；连续触发 2+ toast 均正常离场、无误删。

## Step 5 — R3 枚举 + R4 数值对齐

- [ ] `transition: all` 7 处按 design §4 表枚举（`.modal-overlay` 已随 Step 1 移除，实为 6 处遗留）；逐处核对 `:hover`/`:focus` 变体实际属性后定稿。
- [ ] `cards-detail.css:210` 图片缩放 → 250ms smooth-out；`cards-detail.css:86` `.vn-card` → `--transition-fast`。
- [ ] 验证：`grep -n "transition: all" public/css/*.css` 零命中（AC3）。

## Step 6 — R5 vndb 下拉过渡

- [ ] `public/index.html:286`：`x-show="vndbSearchOpen"` 加类钩子（`dd-grow-*` 风格命名，open 250 / close 150，`transform-origin: top`，起始 `translateY(-6px) scale(0.97)`）。
- [ ] `forms.css` 下拉段：钩子类 CSS + reduce 块 `transition-duration: 0.01ms`。
- [ ] 手工验证：添加条目弹窗内搜索——下拉从输入框下沿生长/收束；键盘上下选择不受影响（listbox 交互回归）；reduce 模拟下直接显隐。

## Step 7 — 全量回归（最终 2.2 前置）

- [ ] `npm run lint` 绿。
- [ ] `npm run test` 绿。
- [ ] 手工过一遍 AC1–AC6 全清单（`prd.md`）。
- [ ] 桌面 + 480px 移动视口各抽验一次 modal/toast（移动端 nav 内 more-menu 也在此列）。

## 验证命令汇总

```bash
npm run lint
npm run test
grep -n "transition: all" public/css/*.css   # 期望零输出（AC3）
grep -n "cubic-bezier(0.4, 0, 0.2, 1)" public/css/*.css  # 期望零输出（手搓贝塞尔清除）
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚粒度 |
|---|---|---|
| `base.css` Modal/Toast 段 | 删基础态后 x-show 失败会导致弹窗永久不可见——Step 1 手工验证是硬闸 | Step 粒度 revert |
| 4 处 modal 模板 | 属性漏抄（尤其 `leave-end`）→ 下次开启跳变 | 样板先行 + 对照核对 |
| `app.js` toast Store | 防重入漏写 → 双路径下 leaving 二次 setTimeout 提前删 | 设计已含 guard |
| `index.html` / `tier.html` | 手工同步 3 处的结构漂移 | diff 对照 detail-modal.js 样板 |

无数据/schema/后端改动，整体回滚 = 单 commit revert。

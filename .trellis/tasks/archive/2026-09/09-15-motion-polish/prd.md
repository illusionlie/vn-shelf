# 动效修复与打磨：toast 退出动画、modal 双轨收敛、motion token 对齐

## Goal

按 transitions-dev / transitions-polish 两个 skill 的审查结论，修复 VN Shelf 前端动效的两处编排缺陷（toast 无退出动画、modal 显隐双轨冲突），并把存量动效数值对齐到项目 motion token 体系，使全站动效「开慢关快、进入有出场有、reduced-motion 全覆盖」。

用户价值：消除 toast 瞬消、modal 背景与主体速度脱节这两处可感知的粗糙点；降低 CSS 双轨带来的维护税（reduced-motion 需 `!important` 打补丁即是症状）。

## Background（审查来源）

2026-09-15 按 transitions-dev（32 过渡方案匹配）与 transitions-polish（五维 motion token 审计）完成全站只读审查。审查范围：`public/css/` 全部 7 文件、4 处 Alpine `x-transition` modal、`app.js` toast 生命周期、`utils.js` more-menu 编排。审查结论已沉淀为本 PRD 的 Confirmed Facts。

项目 motion token 现状：`--transition-fast: 0.2s ease-in-out` / `--transition-medium: 0.3s ease-in-out`（`public/css/base.css:14-15`），duration 与 easing 绑定（skill 体系二者正交，本任务不强制重构 token 轴，见 Key Decisions）。

## Confirmed Facts（代码证据）

### 缺陷级

1. **Toast 无退出动画**：`public/js/app.js:167-175` `removeToast` 直接 `filter` 出数组，toast 3s 后原地闪消；`public/css/base.css:715` 仅 `slideIn` 进入动画（0.3s `cubic-bezier(0.4,0,0.2,1)`）。违反 22-toast 方案「close 350ms、退出须有动画」。
2. **Modal 显隐双轨冲突**：4 处 modal（`public/index.html:227-228`、`public/tier.html:241-242`、`public/js/layout.js:33-34`、`public/js/detail-modal.js:29-30`）overlay 走 `:class="{active}"` 类切换（`base.css:521` `transition: all 0.3s ease`，300ms 双向），主体走 `x-show + x-transition`（Alpine 默认 150ms 双向）。观感上背景 300ms 慢淡入、主体 150ms 快弹出，速度脱节。`base.css:540` 的 `.modal` CSS transition 对 x-transition 元素被内联覆盖、基本死代码；`base.css:918-922` 的 reduced-motion `!important` 补丁即为双轨代价。06-modal 方案基准：open 250ms / close 150ms，scale 0.96，`--ease-smooth-out`。
3. **VNDB 搜索下拉零过渡**：`public/css/forms.css:132-145` `.vndb-search-dropdown` 瞬开瞬关，全站唯一无动效浮层。05-menu-dropdown 方案基准：origin-aware 从锚点生长，open 250ms / close 150ms，scale 0.97。

### 数值/规范级

4. 封面 hover 缩放 0.4s ease（`public/css/cards-detail.css:210`）超 hover-in ≤250ms 基准；外层 `.vn-card` lift 用 `--transition-medium` 0.3s（`cards-detail.css:86`）同超一档。
5. `transition: all` 共 7 处：`base.css:430`（.btn）、`base.css:521`（.modal-overlay）、`base.css:588`（.modal-close）、`cards-detail.css:23`（.search-input）、`cards-detail.css:43`（.sort-select）、`forms.css:22`（.form-input）、`forms.css:103`（.radio-label/.checkbox-label）。transitions-dev 明确反对 `all`（无关属性搭便车）。
6. **reduced-motion 缺口**：`.more-menu`（`base.css:375`）带 `translateY(-10px→0)` 位移过渡，未纳入任何 `prefers-reduced-motion` 块，违反项目自身「位移/缩放降级」规范（`base.css:901-904` 注释）。
7. toast 进入 easing `cubic-bezier(0.4,0,0.2,1)`（`base.css:715`）为手搓贝塞尔，按 polish 规则 surface motion 应对齐 `cubic-bezier(0.22,1,0.36,1)`（`--ease-smooth-out`）。

### 判定为保留不动（no matching token usage，避免误伤）

- 进度条淡出 0.5s ease-out（`base.css:118`）、进度条 width 0.3s（`base.css:133`）、shimmer 1.5s linear（`base.css:149`，linear 已 on-grid）、spin 0.8s linear（spinner 功能性反馈，reduce 下保留正确）、光扫 0.7s（`cards-detail.css:116`，装饰性已有 reduce 冻结）、NSFW blur 过渡（`cards-detail.css:586`）、back-to-top 显隐（`base.css:768`，纯 opacity/色彩属保留类）。
- hover 色彩类过渡（链接、导航、tag 按钮）保持 `--transition-fast` 不动——色彩过渡不属 surface motion，无 token 强制。

### 存量优点（不动的部分）

- 三文件 reduced-motion 覆盖策略清晰（装饰停/功能留，光扫冻结静止位）。
- more-menu 用 `pointer-events: none` 而非 `display: none` 隐藏，天然规避 `.is-closing` 清理陷阱。
- back-to-top visibility 离散插值三件套（`base.css:762` 注释）。

## Requirements

> 范围已确认（2026-09-15 用户选定）：R1–R5 全做。

- **R1 Toast 退出动画**：`removeToast` 增加 leaving 态 + 退出动画（350ms 量级），动画完成后才真正移出数组；进入动画 easing 对齐 smooth-out；保留并发 id 序列防误删语义与 reduced-motion 下 `animation: none` 行为（瞬现瞬退可接受）。
- **R2 Modal 单轨收敛**：显隐动效收敛为单一驱动机制，open 250ms / close 150ms 不对称，overlay 与主体同速结束；`base.css:540` 死代码与 `base.css:918` `!important` 补丁随收敛退役或收敛后不再需要；4 处 modal（edit / tierEdit / confirmDialog / detail）行为一致；reduced-motion 下位移/缩放停用、opacity 保留的既有策略不变。
- **R3 `transition: all` 枚举化**：7 处全部改为显式属性枚举，不改变现有时长与观感。
- **R4 hover 数值对齐 + reduce 缺口**：封面缩放与卡片 lift 对齐 ≤250ms；`.more-menu` 位移纳入 reduced-motion 降级。
- **R5（可选）VNDB 搜索下拉过渡**：`.vndb-search-dropdown` 增加 origin-aware 开合过渡（open 250ms / close 150ms），含 reduced-motion 降级；需处理 x-show `display:none` 切换下的退出编排（`.is-closing` 类清理，按 05-menu-dropdown 方案的 common-mistakes 清单）。

## Acceptance Criteria

- [x] AC1：任意操作触发 toast，3s 后 toast 以退出动画离场（非瞬间消失）；连续 toast 不互相误删（既有 `_toastSeq` 语义保留）。—— 冒烟验证：`slideIn 0.3s` 进入 → 3s 挂 `leaving`（`slideOut 0.35s`，opacity 实测平滑衰减 0.30）→ 350ms 后 DOM 移除
- [x] AC2：四类 modal（编辑、Tier 编辑、确认框、详情）开合时 overlay 与主体动效同步：open 明显慢于 close（250/150ms 量级），无背景慢主体快的脱节感。—— 冒烟验证（详情弹窗）：关闭时序采样 t+0 挂 `leave` 类（0.15s + smooth-out）→ t+60 start→end swap → t+260 display:none + 类清理 + 滚动锁释放
- [x] AC3：`grep -n "transition: all" public/css/*.css` 零命中。
- [x] AC4：系统开启「减少动态效果」后：modal 缩放、卡片 hover 位移、光扫、shimmer、toast 位移均停用；opacity/色彩过渡保留；more-menu 无位移过渡（本条含 R4 修复项）。—— 冒烟验证（reduce 模拟）：modal `transform: none` + 零过渡、toast leaving `animationName: none`、reduce 块五组规则齐全
- [x] AC5：`npm run lint` 与 `npm run test` 通过。—— lint 零告警、test 248 pass / 0 fail
- [x] AC6（R5）：添加条目弹窗内 VNDB 搜索下拉开合有生长/收束过渡，reduced-motion 下直接显隐。—— 静态面由 trellis-check 核验（六类钩子齐全、`transform-origin: top`、250/150、reduce `0.01ms`）；运行时观感经用户管理员侧人工复核通过（2026-09-15）

## 验收记录（2026-09-15）

- 实现：trellis-implement 一次通过，5 处有据偏离（详见 design 对比）：① leave 侧钩子类改 canonical 语义（leave-start=可见态/leave-end=隐藏态，六类全显式）——防退出阶段反向淡入，依据 vendored Alpine 3.17.2 源码（类钩子收尾靠 computed transition-duration 的 setTimeout）；② overlay 补 `x-cloak` 防初始化闪烁；③ reduce 块显式列 `.toast.leaving`（特异度 (0,2,0) 反超 `.toast` (0,1,0)）；④ 下拉过渡并入 opacity（纯 scale 0.97 近乎不可感知）；⑤ 以上机制性依据写入 CSS 注释。
- 检查：trellis-check 零修复全过（8 文件、七项核查 + a11y 附带深查）。
- 冒烟：本地 wrangler dev + Playwright，AC1/2/4 运行时验证通过（详见各 AC 标注）；AC6 运行时项留人工。
- 遗留：无——AC6 管理员侧观感已由用户复核通过（2026-09-15）；`.btn:disabled` opacity 切换不再过渡（原被 `transition: all` 搭便车，check 判定为有意取舍——状态反馈即时呈现更优）。

## Out of Scope

- 引入 transitions skill 的 `_root.css` 五维 token 体系重构（`--duration-*` / `--ease-*` 正交拆分）——现有二元 token 够用，重构收益不成比例；数值直接写 literal 并加注释即可。
- skeleton loader（14-skeleton-reveal）、表单 error shake（12-error-state-shake）、success check 等新增方案——纯锦上添花，另行立项。
- box-shadow / width / background-position 过渡的性能卫生改造（paint 型属性）——skill 列为未来扩展，现状无感知问题。
- 后端（`src/`）与登录/设置/统计页（无动效声明，`login.css` / `settings.css` / `stats.css` 零命中）。

## Key Decisions

- KD1（范围）：R1–R5 全做，用户 2026-09-15 确认。
- KD2（modal 轨道）：收敛走 **Alpine 类钩子模式**（`x-transition:enter/enter-start/enter-end/leave/leave-start/leave-end` 全套类，动画属性全部回归 CSS 管理，Alpine 不写内联 transform）——`base.css:918` 的 `!important` 补丁随之退役。理由：4 处 modal 已用 `x-show`（类钩子是 Alpine 原生离开编排，自动等 transitionend 再 display:none）；overlay 同步改 `x-show` 轨。不引入手写 `.is-closing`。
- KD3（toast 退出）：`removeToast` 先置 `leaving` 字段，`setTimeout(350ms)` 兜底后真正出数组（不用 `animationend` 绑定，x-for 模板保持简单）；CSS `.toast.leaving` 承载退出动画。
- KD4（数值写法）：修改处写 literal + 注释锚定 transitions skill 基准（open 250 / close 150 / toast close 350 / smooth-out 贝塞尔 `cubic-bezier(0.22,1,0.36,1)`），不新增 token 轴、不引入 `_root.css`。
- KD5（vndb 下拉）：`x-show` 上加同套类钩子过渡，origin-aware 从上沿生长（`transform-origin: top`，`translateY(-6px) scale(0.97)` 起始），退出由 Alpine 自动延迟 display:none。

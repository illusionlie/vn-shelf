# Design — 动效修复与打磨

技术设计。需求与验收见 `prd.md`；执行清单见 `implement.md`。

## 0. 已验证的技术前提

- Alpine **3.17.2** vendor 自托管（`package.json` `alpineVersion`），完整支持 `x-transition` 类钩子全套（`x-transition:enter` / `enter-start` / `enter-end` / `leave` / `leave-start` / `leave-end`）。
- 4 处 modal 结构一致：overlay `:class="{active: X}"` + 主体 `x-show="X" x-transition`。overlay 的 `.active` 仅驱动 `opacity/visibility`（CSS 内无其它 `.modal-overlay.active` 消费者，已 grep 确认）。
- vndb 下拉显隐：`x-show="vndbSearchOpen"`（`public/index.html:286`），`display:none` 切换。
- toast 渲染：壳层注入 `public/js/layout.js:57-60`，`x-for` + `:key="toast.id"`。
- Alpine 类钩子模式下 **Alpine 不写内联 transform**，只做类切换并自动等待 `transitionend` 再 `display:none`——动画完全回归 CSS 管理，这是 `base.css:918` `!important` 补丁退役的前提。

## 1. Motion 基准（literal，注释锚定）

全部写 literal + 行注释锚定 transitions.dev 基准，不新增 token：

| 用途 | 值 | 来源 |
|---|---|---|
| modal / dropdown **open** | `250ms` `cubic-bezier(0.22,1,0.36,1)` | `--duration-fast` / `--ease-smooth-out` |
| modal / dropdown **close** | `150ms` 同上 | `--duration-quick` |
| toast close | `350ms` 同上 | `--duration-medium`（22-toast） |
| toast open（进入 easing 对齐） | `300ms` → easing 换 smooth-out，时长保留 | 22-toast「慢进快出」 |
| dropdown pre-scale | `0.97` + `translateY(-6px)`，`transform-origin: top` | `--scale-medium` / `--scale-tiny` 量级 |
| modal pre-scale | `0.95` 保留现值 | `--scale-large`=0.96，现值 0.95 在容差内，不强改 |

开/关不对称（polish 规则）：open 是邀请、close 让路，close 永远快于 open。

## 2. R2 — Modal 单轨收敛（类钩子模式）

### 模板侧（4 处：`index.html:227-228`、`tier.html:241-242`、`layout.js:33-34`、`detail-modal.js:29-30`）

overlay 与主体全部改 Alpine 轨：

```html
<!-- overlay：类切换 → x-show + 淡入淡出钩子 -->
<div class="modal-overlay" x-show="X" x-transition:enter="ov-enter" x-transition:enter-start="ov-enter-start"
     x-transition:enter-end="ov-enter-end" x-transition:leave="ov-leave" x-transition:leave-start="ov-leave-start"
     x-transition:leave-end="ov-leave-end" @click.self="closeX()" ...>
  <!-- 主体：x-transition → 全套类钩子 -->
  <div class="modal" x-show="X" x-ref="..." x-transition:enter="m-enter" ... role="dialog" ...>
```

> 属性较长，允许换行排布；`:class="{active: X}"` 与裸 `x-transition` 移除。Esc 处理（`@keydown.escape.window`）与 `@click.self` 不动。

### CSS 侧（base.css，Modal 段重写）

```css
/* Alpine 类钩子：动画回归 CSS 管理（Alpine 只切类、等 transitionend）。
   基准 transitions.dev：open 250ms / close 150ms（开慢关快），smooth-out。 */
.modal-overlay { /* 删 opacity:0; visibility:hidden 基础态与 transition: all */ }
.ov-enter, .ov-leave { transition: opacity 250ms cubic-bezier(0.22,1,0.36,1); }
.ov-leave { transition-duration: 150ms; }
.ov-enter-start, .ov-leave-start { opacity: 0; }
/* 主体 */
.modal { /* 删 transform: scale(0.95) 基础态与 transition: all */ }
.m-enter, .m-leave { transition: transform 250ms cubic-bezier(0.22,1,0.36,1); }
.m-leave { transition-duration: 150ms; }
.m-enter-start, .m-leave-start { transform: scale(0.95); }
```

- `.modal-overlay.active` / `.modal-overlay.active .modal` 两条规则删除（无消费者）。
- `base.css:905-930` reduced-motion 块中 `.modal { transform: none !important }` 补丁删除——类钩子模式下 Alpine 不写内联 transform，媒体查询常规声明即可接管（reduce 策略见 §6）。
- 类名前缀 `ov-` / `m-` 简短但项目内唯一性可接受；也可用 `modal-fade-*` / `modal-scale-*` 更自描述，实现时取后者风格，此处示意。

### 行为语义

- x-show 关闭：Alpine 加 leave 类 → 等 transitionend → display:none。开合时长 overlay 与主体同为 250/150，同步结束。
- **焦点/滚动锁不动**：`body.modal-open`（滚动锁）与焦点陷阱逻辑在组件层，与显隐机制解耦，本次不触碰。
- **回归风险**：`withModalGuard`（09-12 task 沉淀的弹窗生命周期契约）依赖 x-show/x-ref，不依赖 `.active` 类——已确认无耦合。

## 3. R1 — Toast 退出动画

### JS（`app.js`）

```js
addToast(message, type = 'success') {
  const id = ++_toastSeq;
  this.toasts.push({ id, message, type, leaving: false });
  setTimeout(() => this.removeToast(id), 3000);
},
removeToast(id) {
  const toast = this.toasts.find(t => t.id === id);
  if (!toast || toast.leaving) return;   // 防重入：3s 定时与手动 close 双路径
  toast.leaving = true;                   // 触发 CSS 退出动画
  setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 350);
}
```

- 350ms 用 CSS 动画时长常量对齐（留注释互指）；不用 `animationend` 绑定，模板保持简单。
- `_toastSeq` 并发防误删语义保留（filter 按 id）。

### 模板（`layout.js:59`）

`:class` 增加 leaving：`:class="['toast-' + toast.type, toast.leaving ? 'leaving' : '']"`。

### CSS（base.css Toast 段）

```css
.toast { animation: slideIn 300ms cubic-bezier(0.22,1,0.36,1); }  /* easing 对齐 smooth-out */
.toast.leaving { animation: slideOut 350ms cubic-bezier(0.22,1,0.36,1) forwards; }
@keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
```

- `forwards` 防动画末帧回跳（350ms 后元素即被 filter 移除，正常路径无感知）。
- reduced-motion：既有 `.toast { animation: none }` 同时覆盖进/出（leaving 时瞬退，符合规范）。

## 4. R3 — `transition: all` 枚举化（7 处）

逐处按实际过渡属性枚举，时长/easing 不变（`--transition-fast` 保留）：

| 位置 | 枚举为 |
|---|---|
| `base.css:430` `.btn` | `background-color, color, border-color, box-shadow, transform`（hover 变体用到） |
| `base.css:521` `.modal-overlay` | 整段随 §2 重写移除 |
| `base.css:588` `.modal-close` | `color, background-color` |
| `cards-detail.css:23` `.search-input` | `background-color, border-color` |
| `cards-detail.css:43` `.sort-select` | `background-color, border-color` |
| `forms.css:22` `.form-input` | `background-color, border-color, box-shadow` |
| `forms.css:103` `.radio/.checkbox-label` | `background-color, border-color` |

> 枚举以现有 `:hover`/`:focus` 变体实际改变的属性为准，实现时逐条核对变体再定稿，上表是审查时的推断。

## 5. R4 — hover 数值对齐 + reduce 缺口

- `cards-detail.css:210` `.vn-card-image`：`transform 0.4s ease` → `transform 0.25s cubic-bezier(0.22,1,0.36,1)`（hover-in ≤250ms）。
- `cards-detail.css:86` `.vn-card`：`--transition-medium`（0.3s）→ `--transition-fast`（0.2s）。**保留 token 引用**（色彩类与 transform 混合声明拆开写则 transform 单独 250ms literal；从简：整体降 `--transition-fast`）。
- `base.css:375` `.more-menu`：补进 `base.css:905` reduce 块——`.more-menu { transition: opacity var(--transition-fast); transform: none; }`（位移停、淡入保留，同 modal 策略）。

## 6. Reduced-motion 总策略（不变，补齐覆盖）

沿用项目既有边界（`base.css:901-904` 注释）：**位移/缩放/光效停，颜色/阴影/透明度保留，功能性 spinner 保留**。本任务新增面：

- modal 类钩子：reduce 块加 `transform: none`（替代退役的 `!important` 补丁），opacity 淡入淡出保留。
- vndb 下拉：reduce 下 `transition-duration: 0.01ms`（直接显隐）。
- toast / more-menu：见 §3 / §5。

## 7. 兼容与回滚

- **无后端改动**、无 i18n key 变更、无 vendor 变更。改动面：4 个 CSS + `app.js` + `layout.js` + `detail-modal.js` + `index.html` + `tier.html`。
- HTML/JS 注入模板的 modal 结构改动是最大的回归面（4 处手工同步）——执行时以 `detail-modal.js` 为样板先改 1 处人工验证，再机械同步其余 3 处。
- 回滚：单 git revert 即可，无数据/ schema 影响。
- 测试补充：现有 `tests/public/` 无动效断言；考虑为 toast leaving 语义补一个纯函数级测试不可行（逻辑在 Store 方法内）——以 AC 手工验收 + lint/test 回归兜底，不强行补测试。

## 8. 权衡记录

- **类钩子 vs duration 修饰符**：`x-transition:enter.duration.250ms` 更短，但 Alpine 仍写内联样式，reduce 补丁无法退役——类钩子多写几个属性，换「CSS 单一事实源」，胜出。
- **overlay 并入 x-show vs 保留类切换**：保留类切换则 overlay 无法做开合不对称（纯 CSS 类切换需双态编排），并入后 4 处模板结构更一致，胜出。
- **toast 350ms 硬编码 vs token**：项目无 `--duration-*` 轴，为两处值新建 token 不成比例，literal + 注释互指。

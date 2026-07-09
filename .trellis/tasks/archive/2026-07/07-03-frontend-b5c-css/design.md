# Design — B5c CSS 拆分与断点补全

## 目标文件结构

```
public/css/
├── base.css          # 全站共用：Variables / Reset / Progress Bar / Links / Images /
│                     # Container / Header / Nav / Buttons(+Small) / Scrollbar / Toast /
│                     # Page Title / Empty State / Loading / Utility
├── forms.css         # Forms + Radio & Checkbox Groups（index/login/settings/tier 用；stats 不引）
├── cards-detail.css  # VN List & Cards / Modal / Detail Page / NSFW Overlay /
│                     # Markdown Styles / Static Tags List / Controls Bar（index+tier 共用）
├── tier.css          # Tier List Page 分区
├── stats.css         # Stats Page 分区
├── login.css         # Login Page 分区
└── settings.css      # Settings Page + Cache Status 分区
```

- 每页 `<head>`：`base.css` + 所需模块（如 login = base+forms+login；stats = base+stats；index = base+forms+cards-detail；tier = base+forms+cards-detail+tier；settings = base+forms+settings）。
- **原 `style.css` 删除**（AC1），不留兼容入口——五个 HTML 同 commit 更新，无外部引用方。
- 归属存疑的类（如 `settings-` 前缀出现在 stats/tier 的 HTML 中）：实现时以"HTML/JS 实际使用"为准逐类核对，共用则上移至 base 或对应共用文件，宁可上移不可漏载。JS 注入的 DOM（layout.js 的 toast/进度条/确认框、markdown 渲染、翻译标签）类名也要纳入核对——grep `public/js` 中的 class 字符串。

## 断点体系

- 三档：`@media (max-width: 480px)` / `(max-width: 768px)` / `(min-width: 1024px)`。
- 原 700px 块（约 1472–1557 行）规则整体迁入各模块文件的 768 档——**responsive 规则跟随其组件所在文件**，不再集中一处（集中式会破坏按页加载）。
- 480 档：仅保守增补（更紧的卡片栅格列数、间距缩减、字号微调）；1024 档：容器宽度/栅格列数的宽屏优化。均不改设计语言（D 系列决策）。

## 迁移方法（保证 AC5 等值性）

1. 纯搬运阶段：按分区注释切割，规则逐字复制到目标文件，顺序保持原文件内相对顺序（层叠依赖：base 先加载，页面文件后加载，与原单文件顺序语义一致）。
2. 断点阶段：单独 commit——700→768 迁移与 480/1024 增补分开于搬运，便于 diff 审查与单独 revert。
3. 验证：拆分前后用规则集对比脚本（如 `cat` 拼接新文件 diff 旧文件，忽略空行/注释差异）佐证纯搬运无内容漂移。

## 层叠与加载顺序契约

- `<link>` 顺序固定：`base.css` → 共用模块（forms → cards-detail）→ 页面文件。后者可覆写前者（与原文件"页面分区在后"的层叠语义一致）。
- CSS Variables 全部留在 base.css 顶部；深色模式 `.dark-mode` 变量覆写同在 base.css（theme.js 只切 body class，无 CSS 文件依赖）。
- 自定义背景遮罩（theme.js `applyBackgroundOverlay`）相关规则归 base.css。

## 取舍记录

- **多 `<link>` vs `@import`**：选多 `<link>`——`@import` 串行阻塞（浏览器需先下 base 再发现 import），多 link 并行下载。
- **responsive 集中 vs 跟随组件**：选跟随组件。代价是"看全站断点行为"需跨文件，收益是按页加载完整、模块自洽。
- **不留 style.css 兼容入口**：静态站无第三方引用，留空壳只会误导。

## 回滚

- 三 commit 切分：①纯搬运拆分+HTML link ②700→768 迁移 ③480/1024 增补。任一回归可独立 revert；全部 revert 即回到单文件。

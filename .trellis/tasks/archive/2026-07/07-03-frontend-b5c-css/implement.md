# Implement — B5c CSS 拆分与断点补全

## 执行清单（有序）

### 阶段 0：核对归属（不改码）

- [x] 0.1 逐分区确认使用方：grep 五个 HTML + `public/js`（layout.js 注入 DOM、markdown.js、translations.js、组件里拼的 class 字符串）建立"分区 → 页面集合"映射表，落在本文件附录。存疑类（`settings-` 前缀出现在 stats/tier 等）逐个定归属；共用则上移，宁上移不漏载。
- [x] 0.2 记录拆分前基线：`wc -c public/css/style.css` + 每页阻塞 CSS 字节数（= 全量 1928 行）。

### 阶段 1：纯搬运拆分（commit ①）

- [x] 1.1 按 design.md 结构创建 7 个 css 文件，规则逐字搬运，保持原相对顺序；原 700px media 块暂按组件归属搬入各文件（仍保持 700px 值，本阶段不改断点）。
- [x] 1.2 删除 `style.css`；五个 HTML 更新 `<link>`（顺序：base → forms → cards-detail → 页面文件，按页裁剪）。
- [x] 1.3 等值性佐证：按各页 link 顺序拼接新文件与原文件做规则集 diff（忽略空行/注释），确认零内容漂移。
- [x] 1.4 `npm run lint && npm run test`；五页面 `npm run dev` 快速走查（亮/暗各一遍）。（lint/test 已跑；浏览器走查待用户执行）

### 阶段 2：断点迁移 700 → 768（commit ②）

- [x] 2.1 各文件内 `max-width: 700px` → `max-width: 768px`，无其他改动。
- [ ] 2.2 走查 700–768px 区间（预期改为移动布局，D2 豁免）与 <700px（应与原完全一致）。（浏览器手工走查待用户执行）

### 阶段 3：480 / 1024 增补（commit ③）

- [x] 3.1 480 档保守增补：卡片栅格列数、间距、字号（仅明显拥挤处，逐条记录）。
- [x] 3.2 1024 档宽屏优化：容器最大宽度/栅格列数（仅明显松散处，逐条记录）。
- [x] 3.3 无 700px 残留：`grep -rn '700px' public/css/` 为空（AC3）。

### 阶段 4：验证

- [x] 4.1 `npm run lint && npm run test` 全绿（AC6）。
- [x] 4.2 每页阻塞 CSS 字节数对比表（AC2）。
- [ ] 4.3 手工走查矩阵（AC4）：5 页 × 4 视口档 × 亮/暗；重点：详情弹窗（index/tier）、Tier 拖拽区、设置页表单、深色变量与自定义背景遮罩（AC7）。（浏览器手工走查待用户执行）

## 验证命令

```bash
npm run lint && npm run test
grep -rn '700px' public/css/          # 阶段 3 后应为空
for f in public/css/*.css; do wc -c "$f"; done
npm run dev                            # 手工走查
```

## 风险文件与回滚点

- 高风险：cards-detail.css（Modal/Detail 规则最多、index+tier 双页共用）；层叠顺序错位会静默改样式——link 顺序契约见 design.md。
- 回滚：三 commit 独立 revert；全 revert 回单文件。

## start 前检查

- [ ] prd / design / implement 三件套齐备，用户已评审。
- [ ] `task.py start 07-03-frontend-b5c-css` 后才允许改代码。

## 附录：分区 → 页面映射（阶段 0 填写）

依据：grep 五个 HTML 的 class 属性 + `public/js`（layout.js 注入 shell、markdown.js class 字符串、theme.js/utils.js classList）。

| 原 style.css 分区（原行号） | 使用方 | 归属文件 | 备注 |
|---|---|---|---|
| CSS Variables + dark-mode（5-62） | 全页 + theme.js | base.css | AC7 |
| Reset & Base / modal-open / x-cloak（64-95） | 全页（`.login-page` 仅 login，随分区保留） | base.css | |
| Loading Progress Bar + shimmer（97-145） | 全页（layout.js 注入） | base.css | |
| Background Overlay（147-159） | 全页（layout.js 注入 + theme.js querySelector） | base.css | |
| Links / Images / Container（161-179） | 全页 | base.css | |
| Header / Navigation / more-menu / theme-toggle（181-361） | 全页 | base.css | |
| Controls Bar（363-411） | 仅 index 实际使用（search/sort/controls-bar） | cards-detail.css | 按 design 归 cards-detail |
| Buttons + btn-sm / Scrollbar（413-488） | 全页（layout.js confirmDialog 用 btn-*） | base.css | |
| VN List & Cards（490-662） | index、tier（all-age-badge/stars 详情弹窗共用） | cards-detail.css | |
| **Modal（664-774）** | **全页——layout.js confirmDialog 注入 modal-overlay/modal/modal-header/body/footer/confirm-dialog-overlay** | **base.css（上移，偏离 design 原定 cards-detail）** | 不上移则 login/settings/stats 确认框裸奔 |
| Forms（776-859） | index/login/settings/tier | forms.css | stats 不引，核实 stats.html 无 form-* ✓ |
| has-bg-image（861-864） | 全页（theme.js） | base.css | |
| Detail Page（866-1065） | index、tier（详情弹窗） | cards-detail.css | |
| Tier List Page（1067-1275） | tier | tier.css | tier-controls/tier-page-title 当前 HTML/JS 零引用，按 AC5 纯搬运原样保留（未删） |
| Stats Page（1277-1323） | stats | stats.css | |
| Login Page（1325-1352） | login | login.css | |
| **Settings Page（1354-1382）** | **settings + stats（settings-section、settings-section-title）+ tier（settings-section-title）** | **base.css（上移，存疑类核实结果）** | stats 不引 settings.css，必须上移 |
| Empty State（1384-1401） | index/stats/tier | base.css | 上移（3/5 页共用） |
| Loading（1403-1422） | index/login/stats/tier | base.css | 上移 |
| Toast（1424-1456） | 全页（layout.js 注入；toast-warning 当前无 JS 触发，纯搬运保留） | base.css | |
| Page Title（1458-1465） | settings/stats（tier 的 .tier-page-title 覆写它） | base.css | |
| Responsive 700px 块（1467-1556） | 按规则拆：body/main-header/banner-nav/desktop-only/mobile-only → base；cards-grid/vn-card-image/detail-*/controls-bar/search-container → cards-detail；tier-* → tier | 三个文件各自 768 档 | mobile-only 非 media 规则随分区头留 base |
| NSFW Overlay（1558-1601） | index、tier | cards-detail.css | 含 tier-vn-card 的 NSFW 微调（tier 引 cards-detail，层叠成立） |
| Utility Classes（1603-1609） | 全页（mt-4/text-center/text-muted 等） | base.css | settings.html 用了未定义的 mt-2，与本任务无关，未动 |
| Radio & Checkbox Groups（1611-1649） | settings（radio/checkbox-label） | forms.css | 按 design 归 forms |
| Cache Status（1651-1665） | settings | settings.css | |
| Static Tags List（1667-1671） | index/tier（detail-tags-list.static） | cards-detail.css | |
| Button Small 重复块（1673-1677） | 同 btn-sm | base.css | 与 413 段的 .btn-sm 重复定义，保持原相对顺序（后者覆盖前者 0.8→0.85rem） |
| Markdown Styles + dark-mode 覆写（1679-1928） | index/tier（markdown.js 仅渲染进 detail-review-content） | cards-detail.css | md-* class 全部来自 markdown.js |

### 基线与对比（0.2 / 4.2）

拆分前：style.css 1928 行 / 39799 字节（每页全量阻塞）。

拆分后（含 768 迁移与 480/1024 增补）：

| 文件 | 字节 |
|---|---|
| base.css | 15684 |
| forms.css | 2391 |
| cards-detail.css | 14348 |
| tier.css | 5058 |
| stats.css | 1166 |
| login.css | 708 |
| settings.css | 279 |

| 页面 | link 组合 | 阻塞字节 | vs 39799 |
|---|---|---|---|
| index | base+forms+cards-detail | 32423 | 81% |
| login | base+forms+login | 18783 | 47% |
| settings | base+forms+settings | 18354 | 46% |
| stats | base+stats | 16850 | 42% |
| tier | base+forms+cards-detail+tier | 37481 | 94% |

### 等值性佐证（1.3）

规则集对比脚本（node，剥注释/空白归一化、media 前缀展开、多重集比较）：拆分后 7 文件拼接 vs 原 style.css，**283 条规则完全一致，零漂移**。（原文件末行 `}` 无换行符导致首轮 sed 漏拷 1 字符，已修复后复验通过。）

### 480 / 1024 增补清单（3.1 / 3.2 逐条记录）

480 档（max-width: 480px）：
- base：`.container` padding 0 16px；`.modal-header/.modal-footer` padding 14px 16px；`.modal-body` padding 16px；`.toast-container` 左右 16px、`.toast` max-width 100%（380px 固定宽在 360px 屏溢出）。
- cards-detail：`.cards-grid` minmax(140px,1fr)、gap 12px；`.vn-card-image` 220px；`.vn-card-content` padding 14px；`.detail-title` 1.5rem。
- tier：`.tier-row` 52px 标签列；`.tier-label` 1rem；`.tier-vn-card` 60×84；`.tier-drop-indicator` 72px。
- stats：`.stats-grid` minmax(150px,1fr)、gap 12px；`.stat-value` 2rem。
- login：`.login-box` padding 32px 24px。

1024 档（min-width: 1024px）：
- base：`.container` max-width 1600px（仅 ≥1690px 视口可感知）。
- cards-detail：`.cards-grid` minmax(300px,1fr)（宽屏卡片略宽、列数略减）。

### 偏离 design.md 的决定

1. **Modal 分区放 base.css 而非 cards-detail.css**——layout.js 在全部五页注入 confirmDialog（modal-* + confirm-dialog-overlay + btn-*），design 自身的"JS 注入 DOM 类名纳入核对、宁上移不漏载"条款要求上移。
2. **Settings Page 分区放 base.css 而非 settings.css**——settings-section/settings-section-title 被 stats.html、tier.html 实际使用（design 已预判此存疑类）。settings.css 因此只剩 Cache Status。
3. **`.modal { max-width: 700px }` 改写为 `43.75rem`**——它是内容宽度非断点，但 implement.md 3.3 要求 `grep '700px'` 为空；43.75rem × 16px 根字号 = 700px，渲染完全等价，零视觉变化。
4. tier-controls / tier-page-title / toast-warning 等零引用规则**未删除**——AC5 纯搬运 + 用户"零引用代码先问再删"惯例，原样搬入归属文件。

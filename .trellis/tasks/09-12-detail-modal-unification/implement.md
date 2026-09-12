# 执行计划：详情弹窗统一与弹窗生命周期重构（已完成 2026-09-12）

单 commit 内聚交付，按依赖顺序分四步。全局验证：`npm run lint && npm test`。

## 前置定位（结论）

- [x] `statusBadgeLabel` / `statusIcon` 原为 vnShelf 私有（vnShelf.js:201-223）→ 上移 `utils.js` 导出（依赖 t()）；白名单 `VN_STATUS_OPTIONS` → `constants.js`（与后端 VN_STATUS_VALUES 注释互指）；`formatUserPlayTime` 已在 utils.js 导出，无需动。两组件挂 shorthand，模板绑定名不变
- [x] `.stars-container` / `.star.empty` 仅 tier.html 待删行 + cards-detail.css 自身 → 删除安全，grep 零残留（`--star-empty-color` 保留，stats.css 在用）
- [x] 两页均为 `<body x-data="页面组件()">`，mount 放原弹窗位置即在 x-data 根内，`$refs.detailModal` 可达

## S1 withModalGuard 抽取 ✅

- [x] utils.js `createModalGuard({ lockScroll })` → open / trap(el) / close（偏离 design 的单入口 API：utils.js 不依赖 Alpine 的 $nextTick，trap 由调用方在 nextTick 内建，时序与旧代码逐字等价）
- [x] 4 处替换：shared.js、vnShelf（含 openEdit 内 detail→edit 同构释放块）、tierlistPage（两开一关）、confirmDialog（`lockScroll:false` + `_lastFocus` 双还原保留）
- [x] 静默降级 try/catch 与条件锁语义逐字保留

## S2 统一模板注入 ✅

- [x] 新建 `public/js/detail-modal.js`：统一模板（index 版逐字基准，check 阶段逐行 diff 确认仅 3 处设计内变更：页脚 x-if、编辑钮 x-show、deleteVN 带参）+ `injectDetailModal()`（无 mount 空操作）
- [x] 两页内联模板删除 → `<div id="detail-modal-mount"></div>`；app.js 注入序 `injectFooter 后 → applyI18nDom 首遍前`，无 TLA
- [x] CSS：删除 4 条十星死规则；i18n 零新增 key（26 个既有 key 复用，parity 测试通过）

## S3 管理员动作 mixin + Tier 页接入 ✅

- [x] shared.js `createDetailAdminActions()`（refreshing busy map / refreshVN / deleteVN；偏离 design 的工厂参数钩子：改宿主钩子对象展开覆盖——工厂参数拿不到宿主 this）
- [x] vnShelf：委托 mixin，钩子走 09-09 就地更新（投影合并不 resetRenderWindow，行为零变化，check 逐项核过不回退）；`detailCanEdit: true`
- [x] tierlistPage：混入 + `applyDetailEntryUpdated`（mergeVndbIntoListItem 就地替换进分组，tierId/tierSort 沿旧值）/ `applyDetailEntryRemoved`（过滤 + rebuildTierGroups，空 tier 行保留）；`detailCanEdit: false`

## S4 验收核对（AC1-AC7）

- [x] AC1/AC2 代码层（模板 diff、grep 零残留）+ **手测两页逐项**（见手测记录）
- [x] AC3 lockPageScroll/trapFocus/unlockPageScroll 仅存 utils.js；4 处替换后行为不回退
- [x] AC4 Esc 关闭实测（index）；role/aria-modal/labelledby 两页在；焦点循环代码层核对（日常使用持续验证）
- [x] AC5 **tier 页刷新 + 删除实测通过**；访客页脚 x-if 不进 DOM（代码层 + 结构核）
- [x] AC6 i18n parity 3/3（零新增 key）
- [x] AC7 lint 零告警、test 248/248；两页手测回归通过

## 手测记录（2026-09-12，wrangler dev @ 127.0.0.1:8787 + Playwright 管理员会话）

以 v17（时空轮回/Ever17，管理员 API 重建的牺牲条目，测毕删除）为对象：

1. **两页字段口径一致（AC1/AC2）**：index 与 tier 详情弹窗同模板——标题「时空轮回」为 vndb.org 链接 + 外链图标钮（tier 页升级项）；双评分单 ★ + 数字；十星级行零残留；简评 Markdown（`<strong>`）渲染；role=dialog + aria-modal。
2. **tier 页刷新（AC5）**：页脚「刷新 VNDB」点击 → aria-disabled + aria-busy busy 态 → 完成后 toast「VNDB 数据已刷新」、无整页重载（window 标记保持）、弹窗不关闭、busy map 清空。
3. **tier 页删除（AC5）**：页脚「删除」→ confirmDialog（取消/删除）→ 确认后卡片就地移除（155→154）、详情弹窗关闭、无重载；API 终态 154 条、v17 零残留。
4. **编辑钮隐藏**：tier 页详情页脚三钮中「编辑」display:none（`detailCanEdit:false`），index 页三钮全可见。
5. **生命周期**：Esc 关闭详情弹窗（index 实测）；stats/login 无 mount 空操作零报错（login 已登录重定向首页为既有守卫）。
6. **过程插曲（非缺陷）**：列表为客户端过滤，页面加载后新建的条目需刷新才进列表——首次搜索"Ever17"扑空即此因；tier 卡片标题在 aria-label 不在 textContent。

## 实现与 design.md 的偏离（check 已核对，全部合理）

1. guard API 三动作 open/trap/close（utils.js 不依赖 Alpine）+ `{ lockScroll }` 选项（confirmDialog 不锁滚动差异点）
2. mixin 宿主钩子展开覆盖（替代工厂参数——组件构造时拿不到宿主 this）
3. busy map 字段名沿用现状 `refreshing`（模板绑定 isRefreshing，无行为差异）
4. vnShelf 删除仍走 `loadVNList()` 整表重载（design「就地移除」仅落 tier 钩子——vnShelf「行为零变化」条款优先；书架页删除就地 splice 可作后续微任务）
5. 页脚访客态 x-show → template x-if（dispatch 硬性要求 + AC5 明示，index 版同步升级）

## 遗留观察项

- 焦点循环细节（Tab 遍历）与 en locale 注入文案：代码层已核（i18n 两遍扫描递归 template.content），日常使用持续验证即可
- 书架页删除改就地 splice（微任务，见偏离 #4）
- check 备忘：tier 页隐藏「编辑」钮引用不存在的方法（Alpine 惰性求值 + display:none 不可达，设计上安全；若后续 tier 页补编辑能力自然消除）

## 风险文件

`public/index.html` / `tier.html`（模板删改为 mount）、`public/js/components/vnShelf.js`（09-09 场景重构，check 零回退确认）、`public/js/components/shared.js`（三页复用 mixin 扩展）。

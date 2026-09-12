# 侦察事实：详情弹窗统一（2026-09-12）

实现前必读的代码形态。需求级事实见 prd.md Confirmed Facts。

## 两份模板逐段对照

**相同部分（~90%）**：modal 壳（overlay + `.modal` + x-ref="detailModal" + x-show + x-transition + role/aria）、modal-header + 关闭钮、NSFW 图片 + 遮罩（含内联 `x-data="{ showNsfw: false }"` 作用域，index.html:235 / tier.html:249）、allAge 徽章、subtitle / company、meta（游戏时长 + 我的游玩时长 `formatUserPlayTime`）、tags（`getDisplayTags` 前 15）、简评（`renderMarkdown`，marked+DOMPurify）、Esc 互斥判断 `!$store.app._confirmDialog?.visible && closeDetail()`。

**四处差异（统一口径见 design.md 表）**：

| 差异 | index.html | tier.html |
|------|-----------|-----------|
| 标题 | vndb.org 链接 + `.vndb-link-btn` 外链图标钮（256-277） | 纯文本 span（270） |
| 状态徽章 | `.status-badge` + statusIcon + statusBadgeLabel（279-288） | 无 |
| 评分 | 单 ★ + `.detail-rating-score` 数字（294-309） | `.stars-container` 十星级行 + 数字（276-298） |
| 页脚 | admin 三按钮：刷新（341-349，aria-disabled/aria-busy）/ 编辑 / 删除（338-352） | 无页脚 |

行号锚点：index.html:223-356、tier.html:238-333。

## 共享逻辑层现状（shared.js）

- `createDetailModal()`（104-142）：`selectedVN` / `showDetail` 状态 + `openDetail`（vnAPI.get 拉完整条目；**首开才 lockPageScroll**，113-115 条件锁语义）+ `closeDetail`（release 静默降级 + unlock）。
- `createTagsView()`（27-99）：tags 配置加载 / 翻译 / `getDisplayTags` / 缓存热刷新——统一模板继续依赖，不动。
- 混入方式：对象展开 `...createDetailModal()`（vnShelf.js:27-28、tierlistPage.js:16-17 引用）。

## 注入先例（app.js:22-35 执行序）

```
initI18n()（异步，不阻塞）
→ injectShell()      ← confirmDialog 就是注入的 x-data 组件，Alpine 接管注入 DOM 的成熟先例
→ injectFooter()     ← 注入后随首遍 applyI18nDom 翻译（app.js:26-28 注释契约）
→ applyI18nDom()     ← 首遍同步
→ i18nReady.then(applyI18nDom)  ← 第二遍
→ alpine:init 事件注册 Store + 组件
```

`injectDetailModal()` 插在 `injectFooter()` 之后即可满足两个契约：Alpine 初始化前 + 首遍 i18n 前。**禁止 top-level await**（app.js:20-21 注释：TLA 会破坏与 alpine.min.js 的执行顺序）。

## 弹窗生命周期 4 处重复（逐字 try/catch 块）

- shared.js:131-138（`_detailTrapRelease`）
- vnShelf.js:481-488（编辑弹窗）
- tierlistPage.js:228-235（tier 编辑弹窗）
- confirmDialog.js:113-120

统一为 utils.js `createModalGuard()`；`lockPageScroll` / `trapFocus` / `unlockPageScroll` 现由 utils.js:125-175 区间导出，guard 是其上的薄封装。

## vnShelf 现有管理员动作（重构基准，行为不得回退）

- 刷新：09-09 spec Scenario「单条目就地更新」——PUT refreshVNDB → `vn-list-item.js` 投影合并列表项 + 同步 selectedVN，**不 resetRenderWindow**；per-id busy（`refreshingIds`）；刷新中编辑/删除联动禁用（INSERT OR REPLACE 在途互斥）。
- 删除：confirmDialog → DELETE → 列表移除。
- spec 沉淀位置：`.trellis/spec/frontend/component-guidelines.md`（09-09 条目）与 quality-guidelines.md（busy 按钮 aria-disabled 保焦点、role=button 内嵌控件 .stop、封面 z-index 阶梯）。

## CSS 现状

- `.modal*` 全部在 base.css:504-620；`.detail-*` / `.stars-container` / `.status-badge` 在 cards-detail.css——两页共用同一 CSS 链路（tier.html:21 整份引 cards-detail.css），统一模板零新增样式预期成立。
- tier.html 另有 `.tier-edit-modal`（334）——tier 编辑弹窗不在本任务范围，勿动。

## i18n / 测试

- 双词典 291 key 双向 parity 由 tests/public/i18n.keys.test.mjs 强制；统一模板复用既有 key（index 版已在用）。
- 无组件级 DOM 测试基建——AC 以手测清单 + lint/test 兜底（与 09-09 任务验收方式一致）。

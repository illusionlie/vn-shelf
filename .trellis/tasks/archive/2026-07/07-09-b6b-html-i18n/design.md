# Design — B6b HTML 静态文案 i18n 迁移

## 架构与边界

```
public/js/i18n.js      # +applyI18nDom(root)：data-i18n 方言扫描应用（含 <template>.content 递归）
public/js/app.js       # +Alpine.magic('t')；两遍应用接线（同步遍 + initI18n().then 二遍）
public/*.html          # ~200 非注释中文行 → data-i18n 标注 / $t 表达式（模板内外统一用 data-i18n，
                       #   仅 11 处真动态表达式用 $t）
public/js/locales/*.js # zh-CN + en 双词典新增 ~130–160 键（zh 值 = 现字面量，等值替换）
public/js/api.js       # 全角冒号 8 处 → t('common.colon')（Q3 收编）
public/js/components/settingsPage.js  # toLocaleString 两处 → getLocale()（Q3 收编）
```

- **不引第三方库**（延续自托管原则）；扫描器 ~25 行，无依赖。
- layout.js 注入模板无中文（勘察确认），不动。

## data-i18n 方言（固定属性集，不做通用解析器）

| 标注 | 应用目标 |
|---|---|
| `data-i18n="key"` | `el.textContent = t(key)` |
| `data-i18n-placeholder="key"` | `placeholder` 属性 |
| `data-i18n-aria-label="key"` | `aria-label` 属性 |
| `data-i18n-title="key"` | `title` 属性 |
| `data-i18n-content="key"` | `content` 属性（meta description） |

- `<title>` 走 `data-i18n`（textContent 路径）。
- **叶子规则**：`data-i18n` 只标"无元素子节点"的元素（textContent 赋值会清空子树）；含 SVG 图标的按钮标注其内层文本 `<span>`。
- **与 Alpine 边界（PRD R5）**：同一节点/属性上 `x-text`/`:placeholder` 与 `data-i18n*` 互斥，动态绑定优先、不再标注。

## 关键决策：`<template>.content` 递归

勘察：84/200 的非注释中文行位于 `<template x-for/x-if>` 内（index 19/62、login 12/13、settings 18/65、stats 13/20、tier 22/40），而 `querySelectorAll` 不进 `template.content`。

- `applyI18nDom(root)` 对 `root.querySelectorAll('template')` 逐个递归处理 `tpl.content`（内容内再有 template 由递归覆盖）。
- **收益**：模板源头被翻译 → Alpine 克隆节点天然带出译文；模板内外统一 data-i18n 方言，不必"模板内改 $t"造成双方言。
- **竞态**：en 词典异步 import 期间 Alpine 可能已 boot——但 x-for 实际 stamp 都在数据 fetch 之后（≫ 本地模块 import），x-if 模态 stamp 在用户操作之后；再以**幂等二遍应用**兜底（键存于属性、不被消费，重复应用安全）。

## 启动时序与 FOUC（Q2 决策：then 链，容忍 en 短闪）

```js
// app.js（顺序敏感）
const i18nReady = initI18n();      // 不阻塞（维持现状）
injectShell();
applyI18nDom();                    // 第一遍：zh 用户即终态（中文→中文零观感）；en 用户先见中文
i18nReady.then(() => applyI18nDom());  // 第二遍：en 词典就绪后重写（含模板源头 + documentElement.lang）
```

- **禁用 top-level await**：app.js（module）TLA 不保证先于 alpine.min.js（defer classic）完成，Alpine 可能在 `alpine:init` 监听注册前启动 → 组件注册全丢。此为硬约束。
- zh-CN 默认用户零观感变化；en 用户首屏短暂中文闪现（本地静态资源 import，几十 ms 量级），记录为已知取舍。
- `applyI18nDom` 末尾同步 `document.documentElement.lang = getLocale()`。

## 内联表达式（11 处）：`Alpine.magic('t')`

- `alpine:init` 中注册 `Alpine.magic('t', () => t)`；表达式用 `$t('common.saving')`。
- 迁移映射示例：`'未知'`→`common.unknown`（已有）、`'保存中...'/'保存'`→`common.saving/common.save`（新增）、`'编辑 Tier'/'创建 Tier'`→`tier.editTier/tier.createTier`、`'已配置'/'未配置'`→`settings.configured/notConfigured`、aria 拼接 `' · 未分类'` 中 `'未分类'`→`$t('tier.untiered')`（`' · '` 为标点保持字面量）。

## 词典键命名

- 新增域：`nav.*`（跨页导航）、`meta.*`（5 个页 title + index description，整串成键不拼接）、按页域 `index.* / login.* / settings.* / stats.* / tier.*`；通用词优先复用/扩充 `common.*`。
- zh 值 = 现有字面量逐字复制（等值替换）；en 值风格与 B6a 一致（sentence case）。
- B6a 的 `i18n.keys.test.mjs`（双向相等 + 占位符一致）自动守护新键的 en 对齐——漏译即挂测试。

## Q3 收编项

- `common.colon`：zh `'：'` / en `': '`；api.js `friendlyErrorMessage` 8 处 `${prefix}：${msg}` → `${prefix}${t('common.colon')}${msg}`。
- `settingsPage.js` 两处 `toLocaleString('zh-CN', …)` → `toLocaleString(getLocale(), …)`（'zh-CN'/'en' 均合法 BCP-47）。

## 兼容与验证方法

- **zh 等值性**：zh-CN 模式五页走查零观感变化；等值替换无行为改动。
- **残留白名单**：迁移后 `grep -n '[一-鿿]' public/*.html` 非注释命中仅允许——语言分区 radio 的"简体中文"（B6a 决策：母语呈现，永不翻译）。其余中文残留=漏标。
- **失败语义**：键缺失时 `t()` 回退链兜底显示 zh-CN 并 console.warn——en 走查以"控制台零 missing-key"为验收信号。

## 取舍记录

- **data-i18n 扫描 vs 全 Alpine 绑定**（Q1）：选混合。~150 静态节点进 Alpine 响应图是纯开销，且 `<title>`/meta/html-lang 在 Alpine 作用域外；$t 魔法只服务真动态的 11 处。
- **then 链 vs 阻塞首绘**（Q2）：选 then 链。阻塞惩罚所有用户（含 zh 默认）几十 ms 并引入 JS 失败兜底复杂度，只为消除 en 首屏短闪，不值。
- **模板递归 vs 模板内改 $t**：选递归。单一方言 + 克隆天然继承；竞态由幂等二遍 + stamp 实际时序（数据 fetch 后）双重化解。
- **扫描器不做单测**：项目零依赖无 jsdom，DOM 逻辑以走查 + grep 白名单验收；扫描器保持 trivial（无状态、无分支复杂度）。

## 回滚

三段 commit，各自独立可 revert：
1. 机制：i18n.js applyI18nDom + app.js 接线/魔法（无 HTML 标注时是纯空转，零风险先行）。
2. 迁移：五页 HTML 标注 + 双词典键（可按页拆分提交粒度，回归时按页 revert）。
3. 收编：api.js 冒号 + settingsPage 日期 locale。

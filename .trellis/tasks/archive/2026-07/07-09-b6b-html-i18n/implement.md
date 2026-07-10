# Implement — B6b HTML 静态文案 i18n 迁移

> 前置阅读顺序：implement.jsonl 所列 spec → prd.md → design.md → 本清单。

## 有序执行清单

### 阶段 1：机制（commit 1 边界）

- [ ] 1.1 `public/js/i18n.js`：新增导出 `applyI18nDom(root = document)`
  - `[data-i18n]` → textContent；四个属性标记（placeholder / aria-label / title / content）→ setAttribute；
  - 递归 `root.querySelectorAll('template')` 的 `tpl.content`；
  - 末尾 `document.documentElement.lang = getLocale()`（仅顶层调用时设置一次即可，注意递归入参时不重复设置或设置幂等——直接每次设置也幂等，保持简单）；
  - JSDoc：方言表、叶子规则、幂等性、模板递归动机（84/200 在模板内）。
- [ ] 1.2 `public/js/app.js`：
  - `const i18nReady = initI18n();`（替换现裸调用，保持不 await——TLA 禁用，见 design"启动时序"）；
  - `injectShell()` 后加 `applyI18nDom()`；随后 `i18nReady.then(() => applyI18nDom());`
  - `alpine:init` 内注册 `Alpine.magic('t', () => t)`（import t from './i18n.js'）。
- [ ] 1.3 门禁：`npm run lint && npm run test`（此时无标注，机制空转零行为变化）。

### 阶段 2：词典 + 五页标注（commit 2 边界；页序由小到大控风险）

- [ ] 2.1 全量盘点：逐页枚举非注释中文 → 设计键名清单（nav.* / meta.* / 页域 / common.* 扩充），先落 `locales/zh-CN.js`（值=字面量逐字复制）与 `locales/en.js`（对齐翻译）。
- [ ] 2.2 `login.html` 标注（13 行，最小页先行验证机制）；`npm run dev` 双语走查本页。
- [ ] 2.3 `stats.html` 标注（20 行）。
- [ ] 2.4 `tier.html` 标注（40 行，含 11 处内联表达式中的 tier 部分：`$t('tier.editTier')` 等）。
- [ ] 2.5 `settings.html` 标注（65 行；注意"简体中文"radio 标签**不标注**——白名单项）。
- [ ] 2.6 `index.html` 标注（62 行，最大页；含 `<title>` + meta description、详情弹窗模板内标签）。
- [ ] 2.7 内联表达式收尾核对：11 处全部 `$t` 化（grep `x-text="[^"]*'[^']*[一-鿿]` 与 `:aria-label` 等应零命中）。
- [ ] 2.8 残留白名单检查：`grep -n '[一-鿿]' public/*.html` 非注释命中仅剩"简体中文"radio 一处。

### 阶段 3：Q3 收编项（commit 3 边界）

- [ ] 3.1 词典加 `common.colon`（zh `'：'` / en `': '`）；`public/js/api.js` 8 处拼接改 `${prefix}${t('common.colon')}${...}`。
- [ ] 3.2 `public/js/components/settingsPage.js` 两处 `toLocaleString('zh-CN', …)` → `toLocaleString(getLocale(), …)`（import 补 getLocale）。

## 验证命令

```bash
npm run lint && npm run test                     # 全绿（keys 单测自动守护双词典对齐）
grep -n '[一-鿿]' public/*.html | grep -v '<!--'  # 仅白名单：settings.html 的"简体中文"
grep -rn "window.setLocale" public/              # 保持零命中（B6a 状态不回退）
```

人工走查（`npm run dev`）：
- zh-CN 模式五页零观感变化（等值性）。
- en 模式五页：导航/标题/placeholder/option/aria/页面 `<title>` 全英文；F12 无 `[i18n] missing key`；`document.documentElement.lang === 'en'`。
- en 模式触发错误 toast 看分隔符 ": "；设置页缓存状态日期为英文格式。
- 详情弹窗（模板内标注的代表）双语各开一次。

## 风险文件与回滚点

- 高风险：`index.html`（62 行标注 + 详情弹窗模板）、`settings.html`（65 行）——按页独立走查后再进下一页。
- 回滚：三段 commit 各自可独立 revert；阶段 2 内若单页回归可按页粒度回退标注（词典多余键无副作用，回退不必同步删键）。
- 叶子规则违例症状：某元素子结构消失（textContent 覆写）——走查发现即回查该标注位置。

## start 前核对

- [x] prd.md 决策记录齐备（Q1–Q3）
- [x] design.md / implement.md 就位
- [ ] implement.jsonl / check.jsonl 已策展
- [ ] 用户 start 审查通过

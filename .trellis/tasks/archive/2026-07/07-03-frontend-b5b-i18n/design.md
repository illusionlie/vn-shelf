# Design — B5b 前端 i18n 框架接入

## 架构与边界

```
public/js/
├── i18n.js               # 核心：t() / setLocale() / getLocale() / initI18n()
└── locales/
    ├── zh-CN.js          # 默认词典（JS 模块，export default {...}，静态导入）
    └── en.js             # 留空框架（export default {}），切换时动态 import()
```

- **无构建步骤约束**：zh-CN 词典用 JS 模块而非 `.json`（import assertions 浏览器兼容性不稳，fetch 有异步竞态），静态导入保证 `t()` 首帧同步可用。
- **非默认语言懒加载**：`setLocale('en')` 时 `import('./locales/en.js')`，加载完成前继续用当前词典，失败回退 zh-CN 并 console.warn。
- **`translations.js`（VNDB tags 翻译）完全不动**——两套体系，i18n.js 不与其共享任何状态。

## API 契约

```js
t(key, params?)        // 'toast.indexStarted' + {total: 5} → '索引已启动，共5个条目'
setLocale(locale)      // 持久化 localStorage['locale'] + 加载词典；返回 Promise
getLocale()            // 当前 locale 字符串，默认 'zh-CN'
initI18n()             // 读 localStorage，非 zh-CN 则预载对应词典；app.js 启动时调用
```

- **key 命名**：`<域>.<语义名>`，扁平两级为主：`toast.*`、`status.*`（formatStatus）、`validation.*`、`confirm.*`、`common.*`（未知/失败等通用词）。词典对象嵌套两层，`t()` 按 `.` 逐层取。
- **插值**：`{name}` 占位符，`params` 缺失时保留占位符原样（便于发现漏传）。
- **回退链**：当前语言词典 → zh-CN 词典 → key 本身（并 console.warn 一次/每 key，防刷屏）。

## 数据流

1. `app.js` 顶部 `initI18n()`（在 Alpine 组件注册前，保证组件工厂内 `t()` 可用）。
2. 组件调用点：`addToast(t('toast.exportOk'))`、`formatStatus` map 值换 `t('status.idle')` 等——**t() 在事件触发/渲染时调用**，切语言后新产生的文案自然用新词典；已渲染文本刷新后生效（本轮无可见 UI，此语义足够）。
3. `friendlyErrorMessage`（api.js）的 code→文案映射表值迁 `t()`；**后端 4xx 中文 message 原样透传不翻译**——在 i18n.js 头部注释 + 映射表处注明边界（AC5）。

## 兼容与迁移

- 迁移是纯等值替换：zh-CN 词典值 = 现有字面量，行为零变化，AC7 走查防回归。
- HTML 静态文案本轮不迁（D1）；i18n.js 不需要 DOM 扫描能力，后续 HTML 批次再加 `data-i18n` 应用层（不影响本轮 API）。
- 后续加语言 = 新增 `locales/<locale>.js` 一个文件，零框架改动。

## 取舍记录

- **JS 模块词典 vs fetch JSON**：选 JS 模块。父 PRD 写"JSON 词典"，实际承载为 JS 模块内的 JSON 字面量——满足"自托管 + 词典数据化"意图，规避异步初始化竞态；已与 D3 决策对齐。
- **不做 Alpine 响应式 locale**：切语言即时重渲染需要 store 化 + 全组件改绑定，收益仅服务于"无刷新切换"，本轮无 UI 入口，不值得。刷新生效即可。
- **console.warn 缺 key 而非 throw**：文案缺失不应炸功能。

## 回滚

- 单 commit（或框架/迁移两 commit）；回归时 revert 迁移 commit 即回到硬编码字面量，i18n.js 留存无副作用。

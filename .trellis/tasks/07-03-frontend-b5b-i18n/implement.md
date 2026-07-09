# Implement — B5b 前端 i18n 框架接入

## 执行清单（有序）

### 阶段 1：框架

- [ ] 1.1 新建 `public/js/i18n.js`：`t()`（两级 key 取词 + `{name}` 插值 + 回退链 zh-CN→key + 缺 key warn 去重）、`setLocale()`（localStorage `locale` + 懒加载 `import('./locales/<l>.js')` + 失败回退）、`getLocale()`、`initI18n()`。
- [ ] 1.2 新建 `public/js/locales/zh-CN.js`（先空对象占位，阶段 2 逐文件填充）与 `public/js/locales/en.js`（`export default {}` + 注释说明留空框架）。
- [ ] 1.3 `app.js` 顶部调用 `initI18n()`（Alpine 组件注册前）。
- [ ] 1.4 单测 `tests/public/i18n.test.mjs`：取词、两级嵌套、插值、params 缺失保留占位符、缺 key 回退链、setLocale 持久化（mock localStorage）。

### 阶段 2：文案迁移（逐文件，每文件替换后 lint）

迁移顺序按调用面从小到大，词典 key 随迁随建：

- [ ] 2.1 `api.js` — code→文案映射表 8 条（`common.*`/`error.*`）+ `friendlyErrorMessage` 内兜底文案；**同点补 AC5 边界注释**（后端 4xx 中文 message 不翻译）。
- [ ] 2.2 `components/settingsPage.js` — `formatStatus` 7 态（`status.*`）、toast/校验文案（密码校验、导入导出、索引启动等，含 `共${total}个条目` 插值改造）。
- [ ] 2.3 `components/loginPage.js`、`components/statsPage.js` — 少量 toast/校验。
- [ ] 2.4 `components/vnShelf.js` — 表单校验 throw（游玩时长等）、toast。
- [ ] 2.5 `components/tierlistPage.js`、`components/confirmDialog.js`、`components/shared.js` — 确认对话框标题/正文、tier 操作 toast。
- [ ] 2.6 `utils.js`、`layout.js`、`theme.js`、`markdown.js`、`app.js` — 残余 UI 字面量（`formatUserPlayTime` 的单位词、layout 注入的文案等；纯注释不动）。
- [ ] 2.7 全局复查：`grep -nP "[\x{4e00}-\x{9fa5}]" public/js --include='*.js'`（LC_ALL=C.UTF-8）逐条确认剩余中文只在注释 / `locales/zh-CN.js` / `translations.js`（范围外）中。

### 阶段 3：验证

- [ ] 3.1 `npm run lint && npm run test` 全绿。
- [ ] 3.2 `npm run dev` 手工走查（AC7）：登录错误 toast、添加/编辑 VN 校验、tier 增删确认框、设置页索引状态/导入导出、统计页——zh-CN 文案与迁移前逐字一致。
- [ ] 3.3 控制台 `setLocale('en')` → 刷新 → 触发 toast：显示 zh-CN 回退且无 warn 之外的报错（AC3）；localStorage 持久化（AC4）。

## 验证命令

```bash
npm run lint
npm run test
npm run dev   # 手工走查
LC_ALL=C.UTF-8 grep -nP "[\x{4e00}-\x{9fa5}]" public/js/components/*.js public/js/api.js  # 迁移完整性抽查
```

## 风险文件与回滚点

- 高风险：`api.js`（friendlyErrorMessage 逻辑密集，只换字面量不动解析顺序）、`settingsPage.js`（插值改造）。
- 提交切分：阶段 1 一个 commit（框架+测试），阶段 2 一个 commit（迁移）；回归 revert 迁移 commit 即可，框架 commit 无行为影响。
- 每完成一个文件跑 `npm run lint`（项目规约）。

## start 前检查

- [ ] prd.md / design.md / implement.md 三件套齐备，用户已评审。
- [ ] `task.py start 07-03-frontend-b5b-i18n` 后才允许改代码。

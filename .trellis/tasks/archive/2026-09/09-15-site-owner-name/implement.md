# implement.md — 执行清单

前置：阅读 `.trellis/spec/backend/index.md` 与 `.trellis/spec/frontend/index.md` 指向的相关规范。每步后跑对应验证，全部完成后跑全量门禁。

## Step 1 后端字段贯通

- [ ] `src/repository.js`：`getSettings()` 默认对象加 `ownerName: ''`；`applyAppearanceToSettings()` 加 ownerName 防御性写入（trim + slice(0,30)）；`exportData()` appearance 加 `ownerName: settings.ownerName ?? ''`
- [ ] `src/router.js`：`handleGetAppearance()` 与 `handleGetConfig()` 返回 `ownerName`；`handleUpdateConfig()` 加校验（非 string → 400；trim 后 >30 → 400；否则 trim 落库）；`/api/import` appearance 校验段补 ownerName 规则（含 `null → ''` 归一）
- [ ] 验证：`node --test tests/router/config.update.test.mjs`（先补用例见 Step 4；本步可先跑存量不回归）

## Step 2 前端 site-identity 模块

- [ ] 新建 `public/js/site-identity.js`：`composeSiteName()` / `applySiteIdentity(config)` / `reapplySiteIdentity()` / `initSiteIdentity()`（镜像 theme.js init + `appearance-refreshed` 幂等监听形态；模块级 `_lastConfig`）
- [ ] `public/js/app.js`：import 接线；store `init()` 调 `initSiteIdentity()`；`i18nReady.then()` 回调改为 `applyI18nDom(); reapplySiteIdentity();`
- [ ] 验证：`npm run dev` 手查 index/tier/stats/settings/login 五页 banner 与 title

## Step 3 设置页 UI + tier.html 对齐 + i18n

- [ ] `public/settings.html`：外观区块加 ownerName 输入（maxlength 30，data-i18n 标注 label/placeholder）
- [ ] `public/js/components/settingsPage.js`：config 默认值 + 回填加 ownerName；`saveAppearanceConfig()` 提交 ownerName，成功后 `applySiteIdentity(cfg)` 即时生效
- [ ] `public/tier.html`：`<title>` 加 `data-i18n="meta.tierTitle"`
- [ ] `public/js/locales/zh-CN.js` + `en.js`：同步新增 `site.ownerTitle` / `settings.ownerNameLabel` / `settings.ownerNamePlaceholder` / `meta.tierTitle`（en 注意撇号转义风格与既有 key 一致）
- [ ] 验证：`node --test tests/public/i18n.keys.test.mjs`

## Step 4 测试用例

- [ ] `tests/router/config.update.test.mjs`：ownerName 设置成功（含 trim）/ 非字符串 400 / 超 30 字符 400 / GET appearance 与 GET config 返回字段（未配置时 ''）
- [ ] `tests/router/`：import 用例（appearance.ownerName 非法 400 / 合法生效 / 缺省跳过；落在既有 import 测试文件，若无则并入 config.update.test.mjs 风格新建）
- [ ] `tests/public/site-identity.test.mjs`：composeSiteName 四态——zh 词典 `{name} 的 VN Shelf`、setLocale('en') 后 `{name}'s VN Shelf`、空串/纯空白回退 `VN Shelf`（locale 切换手法参考既有 i18n.test.mjs）
- [ ] 验证：`npm run test` 全绿

## Step 5 全量门禁 + 手工复核

- [ ] `npm run lint`（新文件进 lint 范围：src/**/*.js + public/js/**/*.js）
- [ ] `npm run test` 全量
- [ ] 手工 AC 复核：AC1（设/清 ownerName 五页生效）、AC2（切语言刷新）、AC7（ownerName 填 `<img src=x>` 类文本仅按字面显示）

## 回滚点

- 每 Step 独立可 revert；无 schema/协议变更，revert 单 commit 即恢复。

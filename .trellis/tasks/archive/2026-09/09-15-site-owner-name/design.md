# design.md — ownerName 站点个性化

## 边界与契约

复用背景外观管线，新增一个纯文本字段，前后端各一处纯函数/纯模块承接组合逻辑。

### 数据流

```
settings.ownerName (D1 JSON blob)
  ├─ GET /api/config/appearance  → { ownerName, ... }（公开，max-age=300）
  ├─ GET /api/config             → 管理员设置页回填
  ├─ PUT /api/config             ← settingsPage.saveAppearanceConfig()
  ├─ exportData() appearance     → 导出 JSON
  └─ importData()/applyAppearanceToSettings ← 导入 JSON（router 先行 400 校验）
```

### 后端改动

| 位置 | 改动 |
|------|------|
| `src/repository.js` `getSettings()` 默认对象 | `ownerName: ''` |
| `src/repository.js` `applyAppearanceToSettings()` | `if (ap.ownerName !== undefined) settings.ownerName = String(ap.ownerName).trim().slice(0, 30)`（防御性二次裁剪） |
| `src/repository.js` `exportData()` appearance | `ownerName: settings.ownerName ?? ''` |
| `src/router.js` `handleGetAppearance()` | 返回 `ownerName: settings.ownerName || ''` |
| `src/router.js` `handleGetConfig()` | 同上 |
| `src/router.js` `handleUpdateConfig()` | `body.ownerName !== undefined` 时：非 string → 400 `ownerName 必须为字符串`；trim 后 >30 → 400 `ownerName 长度不能超过 30`；否则 trim 后写入 |
| `src/router.js` `/api/import` appearance 校验段 | 与 backgroundUrl 同风格：非 string → 400；trim 后 >30 → 400；`null` 归一 `''` |

校验风格说明：PUT /api/config 现有字段多为静默 coerce，但 ownerName 是面向用户展示的文本，错误早暴露优于静默截断，故采用显式 400（与 import 校验风格对齐）。30 字符上限：输入框 maxlength 同值；该常量仅后端强校验 + 前端软限制，不进 `constants.js`（非前后端协议契约，单端可独立演化）。

### 前端改动

**新模块 `public/js/site-identity.js`**（镜像 theme.js 的 init/listener 双保险形态）：

```js
export function composeSiteName(ownerName) {
  const name = String(ownerName || '').trim();
  return name ? t('site.ownerTitle', { name }) : 'VN Shelf';
}
export function applySiteIdentity(config) {
  const siteName = composeSiteName(config?.ownerName);
  // banner（四页）+ 登录页大标题，纯 textContent
  document.querySelectorAll('.banner-title, .login-title')
    .forEach(el => { el.textContent = siteName; });
  // <title>：取 title 元素自身 data-i18n key 重取词后做品牌段替换
  const titleEl = document.querySelector('title');
  const key = titleEl?.getAttribute('data-i18n');
  if (key) document.title = t(key).replaceAll('VN Shelf', siteName);
}
export async function initSiteIdentity() { /* await loadAppearance → apply；绑定 appearance-refreshed（幂等一次）*/ }
```

设计决策：

1. **站点名组合是纯函数** `composeSiteName(ownerName)`（依赖当前词典的 `t`），便于 node --test 直接单测（zh/en 两格式）。i18n `t()` 原生支持 `{name}` 插值，无需扩展 applyI18nDom。
2. **`<title>` 品牌段替换而非重构 meta key**：`meta.*Title` 保留现有文案与 `data-i18n` 静态应用路径（zh 默认用户零额外 JS 依赖），`replaceAll('VN Shelf', siteName)` 在 applyI18nDom 之后执行。替换目标是两典中固定的品牌 token；ownerName 为空时 siteName 即「VN Shelf」，替换为幂等 no-op。执行时机三处覆盖：`initSiteIdentity()`（appearance 就绪后）、`i18nReady.then()` 第二遍词典重写后（en 懒加载会重写 title，需重放）、`appearance-refreshed` 事件（跨标签页静默刷新）。
3. **banner/login-title 无 data-i18n**（品牌名硬编码先例，见 layout.js 头注），由 site-identity 独占写入，不存在与 i18n 扫描的竞争。
4. **XSS**：全程 `textContent` / `document.title` 赋值，无 innerHTML；后端限长 30 + trim。

**`public/js/app.js`**：store `init()` 中 `initBackground()` 旁增调 `initSiteIdentity()`（import 接线）；`i18nReady.then()` 回调内在 `applyI18nDom()` 后补一次重放。时序要点：i18n 词典就绪回调触发时 Alpine store 可能尚未初始化（app.js 先于 alpine.min.js 执行，见 app.js 头注），因此 site-identity 模块自持模块级 `_lastConfig`（applySiteIdentity 每次写入），i18n 重放路径 `reapplySiteIdentity()` 用缓存配置重算，不读 store——绕开执行顺序假设。

**`public/js/components/settingsPage.js`**：`config` 默认值与 GET 回填加 `ownerName`；`saveAppearanceConfig()` 提交体加 `ownerName`，保存成功后 `loadAppearance({force:true})` 返回值除背景外同喂 `applySiteIdentity(cfg)`。

**`public/settings.html`**：外观区块新增 label + input（`maxlength="30"`、autocomplete off、占位文案 i18n key）。

**tier.html 标题对齐**：`<title>` 加 `data-i18n="meta.tierTitle"`；两典补 key（zh/en 均 `Tier List - VN Shelf`，Tier List 为品牌式导航词，与 header 硬编码先例一致）。

**i18n key 清单**（两典同步，parity 测试强制）：

| key | zh-CN | en |
|-----|-------|-----|
| `site.ownerTitle` | `{name} 的 VN Shelf` | `{name}'s VN Shelf` |
| `settings.ownerNameLabel` | 站点主人名 | Owner name |
| `settings.ownerNamePlaceholder` | 如：小明；留空显示「VN Shelf」 | e.g. Alice; empty shows "VN Shelf" |
| `meta.tierTitle` | Tier List - VN Shelf | Tier List - VN Shelf |

## 兼容与回滚

- 旧导出 JSON 无 `ownerName` → import 校验跳过（`!== undefined` 门），行为不变。
- 旧前端 + 新后端：appearance 多返回一个字段，忽略无害。
- 未配置任何 ownerName 时全链路输出与现状逐字节一致（空串走回退分支）。
- 回滚：revert 单 commit 即可，无 schema/协议变更。

## 测试设计

- `tests/router/config.update.test.mjs`：PUT ownerName 合法（trim/边界 30）/非字符串 400/超长 400；GET appearance 与 config 返回字段。
- `tests/router/`（import 用例所在文件）：appearance.ownerName 非法 400、合法生效、缺省跳过。
- `tests/public/`：新增 site-identity 组合纯函数测试（zh/en/空串/空白串）；i18n parity 由既有测试自动覆盖新 key。

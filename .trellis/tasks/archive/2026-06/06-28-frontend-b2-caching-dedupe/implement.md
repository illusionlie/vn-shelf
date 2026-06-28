# Implement — B2 前端缓存与重复消除

> 5 步独立交付，按"低风险→中风险"顺序：withLoading(纯抽象) → debounce → IDB 缓存 → version 节流 → appearance Store。每步独立提交，便于回滚。
> 复杂度：T2-A4/P1/P3/S 简单；T2-P2 中；T2-A2 L（跨 theme/shared/store 三处）。

## Step 0 — 前置约定

- 不引入构建步骤、不引入第三方库。
- `sessionStorage`/`localStorage` 键统一前缀 `vn-shelf:` + 版本号，如 `vn-shelf:appearance:v1`、`vn-shelf:trans:versionCheckAt`.
- 遵守 spec：禁 runtime CDN、禁 `{...options}` 后置 headers 合并、禁 `Date.now()` 做 id。
- 每步附 lint/test；Review Gate 通过再进下一步。

## Step 1 — withLoading 抽象 + settings 四处改造（T2-A4）

1.1 `public/js/utils.js` 新增 `withLoading(ctx, asyncFn, { successMsg, errorPrefix })`：
```js
export async function withLoading(ctx, asyncFn, { successMsg = '', errorPrefix = '操作失败' } = {}) {
  ctx.isLoading = true;
  try {
    const result = await asyncFn();
    if (successMsg) ctx.$store?.app?.addToast(successMsg);
    return result;
  } catch (error) {
    console.warn('[withLoading]', { errorPrefix, error: error?.message || String(error) });
    ctx.$store?.app?.addToast(`${errorPrefix}: ${error?.message || error}`, 'error');
  } finally {
    ctx.isLoading = false;
  }
}
```
约定：`ctx` 为组件实例（含 `isLoading` 与 `$store`）。

1.2 `public/js/components/settingsPage.js` 改造四处：
- `saveVndbToken`(~123)：核心 async 逻辑保留（含成功后清空 token 字段、跳转/特定文案），用 withLoading 包裹主体；保留 saveVndbToken 成功后的额外副作用（如清空 `this/vndbApiToken`）。
- `changePassword`(~139)：含前后校验（空密码、两次不一致、长度），校验在 withLoading 之外前置；核心 await 包入。
- `saveTagsConfig`(~289)：含成功后 `initTranslations` + `loadTranslationCacheStatus` 副作用——保留副作用逻辑，把 `configAPI.update` 与副作用一起放进 asyncFn。
- `saveAppearanceConfig`(~334)：最简单，直接包裹。
- 保留每处的现有 toast 文案（如"Tags 设置已保存"）作为 `successMsg`，error 统一用 withLoading 的 `errorPrefix`（与原文一致，如"保存失败"）。

**验证**：
```bash
grep -n "isLoading = true" public/js/components/settingsPage.js   # 期望显著减少（理想 0）
grep -n "withLoading" public/js/components/settingsPage.js          # 期望 4 处调用
npm run lint && npm run test
```
**Review Gate G1**：AC7 满足、行为不变（人工核对 toast 文案）。

## Step 2 — debounce + 搜索防抖（T2-P1）

2.1 `public/js/utils.js` 新增 `debounce(fn, ms=200)`（trailing，返回时绑定 `this` 与 args）：
```js
export function debounce(fn, ms = 200) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
```

2.2 `public/js/components/vnShelf.js`：在 `init()` 或字段初始化处把 `handleSearch` 包裹为防抖版本。两种方案取其一：
- 方案 A（推荐，改动小）：构造期定义 `this.debouncedSearch = debounce(() => this.handleSearch(), 200)`，HTML `@input` 改为 `debouncedSearch()`。但需改 `index.html:100`。
- 方案 B：直接把 `handleSearch` 内部逻辑防抖——需保存 `this.filteredList`，Alpine 响应式仍生效。

采用方案 A：`vnShelf.js` 组件对象中追加 `debouncedSearch` 方法（在 init 里赋值 `this.debouncedSearch = debounce(this.handleSearch.bind(this), 200)`），`index.html:100` `@input="handleSearch()"` 改为 `@input="debouncedSearch()"`。

**验证**：进首页连续快打 5 字，过滤只在停顿后触发一次（console 计数或 DOM 行为）。
```bash
npm run lint && npm run test
```
**Review Gate G2**：AC4 满足。

## Step 3 — IndexedDB 连接缓存（T2-P3）

3.1 `public/js/translations.js` 模块作用域加：`let _db = null;`
3.2 改 `openTranslationsDB`：
```js
async function openTranslationsDB() {
  if (_db) return _db;
  // 原有 indexedDB.open 流程，onsuccess 中:
  //   _db = request.result;
  //   _db.onclose = () => { _db = null; };
  //   _db.onversionchange = () => { _db.close(); _db = null; };
  // 返回 _db
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRANSLATIONS_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
        db.createObjectStore(TRANSLATIONS_STORE, { keyPath: 'key' });
      }
    };
  });
}
```

**验证**：多次 `getFromIndexedDB` 只触发一次 `onsuccess`（console 埋点或行为检查）。
```bash
npm run lint && npm run test
```
**Review Gate G3**：AC6 满足。

## Step 4 — translations version.json 节流（T2-P2）

4.1 `public/js/translations.js` 常量：`const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000;` 与键 `vn-shelf:trans:versionCheckAt`。

4.2 `checkForUpdatesInBackground` 入口先查节流：
```js
async function checkForUpdatesInBackground(translationUrl, currentVersion) {
  const lastAt = Number(localStorage.getItem('vn-shelf:trans:versionCheckAt') || 0);
  if (Date.now() - lastAt < VERSION_CHECK_TTL_MS) {
    return; // 24h 内跳过远端检查
  }
  localStorage.setItem('vn-shelf:trans:versionCheckAt', String(Date.now()));
  // ...原有 versionUrl fetch + 比对 + 下载更新逻辑不变
}
```
注意：先标记检查时间再发请求，发起即计费，避免失败时反复重试。`cached.sourceUrl !== translationUrl`（URL 变更强制下载路径）不受节流影响（那分支不进 checkForUpdates）。

**验证**：连续进多个页面、24h 内 `version.json` 无请求；手动改 `localStorage` 时间戳为 0 后再进，触发一次。
```bash
npm run lint && npm run test
```
**Review Gate G4**：AC5 满足。

## Step 5 — appearance 全局缓存（T2-A2，最复杂）

5.1 `public/js/app.js` Store 扩展：
```js
Alpine.store('app', {
  isAdmin: false,
  isLoading: false,
  toasts: [],
  _initialized: false,
  appearance: null,
  _appearancePromise: null,
  // ...原有 init/checkAuth/addToast...

  async loadAppearance({ force = false } = {}) {
    if (force) {
      this.appearance = null;
      this._appearancePromise = null;
    }
    if (this.appearance) return this.appearance;
    if (this._appearancePromise) return this._appearancePromise;

    const doLoad = (async () => {
      // sessionStorage 直读
      const cachedRaw = sessionStorage.getItem('vn-shelf:appearance:v1');
      if (cachedRaw && !force) {
        try {
          const cached = JSON.parse(cachedRaw);
          this.appearance = cached;
          // 后台静默刷新（不阻塞返回）
          this._refreshAppearanceBackground();
          return cached;
        } catch { /* fallthrough */ }
      }
      try {
        const res = await configAPI.getAppearance();
        const data = res.data || {};
        this.appearance = data;
        sessionStorage.setItem('vn-shelf:appearance:v1', JSON.stringify(data));
      } catch (error) {
        console.warn('[app] load appearance failed', error?.message || String(error));
        this.appearance = {};
      }
      return this.appearance;
    })();

    this._appearancePromise = doLoad;
    try { return await doLoad; } finally { this._appearancePromise = null; }
  },

  async _refreshAppearanceBackground() {
    try {
      const res = await configAPI.getAppearance();
      const data = res.data || {};
      this.appearance = data;
      sessionStorage.setItem('vn-shelf:appearance:v1', JSON.stringify(data));
      // 通知 theme 重新应用
      window.dispatchEvent(new CustomEvent('appearance-refreshed', { detail: data }));
    } catch { /* silent */ }
  }
});
```
注意 `configAPI` 需 import（app.js 已 import `authAPI`，补 `configAPI`）。

5.2 `public/js/theme.js` `initBackground` 改为从 Store 读：
```js
export async function initBackground() {
  try {
    const cfg = await Alpine.store('app').loadAppearance();
    setBackgroundConfig(cfg);
    applyBackground(cfg);
  } catch (error) { console.warn('[theme] initBackground', error); }
}
```
监听 `appearance-refreshed` 事件以响应后台刷新。

5.3 `public/js/components/shared.js` `loadConfig` 改为从 Store 读 appearance（tags 视图只需 tagsMode/translateTags/translationUrl 字段）：
```js
async loadConfig() {
  const cfg = await this.$store.app.loadAppearance();
  this.config = {
    tagsMode: cfg.tagsMode ?? DEFAULT_TAGS_CONFIG.tagsMode,
    translateTags: cfg.translateTags ?? DEFAULT_TAGS_CONFIG.translateTags,
    translationUrl: cfg.translationUrl ?? ''
  };
}
```

5.4 `public/js/components/settingsPage.js` `loadConfig` 同样改从 Store 读（appearance/tab 用字段），且 `saveAppearanceConfig` / `saveTagsConfig` 成功后调用 `this.$store.app.loadAppearance({ force: true })` 让缓存失效刷新。

5.5 settings 保存外观后立即应用：`applyBackground` 用 Store 新数据。

**验证**：
```bash
# 首页 Network 面板：进首页仅 1 条 /api/config/appearance（其余从 sessionStorage）
# 切到 tier/settings/stats 页：无额外 appearance 阻塞请求（仅或后台静默）
npm run lint && npm run test
```
**Review Gate G5**：AC1/AC2/AC3 满足。

## Step 6 — 端到端冒烟

6.1 `npm run dev`。
6.2 走查：
- 首页搜索防抖（停顿后过滤）、排序正常。
- 设置页 4 个 Tab 保存（token、密码、tags、外观）行为与文案一致；外观保存后立即生效且其它页刷新保持。
- Tier / 统计页正常渲染，背景图正常。
- tags 翻译正常（VNDB 模式）。
- DevTools Network 确认 appearance 单页单请求、跨页命中缓存；24h 内 version.json 无重复。
6.3 清 sessionStorage 与 localStorage 后冷启动一次确认 fallback 路径无报错。

**Review Gate G6**：AC8/AC11 满足。

## 验收门禁

```bash
npm run lint && npm run test
```
任一红回到对应 Step。

## 回滚点

- Step1：还原 settingsPage 四处手动 isLoading、删 utils.withLoading。
- Step2：还原 index.html `@input="handleSearch()"`、删 utils.debounce 与 vnShelf.debouncedSearch。
- Step3：还原 translations.js openTranslationsDB 无缓存版本。
- Step4：还原 checkForUpdatesInBackground 无节流版本。
- Step5：还原 app.js 无 appearance 字段、theme.js/shared.js/settingsPage.js 各自请求 getAppearance。
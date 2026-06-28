# Implement — B1 前端健壮性与供应链修复

> 顺序执行，每步附验证命令；通过 Review Gate 后再进入下一步。
> 三个交付物彼此独立，按"自托管 Alpine → headers bug → toast id"顺序，便于分提交回滚。

## Step 0 — 前置约定

- 不引入构建步骤；vendor 静态文件直接放 `public/js/vendor/`。
- 锁定 Alpine 版本：取 3.14.x 最新稳定 patch（实现时确认 npm 上的最新 `3.14.x`）。
- 提交粒度：3 个逻辑提交（vendor 引入 + HTML 切换 / headers 修复 / toast id 修复）。

## Step 1 — 自托管 Alpine（T1-S1）

1.1 从官方渠道下载锁定版本的 `cdn.min.js`（minified UMD/ESM 构建均可，文件名统称 `alpine.min.js`），写入 `public/js/vendor/alpine.min.js`。
1.2 在 `package.json` 记录锁定版本（如 `"alpineVersion": "3.14.x"`）于根级或 `dependencies.meta`；新增 `scripts.fetch:vendor`（`curl`/`node` 下载脚本，写入 vendor 目录）。若无网络执行环境，至少把"下载来源 URL + 目标 sha256"注释进 `package.json` 或新建 `public/js/vendor/README.md`。
1.3 修改五个 HTML：
  - `public/index.html:10`
  - `public/login.html:9`
  - `public/settings.html:9`
  - `public/stats.html:9`
  - `public/tier.html:9`
  将 `https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js` 改为 `/js/vendor/alpine.min.js`，保留 `defer`。

**验证**：
```bash
grep -rn "cdn.jsdelivr" public/*.html           # 期望无输出
grep -n "/js/vendor/alpine.min.js" public/*.html # 期望 5 处
ls -l public/js/vendor/alpine.min.js            # 期望存在且非空
```

**Review Gate G1**：AC1–AC4 满足。

## Step 2 — 修复 headers 合并顺序（T1-B1）

2.1 `public/js/api.js:33-39`，将：
```js
const config = {
  headers: { 'Content-Type': 'application/json', ...options.headers },
  ...options
};
```
改为：
```js
const config = { ...options };
config.headers = {
  'Content-Type': 'application/json',
  ...(options.headers || {})
};
```
2.2 通读 `apiRequest` 其余逻辑（`body` 序列化、`fetch`、错误抛出）确认无副作用被破坏。

**验证**：
```bash
npm run lint
npm run test
```
建议在 `api.js` 旁或临时控制台手测：`apiRequest('/vn', { headers: { 'X-Test': '1' } })` 实际请求头应同时含 `Content-Type: application/json` 与 `X-Test`。

**Review Gate G2**：AC5、AC7、AC8 满足。

## Step 3 — 修复 Toast id 碰撞（T1-B2）

3.1 `public/js/app.js`：在 `document.addEventListener('alpine:init', ...)` 回调外的模块作用域或 Store 内引入递增计数器：
```js
let _toastSeq = 0;
// addToast 中：
const id = ++_toastSeq;
```
（或 `const id = crypto.randomUUID()`；二选一，递增计数器更小且确定性可断言。）
3.2 `addToast`/`removeToast` 其余逻辑不变。

**验证**：
```bash
npm run lint
npm run test
```
手动：连续两次 `Alpine.store('app').addToast('a'); Alpine.store('app').addToast('b');` 立即比对 `toasts` 中 `id`不等。

**Review Gate G3**：AC6–AC8 满足。

## Step 4 — 端到端冒烟

4.1 `npm run dev` 启动本地 Worker。
4.2 走查：首页 VN 列表加载与详情弹窗、登录页、设置页各 Tab、Tier 页拖拽、统计页 Mounting 均渲染正常（Alpine `x-data` 仍生效）。
4.3 确认无 console 报 `Alpine is not defined` 或 vendor 404。

**Review Gate G4**：AC9 满足。

## 验收门禁（全量）

```bash
npm run lint && npm run test
```
任一红 → 回到对应 Step 修复，不进入提交。

## 回滚点

- Step1 回滚：恢复 5 HTML 的 CDN 引用 + 删除 `public/js/vendor/alpine.min.js` + 还原 `package.json`。
- Step2 回滚：还原 `api.js` 合并顺序。
- Step3 回滚：还原 `app.js` toast id 为 `Date.now()`。
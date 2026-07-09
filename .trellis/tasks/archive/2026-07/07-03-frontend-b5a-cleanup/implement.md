# Implement — B5a 前端工程化清理

> 5 步独立交付，按风险从低到高：constants → 进度条单轨 → Tier 分片并行 → 删 stats 兜底（含后端 stats 信封统一）→ computeTierDiff 单测 + markdown 语法测试。每步独立提交。
> 关键契约已核：`apiRequest` 返回整个解析后 JSON 对象；`handleGetStats` 走 `jsonResponse(list.stats)` 返回裸 stats 不裹 success/data，故 `statsPage.js:25` 用 `res.data || res` 兜底。B5a 顺手把后端 stats 改 `successResponse(stats)` 统一信封再前端删兜底——闭环 A3 一处。

## Step 0 — 前置约定

- 不引入第三方库；仅改 `public/js/`、`tests/`、`src/router.js`（仅 stats 信封一处）、`docs/`。
- 保持行为不变：Tier 提交结果、进度条视觉、stats 显示、魔法字符串值、其它接口信封。
- 遵守 sedimented spec。
- 每步附 lint/test；Review Gate 通过再进下一步。

## Step 1 — constants.js 统一魔法字符串（T5-M2）

1.1 新增 `public/js/constants.js`：
```js
/**
 * 前端共享常量。值须与后端约定一致（后端独立定义，跨边界无 import）。
 */
export const UNTIERED_KEY = '__untiered__';
export const DEFAULT_TIER_COLOR = '#ff4757';
// 与后端 src/router.js:35 MAX_BATCH_TIER_UPDATES 同源约定，勿单独修改。
export const MAX_BATCH_TIER_UPDATES = 200;
```

1.2 `public/js/components/tierlistPage.js`：
- import `{ UNTIERED_KEY, DEFAULT_TIER_COLOR, MAX_BATCH_TIER_UPDATES }` from `../constants.js`
- 删组件内 `MAX_BATCH_TIER_UPDATES: 200` 字段，引用导入常量（注意原代码多处 `this.MAX_BATCH_TIER_UPDATES`，需全部改为导入常量）
- `tierForm.color: '#ff4757'`（line 26/192/205）改 `DEFAULT_TIER_COLOR`
- 所有 `'__untiered__'` 字符串（163/167/352/557/564）改 `UNTIERED_KEY`

**验证**：
```bash
grep -rn "'__untiered__'\|#ff4757\|MAX_BATCH_TIER_UPDATES.*200\|MAX_BATCH_TIER_UPDATES: 200" public/js/components/tierlistPage.js   # 仅余 import 行
npm run lint && npm run test
```
**Review Gate G1**：AC5 满足。

## Step 2 — 进度条单轨逻辑（T5-P6）

2.1 `public/js/utils.js initProgressBar` 重写为单源：
```js
export function initProgressBar() {
  const progressBar = document.querySelector('.loading-progress-bar');
  const progressFill = progressBar?.querySelector('.progress-fill');
  if (!progressFill) return;

  // 守卫：避免 bfcache 重现或重复 init 时已完成却再启动进度动画
  if (progressBar.classList.contains('hidden')) return;

  let progress = 0;
  let finished = false;
  const interval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 90) { progress = 90; clearInterval(interval); }
    progressFill.style.width = progress + '%';
  }, 200);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(interval);
    progressFill.style.width = '100%';
    setTimeout(() => { if (progressBar) progressBar.classList.add('hidden'); }, 500);
  };

  // 主源 1：window load
  if (document.readyState === 'complete') {
    finish();
  } else {
    window.addEventListener('load', finish, { once: true });
  }
  // 主源 2：bfcache 前进后退触发 pageshow（含 persisted）
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) finish();
  }, { once: true });
  // 兜底：极端情况下 5s 强制完成（原 3s 双轨改单兜底，且一次性）
  setTimeout(finish, 5000);
}
```
注：`{ once: true }` 监听器保证不重复；`finished` 守卫保证 finish 只执行一次，任何源先到都拔掉其它。

**验证**：刷新、前进后退（bfcache）进度条正确隐藏；无 console 报错。
```bash
npm run lint && npm run test
```
**Review Gate G2**：AC2 满足。

## Step 3 — Tier 分片并行提交（T5-P4）

3.1 `tierlistPage.js applyTierBatchUpdates` 原 `for` 串行 await 改 `Promise.all`：
```js
async applyTierBatchUpdates(payloads) {
  // 分片：每个 chunk 互不相交（扁平 payloads 列表切片），并行提交安全；
  // 顺序语义：各片独立落库，最终全片结果一致。
  const chunks = [];
  for (let i = 0; i < payloads.length; i += MAX_BATCH_TIER_UPDATES) {
    chunks.push(payloads.slice(i, i + MAX_BATCH_TIER_UPDATES));
  }
  await Promise.all(chunks.map(chunk => vnAPI.updateTierBatch(chunk)));
  // 失败回滚沿用调用方 loadVNList（applyDrop 内已有 catch）
},
```
注意：原逻辑若分片内逐个 await 是为了某依赖，需核读原代码确认无依赖——payloads 是扁平 `{id, tierId, tierSort}[]`，各片独立落库无相互依赖，并行安全。

3.2 核对 `applyDrop` 调用方仍能在失败时 catch + `loadVNList` 回滚；并行后任一 chunk 失败 reject 整体 Promise，`applyDrop` catch 触发回滚——行为与串行一致（串行任一失败也会 reject）。

**验证**：批量拖拽 200+ VN 排序正确；耗时下降（无精确测量门槛，代码审查为主 + 单测覆盖结果不变）。
```bash
npm run lint && npm run test
```
**Review Gate G3**：AC1 满足。

## Step 4 — 删 stats 兜底（T5-M3，含后端 stats 信封统一）

4.1 `src/router.js handleGetStats` 改信封统一：
```js
async function handleGetStats(request, env) {
  const list = await getVNList(env);
  return successResponse(list.stats);
}
```
注意 `successResponse` 已 import 于 `router.js`（核读确认；若未 import 则补）。

4.2 `public/js/components/statsPage.js`：
```js
const res = await statsAPI.get();
this.stats = res.data;   // 删 `|| res` 兜底
```

4.3 文档 `docs/frontend-improvements.md`：在 A3 / T5-M3 项旁标注本次闭环 stats 一处；其它接口信封若仍有不一致，留观察项（B5a 不全量扫描其它接口）。

4.4 核对：其它前端调用 `apiRequest` 处对各自返回的解包形态假设未变（仅 stats 一处改，不影响其它）。

**验证**：
```bash
grep -n "res\.data || res\||| res" public/js/   # 仅余注释或无关
npm run lint && npm run test
```
**Review Gate G4**：AC6 满足；stats 页显示与原先一致（数据形态：`list.stats` 经 `successResponse` 裹为 `{success,message,data:stats}`，前端取 `res.data`=stats）。

## Step 5 — computeTierDiff 纯函数化 + 单测 + markdown 语法测试（T5-M1）

5.1 `tierlistPage.js applyDrop` 抽 `computeTierDiff` 纯函数：
- 把 `applyDrop` 内"基于 allVN/draggedId/targetTierKey/insertIndex 计算 payloads 数组"的逻辑提为模块级纯函数（不访问 `this`），返回 `payloads`（不调用 API）。
- `applyDrop` 改为先 `const payloads = computeTierDiff({ allVN: this.allVN, draggedId, targetTierKey, insertIndex })`，再 `await this.applyTierBatchUpdates(payloads)`。
- 把 `computeTierDiff` 单独 `export`（供测试 import），或放到新 `public/js/utils/tier-diff.js` 模块（推荐后者，便于测试 import）。**选 `public/js/tier-diff.js`**（与 `utils.js`、`api.js` 同级，便于 `tests/` import）。

5.2 新增 `tests/public/tier-diff.test.mjs`：覆盖 5 场景：
- 同 tier 内排序（A tier 内把 vn3 拖到 vn1 前）
- 跨 tier 移动（A→B）
- 移到 untiered（A→`UNTIERED_KEY`）
- 边界（移到 tier 首位/末位/空 tier）
- 批量超 200：构造 250 个 payloads 确认分片边界正确（仅测 computeTierDiff 输出，不测 applyTierBatchUpdates）

5.3 新增 `tests/public/markdown.syntax.test.mjs`：markdown 语法正确性快照测试——粗体/斜体/删除线/链接/图片/无序有序列表/代码块（带语言+无语言）/引用/表格/分割线，断言输出含对应标签与 class（与 B4 安全测试互补，不重复安全用例）。`renderMarkdown` 导入沿用 `markdown.security.test.mjs` 的 in-place 模式。

5.4 `package.json` 不动（`node --test` 自动发现 `tests/**/*.mjs`）。

**验证**：
```bash
npm run test   # 含新增 tier-diff + markdown.syntax
npm run lint
```
**Review Gate G5**：AC3/AC4 满足。

## Step 6 — 端到端冒烟

6.1 `npm run dev`。6.2 走查：
- Tier 拖拽批量重排（200+ 条目）结果正确、无 console 报错。
- 进度条刷新/前进后退正确隐藏。
- 统计页数据显示与原先一致（后端信封改动后）。
- 五页面无 console 报错。

**Review Gate G6**：AC9 满足。

## 验收门禁

```bash
npm run lint && npm run test
```
任一红回到对应 Step。

## 回滚点

- S1：删 constants.js、还原 tierlistPage.js 硬编码。
- S2：还原 initProgressBar 双轨版本。
- S3：还原 applyTierBatchUpdates 串行版。
- S4：还原 handleGetStats 为 `jsonResponse(list.stats)`、statsPage.js `|| res` 兜底。
- S5：删 tier-diff.js + 两个新增测试，applyDrop 还原内嵌 diff 逻辑。
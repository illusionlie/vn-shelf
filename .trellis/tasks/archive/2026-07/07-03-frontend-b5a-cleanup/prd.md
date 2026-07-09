# PRD — B5a 前端工程化清理

> 父任务：`.trellis/tasks/07-03-frontend-b5-engineering/prd.md`。
> 范围：B5 中的 S/M 清理项集合（P4/P6/M1/M2/M3-前端侧），五个独立交付物。

## 背景

B1–B4 完成供应链/缓存/可达性/安全后，B5a 收口一组低风险工程化清理：Tier 批量提交串行可并行、进度条双轨可单轨、Tier 拖拽 diff 逻辑无单测、魔法字符串散落、`|| res` 兜底遗存。各自独立无功能变更，提升可维护性与回归保护。

## 现状修正（经核读代码后比 docs 侦察更准确）

- **`applyTierBatchUpdates` 串行 await**（`tierlistPage.js:543` `for` 串行）——各 chunk 之间无依赖（同一批 payloads 内顺序仅决定哪批先落库，最终结果一致），可并行。但需确认同 VN 不跨片（payloads 是扁平 list，每片互不相交），并行安全。
- **`initProgressBar` 双轨**（`utils.js`）：`window.addEventListener('load')` + 3s `setTimeout` 兜底并存，可能重复 clearInterval + 误判隐藏时机。`pageshow` bfcache 未处理。
- **`statsPage.js:25` `res.data || res`**：根因经核读 `src/router.js:1072 handleGetStats` 走 `jsonResponse(list.stats)` 即**裸 stats 对象**不裹 `{success,data}`，故 `apiRequest` 解包后 `res`=stats 裸对象、`res.data`=undefined、`|| res` 兜底取 stats。这是**后端信封不统一（A3）**的实证。B5a 前端侧只能删 `|| res` 兜底改用 `res`，但根治须后端 `/api/stats` 改 `successResponse(stats)`——**后端项单独立任务**，B5a 仅做前端兜底删除 + 文档记录此债。
- **魔法字符串**：`__untiered__`（`tierlistPage.js:163/167/352/557/564`）、`#ff4757` 默认色（`tierlistPage.js:26/192/205` + `src/repository.js:15` tier-s 默认色）、`MAX_BATCH_TIER_UPDATES=200`（前端 `tierlistPage.js:39` vs 后端 `src/router.js:35` 各自定义，未同源）。
- **`computeTierDiff` 现存**：`grep` 无；onDrop/applyDrop 的 diff 逻辑内嵌于方法体内（`tierlistPage.js:~560` `applyDrop`），抽纯函数即可单测。

## 目标（5 个独立可验证交付物）

### 1. Tier 分片并行提交（T5-P4）
- `tierlistPage.js applyTierBatchUpdates` 串行 await 改 `Promise.all`，保持 chunk 边界互不相交；失败回滚沿用 `loadVNList`。
- 顺序语义不变：扁平 payloads 列表分片后各片独立落库，最终全片结果一致。

### 2. 进度条单轨逻辑（T5-P6）
- `utils.js initProgressBar` 改单源：`window.addEventListener('load')` + `pageshow`（bfcache 前进后退）双挂，去掉 3s `setTimeout` 兜底双轨；若 `document.readyState === 'complete'` 已过则立即完成。
- 消除双 setInterval 误删风险。

### 3. `computeTierDiff` 纯函数化 + 单测（T5-M1）
- `tierlistPage.js applyDrop` 内的 diff 计算（拖拽前后 payload 生成）抽为纯函数 `computeTierDiff({ allVN, draggedId, targetTierKey, insertIndex })` 返回 `payloads` 数组，无副作用。
- `tests/` 新增 `tests/public/tier-diff.test.mjs`（或并入既有 `tests/` 结构）覆盖：同 tier 排序、跨 tier 移动、移到 untiered、边界（首/尾/空 tier）、批量超 200 分片边界。
- 另：`tests/public/markdown.syntax.test.mjs`（新）做 markdown 语法正确性快照测试（粗体/斜体/链接/图片/列表/代码块/引用/表格/分割线），与 B4 的安全测试互补。

### 4. `constants.js` 统一魔法字符串（T5-M2）
- 新增 `public/js/constants.js`：导出 `UNTIERED_KEY = '__untiered__'`、`DEFAULT_TIER_COLOR = '#ff4757'`、`MAX_BATCH_TIER_UPDATES = 200`。
- `tierlistPage.js` 全部改用常量引用，删硬编码。
- `src/router.js:35` 的 `MAX_BATCH_TIER_UPDATES` 后端常量保持不变，但在 `constants.js` 加注释标明"与后端 `src/router.js:35` 同源约定，勿单独修改"。**不强制前后端共享同一 import**（跨 Worker/前端边界，无构建步骤）——两端各自定义但值须一致，注释互指。

### 5. 删 `|| res` 兜底（T5-M3 前端侧）
- `statsPage.js:25` `this.stats = res.data || res` 改为 `this.stats = res`（`handleGetStats` 返回裸 stats 对象，`apiRequest` 默认 Content-Type 已解包一层 JSON，`res` 即 stats 本身）。
- 文档：在 `docs/frontend-improvements.md` 标注 A3 后端信封统一为独立后端任务，B5a 仅做前端兜底删除。
- 风险：若未来后端把 `/api/stats` 改为 `successResponse(stats)`（裹 `{success,data}`），`apiRequest` 解包后 `res` 仍是 `data`（因 `apiRequest` 返回 `data` 全体而非 `data.data`），故 **前端用 `res` 不会因后端信封变化而破**——核查 `apiRequest` 解包层级确认。若 `apiRequest` 仅 `return data` 不深解一层，则前端改 `res` 后后端信封升级会破；需在 PRD 内明确 `apiRequest` 的解包契约。

## 范围外

- **A3 后端 `/api/stats` 改 `successResponse(stats)`**——单独立后端任务。
- i18n / CSS 拆分（B5b/B5c）。
- 不改任何后端业务逻辑。

## 约束

- 无构建步骤；仅改 `public/js/`、`tests/`、`docs/`。
- 不引入第三方库。
- **保持行为不变**：Tier 提交结果一致、进度条视觉一致、stats 显示不变、魔法字符串值不变。
- 遵守 sedimented spec：vendor `.min.js` 约定、friendlyErrorMessage、appearance Store、模态 trapFocus、`$store.app.confirm`、禁 native confirm/禁 runtime CDN/禁 {...options} headers/禁 Date.now id。

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | `applyTierBatchUpdates` 用 `Promise.all`；批量提交耗时应下降 | 代码审查 |
| AC2 | 进度条在 `load` + `pageshow` 触发后正确隐藏；bfcache 前进后退正确；无 3s 兜底双轨 | 手动冒烟 + 代码审查 |
| AC3 | `computeTierDiff` 纯函数化并导出；新增单测覆盖 5 场景全绿 | `npm run test` |
| AC4 | markdown 语法正确性快照测试存在且全绿 | `npm run test` |
| AC5 | `public/js/constants.js` 存在；`tierlistPage.js` 无硬编码 `__untiered__`/`#ff4757`/`200` | grep |
| AC6 | `statsPage.js:25` 无 `\|\| res` 兜底 | grep |
| AC7 | `npm run lint` 退出 0 | 命令 |
| AC8 | `npm run test` 退出 0 | 命令 |
| AC9 | 本地 `npm run dev` 五页面功能正常（Tier 拖拽批量提交、进度条、统计页） | 手动冒烟 |
| AC10 | `docs/frontend-improvements.md` T5 项标记完成 | 文档 |

## 风险与回滚

- 分片并行：若 chunk 间存在隐式依赖（实际无，payloads 扁平不相交）则并行错乱；单测覆盖后并行与串行结果一致再上线。
- 进度条：`pageshow` 兼容老浏览器；若 `document.readyState` 判定错可能在已 complete 后重复完成——加 `if (progressBar.classList.contains('hidden')) return` 守卫。
- `|| res` 删除：**必须在删除前确认 `apiRequest` 解包契约**——若 `apiRequest` 返回 `{success,data}` 整体则 `res.data` 才是 stats，删兜底会破。核读 `apiRequest` 后再定。
- 回滚：5 交付物按文件分提交，任一回归单独 revert。
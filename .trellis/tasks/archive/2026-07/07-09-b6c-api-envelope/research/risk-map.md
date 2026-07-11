# Research: 风险与决策点提炼（A3 信封统一）

- **Query**: 交叉三份材料，列因果链（后端改形态→前端必改点→挂测试），提炼规划阶段用户决策点
- **Scope**: internal（提炼自 backend-shapes / frontend-consumers / tests-and-spec）
- **Date**: 2026-07-11

## 因果链：后端改形态 → 前端必改 → 挂测试

前提：把 6 个偏离端点统一为标准成功信封 `{success, message, data}`（data 内层为原裸对象）。

| 后端端点（改动） | 前端必须同步改 | 挂的测试 |
|---|---|---|
| **#1 `GET /api/auth/status`** 裸`{initialized,authenticated}` → `{success,data:{...}}` | C4 `loginPage.js:24` `status.authenticated`→`.data.authenticated`；C5 `loginPage.js:28` `.initialized`→`.data.initialized`；C6 `settingsPage.js:49` `.authenticated`→`.data.authenticated` | 无测试覆盖 auth/status（**无网可兜，纯靠改全对**——风险高） |
| **#6 `GET /api/vn`** `{data,total}` → `{success,message,data}` | C15 `tierlistPage.js:88` / C16 `vnShelf.js:40` 读 `res.data`——**透明兼容**（只要 data 键仍在） | `index.start.test.mjs` 无关；无 vn-list 专项响应测试 |
| **#7 `GET /api/vn/v\d+`** 裸 entry → `{success,data:entry}` | **C13 `shared.js:112`** `this.selectedVN = res`→`= res.data`（否则详情弹窗 `.vndb/.user` 全空） | 无专项测试 |
| **#9 `GET /api/tier`** `{data,total,updatedAt}` → `{success,message,data}` | C14 `tierlistPage.js:69` 读 `res.data`——**透明兼容** | 无专项测试 |
| **#17 `GET /api/index/status`** 裸 status → `{success,data:status}` | **C8 `settingsPage.js:83`** `this.indexStatus = await getStatus()`→`= (await...).data`（否则 `formatStatus`/`isIndexTaskActive`/轮询/模板全断） | **`index.start.test.mjs` 3 处**（`392`/`423`/`454`）断言裸 `payload.status`/`payload.processed`→改 `payload.data.*` |
| **#24 `GET /api/export`** 裸导出 → `{success,data:{...}}` | **C10 `settingsPage.js:169`** `const data = await export()`→`= (await...).data`（否则导出文件变成 `{success,message,data:{真数据}}`，**破坏导出文件格式**与既有备份兼容） | `d1/repository.test.mjs` 测的是 `exportData()` 领域函数（不经 HTTP），**不挂**；但导出/导入往返一致性无自动化守护 |

**附加连锁**：若改 `src/utils.js` 的 `successResponse`/`errorResponse` 本体形态 → `config.update.test.mjs:151-157` 与 `index.start.test.mjs:224-230` 的 **utils 桩需同步复制**，否则测试桩与真实实现漂移导致假绿。

**最脆弱点排序**（整包赋值，改一层级全断）：C8（indexStatus）> C13（selectedVN）> C10（export，且牵连文件格式）。C4/C5/C6（auth/status）次之（无测试网）。

## 规划阶段需用户决策的点（research 只列选项与牵连，不决策）

### 决策 1：信封最终形态 —— 成功侧是否强制 `{success, data}`，`message` 去留？
- **候选 A**：全端点 `{success:true, data, message?}`，data 恒在（列表也包）。牵连：#6/#9 透明；#1/#7/#17/#24 需前端回填（C4/5/6/8/10/13）+ index.start 3 测试。
- **候选 B**：成功侧只保 `{success, data}` 去掉 `message`（前端本就不读 message，见 frontend-consumers Caveats）。牵连：改 `successResponse` 签名（`utils.js:65-67`）+ 两处 utils 桩 + 19 个已统一端点的响应 body 变化（但前端不读 message 故透明）。
- **候选 C**：维持现状仅补 `success` 到 #6/#9（最小改动，只让"有 data 无 success"的两个半统一端点补齐）。牵连：#1/#7/#17/#24 仍裸出——"统一"不彻底。
- 牵连面：候选 A 最彻底但改动最大；C 最小但留 4 个裸端点。

### 决策 2：列表端点（#6 `/api/vn`、#9 `/api/tier`）—— `data` 包裹层级 + `total`/`updatedAt` 散字段去留
- 现状 `{data:[...], total:N}`（#6）、`{data:[...], total, updatedAt}`（#9）。前端只读 `.data`（C14/15/16），`total`/`updatedAt` **当前无人消费**。
- 候选：(a) 保留 total/updatedAt 并入信封 `{success,data,total,updatedAt}`；(b) 丢弃 total/updatedAt 只 `{success,data}`；(c) 下沉为 `{success,data:{items,total}}`（**会挂 C14/15/16**，需前端改 `res.data`→`res.data.items`）。
- 牵连：(c) 破坏当前透明兼容，不推荐；(a)/(b) 对前端透明。

### 决策 3：特殊端点是否豁免统一
- **#17 `/api/index/status`**：轮询高频、前端整包赋值（C8 最脆）。豁免则零改动零风险；纳入则必改 C8 + 3 测试。
- **#24 `/api/export`**：**导出文件格式**即响应体，包信封会改变用户下载的 JSON 结构，影响历史备份的 import 兼容（import #25 校验 `data.entries`，见 `settingsPage.js:201` 前端也读 `data.entries`——若导出包信封，重新导入需先解包）。**强烈建议豁免或特殊处理**。
- **#1 `/api/auth/status`**：无测试网，3 处消费（C4/5/6）。豁免省事，纳入需谨慎逐点改。
- **`index.js` 顶层 500（`166-172`）**：手写 `{success:false,error:'Internal Server Error'}`，是否改为复用 `errorResponse`（一致性）——低风险纯重构。
- **DO 内部端点（`index.js:35-135`）**：Worker↔DO 内部通信，前端不消费，`{acquired}/{released}/{lock}` 形态无需信封。建议显式声明豁免（避免"全量统一"口号误伤）。

### 决策 4：错误信封是否加 `code` 字段 —— ⚠️ 高风险，牵动既有契约
- **现状**：`errorResponse`→`{success:false, error}`，**无 code**（`utils.js:55-57`）。
- **既有依赖（tests-and-spec.md 详载）**：`friendlyErrorMessage`（`api.js:75-114`）的 4xx 分支**依赖"无 code + 中文 message"**——
  - 有 code 时走 `FRIENDLY_CODE_MAP` 映射（`api.js:84-85`），**绕过 4xx 中文 message 透传**（`api.js:98-103`）。
  - 即"加 code" = 改变前端错误文案来源：从"后端中文 message 直出"变为"前端 code→locale 映射"。
- **候选**：(a) 不加 code，维持 `{success,error}`（零破坏，AC5 i18n 边界不变）；(b) 加 code 且前端 `FRIENDLY_CODE_MAP`（`api.js:31-40`）已备 8 个 key（UNAUTHORIZED/FORBIDDEN/NOT_FOUND/VALIDATION/CONFLICT/RATE_LIMIT/SERVER_ERROR/NETWORK）——但需后端逐端点映射 code，且**所有 4xx 文案改由前端 locale 决定**（当前 message 中文透传的行为会变），且 `createApiError`（`api.js:18`）已读 `payload.code` 具备接收能力。
- 牵连：(b) 触及 AC5 i18n 边界（i18n.js:13-15 明确"后端 message 不纳入 i18n"），是**跨 B5/B6 契约的方向性变更**，需明确用户是否要这一步。错误信封字段名 `error` **不可改**（`createApiError` `api.js:16` 硬依赖），否则错误全退化为 `HTTP xxx` 兜底。

### 决策 5：`src/utils.js` 本体改 vs 各 handler 改
- 若统一逻辑收敛进 `successResponse`（如强制去 message / 统一 data 包裹），需同步 `config.update.test.mjs` + `index.start.test.mjs` 两处 utils 桩（tests-and-spec.md Caveats）。
- 若只在偏离端点把 `jsonResponse(x)` 换成 `successResponse(x)`（不动 utils 本体），桩无需改，改动面更可控。

## 决策点清单（速览）

1. 信封最终形态（A 彻底 / B 去 message / C 最小补 success）
2. 列表端点 total/updatedAt 去留 + data 层级（勿下沉否则挂 C14/15/16）
3. 特殊端点豁免：#17 index/status、**#24 export（导出格式风险，建议豁免）**、#1 auth/status、index.js 顶层 500、DO 内部端点
4. **错误信封加 code？（⚠️ 牵动 friendlyErrorMessage 的"无 code+中文 message"既有契约与 AC5 i18n 边界；字段名 `error` 不可改）**
5. utils 本体改 vs handler 局部改（影响 utils 桩是否需同步）

## 必改清单汇总（供 design 直接引用，按"若全量纳入"口径）

- 前端回填（依赖偏离形态）：**C4** `loginPage.js:24`、**C5** `loginPage.js:28`、**C6** `settingsPage.js:49`、**C8** `settingsPage.js:83`、**C13** `shared.js:112`、**C10** `settingsPage.js:169`
- 前端透明兼容（无需改，除非下沉 data）：C14 `tierlistPage.js:69`、C15 `tierlistPage.js:88`、C16 `vnShelf.js:40`
- 需改测试：`tests/router/index.start.test.mjs` 的 3 个 index/status 用例（行 `392`/`423`/`454` 起）
- 需同步的 utils 桩（若改 utils 本体）：`config.update.test.mjs:151-157`、`index.start.test.mjs:224-230`
- 不可破坏：errorResponse 无 code + 4xx 中文 message（`api.js:52-57,98-103`）、错误字段名 `error`（`api.js:16`）、公开端点 CORS 矩阵（`conventions.md:51`）、导出文件格式（`repository.test.mjs:1094-1099` 领域结构 + `settingsPage.js:201` import 读 `data.entries`）

# Research: 前端消费点全量表（A3 信封统一）

- **Query**: 盘点 `public/js/api.js` 与全部组件对 API 返回的解构点，标注依赖"偏离信封"、需后端统一后回填的点
- **Scope**: internal
- **Date**: 2026-07-11

## Findings

### `public/js/api.js` 层：apiRequest 与 wrappers

- **`apiRequest`（`api.js:122-159`）**：核心请求器。
  - 成功（`response.ok`）：`return data`（`api.js:158`）——**直接返回整个 JSON body，不解包 `.data`**。所以每个调用点自己决定读 `.data` 还是读裸对象。
  - 失败（`!response.ok`）：`throw createApiError(response.status, data)`（`api.js:154-155`）。
  - 非 JSON body：降级为 `{}`（`api.js:147-152`）。
  - 网络层失败：`throw createApiError(0, {error, code:'NETWORK'})`（`api.js:144`）。
- **`createApiError`（`api.js:15-21`）**：读错误 body 的 `payload.error`（作 message）与 `payload.code`（`api.js:16,18`）。**依赖错误信封的 `error` 字段名**；`code` 恒为 null（后端不发 code）→ friendlyErrorMessage 走 status 分支。
- **B5a `|| res` 兜底残留验证**：**已确认删除**。全仓 grep `|| res`（`api.js` 及所有组件）**零命中**（仅剩合法的 `res.data || {}`/`res.data || []` 默认值兜底）。B5a 号称"已删裸 res 兜底"属实。
- 每个 wrapper（authAPI/vnAPI/tierAPI/statsAPI/indexAPI/configAPI/dataAPI，`api.js:163-443`）都是 `return apiRequest(...)` 直传，**wrapper 层不解包**。解包责任全在组件。

### 组件解构点全量表（file:line | API | 读取字段 | 期望形态）

| # | 位置 | 调用 API（后端路由#） | 读取字段 | 期望后端形态 | 依赖偏离信封？ |
|---|---|---|---|---|---|
| C1 | `app.js:100-101` | `configAPI.getAppearance()`（#10） | `res.data` | 信封 `{success,data}` | 否（已统一） |
| C2 | `app.js:132-133` | `configAPI.getAppearance()`（#10） | `res.data` | 信封 | 否 |
| C3 | `app.js:150-151` | `authAPI.verify()`（#5） | `res.success` | 信封 `{success,...}` | 否（读 success 字段） |
| C4 | `loginPage.js:23-24` | `authAPI.status()`（#1） | `status.authenticated` | **裸 `{initialized,authenticated}`** | **是（#1 偏离）** |
| C5 | `loginPage.js:28` | `authAPI.status()`（#1） | `status.initialized` | **裸 `{initialized,authenticated}`** | **是（#1 偏离）** |
| C6 | `settingsPage.js:48-49` | `authAPI.status()`（#1） | `status.authenticated` | **裸 `{...}`** | **是（#1 偏离）** |
| C7 | `settingsPage.js:67-68` | `configAPI.get()`（#18） | `res.data`（`|| {默认}`兜底） | 信封 | 否 |
| C8 | `settingsPage.js:83` | `indexAPI.getStatus()`（#17） | 整个 `res` 赋给 `this.indexStatus`，后续读 `.status/.processed/.total/.failed/...` | **裸 status 对象** | **是（#17 偏离）** |
| C9 | `settingsPage.js:157-158` | `indexAPI.start()`（#16） | `res.data.total` | 信封 | 否（已统一） |
| C10 | `settingsPage.js:169-170` | `dataAPI.export()`（#24） | 整个 `data`（直接 `JSON.stringify` 存盘导出） | **裸导出对象 `{version,entries,tierList,appearance}`** | **是（#24 偏离）** |
| C11 | `settingsPage.js:220` | `dataAPI.import()`（#25） | 不读返回（仅 await） | 信封（无所谓） | 否 |
| C12 | `statsPage.js:23-24` | `statsAPI.get()`（#8） | `res.data` | 信封 | 否（已统一） |
| C13 | `shared.js:111-112` | `vnAPI.get(id)`（#7） | 整个 `res` 赋给 `this.selectedVN`，模板读 `.vndb/.user/.id` 等 | **裸 entry 对象** | **是（#7 偏离）** |
| C14 | `tierlistPage.js:68-70` | `tierAPI.getList()`（#9） | `res.data`（`Array.isArray` 守卫） | 半信封 `{data,total,updatedAt}` | **部分（#9 有 data 无 success，只读 data 故安全）** |
| C15 | `tierlistPage.js:87-88` | `vnAPI.getList()`（#6） | `res.data`（`Array.isArray` 守卫） | 半信封 `{data,total}` | **部分（#6 有 data 无 success，只读 data 故安全）** |
| C16 | `vnShelf.js:39-40` | `vnAPI.getList({sort})`（#6） | `res.data`（`|| []` 兜底） | 半信封 `{data,total}` | **部分（#6，只读 data 故安全）** |
| C17 | `vnShelf.js:211` | `vnAPI.create()`（#11） | 不读返回 | 信封（无所谓） | 否 |
| C18 | `vnShelf.js:224` | `vnAPI.update()`（#14） | 不读返回 | 信封 | 否 |
| C19 | `vnShelf.js:255` | `vnAPI.delete()`（#15） | 不读返回 | 信封 | 否 |
| C20 | `tierlistPage.js:256,259,282,302` | tierAPI.update/create/delete/updateOrder（#22/20/23/21） | 不读返回 | 信封 | 否 |
| C21 | `tierlistPage.js:553` | `vnAPI.batchUpdateTier()`（#12） | 不读返回（仅 await + catch 回滚） | 信封 | 否 |

### 后端统一后必须回填的消费点（依赖偏离形态）

若后端把 6 个偏离端点改为标准成功信封 `{success, data}`，**以下前端点会读到 `undefined` 而必须同步改**：

| 回填点 | 现状读法 | 若后端改信封后需改为 |
|---|---|---|
| **C4/C5** `loginPage.js:24,28` | `status.authenticated` / `status.initialized`（#1 auth/status） | `status.data.authenticated` / `status.data.initialized` |
| **C6** `settingsPage.js:49` | `status.authenticated`（#1） | `status.data.authenticated` |
| **C8** `settingsPage.js:83` | `this.indexStatus = await indexAPI.getStatus()`（#17）后读 `.status/.processed/.total/.failed` | `this.indexStatus = (await ...).data`（否则 `formatStatus`/`isIndexTaskActive`/模板全挂） |
| **C13** `shared.js:112` | `this.selectedVN = res`（#7 vn/v\d+）后模板读 `.vndb/.user` | `this.selectedVN = res.data` |
| **C10** `settingsPage.js:169-170` | `const data = await dataAPI.export()`（#24）直接导出落盘 | 若改信封则 `const data = (await ...).data`——**但会改变导出文件结构**（见 risk-map.md，导出格式兼容性风险） |

**半信封点（C14/C15/C16）**：#6/#9 若从 `{data,total}` 改为 `successResponse(items)`（即 `{success,message,data}`），前端只读 `res.data`——**透明兼容，无需回填**。反之若把这些端点的 `data` 层级去掉（改成裸数组）才会挂。

## Caveats / Not Found

- HTML 内联脚本：grep `public/*.html` 对 `/api/` 与 `fetch(` **零命中**——所有 API 消费都经 `api.js` 模块，无散落的裸 fetch。消费面收敛完整。
- `res.message`（成功信封的 message 字段）：**前端全程不消费**。成功提示一律用前端自产 `t('toast.*')`（如 `settingsPage.js:158` 用 `t('toast.indexStarted')` 而非 `res.message`）。故后端成功 `message` 字段可保留/移除对前端无影响。
- C8/C13/C10 是"整包赋值"模式（`this.x = res`），最脆弱——后端一旦包信封，整个对象层级下移一层，模板/后续逻辑全断。这三处是回填的重点。
- 错误消费：全部经 `friendlyErrorMessage`（`api.js:75-114`）读 `error.code`（恒 null）/`error.status`/`error.message`。依赖 `createApiError` 从 `payload.error` 取 message——**依赖错误信封字段名 `error`**。若错误信封改字段（如 `error`→`message`）需同步改 `createApiError`（`api.js:16`）。详见 tests-and-spec.md 与 risk-map.md。

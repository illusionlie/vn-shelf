# Research: 后端返回形态全量表（A3 信封统一）

- **Query**: 盘点 `src/utils.js` 响应辅助函数 + `src/router.js`/`src/index.js` 逐路由成功/错误返回形态，判定已统一/未统一
- **Scope**: internal
- **Date**: 2026-07-11

## Findings

### 响应辅助函数签名（`src/utils.js`）

| 函数 | 行号 | 签名 | 产出 JSON | 状态码 |
|---|---|---|---|---|
| `jsonResponse` | `src/utils.js:39-47` | `jsonResponse(data, status=200, headers={})` | `data` 原样序列化（**无信封**，裸出参数对象） | 参数 status，默认 200 |
| `errorResponse` | `src/utils.js:55-57` | `errorResponse(message, status=400)` | `{ success:false, error:message }`（**无 `code`、无 `data`**） | 参数 status，默认 400 |
| `successResponse` | `src/utils.js:65-67` | `successResponse(data=null, message='操作成功')` | `{ success:true, message, data }` | 恒 200 |

**关键不对称**：成功信封是 `{success, message, data}`，错误信封是 `{success, error}`——**错误侧没有 `data`、没有 `message`（字段名是 `error`）、没有 `code`**。这是 B5 沉淀的既有契约（详见 tests-and-spec.md 与 risk-map.md）。
`jsonResponse` 是"裸出"通道：所有偏离信封的端点都直接调它。

### 逐路由全量表（`src/router.js` 的 `handleAPI`，路由分发 `src/router.js:116-239`）

| # | 方法+路径 | 处理函数（行号） | 成功返回形态 | 成功形态判定 | 错误返回 |
|---|---|---|---|---|---|
| 1 | `GET /api/auth/status` | handleAuthStatus (`243-251`) | `jsonResponse({initialized, authenticated})` (`247-250`) 裸对象 | **未统一**（裸散字段，无 success/data） | 无（恒 200） |
| 2 | `POST /api/auth/init` | handleInit (`253-280`) | `successResponse(null, '初始化成功')` (`279`) | 已统一 `{success,message,data}` | `errorResponse` (`256,268,262`) |
| 3 | `POST /api/auth/login` | handleLogin (`282-309`) | `successResponse(null, '登录成功')` (`305`) + Cookie | 已统一 | `errorResponse` (`292,300`) |
| 4 | `POST /api/auth/logout` | handleLogout (`311-315`) | `successResponse(null, '已退出登录')` (`312`) + 清 Cookie | 已统一 | 无 |
| 5 | `GET /api/auth/verify` | handleVerify (`317-323`) | `successResponse({user: auth.user}, 'Token有效')` (`320`) | 已统一（data={user}） | `errorResponse(auth.error, 401)` (`322`) |
| 6 | `GET /api/vn` | handleGetVNList (`327-373`) | `jsonResponse({data: items, total})` (`369-372`) | **未统一**（有 `data` 但**无 `success`**，且多 `total`） | 无（恒 200） |
| 7 | `GET /api/vn/v\d+` | handleGetVN (`375-383`) | `jsonResponse(entry)` (`382`) **裸 entry 对象** | **未统一**（裸对象，无信封） | `errorResponse('条目不存在', 404)` (`379`) |
| 8 | `GET /api/stats` | handleGetStats (`1072-1075`) | `successResponse(list.stats)` (`1074`) | 已统一 | 无 |
| 9 | `GET /api/tier` | handleGetTierList (`740-747`) | `jsonResponse({data: tiers, total, updatedAt})` (`742-746`) | **未统一**（有 `data` 但**无 `success`**，多 `total`+`updatedAt`） | 无 |
| 10 | `GET /api/config/appearance` | handleGetAppearance (`1125-1141`) | `successResponse({...})` (`1128`) + Cache-Control (`1139`) | 已统一 | 无 |
| 11 | `POST /api/vn` | handleCreateVN (`537-624`) | `successResponse(savedEntry, '创建成功')` (`623`) | 已统一 | `errorResponse`（`539,553,569,579,587,598`） |
| 12 | `PUT /api/vn/tier/batch` | handleBatchUpdateVNTier (`953-1028`) | `successResponse({updated, items}, 'Tier 批量更新成功')` (`1024-1027`) | 已统一 | `errorResponse`（`955,966,971,975,986,991,995,1008,1019`） |
| 13 | `PUT /api/vn/v\d+/tier` | handleUpdateVNTier (`1030-1068`) | `successResponse(entry, 'Tier 更新成功')` (`1067`) | 已统一 | `errorResponse`（`1032,1043,1051,1058,1064`） |
| 14 | `PUT /api/vn/v\d+` | handleUpdateVN (`626-721`) | `successResponse(savedEntry, '更新成功')` (`720`) | 已统一 | `errorResponse`（`628,633,647,667,703`） |
| 15 | `DELETE /api/vn/v\d+` | handleDeleteVN (`723-736`) | `successResponse(null, '删除成功')` (`735`) | 已统一 | `errorResponse`（`725,730`） |
| 16 | `POST /api/index/start` | handleStartIndex (`1079-1111`) | `successResponse({total: result.total}, '索引任务已启动')` (`1099`) | 已统一 | `errorResponse`（`1081,1089,1097`） |
| 17 | `GET /api/index/status` | handleGetIndexStatus (`1114-1121`) | `jsonResponse(status)` (`1120`) **裸 status 对象**（`{status,taskId,total,processed,failed,startedAt,completedAt,error,lastReconciledAt}`） | **未统一**（裸对象，无信封） | `errorResponse('未授权',401)` (`1116`) |
| 18 | `GET /api/config` | handleGetConfig (`1143-1165`) | `successResponse({...})` (`1152`) | 已统一 | `errorResponse('未授权',401)` (`1145`) |
| 19 | `PUT /api/config` | handleUpdateConfig (`1167-1240`) | `successResponse(null, '设置已更新')` (`1232`) + 可能 Cookie | 已统一 | `errorResponse`（`1169,1184`） |
| 20 | `POST /api/tier` | handleCreateTier (`749-789`) | `successResponse(createdTier, '创建成功')` (`788`) | 已统一 | `errorResponse`（`751,767,771`） |
| 21 | `PUT /api/tier/order` | handleUpdateTierOrder (`860-914`) | `successResponse(savedTierList.tiers, '排序更新成功')` (`913`) | 已统一（data=数组） | `errorResponse`（`862,873,882,887,894,899`） |
| 22 | `PUT /api/tier/[^/]+` | handleUpdateTier (`791-838`) | `successResponse(updatedTier, '更新成功')` (`837`) | 已统一 | `errorResponse`（`215,793,804,810,818,828`） |
| 23 | `DELETE /api/tier/[^/]+` | handleDeleteTier (`840-858`) | `successResponse({deletedTier, clearedCount}, '删除成功')` (`857`) | 已统一（data=对象） | `errorResponse`（`225,842,848`） |
| 24 | `GET /api/export` | handleExport (`1244-1251`) | `jsonResponse(data)` (`1250`) **裸导出对象**（`{version,exportedAt,entries,tierList,appearance}`，见 `src/repository.js:843-849`） | **未统一**（裸对象，无信封） | `errorResponse('未授权',401)` (`1246`) |
| 25 | `POST /api/import` | handleImport (`1253-1357`) | `successResponse({count: entries.length}, '导入成功')` (`1356`) | 已统一 | `errorResponse`（多处，`1255,1269,1276,1306,1310,1314,1318,1329...`） |

**兜底错误**：`handleAPI` 未命中 → `errorResponse('Not Found', 404)` (`src/router.js:238`)；`handleRequest` 非 API 路径 → `errorResponse('Not Found', 404)` (`src/router.js:110`)。

### `src/index.js` 直接返回响应的入口（非 router）

| 位置 | 行号 | 形态 | 说明 |
|---|---|---|---|
| Worker `fetch` 顶层 catch | `src/index.js:166-172` | 手写 `{success:false, error:'Internal Server Error'}` + 500 | **手工复刻 errorResponse 形态**（未复用 util）。所有未捕获异常的最终 500 出口。 |
| `IndexStartLockDurableObject.fetch` | `src/index.js:35-135` | `/acquire`→`{acquired, holder?, expiresAt?}`；`/release`→`{released}`；`/status`→`{lock}`；错误→`{success:false, error}` (`37,61,107`) | **内部 DO 端点**（Worker↔DO，**前端不消费**）。本任务范围外，但若"信封统一"号称全量需显式豁免。 |

## 统计

- **路由总数**：25 条公开 API 路由（`handleAPI` 内）。
- **已统一为成功信封 `{success,message,data}`**：19 条（successResponse）。
- **偏离信封**：**6 条**，均走 `jsonResponse` 裸出：
  - #1 `GET /api/auth/status` → 裸 `{initialized, authenticated}`
  - #6 `GET /api/vn` → `{data, total}`（有 data 无 success）
  - #7 `GET /api/vn/v\d+` → 裸 entry 对象
  - #9 `GET /api/tier` → `{data, total, updatedAt}`（有 data 无 success）
  - #17 `GET /api/index/status` → 裸 status 对象
  - #24 `GET /api/export` → 裸导出对象
- **偏离形态的具体 JSON 键**：
  - `{initialized, authenticated}`（#1）
  - `{data, total}`（#6）
  - 裸 entry：`{id, createdAt, vndb:{...}, user:{...}}`（#7，来自 `getVNEntry`/`rowToEntry`）
  - `{data, total, updatedAt}`（#9）
  - 裸 status：`{status, taskId, total, processed, failed, startedAt, completedAt, error, lastReconciledAt}`（#17）
  - 裸导出：`{version, exportedAt, entries, tierList, appearance}`（#24）
- **错误侧**：全部 25 条的错误路径统一走 `errorResponse` → `{success:false, error}`（含兜底 404 与 index.js 顶层 500 手写复刻）。**无一条错误响应带 `code` 或 `data`。**

## Caveats / Not Found

- #6/#9 属"半统一"：已有 `data` 键但缺 `success`，且携带 `total`/`updatedAt` 散字段。前端只读 `.data`（见 frontend-consumers.md），故若改为 `successResponse(items)` 对前端透明——但 `total`/`updatedAt` 会丢失（当前前端未用）。
- #7 与 #6 互相不一致：列表包 `data`、单条裸出——这是"信封不统一"最直接的自相矛盾点。
- DO 内部端点（index.js:35-135）与顶层 500（166-172）是否纳入"统一"是决策点，见 risk-map.md。

# Research: 测试与既有 spec 契约（A3 信封统一）

- **Query**: `tests/` 下断言响应形态的用例 + `.trellis/spec/backend/` 既有响应契约，标注统一后需改项与不可破坏边界
- **Scope**: internal
- **Date**: 2026-07-11

## Findings

### 测试中断言响应形态的用例

#### `tests/router/index.start.test.mjs`（POST /api/index/start #16 + GET /api/index/status #17）

utils 桩复刻真实形态（`errorResponse`→`{success:false,error}`；`successResponse`→`{success,message,data}`，`index.start.test.mjs:224-230`）。

| 用例名（行号） | 断言形态 | 统一后需改？ |
|---|---|---|
| 并发启动仅一个成功（`300`） | 成功 `{success:true, message:'索引任务已启动', data:{total:5}}`（`332-336`）；冲突 `{success:false, error:'已有索引任务正在运行'}`（`338-341`） | **否**（#16 已是信封） |
| running 下重复启动被拒（`356`） | `{success:false, error:'已有索引任务正在运行'}`（`379-382`） | 否 |
| 查询状态直接返回不触发 reconcile（`392`） | `payload.status==='running'`、`payload.processed===1`（`414-416`）**直接读裸字段** | **是（若 #17 包信封需改为 `payload.data.status`）** |
| 非 running 不触发 reconcile（`423`） | `payload.status==='completed'`、`payload.processed===8`（`444-447`）裸字段 | **是（#17 包信封则需改）** |
| reconcile 副作用不报错（`454`） | `payload.status==='running'`、`payload.processed===2`（`475-478`）裸字段 | **是（#17）** |
| 正常启动创建任务并发全部消息（`485`） | `{success:true, message:'索引任务已启动', data:{total:3}}`（`505-509`） | 否（#16 信封） |
| 去重后 total 入队（`534`） | 同上 `data:{total:3}`（`561-565`） | 否 |
| 分片并发上界（`578`） | `data:{total:60}`（`605-609`） | 否 |
| 部分发送失败仍 running（`618`） | 成功 `data:{total:3}`（`645-649`）+ 冲突信封（`671-674`） | 否 |
| 全部失败写 start_failed 返 500（`685`） | `{success:false, error:'索引任务启动失败，请稍后重试'}`（`705-708`） | 否 |
| 释放锁失败不覆盖响应（`724`） | 成功 `data:{total:2}`（`747-751`） | 否 |
| 跨实例并发分布式锁（`762`） | 成功 `data:{total:4}`（`794-798`）+ 冲突信封（`799-802`） | 否 |

#### `tests/router/config.update.test.mjs`（PUT /api/config #19 + GET /api/config/appearance #10 + CORS）

| 用例名（行号） | 断言形态 | 统一后需改？ |
|---|---|---|
| 仅改密码更新哈希+重签 JWT（`249`） | `{success:true, message:'设置已更新', data:null}`（`265`） | 否（#19 信封） |
| 同时改密码与其他字段（`277`） | `{success:true, message:'设置已更新', data:null}`（`301`） | 否 |
| 不改密码不重置凭据（`319`） | 同上（`342`） | 否 |
| 匿名 GET appearance 默认值（`357`） | `payload.success===true`、`payload.data.backgroundUrl===''` 等（`373-380`） | 否（#10 已信封，断言就读 `.data`） |
| 匿名 GET appearance 已配置+不泄敏（`386`） | `payload.data.tagsMode` 等 + `'vndbApiToken' in payload.data===false`（`407-416`） | 否 |
| 公开端点 GET 带 CORS + OPTIONS 204（`422`） | 仅断言 headers/status，不断言 body | 否 |
| 认证端点无 CORS + OPTIONS 404（`448`） | 仅 headers/status | 否 |

#### `tests/queue/index.queue.test.mjs`（Worker queue 消费，**非 HTTP 响应**）

全部断言 `message.ackCalled`/`retryCalled`、`reconcileCalls`、`recordCalls[].state` 等**队列行为**，**不涉及任何 HTTP 响应信封**。统一后**全部无需改**。（唯一 HTTP 相关是 router 桩 `handleRequest` 返回 `new Response('ok')`，`index.queue.test.mjs:87`，与信封无关。）

#### `tests/d1/repository.test.mjs`（数据访问层，**非 HTTP 响应**）

断言 `repository` 函数返回的**领域对象**（`getVNList().items`、`exportData()` 的 `{version,entries,tierList}`、`getIndexStatus()` 的 `{status,taskId,...}` 等）。这是**信封内层 data 的来源**，非信封本身。统一后**无需改**（除非 design 决定改 repository 返回结构，本任务不涉及）。关键：`exportData` 返回 `{version:'1.0', entries, tierList, ...}`（`repository.test.mjs:1094-1099`）——这是 #24 导出端点裸出的内层，导出文件格式的事实源。

#### 其他 tests（`tier-diff` / `markdown.*` / `i18n.*`）

与 API 响应信封无关，无需改。

### `.trellis/spec/backend/` 既有响应契约

#### `.trellis/spec/backend/conventions.md`

| 契约 | 行号 | 与信封相关性 / 不可破坏边界 |
|---|---|---|
| 公开端点 CORS 策略 | `conventions.md:7-65` | 公开五端点 `/api/vn`、`/api/vn/v\d+`、`/api/stats`、`/api/tier`、`/api/config/appearance`（`18-24`）——其中 4 个是**偏离信封端点**（#6,#7,#9 + #10已统一,#8统一）。**边界**：CORS 头由 `handleRequest` 出口统一附加（`30`），改 handler 内响应形态**不得动 CORS 逻辑**；`GET` 即使 404 也带头（`40`）。测试矩阵 `config.update.test.mjs:422-466` 不可破坏。 |
| settings 单请求复用 | `conventions.md:69-125` | `authMiddleware` 返回 `{authenticated, settings?}`（`80-82`）。**边界**：认证 handler 复用 `auth.settings` 不重查库（`89`）。与信封无直接关系，但改 handler 时不得引入重复 `getSettings`。 |
| wrangler 双轨配置 | `conventions.md:129-149` | 与响应信封无关。 |

#### B5 沉淀的隐性契约（散落在 `public/js/api.js` 注释，非 backend spec 但强约束后端）

**`api.js:26-70` 是本任务最关键的既有契约文档**（AC5 i18n 边界 + 错误信封形态），design 阶段必读：

| 契约 | 出处 | 不可破坏边界 |
|---|---|---|
| **errorResponse 无 code 字段** | `api.js:27-29,52-56` | `friendlyErrorMessage` 明确"后端 errorResponse 返回 `{success:false, error}`，**不含 code 字段**"（`api.js:52-54`）。前端约定"code 优先于 message"（`api.js:28-29`），但因后端**从不发 code**，实际全走 status/message 分支。**若本任务给错误信封加 `code` 字段 → 直接改变 friendlyErrorMessage 的解析分支走向**（`api.js:84-85` 的 `FRIENDLY_CODE_MAP` 命中），是行为破坏点。 |
| **4xx message 为中文友好文案** | `api.js:52-57,98-103` | 4xx 的 `error` message 均为中文友好串（`密码错误`/`未授权`/`条目不存在`/`密码长度至少6位`），`friendlyErrorMessage` 第 4 支**原样透传不翻译**（`api.js:98-103`）。**边界**：统一时**不得把 4xx message 改成技术串或英文 code 串**，否则 friendlyErrorMessage 会把技术文本透传给用户。 |
| **`HTTP <status>` 兜底串识别** | `api.js:42-46` | `createApiError` 无 `payload.error` 时兜底 `HTTP 404` 等，`HTTP_FALLBACK_RE`（`api.js:46`）据此区分"技术兜底串"vs"服务端友好串"。**边界**：错误信封字段名 `error` 不能改（`createApiError` `api.js:16` 读 `payload.error`），否则所有错误退化为 `HTTP xxx` 兜底。 |
| **5xx 裸 message 不暴露** | `api.js:60-62,93-95` | 5xx 统一 SERVER_ERROR 文案，隐藏后端异常文本。`index.js:166-172` 顶层 500 手写 `{success:false, error:'Internal Server Error'}` 已符合。 |

## Caveats / Not Found

- **无独立的 response-envelope spec 文件**。响应契约事实上分散在：`api.js:26-114` 注释（前端侧，最权威）+ `conventions.md`（仅 CORS/settings）。本任务若产出信封规范，应考虑 `update-spec` 落一份 backend/response-envelope 契约（主 agent 决策，research 不做）。
- **需改测试清单（后端统一后）**：仅 `tests/router/index.start.test.mjs` 的 **3 个** index/status 用例（`392`/`423`/`454` 行起）断言了裸 `payload.status`/`payload.processed`——若 #17 包信封需改为 `payload.data.*`。其余所有 router 测试断言的是已统一端点或纯 CORS/行为，**无需改**。queue/d1 测试**全部无需改**。
- config.update / index.start 测试的 utils 桩（`config.update.test.mjs:151-157`、`index.start.test.mjs:224-230`）是 successResponse/errorResponse 的镜像复制——若改 `src/utils.js` 的信封形态，**这两处桩需同步**，否则桩与真实行为漂移（测试假绿）。

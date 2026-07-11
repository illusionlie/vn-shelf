# Design — B6c 后端 API 信封统一（A3）

> 事实源：`research/`（backend-shapes / frontend-consumers / tests-and-spec / risk-map，带行号）。四项决策已确认：6 条全收编 / 列表顶层保留 extras / 错误不加 code / 成功保留 message。

## 目标契约（code-spec）

### 成功信封（全 25 条公开路由）

```
{ success: true, message?: string, data: <payload>, ...extras }
```

- `success:true` + `data` **必备**；`message` 可选（前端零消费，仅信息性）；`extras` 仅列表端点（`total` / `updatedAt`）。
- 载体：`src/utils.js` `successResponse(data, message, extra = {})` —— **向后兼容扩展**第三参，产出 `{success:true, message, data, ...extra}`。既有 19 个双参调用点零影响；两处测试桩（config.update:151 / index.start:224）因被测 handler 不用第三参而无需同步（核对项见 implement）。

### 错误信封（零改动，重申既有契约）

```
{ success: false, error: string }   // 无 code、无 data、无 message
```

- 字段名 `error` 不可改（`createApiError` api.js:16 硬依赖）；4xx 中文 message 原样透传（friendlyErrorMessage 分支 4 / AC5 i18n 边界）。
- `src/index.js:166-172` 顶层 500 手写体改为复用 `errorResponse('Internal Server Error', 500)`（纯一致性重构，形态逐字节等价需核对 headers）。

### 6 条偏离端点的目标形态

| # | 端点 | 现状 → 目标 | 前端回填 |
|---|---|---|---|
| 1 | `GET /api/auth/status` | 裸 `{initialized,authenticated}` → `successResponse({initialized, authenticated})` | C4 `loginPage.js:24`、C5 `:28`、C6 `settingsPage.js:49` 改读 `res.data.*` |
| 6 | `GET /api/vn` | `{data,total}` → `successResponse(items, msg, {total})` | C15/C16 只读 `.data`，**透明** |
| 7 | `GET /api/vn/v\d+` | 裸 entry → `successResponse(entry)` | C13 `shared.js:112` `selectedVN = res.data` |
| 9 | `GET /api/tier` | `{data,total,updatedAt}` → `successResponse(tiers, msg, {total, updatedAt})` | C14 只读 `.data`，**透明** |
| 17 | `GET /api/index/status` | 裸 status → `successResponse(status)` | C8 `settingsPage.js:83` `indexStatus = (await ...).data`（整包赋值，最脆——轮询/formatStatus/isIndexTaskActive 全链核对） |
| 24 | `GET /api/export` | 裸导出对象 → `successResponse(exportData)` | C10 `settingsPage.js:169` 存文件改用 `res.data` —— **导出文件内容保持 `{version,exportedAt,entries,tierList,appearance}` 不变** |

### 显式豁免（写入契约，防"全量统一"口号误伤）

- DO 内部端点（`index.js:35-135`，`{acquired}/{released}/{lock}`）：Worker↔DO 内部通信，非公开 API。
- 非 JSON 通道（静态资源、404 兜底已是 errorResponse）。

## 数据流与兼容

- **一次性原子切换**：wrangler 部署同批替换 Worker + assets；仓库内后端改动与前端回填**必须同一 commit**（任何中间提交都是前后端形态错配的坏 bisect 点）。
- 导入兼容：import 端点解析的是**文件内容**（`{entries,...}`），export 响应包信封后前端存 `res.data`，文件格式与历史备份完全一致——导入路径零改动。
- `api.js` 的 `apiRequest`/wrappers 维持"返回完整解析 payload"语义不变，解包责任在组件层（与现有 19 端点消费习惯一致）。

## 测试策略

- 改：`tests/router/index.start.test.mjs` 3 处 index/status 断言 `payload.status/processed` → `payload.data.status/data.processed`（行 392/423/454 起）。
- 增：`tests/router/envelope.test.mjs`——对 6 条原偏离端点断言信封形态（success/data 存在；#6/#9 顶层 total（#9 另有 updatedAt）；#24 `data.entries` 为数组且文件级键齐全；#1 `data.initialized/authenticated` 布尔）。复用既有 router 测试的 env/stub 搭建模式（config.update / index.start 先例）。
- 桩漂移核对：utils 扩展第三参后，跑全量测试确认两个桩测试文件仍绿；若桩内 successResponse 被新路径触达则同步复制实现。

## 取舍记录

- **utils 扩展 extras vs handler 手拼 jsonResponse**：选前者——信封定义收敛单点，`{success:true,...}` 字面量不散落 handler；向后兼容扩展让 19 处零改动。
- **列表 extras 顶层保留 vs 下沉**：顶层（Q2）——C14/15/16 透明兼容；total/updatedAt 当前无人读但为将来分页预留，删除是无收益的信息损失。
- **错误不加 code**（Q3）：加 code = 4xx 文案来源从"后端中文直出"切到"前端 locale 映射"，推翻 B5b i18n 边界，超出 A3 结构统一本体。留作未来独立任务（若做多语言错误文案）。
- **message 保留**（Q4）：删除牵动 utils 签名 + 19 调用点 + 2 桩，纯洁癖无实质收益。

## 回滚

- 主体单 commit（后端 + 前端回填 + 测试），revert 即整体回到旧形态，无中间态。
- spec 更新独立 commit。
- 数据零迁移（纯响应形态变更，D1 无涉）。

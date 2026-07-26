# 添加条目弹窗支持 VNDB 模糊搜索选择

## Goal

主页添加条目弹窗目前只有纯文本 `VNDB ID` 输入框，用户必须先去 vndb.org 查到 `v<id>` 才能添加。本任务把该输入框升级为「双模式搜索框」：

- 输入 `v<id>` → 保持现有直连行为，不发搜索请求；
- 输入任意语言名称（中文官方/汉化译名、日文原名、英文名、别名）→ 防抖调用 VNDB 搜索，下拉展示候选（封面/标题/原名/厂商/年份/VNDB 评分），点选后回填 `vndbId`，继续走既有创建管线。

## Confirmed Facts（代码调研，2026-07-26）

- `VNDBClient.searchVN(query, limit=10)` 已存在（`src/vndb.js:252`）但**零引用**：无路由暴露、无前端调用。现有字段 `id/title/alttitle/image.url/rating/developers.name`；未指定 `sort`（kana API search filter 默认按 id 排序，需 `sort: 'searchrank'` 才按相关度）。
- VNDB kana API `search` filter 本身跨标题/别名/发行版名模糊匹配，中文译名可命中，正好满足诉求。
- 添加条目是 admin 功能（`handleCreateVN` 要求认证）；编辑态不显示 ID 输入框（vndbId 不可改）→ 搜索仅存在于新增态（`editForm.isNew`）。
- `createVNDBClient` 在 `settings.vndbApiToken` 缺失时抛错 → 搜索与现有添加一样以 Token 已配置为前提。
- 认证 handler 契约（backend/conventions.md）：复用 `auth.settings`，禁止二次 `getSettings`。
- 响应信封契约（B6c）：`successResponse`/`errorResponse`，错误无 `code`、中文文案直出 toast。
- 新端点为认证端点 → 默认**不加** CORS、不入 `PUBLIC_CORS_PATH_PATTERNS`（什么都不做即正确）。
- router 4 个 patch 型测试（config.update / envelope / vn.status / index.start）整体替换 `./vndb.js` 桩：router.js 新增来自该模块的 import 必须同步四桩，否则 `ERR_MODULE_NOT_FOUND` / 假绿。
- 前端已有可复用件：`debounce`（vnShelf 已用，本地过滤 200ms）、`nsfw-blur` 封面模糊样式、i18n zh-CN/en 双 locale + key 双向 diff 测试、评分色语义**金=VNDB**。
- 创建时后端 `titleCn: titleCn || vndbData.titleCn || ''` 自动回填中文标题 → 选中候选后前端无需替用户填「中文标题」字段。

## Requirements

### 后端

- 新增认证端点 `GET /api/vndb/search?q=<关键词>&limit=<n>`：
  - 未认证 → `errorResponse('未授权', 401)`；
  - `q` trim 后为空 → 400；超长静默截断（100 字符）；
  - `limit` 默认 10，clamp 1..20；
  - `auth.settings.vndbApiToken` 缺失 → 400 中文文案（提示先在设置页配置）；
  - VNDB 上游失败 → 500 `VNDB API错误: ...`（与 `handleCreateVN` 现有形态一致）；单次调用不重试（type-ahead 场景，下一次击键即自然重试）；
  - 成功 → `successResponse(<数组>)`，handler 内用 `auth.settings` 直接构造 `VNDBClient`。
- `searchVN` 升级（零引用方法，无回归面）：请求加 `sort: 'searchrank'`；字段增加 `released`、`image.sexual`、`image.violence`；输出增加 `released`（无则空串）与 `imageNsfw`（`sexual>1 || violence>1`，与 `mapVnObjectToVndbData` 同口径）。

### 前端（仅添加弹窗 isNew 分支）

- 单输入框双模式：trim 后匹配 `^v\d+$` → 直连模式（不搜索，hint 提示将直接使用该 ID）；否则 ≥2 字符经 350ms 防抖触发搜索。
- 下拉候选项：封面缩略图（NSFW 应用 `nsfw-blur`，不做点击解锁）、主标题、原名（alttitle）、厂商 + 发行年份、VNDB 评分（金色语义）。
- 键盘：↑/↓ 移动高亮、Enter 选中（下拉打开时 Enter 不得触发表单提交）、Esc 关闭下拉且**不冒泡**关闭弹窗；下拉已关闭时 Esc 保持现状（关闭弹窗）。
- 竞态防护：序号守卫，过期响应不得覆盖新结果；清空/关闭时丢弃 in-flight 结果。
- 选中后回填 `editForm.vndbId`，输入框区域替换为「已选卡片」：封面小图（NSFW 模糊）+ 标题 + 原名 + vID + 「重新选择」按钮（用户决策 2026-07-26，方案 A）。
- 提交守卫：`vndbId` 为空（输入了名字但未点选）→ 阻止提交并 toast 提示。
- 状态呈现：搜索中提示、空结果提示、失败提示均**内联**展示于下拉区（不走 toast，避免逐击键刷屏）；失败文案经 `friendlyErrorMessage`。
- i18n：新增词条 zh-CN / en 双侧同步。

### 不变量

- `POST /api/vn` 创建管线与校验逻辑零改动；手输 `v<id>` 的老用法完整保留。

## Acceptance Criteria

- [x] 新增 `tests/router/vndb.search.test.mjs`（patch 加载器模式）：未认证 401 信封 / `q` 空 400 / token 缺失 400 / 成功形态（data 为数组、字段齐全）/ limit clamp；既有 4 个 router 测试桩同步后全绿。
- [x] `searchVN` 单测（tests/vndb/）：请求体含 search filter + `sort: 'searchrank'` + 新字段集；结果映射（released / imageNsfw / 评分 0-100→0-10）与空结果分支。
- [x] 手动验收：输入中文译名 / 日文原名 / 英文名均能出候选并点选添加成功；输入 `v<id>` 走直连与现状一致；NSFW 封面模糊；纯键盘可完成一次选择；Esc 行为符合上述定义。
- [x] i18n key 双向 diff 测试通过（zh-CN / en 同步）。
- [x] `npm run lint` 与 `npm test` 全绿。
- [x] AGENTS.md / CLAUDE.md 的 API 说明与结构描述同步（如涉及）。

## Out of Scope

- 编辑态更换 vndbId；设置页 / Tier 页复用该搜索；搜索结果分页（`more` 翻页）；按厂商/年份等高级筛选；公开无鉴权搜索代理；VNDB Token 缺失时的引导流程改造。

## Open Questions

无——选中态形态已于 2026-07-26 决策为方案 A（已选卡片），已并入 Requirements。

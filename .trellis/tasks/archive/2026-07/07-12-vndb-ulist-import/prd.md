# VNDB ulist 用户列表导入

## 目标与用户价值

让用户一键从 VNDB 拉取自己的游玩列表（ulist），批量写入本地书架：自动创建条目、映射游玩状态、带入个人评分与游玩起止日期，省去逐条手动添加。这是 07-11 状态字段任务预留的下游功能——彼时固化的枚举与映射规则在此兑现。

## 已确认事实（代码 + API 证据）

### 现有可复用基建
- **VNDB 客户端**：`src/vndb.js` 的 `VNDBClient`（`request(endpoint, body)` POST + `Token` 认证 + UserAgent），token 存于 settings `vndbApiToken`，`createVNDBClient(env)` 统一取用。目前只有 `/vn` 端点方法（getVN/searchVN），**无 `/ulist`、`/authinfo` 方法**，需新增。
- **索引管线**：`startIndexTask`→`VN_INDEX_QUEUE.send`→`queue()` 消费→`fetchVNDB`+`saveVNEntry`→`recordIndexItemResult`（幂等，`taskId+vndbId`）→`reconcileIndexStatusFromItems` 汇总。任务状态存 `index_tasks` 表，前端 `settingsPage` 5s 轮询 `/index/status` 显示进度条。重试 3 次 / 延迟 60s。Durable Object `INDEX_START_LOCK` 提供启动互斥。
- **导入机制**：`importData(env, {entries,tierList,appearance}, mode)`，宽松校验，merge/replace 双模式，分片 batch。
- **状态归一**：`normalizeStatus()`（`src/repository.js`），`VN_STATUS_VALUES` 含 wishlist。

### VNDB ulist API（已核实 api.vndb.org/kana）
- `GET /authinfo`：用现存 token 返回 `{id, username, permissions}`；`listread` 权限可读私有标签。**无需用户手填 uid**。
- `POST /ulist`：类似 `POST /vn` 但必须带 `user` 参数；支持全部 vn filters；分页 `page`（从 1）+ `results`（每页 max 100）；可选 `sort`（id/added/vote/...）+ `reverse`+`count`。
- 返回字段（可选择）：`id`、`vote`(10-100)、`notes`、`started`、`finished`、`labels[]`(`{id,label}`)、`vn.*`（可嵌套选 VN 字段）。
- **映射规则（07-11 固化，见 backend/conventions.md「条目游玩状态枚举」）**：label `1→playing, 2→finished, 3→stalled, 4→dropped, 5→wishlist`；一个 VN 多 label 时终态优先 `2 > 4 > 3 > 1` 单值化；纯 Wishlist 条目跳过（除非启用 wishlist）。`vote/10 → personalRating`、`started → startDate`、`finished → finishDate`。

## 需求

### 后端 VNDB 客户端（src/vndb.js）
- [ ] 抽出共享的 VN 字段映射函数（现 `getVN` 内联的多语言标题提取、tags 过滤、g235 全年龄、rating/10、length 格式化 → `mapVnObjectToVndbData(vn)`），`getVN` 与 ulist 映射共用；`getVN` 行为不变（回归保护）。
- [ ] `getAuthInfo()`：`GET /authinfo`，返回 `{id, username, permissions}`；无 token 或无 listread 时抛明确错误。
- [ ] `fetchUList(userId, {page, results})`：`POST /ulist`，body 带 `user`、`fields`（含 `vote,notes,started,finished,labels.id,labels.label` + `vn.*` 需要的字段）、分页。返回原始 results + 是否 more。
- [ ] `mapUListItemToEntry(item)`：单条 ulist → 本地 entry（状态终态优先映射、vote/10、started/finished、VN 元数据经共享函数）；纯 wishlist 返回跳过标记。映射规则常量落此文件。

### 导入任务管线（复用索引基建）
- [ ] 泛化任务状态存储：`index_tasks` 表新增 `type` 区分 index/ulist-import（或另建轻量任务记录，design 定），保证进度轮询与终态汇总可复用。
- [ ] 启动端点 `POST /api/ulist/import`：`/authinfo` 取 uid → 建任务 → 异步分页拉取+映射+`saveVNEntry`（跳过已存在、跳过纯 wishlist）。Durable Object 启动锁复用或并存。
- [ ] 进度语义：total（拉取到的条目数）、imported、skipped（已存在+纯 wishlist）、failed；终态 completed/partial。
- [ ] 状态查询端点或复用 `/index/status`（design 定），前端 5s 轮询。

### 前端（设置页）
- [ ] 设置页「VNDB」区新增「导入我的 ulist」按钮 + 进度显示（复用现有 index 进度条模式）。
- [ ] i18n 双语文案（zh-CN + en）。

### 测试
- [ ] `mapUListItemToEntry` 单测：四状态映射、多 label 终态优先、纯 wishlist 跳过、vote 空→0、日期映射、无状态标签→null。
- [ ] `getVN` 抽函数后回归不变。
- [ ] 导入端点：跳过已存在、鉴权失败、分页汇总。

### 文档
- [ ] AGENTS.md VNDB 集成段 + spec 更新映射规则落地位置。

## 决策记录（brainstorm 逐项确认中）

1. 导入范围与 VN 元数据获取方式：**已确认（2026-07-12）——ulist 一次拉全**。`POST /ulist` 用 `vn.*` 嵌套字段一次分页请求同时取回用户数据 + VN 元数据；映射后直接 `saveVNEntry` 写完整条目，不走队列补全。`getVN` 的字段解析逻辑（多语言标题提取、tags 过滤、g235 全年龄、rating/10、length 格式化）抽为共享函数，`getVN` 与 ulist 映射共用。
2. 与现有索引任务的关系（复用队列 vs 独立管线）：**已确认（2026-07-12）——复用异步任务+轮询基建**。复用/泛化 `index_tasks` 表、Durable Object 启动锁、前端进度条轮询、终态汇总，避开单请求超时。分页拉取如何映射进队列模型（每消息=一页 vs 其他）由 design.md 定。
3. 已存在条目的冲突策略：**已确认（2026-07-12）——跳过已存在**。导入只新增本地没有的条目；已存在的同 ID 条目完全不动（保留用户的中文名/评论/tier/tags/评分等全部本地数据）。跳过计入进度汇总（如 skipped 计数），不算失败。
4. 触发与鉴权（是否手填 uid / 私有列表）：**已确认（2026-07-12）——用自己的 token 经 `GET /authinfo` 取 uid**。零额外输入，`listread` 权限读到自己的完整列表（含私有标签）。首期不支持导入他人公开列表（填 uid）。token 缺失/无 listread 权限时给明确中文错误。
5. 映射细节边界：**已确认（2026-07-12）**：
   - 无 1-4 游玩状态标签、但有其他标签（Voted/自定义）的条目：**仍导入**，`status` 落 null（未设置）。
   - `vote` 为空（未评分）：`personalRating` 落 0（与现有未评分一致）。
   - 纯 Wishlist（只有 label 5、无 1-4）条目：**跳过不导入**（维持 07-11 固化规则；不在本任务放出 wishlist 前端展示）。计入 skipped，不算失败。
   - 主规则（07-11 固化）：多 label 终态优先 `2>4>3>1` 单值化；`vote/10→personalRating`（四舍五入到与现有精度一致）；`started→startDate`、`finished→finishDate`。

## 明确不做（Out of Scope）

- 向 VNDB 反向写回（PATCH /ulist，需 listwrite）。
- 定时自动同步（首期仅手动触发）。
- ulist 之外的 rlist（release 列表）。

## Acceptance Criteria

- [x] 点击设置页「导入我的 ulist」→ 后端经 `/authinfo` 取 uid → 分页拉取全部 ulist 条目。
- [x] 状态映射正确：单/多 label 均按终态优先 `2>4>3>1` 得到单值；无 1-4 标签→null；纯 wishlist 跳过。
- [x] 评分/日期映射：`vote/10→personalRating`（vote 空→0）、`started→startDate`、`finished→finishDate`。
- [x] VN 元数据（标题多语言、封面、rating、tags、length、全年龄）随 ulist 一次拉全写入，`getVN` 抽共享函数后行为不回归（对拍 deepEqual 断言）。
- [x] 已存在同 ID 条目跳过，本地数据零改动；skipped 计数正确（含纯 wishlist）。
- [x] 大列表不超时：分页 + 异步 waitUntil 任务，前端进度条实时反映 imported/skipped/failed；中断置 partial 断点续传。
- [x] token 缺失或无 listread → 明确中文错误（信封无 code）；活跃任务 409。
- [x] `npm run lint`、`npm run test` 通过（159/159）；映射单测覆盖全部边界；`getVN` 回归通过。
- [x] AGENTS.md 与 backend spec 同步；wrangler 无新绑定（复用 D1 + INDEX_START_LOCK），双轨无需改。

## 待人工冒烟（无法连真实 VNDB，依赖用户 token）

- `wrangler dev` 配置真实 token → 导入 → 观察进度 total/skipped → 书架出现新条目（状态/评分/日期正确）→ 重复导入全 skipped → 超大列表中断重跑收敛 completed。

## Open Questions（进入 design 阶段解决，非阻塞用户）

- 任务状态表泛化方式（加 `type` 列 vs 独立表）——技术设计决策，design.md 定。
- 分页拉取与 Worker 执行模型的具体编排（waitUntil 循环 vs 队列每消息一页）——design.md 定，需评估单次 subrequest 数与 CPU 时限。
- 启动锁是否与索引任务互斥（两者都写 vn_entries，建议互斥避免并发写）。

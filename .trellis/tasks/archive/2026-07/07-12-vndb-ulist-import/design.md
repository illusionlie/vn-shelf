# 设计：VNDB ulist 用户列表导入

## 架构总览

```text
[设置页按钮] POST /api/ulist/import
   → handleStartUListImport(env, auth)
       1. getAuthInfo(env)            # GET /authinfo, 取 uid + 校验 listread
       2. 建导入任务（复用 index_tasks，type='ulist_import'）
       3. 启动异步拉取（见「执行模型」）
   → 202/200 返回 taskId
[设置页 5s 轮询] GET /index/status（复用）→ 进度条
```

映射与拉取全部落 `src/vndb.js`；写入复用 `saveVNEntry` + `getVNEntry`（存在性检查）；任务状态复用 `index_tasks` 表与 `reconcile*` 汇总。

## 执行模型（解决 PRD 开放问题）

**选定：waitUntil 分页循环 + 分批 D1 写入，单任务串行。** 理由与权衡：

- ulist 是分页流（每页 ≤100，一次请求含 `vn.*`），天然顺序拉取——不像索引那样有"N 个独立 VN 可并行入队"的结构。硬塞进"每消息一页"的队列模型反而要处理跨消息的分页游标状态，得不偿失。
- Worker CPU 时间不含网络等待（付费版默认 30s/可提 5min），拉取瓶颈是网络 I/O 不是 CPU；`ctx.waitUntil` 客户端断开后仍可跑。subrequest 付费版 10,000/调用：一次导入 = ceil(N/100) 页 + 命中写入的 saveVNEntry。**N≈2000 时约 20 页 + ≤2000 写入 ≈ 2020 subrequest,在 10k 内**;超大列表(>9000 条)才逼近上限,记为已知边界(见下)。
- 写入分批:每拉一页(≤100 条)→ 过滤已存在/纯 wishlist → 批量 `saveVNEntry`(或复用 repository 的分片 batch),每页结束更新任务进度(imported/skipped/failed),前端轮询即时可见。
- 兜底:导入任务与索引任务**互斥**(两者都写 vn_entries),复用 `INDEX_START_LOCK` Durable Object 或加同类锁,避免并发写入与进度串台。

**超大列表边界**:单次 Worker 调用(含 waitUntil)有墙钟上限。若 N 极大导致单次跑不完,首期策略 = 记录已导入进度并置 `partial` + 错误说明,提示用户重跑(已存在会跳过,天然断点续传)。不实现自动续跑队列——记入 spec 备忘,超出首期。

## 任务状态表泛化（解决 PRD 开放问题）

**选定：`index_tasks` 表加 `type` 列（默认 `'index'`），迁移经 07-11 建立的 MIGRATIONS 机制追加。** 理由:

- 表结构(id/status/total/processed/failed_ids/started_at/completed_at/error/last_reconciled_at)与导入任务需求几乎完全重合;进度/终态/轮询/汇总逻辑零改动复用。
- 加一列 `type TEXT NOT NULL DEFAULT 'index'`,导入任务写 `'ulist_import'`;`getIndexStatus` 返回体加 `type` 字段供前端区分文案。
- 复用 `reconcileIndexStatusFromItems` 需评估:它基于 `index_task_items` 逐条结果汇总。导入若也按条写 `index_task_items`(state success/failed)则汇总逻辑全复用;skipped 需第三态或单独计数(见下)。
- **skipped 计数**:现有 item 表只有 success/failed 两态。方案:skipped 不写 item 表,单独在任务记录加 `skipped` 计数列(迁移一并加),或复用 `error` 字段附带 skipped 摘要。design 倾向加 `skipped INTEGER DEFAULT 0` 列,语义最清晰。

> 迁移条目(v2,接 07-11 的 v1）：
> `ALTER TABLE index_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'index'`
> `ALTER TABLE index_tasks ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0`
> （单迁移多语句，同批原子——符合 07-11 迁移契约。）

## VNDB 客户端新增（src/vndb.js）

```js
// 共享映射：现 getVN 内联逻辑抽出，getVN 与 ulist 映射共用
function mapVnObjectToVndbData(vn) { /* 多语言标题 / tags 过滤 / g235 / rating/10 / length */ }

async getAuthInfo() {
  // GET /authinfo —— 注意：现有 request() 硬编码 POST，需支持 GET（authinfo 是 GET）
  // 返回 { id, username, permissions }；无 listread → 抛错（明确文案）
}

async fetchUList(userId, { page = 1, results = 100 }) {
  // POST /ulist, body: { user, fields, page, results, sort:'id' }
  // fields 含 vote,notes,started,finished,labels.id,labels.label + vn.<需要字段>
  // 返回 { results, more }
}

// 映射规则常量（07-11 固化，落此处）
const ULIST_LABEL_TO_STATUS = { 1:'playing', 2:'finished', 3:'stalled', 4:'dropped', 5:'wishlist' };
const STATUS_PRIORITY = ['finished','dropped','stalled','playing']; // 终态优先 2>4>3>1
function mapUListItemToEntry(item) {
  // labels → 单值 status（终态优先）；纯 wishlist(仅 label5) → { skip:true }
  // vote/10 → personalRating（vote 空→0）；started/finished → 日期
  // vn.* → mapVnObjectToVndbData
  // 返回 { skip } | 完整 entry
}
```

**client.request() 需改造**:当前签名 `request(endpoint, body)` 恒 POST。`/authinfo` 是 GET 无 body。改为 `request(endpoint, body, method='POST')`,GET 时不带 body——现有 `/vn` 调用不受影响(默认 POST)。

## 数据流与契约

- 启动端点信封:成功 `successResponse({ taskId, total? })`;鉴权失败 `errorResponse('VNDB Token 未配置 / 无 listread 权限...', 400/403)`——遵循无 code 中文文案契约。
- 进度查询复用 `/index/status`,返回体加 `type`、`skipped`,前端按 type 显示"导入"vs"索引"文案。
- 冲突:每条映射后 `getVNEntry(env, id)` 命中即 skip(+skipped),未命中才 `saveVNEntry`。**注意 subrequest 成本**:存在性检查是额外 D1 读。优化:开始时一次性 `listIndexableVNIds`(或 SELECT id)载入已存在 id 集合到内存,避免逐条查库(N 条省 N 次 subrequest)——推荐做法。

## 兼容与回滚

- 迁移只加列、有默认值,旧数据 `type='index'`/`skipped=0`,存量索引任务不受影响。
- 回滚 = 重部署旧 Worker,多出的列不读写无害(07-11 已验证此模式)。
- 前端新按钮独立,不改现有索引/导入 UI。

## 运维与限流

- VNDB 无官方明确 QPS,但礼貌起见分页间可加小延迟(如 waitUntil 内 sleep)——低优先,首期可不加,记备忘。
- UserAgent 已带项目标识(现有)。

## 测试策略

- `mapUListItemToEntry` 纯函数单测:四状态、多 label 终态优先(如 label [1,2] → finished)、纯 wishlist skip、[1,5] → playing(有 1-4 不跳)、vote 空→0、started/finished 映射、无 1-4 标签→status null。
- `mapVnObjectToVndbData` 抽出后 `getVN` 回归:构造同一 VN 对象,断言 getVN 输出与重构前逐字段一致(可对拍现有 getVN 测试)。
- `getAuthInfo`/`fetchUList`:mock fetch,断言 GET/POST 方法、body、错误分支。
- 导入端点:mock 客户端,断言跳过已存在、skipped 计数、分页汇总、鉴权失败信封。
- 迁移:复用 07-11 migrations.test 模式,断言 v2 在存量库正确加列。
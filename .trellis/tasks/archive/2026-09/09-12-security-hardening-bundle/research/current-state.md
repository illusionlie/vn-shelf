# 侦察事实：安全加固小包（2026-09-12）

实现前必读的代码形态与先例锚点。需求级事实见 prd.md Confirmed Facts。

## verifyJWT 现状（src/auth.js:44-75）

- `token.split('.')` 定长 3 段校验后，直接对 `encodedHeader.encodedPayload` 做 HMAC-SHA256 验签（`sign()`，src/auth.js:83-100），**全程不解码 header**——alg 校验需在验签后、payload 解析前插入（顺序无安全影响，因为验签固定 HMAC）。
- `payload.exp && payload.exp < now` 才拒绝（src/auth.js:64）：缺 exp、exp 非数值、`exp == now` 三种情况当前均放行。
- `createJWT`（src/auth.js:14-36）恒写 `alg: 'HS256'` + `exp = iat + 24h` + `jti`——收紧后存量合法 token 不受影响。
- `constantTimeEqual`（src/auth.js:158-166）未导出；等长短路 `if (a.length !== b.length) return false` 本身非常量时间，但长度不泄露密钥信息，属可接受实现。

## handleLogin 现状（src/router.js:300-327）

顺序：parseJsonBodyOr400 → password 非空（309-311）→ `getSettings(env)`（314）→ `verifyAdminPassword(settings, password)`（316）→ 失败 401 `'密码错误'`（318）→ 成功 `createJWT` + `setAuthCookie`（321-324）。
限流插入点：password 非空校验之后、`getSettings` 之前（precheck）；`verifyAdminPassword` 结果出来后（record）。错误信封统一走 `errorResponse`（src/utils.js:55-57）。

## DO 先例（src/index.js:31-136 `IndexStartLockDurableObject`）

- 构造器 `constructor(state, env)`，fetch 按 pathname 分发（`/acquire`、`/release`、`/status`）。
- storage 用 `this.ctx.storage.put/get`；TTL 过期用「存储时间戳 + 请求时惰性判定」（79-93 同 holder 重入逻辑）——LoginRateLimiter 沿用该惰性模式即可，不需要 alarm。
- 调用方包装：`tryAcquireIndexStartLock/releaseIndexStartStartLock`（router.js 使用 env 绑定 `idFromName(...).get().fetch(...)` 的封装模式可参照，实际封装位置在 index-task.js / index.js）。

## wrangler DO 迁移机制（wrangler.toml.example:26-32）

现有唯一 DO 走 `[[migrations]] tag = "v1"` + `new_sqlite_classes`。新增第二个 DO 类必须追加 **新 tag**（`v2`）而不是改 v1——Workers 迁移 tag 不可变。真实 `wrangler.toml` 在 .gitignore 内（部署走 deploy.yml 从 example 生成或本地手配），本地与生产配置都要同步。

## queue() 尾部循环（src/index.js:389-430）

- 位置：每消息处理循环之后。先 `getIndexStatus` 读状态，按 `delayedReconcileAt` 节流窗口决定跳过 / 立即 `reconcileIndexStatusFromItems` / `scheduleDelayedReconcile`。
- 对比：消息级处理（308-385）与 `scheduleDelayedReconcile`（216-287）均有 try/catch，唯独这段编排裸奔——兜底只加这一处，不改既有节流语义。

## vendor 锁定机制（package.json + scripts/fetch-vendor.cjs）

- 版本键在 package.json 顶层：`alpineVersion` / `markedVersion` / `purifyVersion`（非 dependencies）；拉取脚本 `npm run fetch:vendor` 从 jsdelivr 下载并做 sha256 校验。
- **待实现时确认**：sha256 是脚本内嵌清单还是下载时计算——决定升级改动面（前置核实清单第 1 项）。
- mitigations（CVE-2026-41680 评估）：marked 仅渲染管理员自输入简评，输出必过 DOMPurify（public/js/markdown.js:22-23），且无访客可控输入路径。

## 测试技术先例

- router 级测试：复制 router.js 源码到临时目录、正则替换 import 为桩模块（tests/router/envelope.test.mjs:113-121、index.start.test.mjs:260-278）。桩 env 绑定（如 DO）直接在构造 env 对象时注入假 fetch 对象。
- 纯后端模块直测先例：tests/vndb/（直接 import src/vndb.js）。tests/auth/ 为新目录，同模式。
- node --test 环境：node ≥ 18 自带 `crypto.subtle` / `btoa` / `atob`，auth.js 直测无需 polyfill。

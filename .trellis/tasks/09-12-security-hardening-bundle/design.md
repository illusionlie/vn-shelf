# 技术设计：安全加固小包

## 架构总览

四个子项互相独立，按 R1 → R4 分 commit 交付，任一回滚不影响其余。

| 子项 | 改动面 |
|------|--------|
| R1 登录限流 | 新增 `src/login-ratelimit.js`（纯函数）+ `LoginRateLimiterDurableObject`（src/index.js）+ wrangler 配置 |
| R2 JWT 收紧 | `src/auth.js` verifyJWT + 新测试域 `tests/auth/` |
| R3 vendor 升级 | package.json 三个版本键 + `npm run fetch:vendor` 重拉 |
| R4 queue 兜底 | src/index.js:389-430 包 try/catch |

## R1 登录限流

### 纯函数核心（src/login-ratelimit.js）

常量：`LOGIN_MAX_FAILURES = 5`、`LOGIN_LOCK_MS = 600_000`（10 分钟）、`LOGIN_WINDOW_MS = 900_000`（失败计数窗口 15 分钟）。

`evaluateLoginAttempt(state, { now, success })` → `{ allowed, failures, windowStart, lockUntil, retryAfterSec }`：

- `state = { failures, windowStart, lockUntil }`（均可为 null，视作无记录）
- `lockUntil > now` → `allowed: false`，`retryAfterSec = ceil((lockUntil - now) / 1000)`（success 也被拒，且不改动状态）
- `success: true` → 计数清零
- 失败 → 窗口过期（`now - windowStart >= LOGIN_WINDOW_MS`）则重开窗口从 1 计，否则 +1；达到 5 → `lockUntil = now + LOGIN_LOCK_MS`

单文件纯函数，node --test 直接覆盖全分支；DO 壳不进单测（与 `IndexStartLockDurableObject` 同策略，见 tests/router/index.start.test.mjs:150-178 的处理先例）。

### Durable Object 存储（LoginRateLimiterDurableObject，src/index.js 与现有 DO 并列）

- 实例粒度：`env.LOGIN_RATE_LOCK.idFromName(ip)` 每 IP 一个实例
- fetch 路由两个方法：
  - `/precheck`（GET）：读 storage 中的 state，返回 `{ allowed, retryAfterSec }`
  - `/record`（POST `{ success }`）：`evaluateLoginAttempt` 更新 state 后写回，返回新状态
- `storage.put('state', …)`；**不用 alarm**——窗口/锁定到期由纯函数按传入 `now` 惰性判定，过期状态被下次访问自然覆盖，实例闲置无清理负担

### handleLogin 集成顺序（src/router.js:300-327）

```
parse body → password 非空校验
→ precheck（锁定则 429 + Retry-After，不触 settings / PBKDF2）
→ getSettings → verifyAdminPassword
→ await record(success)          ← 同步 await，保证第 5 次失败后的下一次请求立即被锁
→ 签发 JWT
```

IP 来源 `request.headers.get('CF-Connecting-IP')`，缺失（本地 dev）时用固定占位键 `'local'`。

### 绑定与降级

wrangler.toml.example 追加：

```toml
[[durable_objects.bindings]]
name = "LOGIN_RATE_LOCK"
class_name = "LoginRateLimiterDurableObject"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["LoginRateLimiterDurableObject"]
```

真实 wrangler.toml（gitignore 内）需手动同步——implement.md 列为部署前检查项。`env.LOGIN_RATE_LOCK` 缺失时 **fail-open**：`console.warn` 后放行（可用性优先：漏配绑定的代价退化为现状的无限流，而不是登录全挂；与 INDEX_START_LOCK 的 fail-closed 语义相反，因其守护对象是可用性而非数据正确性）。

### 测试

- `tests/auth/login-ratelimit.test.mjs`：纯函数全分支——首次失败 / 窗口内递增 / 窗口过期重开 / 第 5 次触发锁定 / 锁内 success 与 failure 均 `allowed:false` 且状态不变 / 到期解锁 / 成功清零 / retryAfterSec 取整。
- router 测试沿用「复制源码替换 import / 桩 env 绑定」既有技术：429 + Retry-After 形态、锁内 `verifyAdminPassword` 桩未被调用（AC2）、成功登录后计数清零（AC3）。

## R2 JWT 校验收紧（src/auth.js:44-75）

- 解码 header 后校验 `alg === 'HS256'`，其余拒绝（当前固定 HMAC 验签使伪造本不可通过，此条为纵深防御，见 prd.md Confirmed Facts）。
- `payload.exp` 必须为有限数值，缺失或非法即拒绝（当前 `payload.exp &&` 短路使无 exp 的 token 永不过期）。
- 过期边界从 `exp < now` 收紧为 `exp <= now`。

兼容性：合法 token 均由 `createJWT` 签发（alg 恒 HS256、exp 恒存在），存量登录态不受影响；`exp == now` 边界仅影响恰好到期的 token。

`tests/auth/jwt.test.mjs`（不经 router 桩替换，直接 import src/auth.js；node ≥ 18 自带 WebCrypto / btoa / atob，无需 polyfill——仓库内已有纯后端测试先例 tests/vndb/）：createJWT/verifyJWT 往返、篡改 payload、篡改签名、伪造 alg（none / HS384）、缺 exp、非数值 exp、exp == now 与 exp = now-1 边界、constantTimeEqual 等长 / 不等长 / 非串入参（经导出或等价行为断言）、setAuthCookie（Secure 与非 Secure 两形态）与 clearAuthCookie 属性串、setAdminPassword → verifyAdminPassword 往返与错误密码。

注意：`constantTimeEqual` 目前未导出——测试经由 verifyPassword / verifyJWT 行为断言，或最小化导出（实现时二选一，倾向不改导出面）。

## R3 vendor 全量升级

package.json 版本键：`markedVersion: "18.0.12"`（fetch 时若有更高 18.0.x patch 取最新）、`purifyVersion: "3.4.15"`、`alpineVersion: "3.17.2"`。

`npm run fetch:vendor` 重拉——**实现前先读 `fetch-vendor.cjs` 确认 sha256 锁定方式**（若脚本内嵌哈希清单需同步更新；若运行时校验则只需改版本键）。

回归面：Alpine 3.14.9 → 3.17.2 影响 5 个页面全部指令（x-data / x-show / x-if / x-for / x-transition / x-ref / magic `$t` / Store / alpine:init 事件）；marked + DOMPurify 只影响详情简评渲染。仓库无 markdown 渲染单测（tests/public/ 仅有 i18n keys 等），故 AC6 以手测 + XSS 抽查（`<img onerror>` / `[link](javascript:)` 用例）补位。

## R4 queue() 尾部兜底（src/index.js:389-430）

编排循环整体包 try/catch，catch 内 `console.warn('[queue] tail reconcile failed', { error })`，不 rethrow（消息此时多已 ack，抛出只会让 runtime 记一次未处理异常并可能触发消息重投，重投会被幂等结果表挡住但徒增噪音）。

测试：tests/queue/ 既有 harness 注入 `reconcileIndexStatusFromItems` 抛错 → 断言 `queue()` 正常 resolve、其余消息 ack 语义不变、批处理摘要仍产出（AC8）。

## 兼容与回滚

- R1：部署即生效；回滚 = 还原代码（DO 实例残留无害，storage 随实例闲置）
- R2：无存储变更；回滚即还原函数
- R3：回滚 = 还原版本键 + 重拉 vendor（vendor 文件在 public/js/vendor/，git 跟踪与否以现状为准——implement.md 首步核实）
- R4：纯兜底，无状态

## 风险与取舍

- 每 IP 独立 DO 实例：攻击者换 IP 可绕过单 IP 锁定——单管理员自用站的可接受威胁模型（穷举成本仍被 PBKDF2 + 每 IP 锁定抬高）；全局限流属 Out of Scope
- record 同步 await 使失败登录多一次 DO 往返（毫秒级）：换取锁定语义严格
- fail-open 降级：漏配绑定时静默退化为无限流——以 warn 日志暴露，CI 的 deploy dry-run 无法覆盖绑定缺失（部署配置漂移属人工检查项）

# 安全加固小包：登录限流 + JWT 校验加固 + vendor 升级 + queue 兜底

## Goal

收敛四处已验证的安全与健壮性缺口：(1) 登录暴力破解面（可无限次 PBKDF2 尝试）；(2) JWT 校验的算法声明盲区、exp 缺失永不过期、auth 模块零直接测试；(3) vendor 库版本滞后（marked 18.0.5 落在 CVE-2026-41680 报告区间）；(4) `queue()` 尾部 reconcile 编排循环异常裸奔。全程不改变产品功能面。

## Confirmed Facts（仓库已验证）

- `POST /api/auth/login`（src/router.js:318 附近）无任何速率限制，全仓 grep 无 429/限流实现；每次尝试都执行 PBKDF2 100k 迭代（src/auth.js:142-151），暴力穷举同时消耗 CPU。
- `verifyJWT`（src/auth.js:44-75）固定用 HMAC-SHA256 验签、不读取 header.alg——伪造 `alg:none` 无法通过验签（**当前不可利用**，显式拒绝属纵深防御）；`payload.exp &&` 短路（src/auth.js:64）使无 exp 的 token 永不过期（现有签发路径恒写 exp，属防御性收紧）。
- auth.js 无任何直接单测；router 级测试全部把 auth 模块替换为桩（tests/router/config.update.test.mjs:56-75 等 5 处），verifyJWT 的 exp 边界 / 篡改签名 / constantTimeEqual / Cookie 属性均未覆盖。
- vendor 版本锁定在 package.json 顶层（alpineVersion 3.14.9 / markedVersion 18.0.5 / purifyVersion 3.4.11），由 `npm run fetch:vendor` 拉取自托管。marked 18.0.x 线有 CVE-2026-41680（Tokenizer 无限递归 OOM DoS，18.0.12 修复）；缓解因素：仅渲染管理员自己的简评且输出过 DOMPurify（public/js/markdown.js:22-23）。
- `queue()` 末尾的节流/即时 reconcile 编排循环（src/index.js:389-430）无 try/catch；同函数内每条消息处理（308-385）与延迟 reconcile（216-287）均有完整 catch。该循环抛错时消息多已 ack，异常会炸掉整个 queue() 调用。
- 项目已具备 Durable Object 部署经验（INDEX_START_LOCK：wrangler.toml.example `new_sqlite_classes` + migration tag v1），新增 DO 需同步 example 与真实配置。

## User Decisions

| 决策 | 结论 |
|------|------|
| vendor 升级范围 | **全量升级**：marked ≥ 18.0.12、DOMPurify 3.4.15、Alpine 3.17.2（2026-09-12 确认） |
| 登录锁定参数 | **按 IP 连续 5 次失败锁 10 分钟**：失败计数窗口 15 分钟、成功登录清零、锁定判定先于 PBKDF2（2026-09-12 确认） |

## Requirements

### R1 登录速率限制

- `POST /api/auth/login` 增加按 IP（`CF-Connecting-IP`）的失败计数与锁定：连续 5 次密码错误后锁定 10 分钟；锁定期间即使密码正确也返回 `429`（含 `Retry-After`，错误文案不泄露密码对错）。
- 锁定判定必须在 PBKDF2 计算之前（防穷举同时防 CPU 消耗）。
- 成功登录清零该 IP 计数；计数与锁定状态需跨 isolate 存活（Durable Object 方案见 design.md，D1 行存储为备选）。
- 锁定判定/计数核心逻辑抽为纯函数，可直接 node --test（DO 壳只做存储与 TTL）。

### R2 JWT 校验加固 + auth 直测

- `verifyJWT` 显式校验 header：`alg` 必须为 `HS256`；`exp` 必须存在且为数值，缺失或非法即拒绝；过期边界收紧为 `exp <= now` 拒绝。
- 新增 `tests/auth/` 直测（不经 router 桩替换）：createJWT/verifyJWT 往返、篡改 payload、篡改签名、伪造 alg、缺 exp、过期与 exp==now 边界、constantTimeEqual 等长/不等长、setAuthCookie/clearAuthCookie 属性串、setAdminPassword/verifyAdminPassword 往返。

### R3 vendor 版本升级（范围待决策）

- marked → ≥18.0.12（CVE-2026-41680 修复线）；DOMPurify → 3.4.15；【若选全量】Alpine → 3.17.2。
- `package.json` 锁定版本更新 + `npm run fetch:vendor` 重拉 + sha256 校验通过。
- 【若选全量】升级后五页面手测冒烟（登录 / 书架 / 详情 / 编辑 / Tier 拖拽 / 设置 / 统计）。

### R4 queue() 尾部 reconcile 兜底

- src/index.js:389-430 编排循环包 try/catch：异常仅 `console.warn` 记录，不向 queue() 调用方抛出（消息此时多已 ack）。
- 测试：注入 reconcile 抛错，断言 queue() 正常完成且批处理摘要仍产出。

## Acceptance Criteria

- [ ] AC1 连续 5 次错误密码后，第 6 次登录（无论对错）返回 429 且带 Retry-After；锁定到期后正确密码可登录。
- [ ] AC2 锁定期间请求不执行 PBKDF2（测试断言 hashPassword 未被调用）。
- [ ] AC3 成功登录重置失败计数。
- [ ] AC4 伪造 alg / 缺失 exp / exp <= now 的 token 校验失败。
- [ ] AC5 `tests/auth/` 直测新增且全绿；`npm run lint`、`npm test` 通过。
- [ ] AC6 vendor 重拉后版本与 package.json 锁定一致；marked ≥ 18.0.12；简评渲染回归通过（含 XSS 用例）。
- [ ] AC7 【若选全量】五页面手测冒烟通过。
- [ ] AC8 reconcile 抛错注入下 queue() 不再整体异常。

## Out of Scope

- 全站通用限流中间件、CAPTCHA、双因素认证。
- `/api/auth/init` 与公开 GET 端点的限流。
- JWT 刷新机制 / 滑动过期。
- wrangler 配置双轨漂移清理（BACKGROUND 死配置）——另立卫生任务。

## Open Questions

- 无。技术方案见 `design.md`，执行计划见 `implement.md`。

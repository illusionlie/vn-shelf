# Turnstile 官方契约速查（实现参考）

> 来源：Cloudflare Turnstile 官方文档（developers.cloudflare.com/turnstile/）。
> ✅ 2026-09-19 步骤 0 已按官方文档逐项核对（WebFetch + Tavily raw markdown 双通道），
> ❓ 标记已移除；dummy sitekey 表与规划期记忆有 **两处实质差异**，以本文修正值为准。

## siteverify 端点（服务端）

- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
- 请求体官方文档列出 `application/x-www-form-urlencoded` 与 `application/json` 两种
  （multipart/FormData 出现在官方 JS 示例中但未明文列入支持列表）。form-urlencoded 为
  最稳路径，`URLSearchParams` 自动带头——本项目选定此路。字段：
  - `secret`（必填）：secret key
  - `response`（必填）：widget 回调拿到的 token（**官方文档标注 max 2048 chars**——模块入口 >2048 直接判 invalid 不发请求的防御有了官方依据）
  - `remoteip`（可选）：访客 IP，改善评分
  - `idempotency_key`（可选）：本项目不用（token 本身单次消费）
- 响应 JSON：
  ```json
  { "success": true|false, "error-codes": ["..."], "challenge_ts": "...", "hostname": "...", "action": "...", "cdata": "..." }
  ```
  注意键名 `error-codes` 带连字符。
- 错误码全集：`missing-input-secret` / `invalid-input-secret` / `missing-input-response` / `invalid-input-response` / `bad-request` / `timeout-or-duplicate` / `internal-error`
- **token 单次消费**：一个 token 只能 siteverify 一次，重复验证报 `timeout-or-duplicate`；token 有效期 ~300 秒。→ 设计推论：每次登录尝试后必须 reset widget。
- token 长度不固定，实测 < 2000 字符 → 模块入口 > 2048 直接判 invalid 不发请求。

## widget 客户端

- 脚本：`https://challenges.cloudflare.com/turnstile/v0/api.js`，显式渲染加 `?render=explicit`（页面加载时不自动扫 `cf-turnstile` class，由代码调 `turnstile.render`）。
- `turnstile.render(el, params)` → widgetId；params 关键项：
  - `sitekey`（必填）
  - `theme`: `'auto' | 'light' | 'dark'`（auto 跟系统，不跟站点手动主题——本项目手动切主题，须按 `html.dark-mode` 显式传）
  - `callback(token)`、`'expired-callback'()`、`'error-callback'(errorCode)`（已核对官方 widget-configurations 文档：error-callback 接收 errorCode 参数；未设置 error-callback 时 Turnstile 会直接抛 JS 异常，生产建议设置——本项目均已设置）
  - 另有 `'timeout-callback'()`（交互挑战超时），本项目未用
- `turnstile.reset(widgetId?)`：重置并重新走挑战（managed 模式通常静默自动通过，新 token 经 callback 回来）
- `turnstile.remove(widgetId)`：销毁 widget（设置页临时测试容器用完清理）
- 标准尺寸 300×65；容器留宽度即可。
- **脚本无法自托管**：挑战逻辑与 Cloudflare 域绑定且持续更新——vendor 自托管规则的本功能例外依据。

## 测试用 dummy keys（✅ 已对 https://developers.cloudflare.com/turnstile/troubleshooting/testing/ 原文表格核对）

⚠️ 规划期记忆有两处错误（`2x…AB` 误记为"恒通过不可见"、`1x…BB` 误记为"恒阻止可见"），
以下为官方表格原文（Behavior × Widget Type 逐格核对）：

| 用途 | 值 |
|------|-----|
| Sitekey 恒通过（可见） | `1x00000000000000000000AA` |
| Sitekey 恒失败（可见） | `2x00000000000000000000AB` |
| Sitekey 恒通过（不可见） | `1x00000000000000000000BB` |
| Sitekey 恒失败（不可见） | `2x00000000000000000000BB` |
| Sitekey 强制交互挑战（可见） | `3x00000000000000000000FF` |
| Secret 恒通过 | `1x0000000000000000000000000000000AA` |
| Secret 恒失败 | `2x0000000000000000000000000000000AA` |
| Secret 报 token-already-spent | `3x0000000000000000000000000000000AA` |

官方 Testing scenarios 表：`1x…AA(sitekey) + 1x…AA(secret)` 恒成功；`2x…AB(sitekey) + 2x…AA(secret)` 恒失败；
`1x…AA(sitekey) + 3x…AA(secret)` 报 timeout-or-duplicate。dummy 组合产生/消费 dummy token
`XXXX.DUMMY.TOKEN.XXXX`，**真实 secret 会拒绝 dummy token**——手测时 sitekey 与 secret 必须都用 dummy 值。

## Workers 侧注意

- `AbortSignal.timeout(ms)` 在 Workers 原生支持（✅ 已核对：Cloudflare 官方博客
  "The road to a more standards-compliant Workers API" 明确演示 `AbortSignal.timeout(10)`；
  本项目 `compatibility_date = "2026-02-14"`，远晚于该 API 落地；本地测试 Node ≥ 18 亦原生支持）。
- Worker → `challenges.cloudflare.com` 为 CF 内网路径，延迟低；不计入 subrequest 限制的担忧不存在（siteverify 每登录最多 1 次）。
- `CF-Connecting-IP` 头由 CF 边缘注入，Workers 内可信；缺失（`wrangler dev` 本地）时 siteverify 不传 `remoteip`。

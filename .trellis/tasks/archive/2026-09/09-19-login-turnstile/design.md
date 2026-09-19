# 技术设计：登录页 Cloudflare Turnstile 集成

## 架构总览

三层：网络模块（新 `src/turnstile.js`）→ 路由接线（`handleLogin` / `handleAuthStatus` / config 两端点 + 新测试端点）→ 前端（登录页 widget 生命周期 / 设置页管理与测试）。

**零基础设施变更**：无新绑定、无 DO、无 D1 迁移（settings blob 加两键）、wrangler 双轨文件不动。

## 1. `src/turnstile.js`（新模块，无 import 依赖）

```js
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken({ secretKey, token, remoteIp, fetchImpl = fetch })
// → { outcome: 'pass' | 'invalid' | 'error', errorCodes?: string[] }
```

- **请求**：POST，form-urlencoded（`new URLSearchParams({ secret, response, remoteip? })`——`URLSearchParams` 自带正确 Content-Type）。remoteip 传真实 `CF-Connecting-IP`，头缺失时不传（**不用**限流的 `'local'` 占位——那是 DO 实例键，不是 IP）。
- **超时**：`AbortSignal.timeout(10_000)`（Workers 与 node ≥ 18 均原生支持；实现前在 research 核对）。
- **输入防御**：token 非字符串或长度 > 2048 → 直接 `{ outcome: 'invalid' }` 不发网络请求（Turnstile token 实际 < 2000 字符，超长必为恶意载荷）。
- **判定**：`success: true` → `pass`；`success: false` → `invalid` + `error-codes` 透传（注意响应键是 `error-codes` 带连字符）；throw / 非 2xx / JSON 解析失败 / 字段形态异常 → `{ outcome: 'error' }`——**模块永不抛出**，异常语义统一由路由层决定（fail-open / fail-closed 分野在调用方）。
- 无状态纯网络胶水，`fetchImpl` 注入直测（对照 `login-ratelimit.js` 的纯函数直测先例）。

## 2. `handleLogin` 接线（src/router.js:430 起）

扩展 09-12 限流契约的插入顺序：

```
parse body → password 非空校验（400）
→ 限流 precheck（锁定 429 + Retry-After，先于 getSettings / PBKDF2 / siteverify）
→ getSettings（单次，后续 Turnstile / 密码 / JWT 全复用——settings 单请求复用契约不破）
→ [新增] turnstileEnabled = !!(settings.turnstileSiteKey && settings.turnstileSecretKey)
    ├─ !enabled → 跳过
    ├─ enabled && !body.turnstileToken → 400 '请完成人机验证'
    ├─ verifyTurnstileToken({ secretKey, token, remoteIp })
    │    ├─ 'invalid' → 403 '人机验证失败，请重试'（errorCodes 进 console.warn 排障，不回前端）
    │    └─ 'error'   → console.warn('[auth][turnstile] siteverify failed, fail-open', …) → 继续
→ verifyAdminPassword → await record（语义不变：只数密码尝试）
→ 签发 JWT
```

- Turnstile 拒绝路径 **不调 `recordLoginResult`**：限流计数 = 密码尝试次数，Turnstile 拒绝时密码未校验、PBKDF2 未消耗。
- 全部错误走 `errorResponse(中文, 4xx)` 无 code——前端 `friendlyErrorMessage` 的 4xx 中文透传分支直接可用（信封契约）。
- 顺序理由：precheck 在前（锁定的 IP 连 siteverify 都不用打，Turnstile 无法被用来放大查询）；turnstile 在密码前（尽早拒绝自动化流量，省 PBKDF2）。

## 3. `handleAuthStatus` 扩展（src/router.js:391）

data 增 `turnstileSiteKey`，**输出走双钥匙门**：`settings.turnstileSiteKey && settings.turnstileSecretKey ? settings.turnstileSiteKey : ''`——「widget 可见 ⟺ 后端强制校验」成为全局不变量，半配（仅 siteKey）不向登录页暴露半成品配置（否则前端会要求一个后端并不校验的 token）。公开无泄露面：siteKey 本来就要嵌进公开页面源码。

实现形态：现状 `isInitialized(env)` 内部已 `getSettings` 一次。改为 handleAuthStatus 内单次 `getSettings` + 内联判定 `initialized = !!(settings.adminPasswordHash && settings.jwtSecret)`，**不让该端点 settings 查询次数变多**（实现时核对现状再落，这是约束不是指定实现）。

## 4. `/api/config` GET/PUT 扩展 + 测试端点

**GET**（认证）：data 增 `turnstileSiteKey: settings.turnstileSiteKey || ''`（明文——管理员要看到当前键）+ `hasTurnstileSecret: !!settings.turnstileSecretKey`。

**PUT**（认证）：前置校验段新增（09-15 不变量：任何 400 先于一切持久化）：

```
turnstileSiteKey !== undefined → 非 string 400 'turnstileSiteKey 必须为字符串'
                              → trim 后 > 200 → 400 'turnstileSiteKey 长度不能超过 200'
turnstileSecretKey 同规则、同阈值（两键独立校验、独立赋值；赋值段无 return）
```

**`POST /api/config/turnstile/test`**（认证，路由表新增）：

```
body { siteKey, secretKey, token } —— 三值均须非空 string，token ≤ 2048，否则 400
outcome = await verifyTurnstileToken({ secretKey: body.secretKey, token: body.token, … })
  'pass'    → successResponse({ ok: true })
  'invalid' → successResponse({ ok: false, errorCodes })   ← 200：测试失败是有效结果，非协议错误
  'error'   → errorResponse('人机验证服务暂时不可用，请稍后重试', 503)
```

**语义分野（写 spec 时要讲清）**：登录侧 siteverify 异常 fail-open（守可用性，漏验证不阻断管理员），测试端点 fail-closed（守真实性——fail-open 会让误配拿到假绿，正好废掉该端点存在的意义）。测试端点用**请求体输入值**而非已存值，使「未保存的候选配置」可被先验证。

## 5. 前端登录页

**api.js**：`login(password, turnstileToken)`——body 增 `turnstileToken`（空串时后端仅在启用后要求，语义一致）；`configAPI.testTurnstile({ siteKey, secretKey, token })` 新方法。

**loginPage.js** 状态机：

```
init(): status.data.turnstileSiteKey → this.turnstileSiteKey（'' = 未启用）
        isInitialized === true 后 $nextTick → mountTurnstile()
mountTurnstile(): loadTurnstileScript()（模块级 promise 单例，防重复注入）
  → window.turnstile.render(this.$refs.turnstileBox, {
      sitekey, theme: documentElement.classList.contains('dark-mode') ? 'dark' : 'light',
      callback: t => this.turnstileToken = t,
      'expired-callback': () => this.turnstileToken = '',
      'error-callback': () => this.turnstileToken = ''
    }) → this.turnstileWidgetId
handleSubmit(): enabled && !turnstileToken → this.error = t('login.turnstileRequired')，不发请求
  → login(password, turnstileToken)
  → finally { if (widgetId != null) turnstile.reset(widgetId)；turnstileToken = '' }
```

- `?render=explicit`：显式渲染配合 Alpine `template x-if` 的异步挂载（x-ref 在 template 内同组件作用域可用）。
- token 单次消费 → **每次尝试后 reset**（无论成败；失败重试与 401 后再提交都拿新 token）；token 生命周期 ~300s，expired-callback 兜底。
- 脚本 onerror → `this.error = t('login.turnstileLoadFailed')`（网络拦截场景的可操作提示）。

**login.html**：登录表单（`isInitialized === true` 模板）密码框与错误行之间插 `<div class="turnstile-box" x-ref="turnstileBox" x-show="turnstileSiteKey"></div>`；`login.css` 加容器样式（300px widget 居中 + 上下间距）。

## 6. 前端设置页

`settings.html` 管理密码 section 后新 section「Cloudflare Turnstile」：

- siteKey input（text，预填 `config.turnstileSiteKey`）；secretKey input（password 型**不回显**——GET 只有布尔，placeholder 语义「已配置，留空保持/输入更换」需与保存语义协调：**保存时两框都提交**，secret 留空 = 清除。hint 明示）。
- 状态行：两键齐 = 已启用；半配 = 未启用（提示补齐另一键）；全空 = 未配置。
- 「测试」按钮：输入两框非空校验 → 动态渲染临时 widget（当前输入 siteKey，容器用完 `turnstile.remove()` 防叠加）→ token → `configAPI.testTurnstile` → 成功 toast / 失败展示 errorCodes 或文案。
- 「保存」按钮：`configAPI.update({ turnstileSiteKey, turnstileSecretKey })`。
- hint 文案：CF 控制台 Turnstile 页建站获取两键；widget 域名须含站点域名（本地 dev 加 `localhost`）；官方 dummy keys 链接可无账号测试。

## 7. i18n 新 key 清单（zh-CN / en 双侧，parity 测试卡）

```
login.turnstileRequired / login.turnstileLoadFailed
settings.turnstileSectionTitle / turnstileSiteKeyLabel / turnstileSecretLabel
settings.turnstileHintKeys / turnstileHintDomain / turnstileStatusEnabled / turnstileStatusHalf
settings.turnstileTestButton / turnstileTestOk / turnstileTestFail
toast.turnstileSaved
```

能复用既有 key（`settings.configured` / `settings.notConfigured` / `common.save`）处不新增；最终清单以实现时 diff 为准，parity 测试兜底。

## 8. 测试设计

| 文件 | 覆盖 |
|------|------|
| `tests/auth/turnstile.test.mjs`（新，直测 fetchImpl 注入） | pass；invalid + error-codes 透传；throw / 非 2xx / 坏 JSON → error；token 非法形态 → invalid 且 fetchImpl 零调用；form body 三字段与 remoteip 省略断言；超时 → error |
| `tests/router/login.turnstile.test.mjs`（新，复制 router 源码替换 import 桩，同 login.ratelimit.test.mjs 技术） | AC1 两态未配置放行；AC2/AC3 拒绝 + verifyAdminPassword/record 计数 0；AC4 全通；AC5 三态 fail-open；AC6 锁内 siteverify 调用 0 |
| `tests/router/config.update.test.mjs`（扩展） | AC7 校验矩阵 + 零持久化双计数断言 + GET 两字段 |
| `tests/router/config.turnstile.test.mjs`（新） | AC8 测试端点：401 / 缺参 400 / 输入值与已存值分离断言 / ok:true / 200+ok:false / 503 |
| i18n parity 既有测试 | AC12 自动覆盖 |

**turnstile 桩策略与 login-ratelimit 的差异**：限流测试桩内嵌真实纯函数（判定逻辑必须真实）；turnstile 桩是**可控 outcome 开关**（pass/invalid/error 三态由测试指令）——`verifyTurnstileToken` 是网络胶水而非判定逻辑，其语义已由直测全分支覆盖，router 测试关注的是接线顺序与信封，复刻协议反而违反「桩不复刻实现」原则的反向应用（桩只复刻协议，这里协议就是 outcome 三态）。

**patch 桩依赖图同步（B6c 教训，必须全量）**：router.js 新增 `import { verifyTurnstileToken } from './turnstile.js'` → 七个 copy 型 router 桩（envelope / config.update / vndb.search / login.ratelimit / index.start / vn.status / import.appearance）+ queue 加载器 + ulist 桩全部同步补 turnstile 直通或开关桩，否则 `ERR_MODULE_NOT_FOUND`。实现步骤 4 单独列出全量核查。

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 误配锁死（siteKey 域名不符 → widget 永远失败 → 管理员进不了登录页） | 双钥匙启用门（半配不生效）+ 测试端点先测后存 + README 记 `wrangler d1 execute` 清键恢复路径（最终退路） |
| vendor 自托管规则冲突 | 脚本无法自托管（挑战域绑定 + 持续更新）；按需注入，未启用者零第三方请求；Phase 3 写入 frontend spec 例外条款 |
| token 过期 / 单次消费 | expired-callback 清 token；每次尝试后 reset |
| siteverify 延迟 | Worker → CF 内网调用，登录非高频路径，接受；不缓存（token 单次消费，缓存无意义） |
| 管理员在多设备旧会话 | 不涉及：只影响新登录，已有 JWT 不校验 Turnstile |

## 10. 回滚

单 commit 交付（后端 + 前端 + 测试一体，功能由配置开关控制，代码合入后未配置 = 行为不变）。代码回滚 = revert 单 commit；功能回退 = 设置页清空两键（无需回滚代码）。

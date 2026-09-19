# 登录页集成 Cloudflare Turnstile 人机校验

## Goal

为公开登录端点 `POST /api/auth/login` 增加 Cloudflare Turnstile 人机校验层，与既有 IP 限流（`LOGIN_RATE_LOCK`）组成纵深防御：限流卡「频率」，Turnstile 卡「自动化」。**未配置时行为与现状逐字节一致**（存量部署零感知升级）。

## Background

- 登录端点公网暴露，现状防护 = IP 限流（15 分钟窗口 5 次失败锁 10 分钟）+ PBKDF2。分布式低速凭据 stuffing 可绕过单 IP 限流，Turnstile 补上「证明是人」这一层。
- 用户已定三项决策：走 Trellis 任务全流程；两把密钥存 D1 settings 表（设置页管理，与 `vndbApiToken` 同模式）；siteverify 校验服务本身异常时 **fail-open 放行**（可用性优先，与 `LOGIN_RATE_LOCK` 同语义）。

## Requirements

### R1 后端登录校验（`src/router.js` + 新 `src/turnstile.js`）

- **双钥匙启用门**：`settings.turnstileSiteKey` 与 `settings.turnstileSecretKey` 均 non-empty 才启用校验；任一缺失 = 完全跳过（现状行为）。理由：只配一把会出现「后端要 token、前端无 widget」的管理员自锁死。
- **插入顺序**（扩展 09-12 限流契约）：password 非空校验 → 限流 precheck（429 优先于一切）→ getSettings → Turnstile 校验 → verifyAdminPassword → record → JWT。
- 已启用 + 请求无 `turnstileToken` → 400「请完成人机验证」；siteverify 判定 invalid → 403「人机验证失败，请重试」。
- **被 Turnstile 拒绝的请求不计入限流计数**（限流语义 = 密码尝试计数；Turnstile 拒绝时密码未发生校验，且未消耗 PBKDF2）。
- siteverify 网络异常 / 非 2xx / 响应解析失败 → `console.warn` + 放行（fail-open）。
- secretKey 仅存服务端 settings，任何响应不回显；错误文案不泄露配置细节。

### R2 配置管理（settings blob + `/api/config`）

- settings 新增 `turnstileSiteKey`（公开级：本就要嵌入登录页）/ `turnstileSecretKey`（敏感）两键，默认 `''`。
- `GET /api/config`（认证）返回 `turnstileSiteKey` 明文 + `hasTurnstileSecret` 布尔（脱敏对齐 `hasVndbApiToken` 先例）。
- `PUT /api/config` 接受两键：非 string → 400；trim 后超 200 字符 → 400；空串合法 = 清除。遵守 09-15 前置校验不变量：任何 400 之前零持久化（`setAdminPassword` / `saveSettings` 零调用）。
- 两键独立可存（半配状态合法落库），但启用门在登录侧，半配 = 不生效；设置页 hint 提示两键齐才启用。
- 导出（`/api/export`）与导入（`/api/import`）**不携带**两键（对齐 `vndbApiToken`：安全配置不进备份）。
- **新增** `POST /api/config/turnstile/test`（认证）：body `{ siteKey, secretKey, token }`，用请求体输入值（而非已存值）调 siteverify 返回验证结果——支撑设置页「先测试后保存」，消除误配锁死（本功能最大风险）。

### R3 登录页 widget（`login.html` + `loginPage.js` + `api.js`）

- `GET /api/auth/status`（公开，登录页已在调）data 增加 `turnstileSiteKey`（未启用 = `''`）。
- siteKey 非空时才动态注入 `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` 并显式渲染 widget；**未启用的部署零第三方请求**（vendor 自托管规则的显式例外，脚本无法自托管，Phase 3 写入 spec）。
- 提交门控：启用时无 token 不发请求，前端直接提示；`authAPI.login` body 带 `turnstileToken`。
- token 单次消费：每次登录尝试后（无论成败）`turnstile.reset()` 取新 token；expired-callback 清空本地 token。
- widget theme 跟随站点主题（`html.dark-mode` → `'dark'`）。
- 仅登录表单渲染 widget；初始化表单不渲染（Turnstile 只能在初始化完成后经设置页配置，首次部署窗口必然未启用，无场景）。

### R4 设置页管理 UI（`settings.html` + `settingsPage.js`）

- 新 section：siteKey / secretKey 输入 + 配置状态行（已启用 / 半配提示 / 未配置）+ hint（CF 控制台获取、站点域名需加入 widget 域名、本地 dev 需含 `localhost`、官方 dummy keys 可用于测试）。
- 「测试」按钮：用输入框当前值渲染临时 widget → 拿 token → 调 R2 测试端点 → 绿 / 红反馈；建议测试通过后再保存（保存不强制，允许强存）。
- 保存走既有 `configAPI.update`；清空 secret = 禁用功能（hint 说明）。

### R5 测试与文档

- 测试矩阵见 design.md §8；i18n 新 key zh-CN / en 双语 parity（既有 key-diff 测试自动卡住）。
- README：Turnstile 开启指南（控制台建站、两键填入、dummy keys 表）；AGENTS.md API 表补 test 端点一行；spec 沉淀（Phase 3）：backend 登录 Turnstile Scenario + frontend vendor 例外条款。

## Non-Goals

- `/api/auth/init` 不加 Turnstile（只可能在未初始化窗口被调用，彼时 Turnstile 必然未配置）。
- 不做 widget 模式配置（managed / non-interactive / invisible 由 CF 控制台 siteKey 侧决定，代码无感）。
- 不改限流参数与 DO 结构。
- 不自托管 / 不代理 Turnstile 脚本（技术上不可行：挑战脚本与 Cloudflare 域绑定且持续更新）。

## Acceptance Criteria

- [ ] AC1 未配置（两键均空 / 仅一把）→ 登录请求无 token 行为与现状一致（放行到密码校验）；`GET /api/auth/status` 返回 `turnstileSiteKey: ''`。
- [ ] AC2 已启用 + 无 token → 400 中文文案；`verifyAdminPassword` 与 `recordLoginResult` 调用数为 0。
- [ ] AC3 已启用 + token invalid → 403 中文文案；`verifyAdminPassword` 与 `recordLoginResult` 调用数为 0。
- [ ] AC4 已启用 + token pass + 密码正确 → 200 登录成功（信封形态不变）。
- [ ] AC5 siteverify 异常三态（throw / 非 2xx / 坏 JSON）→ warn 放行，密码正确仍 200（fail-open）。
- [ ] AC6 限流锁内（429）优先于 Turnstile 检查：不发起 siteverify 调用。
- [ ] AC7 PUT `/api/config` 两键校验矩阵（非 string 400 / trim 后超 200 → 400 / 空串清除 / 混合请求含非法字段时 `setAdminPasswordCalls` 与 `saveSettingsCalls` 均为 0）；GET 返回明文 siteKey + `hasTurnstileSecret` 布尔。
- [ ] AC8 测试端点：未认证 401；缺参 400；**用请求体输入值而非已存 settings 值**验证（桩分离断言）；pass → `ok:true`；invalid → 200 + `ok:false`；siteverify 异常 → 503（测试端点不 fail-open：测试目的就是验证真实可用性，fail-open 会给假绿）。
- [ ] AC9 登录页（手测 + lint）：未启用无脚本注入；启用后 widget 渲染、无 token 提交被前端拦截、登录失败后 widget 自动重置、dark 模式下 widget 深色。
- [ ] AC10 导出数据不含两键；导入 payload 含两键时被忽略、不报错。
- [ ] AC11 `npm run lint` 0 告警 + `npm test` 全绿（含新增用例与全部桩同步）。
- [ ] AC12 i18n 新 key 双语 parity 全绿。

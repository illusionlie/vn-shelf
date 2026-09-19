# 执行计划：登录页 Turnstile 集成

全局验证命令：`npm run lint && npm test`。按步骤推进，每步内的测试随写随跑；步骤 1-2（后端）完成后可做一次中场核对，步骤 5 全量验证 + 手测。

## 0. 前置核实（read-only，结论回填此处）

- [x] `handleAuthStatus` / `isInitialized` 现状调用链——确认扩展后 settings 查询次数不增（design §3 约束）
  - 结论：现状 = isInitialized 内 1 次 getSettings + authMiddleware 0/1 次；改造后 handleAuthStatus 内联判定（1 次）+ authMiddleware 0/1 次，次数持平。附带修正：envelope.test.mjs 桩的 getSettings 原返回空凭据（旧 isInitialized 桩恒 true 掩盖了语义），已对齐真实语义（凭据齐备 = 已初始化）
- [x] 列全 copy 型 router 测试加载器的 import 替换机制与清单（spec 记 7 桩 + queue 加载器 + ulist 桩，逐一核对实际文件名）
  - 结论：实际 **8 个** router 源码加载器（spec 七桩之外还有 `tests/router/http-cache.test.mjs` 也复制 router.js 做 patch）；queue 加载器整体桩化 router（`./router.stub.mjs`），不触达 router 依赖图，无需改；ulist 桩本身不变。grep 交叉核对：引用 router.js 的测试文件集合与含 `./turnstile.js` 桩的集合完全一致（10 文件）
- [x] `settingsPage.js` 的 `loadConfig` / `saveVndbToken` 形态与 `settings.html` section 注入点
  - 结论：loadConfig 直接解包 `res.data` 到 `this.config`（turnstile 两字段经此进入 + siteKey 另存 `this.turnstileSiteKey` 预填）；保存模式走 `withLoading + configAPI.update`；注入点 = 密码设置 section 之后
- [x] locales 现有 key 命名（`settings.configured` / `settings.notConfigured` / `common.save` 是否可直接复用）
  - 结论：`settings.notConfigured` / `common.save` 复用；`settings.configured`（"已配置"）语义偏弱未复用，新增 `settings.turnstileStatusEnabled`（"已启用"）更贴合启用门语义
- [x] research/turnstile.md 的待核项（dummy keys 精确值、`AbortSignal.timeout` 在 Workers 可用性、siteverify form/JSON 格式）——以官方文档为准修正
  - 结论（已回填 research 文件）：**dummy sitekey 表两处记忆错误**——`2x…AB` 实为「恒失败·可见」（非恒通过不可见）、`1x…BB` 实为「恒通过·不可见」（非恒阻止可见）；secret 三把值正确。siteverify 官方支持 urlencoded + JSON（multipart 仅出现在 JS 示例）；`response` 字段官方标注 max 2048 chars。`AbortSignal.timeout` Workers 原生支持（官方博客明示，项目 compatibility_date 2026-02-14 无虞）。error-callback 签名确认接收 errorCode 参数，未设置时 Turnstile 直接抛异常

## 1. 后端模块与登录接线

- [x] `src/turnstile.js`：`TURNSTILE_VERIFY_URL` + `verifyTurnstileToken`（永不抛出，outcome 三态）
  - 偏差：新增 `timeoutMs = 10_000` 参数——design §8 要求「超时 → error」直测用例，硬编码 10s 会让单用例拖慢 CI，注入短超时是唯一可测路径
- [x] `src/router.js`：import + `handleLogin` 插入（双钥匙门 / 400 缺 token / 403 invalid / fail-open warn，不 record）
- [x] `src/router.js`：`handleAuthStatus` 增 `turnstileSiteKey`
- [x] `tests/auth/turnstile.test.mjs`（直测全分支，design §8 第一行）
- [x] `tests/router/login.turnstile.test.mjs`（复制源码替换 import 技术；turnstile 桩 = outcome 开关）
- [x] 桩同步：本步骤新增的 router import 影响到的既有 loader 先行同步（步骤 4 再全量核查）

验证：`node --test tests/auth/turnstile.test.mjs tests/router/login.turnstile.test.mjs` → 11 + 10 全绿

## 2. 配置端点

- [x] `handleGetConfig`：`turnstileSiteKey` 明文 + `hasTurnstileSecret` 布尔
- [x] `handleUpdateConfig`：两键前置校验（非 string / trim > 200 → 400，先于一切持久化）+ 赋值
- [x] `POST /api/config/turnstile/test` 新路由（认证；输入值验证；invalid → 200 `ok:false`；error → 503）
- [x] `tests/router/config.update.test.mjs` 扩展（AC7 矩阵 + `setAdminPasswordCalls`/`saveSettingsCalls` 双零断言）
- [x] `tests/router/config.turnstile.test.mjs` 新建（AC8；settings 桩与 siteverify 桩输入分离断言「用输入值非已存值」）
- [x] 附加：`tests/d1/repository.test.mjs` 补 AC10 用例（导出不含两键 + 导入夹带两键被忽略不报错）

验证：`node --test tests/router/config.update.test.mjs tests/router/config.turnstile.test.mjs tests/d1/repository.test.mjs` → 18 + 6 + 35 全绿

## 3. 前端

- [x] `api.js`：`login(password, turnstileToken)` + `configAPI.testTurnstile`
- [x] `loginPage.js`：siteKey 接收 / 脚本懒加载单例 / mountTurnstile / 提交门控 / finally reset / expired-callback
- [x] `login.html`：`x-ref="turnstileBox"` 容器（仅登录表单模板）
- [x] 容器样式（居中 + min-height 65px 预留 + 上下间距；dark 由 JS 传 theme）
  - 偏差：放 `base.css` 而非 `login.css`——`.turnstile-box` 被 login + settings 两页共用，按 CSS 归置规则（所有权跨页不明时上提共享层）
- [x] `settingsPage.js`：loadConfig 两字段 / `saveTurnstile()` / `testTurnstile()`（临时 widget 用完 remove，$nextTick 等容器可见再 render）
- [x] `settings.html`：新 section（两输入 + 状态行 + 测试/保存按钮 + hint）
- [x] locales `zh-CN.js` / `en.js` 新 key 双侧同步
  - 偏差：实际 key 清单比 design §7 多 4 个（`turnstileSiteKeyPlaceholder` / `turnstileSecretPlaceholder` / `turnstileTestInputRequired` / `turnstileHintSave`）——输入框 placeholder 属必须文案，design 自身注明「最终清单以实现时 diff 为准，parity 测试兜底」

验证：`npm run lint`；`node --test tests/public/i18n.keys.test.mjs` → 全绿

## 4. patch 桩全量同步核查（依赖图陷阱，B6c 教训）

- [x] router 桩逐文件核对：`./turnstile.js` import 已全部直通/开关桩化
  - 实际同步 8 个（spec 七桩 + http-cache.test.mjs）+ 新建 2 个自带（login.turnstile / config.turnstile）；queue 加载器整体桩化 router 无需改
- [x] `grep -rn "from './turnstile" tests/` 与 `grep -rln "router.js" tests/` 交叉核对无遗漏
  - 两集合完全一致（各 10 文件）；附带修正 envelope.test.mjs 桩语义（见步骤 0 第一项）

## 5. 全量验证与手测

- [x] `npm run lint && npm test` 全绿（对照基线记录新增用例数）
  - 实现子代理完成（2026-09-19）：lint 0 告警；测试基线 277 pass → **309 pass / 0 fail**（+32：turnstile 直测 11 + login.turnstile 10 + config.turnstile 6 + config.update 扩展 4 + d1 AC10 1）
- [x] 手测（2026-09-19，wrangler dev @ 127.0.0.1:8789 + 官方 dummy keys + Playwright MCP + curl + `wrangler d1 execute --local`；8787 为本机其他服务勿用）：
  - [x] 未配置：登录页零 challenges.cloudflare.com 请求、无 widget DOM、`auth/status` 返回 `''`
  - [x] dummy pass 键（siteKey `1x…AA` + secret `1x…AA`）：widget 渲染于密码框与登录按钮之间、自动通过签发 `XXXX.DUMMY.TOKEN`、Alpine `turnstileToken` 经 callback 捕获、widgetId 赋值
  - [x] 错误密码 → 401「登录失败：密码错误」（token 通过后端校验到达密码层）+ finally reset → ~1s 新 token 自动续签（5s 轮询稳定，重试就绪）
  - [x] dummy fail secret（`2x…AA`）→ 403 `{success:false,error:'人机验证失败，请重试'}` 无 code + 前端透传 + reset
  - [x] 设置页（铸临时 JWT 进入——读本地 jwtSecret 签发，**全程未动管理员密码**）：section 就位 / siteKey 预填 / secret 占位符「保存时留空 = 清除（禁用）」/ 状态行三态（已启用 / 未启用（两把密钥需齐全） / 未配置）
  - [x] 测试按钮：绿（200 `ok:true` + UI「测试通过」）/ 红（200 `ok:false` `errorCodes:['invalid-input-response']` + UI 失败提示）/ 临时 widget 用完 remove 残留 0
  - [x] 保存：两键保存 200 + secret 框自动清空（无明文残留）；半配保存（secret 空）→ 状态行「未启用」+ `auth/status` 输出 `''`（P2 双钥匙门修复实测生效）
  - [x] dark 模式：widget 深色渲染（视觉分析确认：Success! 绿勾 + CF 品牌 + 深色底）
  - [x] 清空两键：恢复现状（备份还原 + curl 确认 `''`）
  - [x] 环境还原：settings 行从备份恢复、临时 JWT 随测试浏览器关闭失效、截图已删、dev server 已停
  - 未测（遗留人工两项）：① 真实 siteKey/secret 在真实域名的正向登录成功流（本地管理员密码不公开，未做临时换密——token 传递链已由 401 路径完整验证，delta 仅剩密码比对+cookie 均有单测）；② 限流 429 与 Turnstile 的浏览器级交互（AC6 单测覆盖；浏览器验证需 5 次失败登录，会污染本地限流 DO 状态 10 分钟）

## 6. Phase 3（实现验证通过后另起）

- [x] spec 沉淀：backend/conventions.md 新 Scenario「登录 Turnstile 校验（09-19 起）」（含登录 fail-open vs 测试端点 fail-closed 语义分野、双钥匙门不变量、八桩清单修正）+ frontend quality-guidelines「Turnstile 懒加载 vendor 例外」条款 + 两处 index.md 描述同步 + 09-12 限流 Scenario 插入顺序行扩展
- [x] README：「登录人机验证（Cloudflare Turnstile，可选）」章节（开启步骤 / 锁死恢复 / dummy keys 表）+ API 表配置行更新
- [x] AGENTS.md：API 路由表（login/status/config 三行更新 + turnstile/test 新行）+ vendor 例外 + 注意事项第 8 条（双钥匙门）
- [x] 单 commit 交付（回滚 = revert，见 design §10）

## 回滚点

- 步骤 1-2 各自独立可弃（文件级）；步骤 3 前端依赖 1-2 的端点契约
- 功能级回退：设置页清空两键即回到现状行为，无需回滚代码

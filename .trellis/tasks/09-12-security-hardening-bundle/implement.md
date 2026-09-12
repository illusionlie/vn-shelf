# 执行计划：安全加固小包（已完成 2026-09-12）

按 R1 → R4 顺序执行，每个 R 一个 commit 粒度（回滚点）。全局验证命令：`npm run lint && npm test`。

## 前置核实（结论）

- [x] `fetch-vendor.cjs` 的 sha256 为**运行时计算**（下载后 createHash 打印），无内嵌清单 → R3 只需改版本键 + 重拉
- [x] `public/js/vendor/` **被 git 跟踪** → R3 回滚 = revert 含 vendor 文件的 commit
- [x] 本地 `wrangler.toml` 存在（gitignore 内）→ 已同步 DO 绑定 + v2 迁移块

## R1 登录限流 ✅

- [x] `src/login-ratelimit.js`：常量 + `evaluateLoginAttempt` 纯函数
- [x] `src/index.js` 新增 `LoginRateLimiterDurableObject`（`/precheck` GET、`/record` POST，storage 键 `login:rate-state`，无 alarm 惰性过期）
- [x] `wrangler.toml.example` + 本地真实 toml：`LOGIN_RATE_LOCK` 绑定 + `[[migrations]] tag="v2"`
- [x] `handleLogin` 插入 precheck / record；429 + `Retry-After`；绑定缺失 warn + fail-open
- [x] `tests/auth/login-ratelimit.test.mjs`（10 用例）
- [x] `tests/router/login.ratelimit.test.mjs`（6 用例，DO 桩内嵌真实纯函数）

## R2 JWT 收紧 + auth 直测 ✅

- [x] `verifyJWT`：`alg === 'HS256'` 强校验；`exp` 有限数值且 `exp > now`
- [x] `tests/auth/jwt.test.mjs`（20 用例，直测不经桩）

## R3 vendor 全量升级 ✅

- [x] package.json：marked 18.0.12 / purify 3.4.15 / alpine 3.17.2
- [x] `npm run fetch:vendor` 重拉（sha256 运行时校验通过；check 阶段独立从 jsdelivr 重下比对三文件 MATCH）
- [x] 手测冒烟 + XSS 抽查：见下方手测记录（自动化部分由既有 `tests/public/markdown.{security,syntax}.test.mjs` 覆盖——design 误记为"无 markdown 单测"，实际存在且对新版本全绿）

## R4 queue 兜底 ✅

- [x] `src/index.js` 尾部编排循环包 try/catch + warn
- [x] `tests/queue/index.queue.test.mjs` 新增 2 注入用例（patch 列表同步 `login-ratelimit` 真实源文件）

## 验收核对（AC1-AC8）

- [x] AC1 代码层（router 测试 429 形态 + 到期解锁）+ **本地实测通过**（见手测记录）
- [x] AC2 锁内 `verifyAdminPassword` 与 `getSettings` 调用数均为 0（测试断言）
- [x] AC3 成功清零（纯函数 + router 测试）
- [x] AC4 alg 伪造三态 / 缺 exp / 非数值 exp / exp==now 与 now-1 全拒（直测）
- [x] AC5 `npm run lint` 0 告警；`npm test` 235 pass / 0 fail（基线 197 → +38）
- [x] AC6 版本键一致 + bundle 版本标记匹配 + markdown 单测全绿 + **XSS 浏览器侧实测通过**（见手测记录）
- [x] AC7 五页面冒烟：访客侧四页 + 登录页 + settings 未登录守卫实测通过；**管理员侧 settings 页未验证**（本地库密码不公开，无法登录——遗留人工项）
- [x] AC8 queue 注入测试两处

## 手测记录（2026-09-12，wrangler dev @ 127.0.0.1:8788，Playwright + curl）

1. **XSS 浏览器侧（AC6）**：本地 D1 种入 review 含 `<img src=x onerror=window.__xssImg=1>`、`[link](javascript:alert(1))`、`**bold**` 的条目 → 详情弹窗实测：img 被转义为纯文本（DOM 中 0 个 img、`window.__xssImg` 未触发）；javascript: 链接渲染为 `.md-link-unsafe`「不安全的链接已禁用」span（无 `<a>`）；`<strong>` 正常。测试后条目已清理。
2. **五页面冒烟（AC7，Alpine 3.14.9 → 3.17.2）**：index（卡片渲染、搜索过滤响应、详情弹窗开合、Esc 关闭）、tier（58 卡片渲染）、stats（155 条目、4 图表、直方图分桶）、login（含 settings 未登录重定向守卫）；主题双向切换（dark-mode 类 + aria-label + 图标联动）；全部页面 console 仅既有预期项（访客 401 verify + 对应 warn），无 Alpine 报错。
3. **限流实测（AC1）**：curl 连续错误密码 → 前 5 次 401，第 6 次起 429 + `Retry-After: 600`，真实 DO 本地生效。⚠️ 本地 dev 登录被锁至约 12:57（IP 键 `'local'`，10 分钟自动过期）。
4. **部署前人工项**：线上部署后 `npm run tail` 观察 `[auth][login-ratelimit] binding missing` 告警（有则说明线上配置漂移）。

## 遗留人工项

- 管理员登录态下的 settings 页冒烟（本地密码不公开；上线后随手验证即可）
- 线上 tail 观察限流绑定告警（上述第 4 项）

## 风险文件

`src/router.js`、`src/index.js`——回归由 235 用例 + dry-run 部署（双 DO 解析通过）覆盖。

# Turnstile 本地遥测阻塞与登录按钮门控修复

## Goal

修复真 Turnstile key 在本地 dev 的两处体验问题：① widget 遥测请求挂在 doomed CORS 预检上延迟 token 派发；② 登录按钮在 token 就绪前可点击。

## Background

用户真 key 本地实测反馈：验证通过后浏览器向 `https://<origin>/cdn-cgi/challenge-platform/h/g/c/<hash>` 发 POST + OPTIONS，耗时非常久（OPTIONS 最终 CORS Failed）；在此之前点登录只得到「请完成人机验证」，请求失败落定后才能登。

诊断：这是 Turnstile 的**遥测信标**——widget（iframe origin `challenges.cloudflare.com`）向嵌入页 origin 相对路径发遥测，且**在遥测定型前不派发 token**。生产环境（Workers 自定义域/workers.dev 均经 CF 边缘）该路径被边缘吸收，永远到不了 Worker；本地 `wrangler dev` 无边缘，落到我们的 Worker → 404 且无 CORS 头 → 跨域预检挂起至超时。dummy keys 走简化路径不发完整遥测，故 09-19 手测未覆盖（测试盲区，用户实测补上）。

## Requirements

- **R1 遥测快速应答**：`handleRequest` 早段对 `/cdn-cgi/challenge-platform/*` 前缀的 OPTIONS / POST 立即回 **204 + 定向 CORS**（`Access-Control-Allow-Origin: https://challenges.cloudflare.com`、允许 POST/OPTIONS、Max-Age 86400；POST 本体同 ACAO）。响应构造导出为纯函数直测；**不新增 import**（零桩同步成本，beacon 经 assets 404 回退自然到达 router）。生产侧该路径不可达（边缘吸收），双保险无害。其他方法（GET 等）→ 维持 404 不带 CORS 头。
- **R2 登录按钮门控**：登录表单按钮在 `turnstileSiteKey && !turnstileToken` 期间 `aria-disabled="true"`（09-09 契约：禁原生 disabled——Chrome 夺焦点；`base.css` 已有 `[aria-disabled="true"]` 共享 `:disabled` 样式的规则）；**保留**提交时「请完成人机验证」校验兜底（token 过期竞态下点击仍有反馈）。未配置 Turnstile 时行为与现状一致（仅 isLoading 门控）。

## Acceptance Criteria

- [x] AC1 OPTIONS `/cdn-cgi/challenge-platform/x` → 204 + ACAO=challenges.cloudflare.com + Allow-Methods 含 POST/OPTIONS + Max-Age（直测 + dev server 直连 curl 双验证）
- [x] AC2 POST 同路径 → 204 + ACAO；GET → 404 且无 CORS 头；`/cdn-cgi/` 其他子路径不受影响
- [x] AC3 响应构造纯函数直测覆盖方法矩阵（tests/router/challenge-platform.test.mjs 5 用例，不经 router 桩）
- [x] AC4 登录按钮：未配置 Turnstile 行为不变（`turnstileSiteKey && !turnstileToken` 短路）；配置后 token 就绪前 aria-disabled 置灰、就绪即恢复；初始化表单不受影响；提交校验兜底保留
- [x] AC5 `npm run lint` 0 告警 + `npm test` 全绿（314/314，+5）

## Notes（验证方式）

- AC1/AC2：`wrangler dev` + curl 复核 ✅（**注意**：本机系统代理会劫持这批 URL——首轮流询得 403 系代理行为，`--noproxy '*'` 直连后 204 全对；此发现也是用户原始症状「请求非常久」的候选根因之一）
- AC4：模板绑定属 Alpine 表达式，lint + 代码走查 + 用户真 key 本地复测（token 派发时延与按钮态联动）
- 生产语义：该路径在生产被 CF 边缘吸收，Worker 处理器不可达（双保险无害）；本地价值 = 遥测首试即成、token 立即派发

# 站点主人名个性化：banner 与网页标题注入 ownerName

## Goal

为站点提供"主人名"个性化：管理员在设置页配置 `ownerName` 后，顶部 banner、网页 `<title>`、登录页大标题显示「XX 的 VN Shelf」（中文）/「XX's VN Shelf」（英文）；未配置时保持品牌原样「VN Shelf」。

## Background

项目功能完工程度高，但缺少个性化表达。现有外观管线（背景图：settings 表 → `GET /api/config/appearance` 公开端点 → 前端 `loadAppearance()` sessionStorage 缓存 + `appearance-refreshed` 静默刷新事件）已验证可复用，本需求沿同一管线扩展一个非敏感字段。

## Requirements

### R1 配置存储与读写

- settings 表新增 `ownerName` 字段（string，默认 `''`），随 JSON blob 存储，无需 schema 迁移。
- `GET /api/config/appearance`（公开）返回 `ownerName`；`GET /api/config`（管理员）同步返回。
- `PUT /api/config` 接受 `ownerName`：string，trim 后 ≤ 30 字符；空串合法（= 清除个性化，回退品牌名）。
- 导出数据 `appearance` 对象包含 `ownerName`；导入侧对其做同规则校验（类型/长度不符返回 400），导入应用逻辑与背景字段一致。

### R2 前端展示

- 四页（index/tier/stats/settings）顶部 banner `.banner-title`、登录页 `h1.login-title` 显示站点名：有 ownerName 时为 i18n 拼接结果，无则「VN Shelf」。
- 五页 `<title>` 中的品牌段「VN Shelf」同样替换为站点名（页面描述前缀如「登录 - 」保留）。
- 语言切换后拼接格式正确（zh「的」/ en "'s"）。
- 设置保存后当前页立即生效（不要求整页刷新）；其他标签页/后续访问经缓存自然生效。

### R3 设置页 UI

- 外观区块新增「站点主人名」输入（maxlength 30 + 占位提示说明留空行为），随「保存外观」一并提交。

## 约束

- `ownerName` 属非敏感外观配置，与背景同级别对待（公开可读）。
- XSS 防护：前端仅经 `textContent` / `document.title` 赋值，禁止 innerHTML；后端限长与类型校验。
- 页脚 `© year VN Shelf` 为品牌署名，**不**跟随 ownerName（本次决策）。
- 既有取舍沿用：首访/语言懒加载期间短暂显示默认「VN Shelf」后更新（与背景图首帧行为同级别，可接受）；appearance 端点 `max-age=300` + sessionStorage 缓存导致改名后回访最长约 5 分钟延迟生效。
- tier.html `<title>` 目前硬编码英文、无 data-i18n，与其余四页不一致——随本任务补 `meta.tierTitle` key 对齐。

## Acceptance Criteria

- [x] AC1 管理员设置 ownerName 后：banner、五页 `<title>`、登录页大标题均为「XX 的 VN Shelf」；清空后全部回退「VN Shelf」。（用户人工复核通过，2026-09-15）
- [x] AC2 中文/英文词典下拼接格式分别为「{name} 的 VN Shelf」与「{name}'s VN Shelf」；切换语言刷新后生效。（用户人工复核 + `tests/public/site-identity.test.mjs` 双语断言）
- [x] AC3 未认证 PUT /api/config 仍 401；`ownerName` 非字符串或 trim 后 >30 字符返回 400；合法输入 trim 后落库。（`tests/router/config.update.test.mjs` 含显式 401 用例）
- [x] AC4 `GET /api/config/appearance` 与 `GET /api/config` 均返回 `ownerName`（未配置时 `''`）。（测试断言）
- [x] AC5 导出 `appearance.ownerName` 随数据带出；导入含非法 `ownerName`（非字符串/超长）返回 400，合法则生效。（`tests/d1/repository.test.mjs` + `tests/router/import.appearance.test.mjs`）
- [x] AC6 zh-CN 与 en 词典 key 双向 parity 测试通过（新增 key 同步两典）。（i18n.keys.test.mjs）
- [x] AC7 ownerName 含 HTML/换行等字符时前端不发生注入（纯文本渲染路径验证）。（用户人工复核：`<img src=x>` 类文本按字面显示 + 代码路径纯 textContent）
- [x] AC8 `npm run lint` 与 `npm run test` 全绿，含本次新增用例。（262/262 pass，ESLint 零告警）

## 验收记录（2026-09-15）

- 独立 check 代理复核：AC1–AC8 全过，七处契约一致，无注入面，PASS。
- 检查发现 P1（已随本任务修复）：`loadAppearance({force:true})` 重取命中浏览器 HTTP 缓存（appearance 端点 `max-age=300`），保存后「当前页立即生效」静默失效——`api.js getAppearance` 增 options 透传，force 路径与后台静默刷新恒传 `cache:'no-store'`（背景图管线同样受益）。
- 用户人工复核：五页 banner/title、登录页、设/清回退、切语言、注入字面显示，均无问题。
- 实现偏离：settingsPage `importData()` 成功路径对导入 appearance 增调 `applySiteIdentity`（PRD R1「与背景字段一致」的即时应用先例，design 未逐条列出）。
- 遗留（转后续任务）：① `PUT /api/config` 中 newPassword 分支先落库、后续字段校验 400 时凭据已变更（存量问题，前端表单不混发故触达面窄）；② appearance 端点 `max-age=300` + sessionStorage 导致改名后回访最长约 5 分钟陈旧（PRD 接受的既有取舍）。

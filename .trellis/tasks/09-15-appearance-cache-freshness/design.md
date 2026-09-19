# design：appearance 冷启动缓存收紧

> **选型已定（2026-09-19 用户决策）：方案 c —— 前端冷路径恒 no-store**。冷启动陈旧上界目标 0s；服务端零变更（`max-age=300` 头保留，仅服务外部 API 消费者）。落选分析保留于 §4/§6 作为 spec 修订（AC2/R2）的理由素材。

## 1. 现状链路（证据锚点）

- 服务端：`handleGetAppearance`（[router.js:1375](../../../src/router.js)）响应 `Cache-Control: public, max-age=300`，无 ETag；appearance 显式排除在 `PUBLIC_CACHE_PATH_PATTERNS` 之外（[router.js:61-68](../../../src/router.js)），即不走 `servePublicCached` 的版本键/ETag/边缘 Cache 机制。
- 前端冷路径（sessionStorage 未命中）：[app.js:116](../../../public/js/app.js) `getAppearance(force ? { cache:'no-store' } : {})` —— 非_force 时**默认 cache 模式**，命中浏览器 HTTP 磁盘缓存 ≤300s 旧副本时零网络请求，且该路径不触发后台静默刷新 → 首屏陈旧直到缓存过期。
- 前端暖路径（sessionStorage `vn-shelf:appearance:v1` 命中）：即时渲染 + 后台 no-store 静默刷新（[app.js:149](../../../public/js/app.js)），秒级自纠。
- 写路径：`PUT /api/config`（外观字段落 settings blob，经 09-15-config-put-validate-first 已校验前置）与 `POST /api/import`（含 `appearance` 时）均**不 bump** `cache:version`。
- 既有测试锚点：`tests/router/config.update.test.mjs:622`（断言 max-age=300）、`tests/router/http-cache.test.mjs:533`（appearance 不入缓存路径 + 维持 300）。

## 2. 关键技术事实：对 PRD 候选 b 的纠正

HTTP 语义：**`max-age` 新鲜度窗口内的浏览器缓存副本不经网络直接使用**；ETag/`If-None-Match` 只在副本过期后的再验证中生效。服务器侧 bump 版本/换 ETag **无法推送失效**浏览器内仍新鲜的副本（对边缘 Cache API 层才是即时的——换钥匙）。

推论：
- 「b) 接入 ETag 但保持 300s」**不能**获得写后即时失效，冷会话首屏上界仍是 300s，等于零收益白加复杂度。
- b 若要有任何收紧效果，必须同时下调 max-age（对齐四端点的 60s）→ 上界 = 60s，与方案 a 相同；ETag 的增量收益只剩 304 省一次 ~300B 载荷 + 边缘命中省一次 D1 点查——在本站量级下价值≈0。
- 现有四公开端点的访客陈旧上界同样是 60s（浏览器层），版本键即时失效只作用于边缘层。

## 3. 量化依据（R2）

**负载面**：
- appearance 响应 ≈ 250–350B JSON；一次 GET = 1 次 Worker 调用 + 1 次 D1 PK 点查（`config:settings` blob，[repository.js getSettings](../../../src/repository.js)）。
- 暖路径今天已经每次页面加载发 1 次 no-store 后台刷新（`_refreshAppearanceBackground`）——「每页一次源站请求」是既有常态，冷的只有新标签页首屏那次。
- 个人站点量级（≤10k PV/天）：方案 c 使 appearance 源站请求 ≈ 每次页面加载 1 次 → ≤10k req/天，占 Worker 免费额度（100k/天）≤10%、D1 读额度（5M/天）≤0.2%。方案 a 上界 1 req/min/访客浏览器，同样可忽略。
- 结论：**三方案负载差异在本站量级均不构成决策因素**；决策应看陈旧上界与复杂度。

**陈旧代价面**：
- 受影响场景：改动 ownerName/背景后 5 分钟内开新标签页/无痕窗口者。最主要受影响者是站长本人（改完开新标签验证——恰为 AC1 验收动作）；真实新访客落入窗口的概率低。
- 本质是「站长验证 UX + 契约正确性」问题，而非高流量缓存效率问题。

## 4. 方案对比

| 方案 | 冷启动陈旧上界 | 源站成本增量 | 改动面 | 复杂度 / 风险 |
|---|---|---|---|---|
| a) max-age 300→60 | 60s | ≤1 req/min/访客 | router.js 1 行 + 2 处测试断言 + spec | 极低；保留双层心智模型，60s 仍非零 |
| b) ETag + 版本键接入 | 60s（必须同时降 max-age；纯 300s 版 = 零收益） | 边缘命中省 1 次 D1 点查 | appearance 入 `PUBLIC_CACHE_PATH_PATTERNS`；PUT /api/config 与 import 的 appearance 写路径挂条件 bump；304/管理员分支；测试矩阵扩张 + 七桩同步纪律 | **高**；版本键语义从「vn/tier 数据」扩到「任意公开数据」，密码-only 保存需条件 bump 防误失效 vn 缓存，分支面大 |
| c) 前端冷路径恒 no-store | **0s** | +1 req/冷页面加载（与暖路径后台刷新对齐） | app.js 1 行 + api.js 注释 + spec | **极低**；冷/暖统一为「每次页面加载恰好 1 次新鲜请求」，sessionStorage 仍供暖路径即时首绘 |

## 5. 推荐：方案 c

- 唯一把上界降到 0s 的方案，且改动最小（1 行）；AC1 目标窗口可直接记 0s。
- 与既有暖路径 no-store 后台刷新构成统一心智模型：sessionStorage 只负责即时首绘，新鲜度永远来自当次加载的源站请求。
- 不触碰版本键语义、不引入桩同步负担；服务端零变更，`max-age=300` 头保留为外部 API 消费者的无害缺省（本端点实际唯一消费者是前端，且已 no-store；若未来出现新消费者再评估下调）。
- 实现：`app.js:116` `getAppearance(force ? {...} : {})` → 恒 `{ cache: 'no-store' }`；`force` 仅保留「重置 Store 与进行中 promise」语义（[app.js:91-94](../../../public/js/app.js)）。api.js `getAppearance` doc 注释同步。no-store 请求选项已在暖路径/force 路径使用，无新兼容面。

## 6. 选定方案 c 的落点（implement.md 的依据）

- 代码：`app.js:116` `getAppearance(force ? { cache: 'no-store' } : {})` → 恒 `getAppearance({ cache: 'no-store' })`；`force` 仅保留「重置 Store 与进行中 promise」语义（[app.js:91-94](../../../public/js/app.js)）；api.js `getAppearance` doc 注释同步；同步 app.js 冷路径周边注释。
- 机制测试：新增 `tests/public/` 静态断言（与本仓 i18n.keys.test.mjs 静态分析风格一致）——冷路径调用恒 no-store、无 `force ?` 条件残留、sessionStorage 写回与后台刷新仍 intact。
- 服务端两处既有断言（`config.update.test.mjs:622`、`http-cache.test.mjs:533,542`）**不动**（服务端零变更）。
- spec 修订范围（AC2）扩展为两处：
  - `.trellis/spec/backend/conventions.md` 缓存 Scenario：appearance 行 + `PUBLIC_CACHE_PATH_PATTERNS` 注释行（:581）+ ETag 无法推送失效的选型理由（§2 纠正事实即 R2 的记录依据）。
  - `.trellis/spec/frontend/state-management.md`：L27-28（sessionStorage read-through / force no-store 契约扩为全网络路径 no-store）+ L52-53 mistakes 条目（09-15 教训延伸至冷路径）。

## 决策记录

- 2026-09-19 用户选定 **c**（候选 a/b 落选；b 的 PRD 前提纠正见 §2）。后续：implement.md → PRD 收敛 → 最终摘要 → 批准后 1.3/1.4。

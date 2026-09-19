# appearance 回访时效：冷启动首屏最长 5 分钟陈旧的缓存收紧

## Goal

消除 `GET /api/config/appearance` 对冷会话首屏的陈旧窗口：当前 `Cache-Control: public, max-age=300` 且无 ETag，冷会话（无 sessionStorage 副本的新标签页/新访客）首屏网络路径可命中浏览器磁盘中最长 5 分钟前的旧副本，站点主人名（ownerName）与背景在改名/换背景后延迟可见。09-15 已修「保存后当前页即时生效」（force 路径 no-store），本任务处理剩余的**回访冷启动**窗口。

**已定机制（2026-09-19 用户决策，量化对比见 design.md）：前端冷路径恒 `cache: 'no-store'`。冷启动陈旧上界目标值 = 0s（首屏网络路径直查源站）。**

## Background（已确认事实）

- 缓存链路三层：浏览器 HTTP 缓存（max-age=300，无校验机制）→ sessionStorage `vn-shelf:appearance:v1`（命中后触发 no-store 后台静默刷新，秒级自纠）→ Store 内存。陈旧窗口仅在冷会话**首屏**网络路径（[app.js:116](../../../public/js/app.js) 非 force 默认 cache 模式），首屏后无自纠触发。
- HTTP 语义约束（规划期确认，否决 ETag 方案前提）：`max-age` 窗口内浏览器直接使用本地副本、不发再验证请求，服务端 bump 版本/换 ETag **无法推送失效**仍新鲜的浏览器副本。故「ETag + 保持 300s」零收益；ETag 方案须同时降 max-age 至 60s 才有收紧效果，且上界与单纯降 max-age 相同，增量收益（304 省 ~300B / 边缘省一次 D1 点查）在本站量级（≤10k PV/天 vs Worker 免费 100k req/天）≈0。
- 暖路径今天已每次页面加载发 1 次 no-store 后台刷新——「每页一次源站小 JSON 请求」是既有常态，方案 c 使冷路径与之对齐，负载增量可忽略。
- 陈旧代价主要落在站长本人改后开新标签验证的场景（即 AC1 验收动作），本质是验证 UX 与契约正确性问题。
- 09-15-site-owner-name PRD 显式接受旧取舍；关联 spec：`.trellis/spec/backend/conventions.md` 公开缓存 Scenario（「维持 max-age=300 现状」条目随本任务修订）与 `.trellis/spec/frontend/state-management.md`（appearance Store 缓存契约，:27-29、:52-53）。
- `PUT /api/config` 与 `POST /api/import` 均不 bump `cache:version`——本方案（纯前端）不改变这一点，版本键语义维持「vn/tier 数据变更」。

## Requirements

- R1（已选型落地）：`loadAppearance` 冷路径（sessionStorage 未命中）的网络请求恒传 `cache: 'no-store'`，冷启动首屏陈旧上界 0s；`force` 语义不变（仍重置 Store 与进行中 promise）；sessionStorage 暖路径即时首绘与后台静默刷新不回归。
- R2：选型量化理由（负载 vs 陈旧代价 + ETag 语义约束）沉淀进 spec：backend/conventions.md 缓存 Scenario 替换「维持现状」旧条目；frontend/state-management.md 的 appearance 契约与 mistakes 条目同步扩展（09-15 no-store 教训延伸至冷路径）。
- R3：09-15 已落地的「保存后即时生效」行为（force no-store）不回归。
- R4：机制变更不改变响应体 shape（appearance 字段集不变）——本方案服务端零变更，天然满足；`max-age=300` 响应头保留，仅服务外部 API 消费者。

## Acceptance Criteria

- [ ] AC1 改动 ownerName/背景后，新开无痕标签页（冷会话）首屏显示新值——目标窗口 0s（机制层面：首屏网络路径 no-store 直查，不再经过 HTTP 缓存；人工复核 + 静态机制测试佐证）。
- [ ] AC2 选型理由与最终契约（前端恒 no-store、响应头 max-age=300 保留及理由、ETag 不适用于冷启动窗口的语义依据）写入 `.trellis/spec/backend/conventions.md`（替换「维持 max-age=300 现状」条目）并同步 `.trellis/spec/frontend/state-management.md`。
- [ ] AC3 既有 http-cache / config.update 测试不回归（服务端两处 max-age=300 断言不动）；按选型补前端机制静态测试（冷路径恒 no-store、无 force 条件残留、暖路径 intact）。
- [ ] AC4 `npm run lint` + `npm run test` 全绿。

## Out of Scope

- 服务端任何变更：Cache-Control 头、ETag/版本键接入、`cache:version` bump 语义（含 PUT /api/config / import 挂 bump）。
- sessionStorage 层的移除或键格式变更（仍供暖路径即时首绘）。
- 外部 API 消费者的缓存行为优化（若未来出现新消费者再评估下调 max-age）。

## Notes

- AC1 人工复核项（无痕标签页验证 ownerName 即时生效）与 [[owner-name-followups]] 记忆中遗留的五页生效/英文标题/HTML 字面显示手工复核可合并执行。

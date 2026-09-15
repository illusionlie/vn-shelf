# appearance 回访时效：冷启动首屏最长 5 分钟陈旧的缓存收紧

## Goal

收紧 `GET /api/config/appearance` 的陈旧上界：当前 `Cache-Control: public, max-age=300` 且无 ETag，冷会话（无 sessionStorage 副本的新标签页/新访客）首屏网络路径可命中浏览器/边缘磁盘中最长 5 分钟前的旧副本，站点主人名（ownerName）与背景在改名/换背景后延迟可见。09-15 已修「保存后当前页即时生效」（force 路径 no-store），本任务处理剩余的**回访冷启动**窗口。

## Background

- 缓存链路三层：浏览器/边缘 HTTP 缓存（max-age=300，无校验机制）→ sessionStorage `vn-shelf:appearance:v1`（命中后触发 no-store 后台静默刷新，秒级自纠）→ Store 内存。
- 实际陈旧窗口：冷会话**首屏**渲染用的那次网络 GET（默认 cache 模式）；首屏之后无自纠触发（静默刷新仅由 sessionStorage 命中路径派发），要到下次带 sessionStorage 的加载或缓存过期才收敛。
- 09-15-site-owner-name PRD 显式接受该取舍；独立检查建议开后续任务评估收紧。关联 spec：`.trellis/spec/backend/conventions.md` 公开缓存 Scenario（appearance「维持 max-age=300 现状」条目需随本任务结论同步修订）。
- 注意：`PUT /api/config` 目前**不 bump** `cache:version`（现有四端点 ETag 共用版本键的语义是 vn/tier 数据变更）——若走 ETag 方案需评估版本键语义扩展。

## Requirements

- R1：选定并落地一种收紧机制，使冷会话首屏的 appearance 陈旧上界从 300s 降至一个明确、有记录依据的目标值（候选，planning 阶段决策）：
  - a) 直接下调 `max-age`（如 60s）——零协议复杂度，换取边缘命中率下降；
  - b) appearance 端点接入 ETag 协商（评估复用 `cache:version` 或独立版本键 + `PUT /api/config` bump）——保持 300s 新鲜度窗口的同时获得写后即时失效；
  - c) 前端冷启动路径也传 `cache: 'no-store'`——每页一次源站小 JSON，彻底消除陈旧但放弃 HTTP 缓存。
- R2：选型须给出量化理由（请求量/负载影响 vs 陈旧代价），结论沉淀进 backend conventions 缓存 Scenario。
- R3：09-15 已落地的「保存后即时生效」行为（force no-store）不回归。
- R4：机制变更不改变响应体 shape（appearance 字段集不变）。

## Acceptance Criteria

- [ ] AC1 改动 ownerName/背景后，新开无痕标签页（冷会话）首屏在 PRD 记录的目标窗口内显示新值（人工复核 + 机制层面的测试佐证）。
- [ ] AC2 选型理由与最终契约（Cache-Control/ETag 语义、bump 触发点）写入 `.trellis/spec/backend/conventions.md`，替换「维持 max-age=300 现状」旧条目。
- [ ] AC3 既有 http-cache / config.update 测试不回归；按选型补充机制测试（如 ETag 方案补 appearance INM 304 用例）。
- [ ] AC4 `npm run lint` + `npm run test` 全绿。

## Notes

- 涉及缓存协议决策，开工时按复杂度判断补 design.md（候选方案对比 + 负载权衡），PRD-only 起草。
- 若选型结论为「维持现状、仅记录权衡」，需在 AC2 的 spec 修订中把取舍显式化并关闭本任务——这也是合法终态。

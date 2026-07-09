# PRD — B5 前端工程化收尾（父任务）

> 上下文：`docs/frontend-improvements.md` 批次 B5（T5-P4 / T5-P5 / T5-P6 / T5-M1 / T5-M2 / T5-U3 / T5-M3+A3）。
> 本父任务**不做实现**，仅统领子任务边界、依赖与最终集成验收。实际工作交付三个独立可归档的子任务。

## 范围拆分（已决策）

B5 原八项按"工作量大 + 独立可验收"原则拆为三个子任务：

### B5a 前端工程化清理 (`07-03-frontend-b5a-cleanup`)
- **T5-P4** Tier 分片并行提交（保持顺序语义不变）
- **T5-P6** 进度条单轨逻辑（`load` + `pageshow` bfcache，去掉 3s 兜底双轨）
- **T5-M1** `computeTierDiff` 纯函数化 + 单测；markdown 语法正确性快照测试
- **T5-M2** `public/js/constants.js` 统一魔法字符串（`__untiered__`、`MAX_BATCH_TIER_UPDATES=200`、`#ff4757` 默认色等），与后端 `src/router.js` 同源注释
- **T5-M3 删 `|| res` 兜底**——前端 `statsPage.js:25` 的 `res.data || res` 兜底改为统一走 `res.data`，并核对后端 `/api/stats` 返回形态已统一（如未统一则在本子任务内顺手对齐后端信封，或单独立后端项；本 PRD 默认前端侧删兜底+核对，发现后端不统一则记录并要求后续统一）
- 工作量 S/M 集合，风险低，独立可验收

### B5b 前端 i18n 框架接入 (`07-03-frontend-b5b-i18n`)
- **T5-U3** 引入轻量 i18n（自托管 `i18n.js` + JSON 词典，不引第三方库）+ 将现有硬编码中文文案（toast 文案、`settingsPage.js formatStatus` map、表单校验抛错、各按钮文字）迁移词典
- 目标：结构就绪 + 切语言 toast/状态文案随之切换；多语言上线非强制（即先做 zh-CN + 框架，en 词典留空框架就位即可）
- 工作量 L，独立可验收

### B5c CSS 拆分与断点补全 (`07-03-frontend-b5c-css`)
- **T5-P5** `public/css/style.css`（1918 行单文件）拆分为 `base.css` + 各组件 css，按页面按需引入；增补断点（`480 / 768 / 1024`）覆盖平板/宽屏；引入 critical CSS 内联头部、余 `media` 异步
- 不破坏现有视觉；首屏阻塞 CSS 体积下降
- 工作量 L，独立可验收

## 范围外（不在 B5）

- **A3 后端 API 信封统一**——若 B5a 核查发现 `/api/stats` 等返回形态不一致，B5a 内只做前端 `|| res` 兜底删除+核对记录；后端信封的真正统一（所有路由返回 `{success, data, ...}`）单独立后端任务，不在 B5 内。
- **Bootstrap spec**——已归档。
- 不引入新的第三方库（i18n/CSS 都是自托管或纯 CSS 工程）。

## 子任务依赖

- **B5a 独立**（清理项之间互不依赖；T5-M1 单测依赖 B4 的 K1 已就位 ✓）
- **B5b 独立**（i18n 改 toast 文案需与 B4 的 `friendlyErrorMessage` 协调——`friendlyErrorMessage` 的 4xx 保留后端中文 message 与 i18n 交集：i18n 先迁前端硬编码文案，后端 message 暂不翻译，留 i18n 文档说明此边界）
- **B5c 独立**（CSS 拆分不影响 JS；与 B5a/B5b 互不冲突）
- 三个子任务**可并行**，但为保单会话上下文清晰，建议顺序推进：B5a → B5b → B5c

## 跨子项验收（父任务最终集成）

| AC# | 条件 | 验证 |
|---|---|---|
| AC1 | 三个子任务全部归档 | `ls .trellis/tasks/archive/` 含 b5a/b5b/b5c |
| AC2 | `npm run lint && npm run test` 全绿 | 命令 |
| AC3 | 五页面 `npm run dev` 全功能正常 + 键盘 Tab 全屏走查无回归 | 人工走查 |
| AC4 | `docs/frontend-improvements.md` 路线表上 B5 各项标记完成 | 文档更新 |

## 风险与回滚

- 每个子任务独立 commit + 独立归档；任一回归单独 revert 不影响另两个。
- i18n 改动文件多（全前端文案），若引入回归面大，先做框架+少量关键文案迁移，余下灰度推进。
- CSS 拆分若引入视觉回归，单 commit revert 回单文件即可。

## 备注

- 父任务在三个子任务全部归档后由 finish-work 一并归档（无需 `task.py start`，因父任务不做实现）。
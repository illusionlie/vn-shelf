# Implement — B6c 后端 API 信封统一（A3）

> 阅读序：implement.jsonl 所列 spec + research/ 四表 → prd.md → design.md → 本清单。
> **核心纪律：后端改形态 + 前端回填 + 测试改动同一 commit，不可拆分提交**（原子切换，避免前后端错配的坏中间态）。

## 有序执行清单

### 阶段 0：utils 载体扩展

- [ ] 0.1 `src/utils.js` `successResponse(data=null, message='操作成功', extra={})`：产出 `{ success:true, message, data, ...extra }`。保持前两参默认值不变（19 处双参调用零影响）。JSDoc 补第三参用途（列表 extras）。

### 阶段 1：后端 6 端点收编（`src/router.js`）

- [ ] 1.1 #1 handleAuthStatus（247-250）：`jsonResponse({initialized, authenticated})` → `successResponse({ initialized, authenticated })`。
- [ ] 1.2 #7 handleGetVN（382）：`jsonResponse(entry)` → `successResponse(entry)`。
- [ ] 1.3 #17 handleGetIndexStatus（1120）：`jsonResponse(status)` → `successResponse(status)`。
- [ ] 1.4 #24 handleExport（1250）：`jsonResponse(data)` → `successResponse(data)`（data 即 `{version,exportedAt,entries,tierList,appearance}`，进入信封 data 层，文件格式不变）。
- [ ] 1.5 #6 handleGetVNList（369-372）：`jsonResponse({data: items, total})` → `successResponse(items, undefined, { total })`（用默认 message；items 进 data，total 顶层）。
- [ ] 1.6 #9 handleGetTierList（742-746）：`jsonResponse({data: tiers, total, updatedAt})` → `successResponse(tiers, undefined, { total, updatedAt })`。
- [ ] 1.7 `src/index.js:166-172` 顶层 500：手写 `{success:false,error:'Internal Server Error'}` → `errorResponse('Internal Server Error', 500)`；核对 headers（Content-Type/CORS）与原手写一致。
- [ ] 1.8 复核：`jsonResponse` 是否仅剩合法用途（非信封通道，如有）。grep 确认 6 端点无残留裸出。

### 阶段 2：前端回填（6 点，与阶段 1 同 commit）

- [ ] 2.1 C6 `settingsPage.js:49`：auth/status `.authenticated` → `.data.authenticated`。
- [ ] 2.2 C8 `settingsPage.js:83`：`this.indexStatus = await ...getStatus()` → `= (await ...).data`。**全链核对**：`formatStatus` / `isIndexTaskActive` / 轮询赋值 / 模板绑定读的都是 `indexStatus.<field>`，回填后字段路径不变（只是赋值源解包一层）。
- [ ] 2.3 C10 `settingsPage.js:169`：export `const data = await ...export()` → `= (await ...).data`；确认写文件/下载用的是解包后的 data。
- [ ] 2.4 C4 `loginPage.js:24`、C5 `:28`：auth/status `.authenticated` / `.initialized` → `.data.*`。
- [ ] 2.5 C13 `shared.js:112`：`this.selectedVN = res` → `= res.data`（详情弹窗 `.vndb`/`.user`）。
- [ ] 2.6 透明兼容确认（不改，仅核对）：C14 `tierlistPage.js:69`、C15 `:88`、C16 `vnShelf.js:40` 仍读 `res.data`，正常。
- [ ] 2.7 全局兜底扫描：`grep -rn '|| res' public/js/`、`grep -rn 'await .*API\.' public/js/` 核对无新增裸 res 消费、无回填遗漏。

### 阶段 3：测试（同 commit）

- [ ] 3.1 `tests/router/index.start.test.mjs`：3 处（392/423/454 起）`payload.status/processed` → `payload.data.status/data.processed`。
- [ ] 3.2 新增 `tests/router/envelope.test.mjs`：6 端点信封断言（见 design 测试策略）。搭建复用 config.update/index.start 的 env+stub 模式。
- [ ] 3.3 utils 桩核对：`config.update.test.mjs:151` / `index.start.test.mjs:224` 两桩——扩展第三参后跑全量，若桩测试变红则同步桩实现。

## 验证命令

```bash
npm run lint && npm run test              # 全绿（含新 envelope 测试 + 改后的 index.start）
grep -rn '|| res\b' public/js/            # 零命中（无兜底残留）
grep -rn 'jsonResponse' src/              # 仅剩合法非信封用途（若有）
```

人工走查（`npm run dev`，覆盖 6 端点前端路径）：
- 登录页：未初始化/已登录分支正确（auth/status → C4/C5）。
- 设置页：进入不被踢回登录（C6）；数据索引状态显示 + 轮询正常（C8，最脆）；导出下载文件打开确认是 `{version,exportedAt,entries,...}` 原格式（C10）→ 立即重新导入验证往返（R5）。
- 主页/Tier 页：列表加载（C15/16/14 透明）。
- 详情弹窗：任一条目打开，VNDB/用户信息完整（C13）。

## 风险文件与回滚

- 最高风险：`settingsPage.js`（C8 indexStatus 整包赋值 + C10 导出格式）——回填后必走查轮询与导出往返。
- 次高：`src/utils.js`（信封单点，改错波及全 25 端点）——阶段 0 后先跑全量测试确认 19 端点未回归再动 handler。
- 回滚：主体单 commit revert 即整体回退，无前后端错配中间态；数据零迁移。

## start 前核对

- [x] prd 决策记录（Q1–Q4）
- [x] design 契约表 + implement 清单
- [ ] implement.jsonl / check.jsonl 策展
- [ ] 用户 start 审查

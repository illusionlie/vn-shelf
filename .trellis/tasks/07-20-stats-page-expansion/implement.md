# Implement：统计页扩展执行清单

按序执行；每步后不提交，最终统一验证后一次 commit。

## 后端

- [x] 1. 新增 `src/stats.js`：`computeStats(rows)` 纯函数 + 私有 `safeJSONParse`（shape 见 design.md）
- [x] 2. `src/repository.js`：新增 `getStats(env)`（initDB + 宽 SELECT + computeStats）；`getVNList` 移除聚合 SQL，返回 `{ items }`
- [x] 3. `src/router.js`：import `getStats`；`handleGetStats` 改调之

## 测试

- [x] 4. 新增 `tests/stats/compute.test.mjs`：空输入、既有4值语义对齐、round 边界(x.5/0/10+)、状态计数含 wishlist/none、分歧榜阈值与截断、跨年月份分组、日期容错、负跨度剔除、多开发商、JSON 解析容错、Top 稳定排序
- [x] 5. `tests/d1/repository.test.mjs`：FakeD1 增宽 SELECT 分支、删 `select count(*) as total,` 分支；新增 getStats 装配断言；核对既有 getVNList 断言不再引用 stats（原本就无 stats 断言）；loadModules 加载器同步拷贝 stats.js（patch 型加载器依赖图）
- [x] 6. router 4 桩补 `getStats` 导出：`envelope` / `config.update` / `vn.status` / `index.start`
- [x] 7. `tests/router/envelope.test.mjs` 补 `/api/stats` 信封形态用例

## 前端

- [x] 8. `public/js/components/statsPage.js`：spread `createTagsView`；init 时序照 vnShelf（setupTranslationsRefresh→loadConfig→initTranslations→loadStats）；派生：状态段、直方图 max、年份分组+默认年、分歧榜展示、tag 择源与翻译；helpers（percent/formatDiff/formatSpan 等）
- [x] 9. `public/stats.html`：六区块重写（概览6卡/状态条/评分区/时间线/厂商/标签），各区块空样本提示
- [x] 10. `public/css/stats.css`：stacked bar / histogram / month bars / hbar / chips；主题变量；768/480 断点；reduced-motion
- [x] 11. locales `zh-CN.js` + `en.js`：stats.* 新词条 + aboutText 口径更新（双侧同步）

## 文档与验证

- [x] 12. `AGENTS.md`：/api/stats 行说明 + 结构树补 src/stats.js、tests/stats/（测试树同步拉平到现状）；`CLAUDE.md` 结构树同步
- [x] 13. `npm run lint` 全绿
- [x] 14. `npm test` 全绿（174 pass / 0 fail）
- [ ] 15. 人工验收（用户侧）：明暗主题、空库、480 宽度、en locale
- [x] 16. 验收迭代：概览区多卡片网格 → 单条摘要条（stats-overview，5 项横排，已完成+完成率合并；移除 stat-card/stats-grid 样式与 finishedRate 词条）

## 回滚点

- 单 commit；任一阶段失败可 `git checkout -- .` 回到干净态。

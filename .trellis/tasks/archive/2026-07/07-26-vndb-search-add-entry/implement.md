# Implement：添加条目 VNDB 模糊搜索执行清单

按序执行；每步后不提交，最终统一验证后一次 commit。

## 后端

- [x] 1. `src/vndb.js`：升级 `searchVN`——请求加 `sort: 'searchrank'`，fields 增 `released, image.sexual, image.violence`；输出增 `released`（缺省空串）与 `imageNsfw`（`sexual>1 || violence>1`，与 `mapVnObjectToVndbData` 同口径）
- [x] 2. `src/router.js`：import 增 `VNDBClient`（来自既有 `./vndb.js`）；认证段加路由 `GET /api/vndb/search` + `handleVndbSearch`（校验顺序与错误矩阵见 design.md；token 取 `auth.settings.vndbApiToken`，**不得**调 `createVNDBClient`）

## 测试（后端）

- [x] 3. 四个 router patch 测试的 vndb 桩补 `export class VNDBClient {}`：`config.update` / `envelope` / `vn.status` / `index.start`（先跑一次 `npm test` 确认无遗漏桩）
- [x] 4. 新增 `tests/vndb/search.test.mjs`：fetch stub 断言请求体（search filter / searchrank / 字段集 / results=limit）+ 映射边界（released 缺省、imageNsfw 三态、rating 换算、空结果）
- [x] 5. 新增 `tests/router/vndb.search.test.mjs`（照 index.start 模式建 tempDir + 全套桩）：401 信封 / q 空 400 / token 缺失 400 / 成功形态 / limit clamp（999→20、非法→10）/ q trim 透传

## 前端

- [x] 6. `public/js/api.js`：新增 `export const vndbAPI = { search(q, limit) }` → `GET /api/vndb/search`
- [x] 7. `public/js/components/vnShelf.js`：新增 vndbSearch 状态组 + 方法组（清单见 design.md）；`init()` 建 350ms 防抖器；`openEdit(null)` / `closeEdit()` 重置搜索状态；`saveEdit()` isNew 分支加空 `vndbId` 守卫 toast
- [x] 8. `public/index.html`：isNew 模板重写为 combobox（输入框 + 四态下拉 + 已选卡片 + 直连 hint + a11y 属性）；键盘 ↓/↑/Enter/Esc 与 `@click.outside`、候选行 `@mousedown.prevent` 按 design.md 接线
- [x] 9. `public/css/forms.css`：`.vndb-search*` 样式组（下拉/选项/高亮/缩略图/已选卡片），主题变量 + 480 断点；确认 `nsfw-blur` 选择器作用域，不匹配则本地补等效规则（已确认：`cards-detail.css` 的 `.nsfw-blur` 为裸类选择器，index.html 已链接，直接复用；缩略图容器 overflow:hidden 收模糊外溢）
- [x] 10. locales `zh-CN.js` + `en.js`：改文案 `index.vndbIdPlaceholder` / `index.vndbIdHint`；label 词条化 `index.vndbSearchLabel`；新增 searching / noResults / directHint / reselect / selectRequired / listLabel / `prefix.searchFailed`（双侧同步）

## 文档与验证

- [x] 11. `AGENTS.md`：API 说明补 `GET /api/vndb/search` 行；测试树补两个新测试文件；`CLAUDE.md` 测试树同步
- [x] 12. `npm run lint` 全绿
- [x] 13. `npm test` 全绿（187 pass / 0 fail，含 13 个新用例）
- [x] 14. 手动验收：中文译名 / 日文原名 / 英文名各搜一例并点选添加成功；`v<id>` 直连与现状一致；NSFW 封面模糊；纯键盘完成一次选择；Esc 先关下拉再关弹窗；快速连续输入无过期结果回写；token 未配置时 400 文案内联展示；明暗主题 + 480 宽度下下拉可用（用户浏览器验收通过，驱动一轮迭代见第 15 项）
- [x] 15. 验收迭代（2026-07-27）：搜索中旧候选降透明度（`.is-searching`）——保留式行为不变（不清空、仍可点选），状态行全透明度

## 风险文件与回滚点

- 风险集中在 `index.html` 编辑模态（Esc/Enter 与既有弹窗行为耦合）与四桩同步（漏一个即红/假绿）。
- 单 commit；任一阶段失败 `git checkout -- .` 回到干净态。

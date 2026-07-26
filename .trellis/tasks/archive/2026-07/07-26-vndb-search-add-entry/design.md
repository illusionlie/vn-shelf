# Design：添加条目 VNDB 模糊搜索

## 边界与数据流

```
[添加弹窗 isNew] vnShelf.js
  输入(trim) ──┬─ 匹配 ^v\d+$ ──▶ 直连模式：editForm.vndbId = 输入，不发请求，hint 提示
               └─ 长度 ≥2 ──▶ debounce 350ms（IME composition 期间挂起）
                                  │ vndbAPI.search(q)  GET /api/vndb/search?q=&limit=10（认证，无 CORS）
                                  ▼
router.handleVndbSearch ── auth.settings.vndbApiToken ──▶ new VNDBClient(token).searchVN(q, limit)
        │ successResponse(results[])                         │ POST kana /vn：search filter + sort:searchrank
        ▼                                                    ▼
  下拉候选（封面/标题/原名/厂商+年份/金色评分）◀── 映射 { id,title,original,released,image,imageNsfw,rating,developers }
        └ 点选/Enter ──▶ vndbSearchSelected + editForm.vndbId = id ──▶ 已选卡片
                                                    └ saveEdit() 走既有 POST /api/vn（创建管线零改动）
```

## 后端契约

### 路由与 handler

- `GET /api/vndb/search` 放在 `handleAPI` 认证段（`authMiddleware` 之后）；**不加入** `PUBLIC_CORS_PATH_PATTERNS`（认证端点默认无 CORS = 正确）。
- `handleVndbSearch(request, env, auth)`：
  1. `!auth.authenticated` → `errorResponse('未授权', 401)`；
  2. `q = searchParams.get('q').trim().slice(0, 100)`；空 → `errorResponse('搜索关键词不能为空', 400)`；
  3. `limit = clamp(parseInt(limit), 1, 20)`，非法/缺省 → 10；
  4. `auth.settings.vndbApiToken` 缺失 → `errorResponse('VNDB API Token未配置，请先在设置页配置', 400)`；
  5. `new VNDBClient(token).searchVN(q, limit)`，成功 → `successResponse(results)`；异常 → `errorResponse('VNDB API错误: ' + error.message, 500)`（与 `handleCreateVN` 同形态）。
- **settings 复用契约**：直接用 `auth.settings` 构造 client；**禁止**调 `createVNDBClient(env)`（内部二次 `getSettings`，违反 backend/conventions.md）。
- 不重试：type-ahead 场景下一次击键即自然重试；与 `fetchVNDB` 的 3 次退避重试有意不同。

### searchVN 升级（零引用方法，无回归面）

```js
// 请求体：filters: ['search','=',query], sort: 'searchrank', results: limit,
// fields: 'id, title, alttitle, released, image.url, image.sexual, image.violence, rating, developers.name'
// 输出（新增两字段，其余不变）：
{ id, title, original: alttitle||'', released: released||'', image: image?.url||'',
  imageNsfw: (image?.sexual > 1 || image?.violence > 1),   // 与 mapVnObjectToVndbData 同口径
  rating: (rating||0)/10, developers: [name] }
```

### 错误矩阵

| 条件 | 行为 |
|------|------|
| 未认证 | 401 信封 `{success:false, error:'未授权'}` |
| q trim 后空 | 400 中文文案 |
| q 超 100 字符 | 静默截断，不报错 |
| limit 非法/越界 | 静默归 10 / clamp 1..20 |
| token 未配置 | 400 中文文案（不走 500，前端 4xx 分支透传文案） |
| VNDB 上游失败 | 500 `VNDB API错误: ...` |

## 前端契约（vnShelf.js + index.html + forms.css）

### 组件状态与方法

```js
// 状态（openEdit(null) 与 closeEdit() 均重置）
vndbSearchText: ''        // 输入框绑定（不再直接 x-model editForm.vndbId）
vndbSearchResults: []     // 候选
vndbSearchStatus: 'idle'|'searching'|'done'|'error'
vndbSearchError: ''       // friendlyErrorMessage 产物，内联展示
vndbSearchOpen: false     // 下拉开合
vndbSearchActiveIndex: -1 // 键盘高亮
vndbSearchSelected: null  // 已选候选对象（驱动已选卡片）
_vndbSearchSeq: 0         // 竞态序号守卫
_vndbComposing: false     // IME 组字中挂起搜索

// 方法
onVndbSearchInput()       // 分流：^v\d+$ 直连 / ≥2 防抖搜索 / 其余关下拉置 idle；任何输入变更先清 editForm.vndbId（直连模式内再回填）
runVndbSearch()           // seq++ 快照；status=searching；vndbAPI.search；仅 seq 最新才写结果/错误
selectVndbResult(r)       // selected=r; editForm.vndbId=r.id; 关下拉
clearVndbSelection()      // selected=null; vndbId=''; text=''; $nextTick 聚焦输入框
onVndbSearchKeydown(e)    // ↓/↑ 移动高亮（prevent）；Enter：下拉开时 prevent+选中高亮项（防表单提交）；Esc：下拉开时 close+stopPropagation（阻断 window 级关弹窗），关时不拦截
```

- 防抖器在 `init()` 创建：`debounce(this.runVndbSearch.bind(this), 350)`；输入事件在 `_vndbComposing` 为真时不触发（`@compositionstart/@compositionend` 维护，compositionend 后补一次分流）——中文 IME 组字期间不发半截拼音请求。
- **提交守卫**：`saveEdit()` 的 `isNew` 分支入口处 `!editForm.vndbId` → toast `t('index.vndbSearchSelectRequired')` 并 return。原因：footer「保存」按钮在 `<form>` 外，HTML `required` 从不生效，JS 守卫是唯一可靠层（现状裸提交空 ID 靠后端 400 兜底）。

### UI 结构（index.html isNew 模板重写）

- 未选中：`role="combobox"` 输入框（`aria-expanded`/`aria-controls`）+ `role="listbox"` 下拉（选项 `role="option"` + `aria-selected`）；下拉内四态：searching 提示 / error 文案 / 空结果提示 / 候选列表。
- searching 态保留上一轮候选，下拉挂 `.is-searching` 类给旧候选降透明度（≈0.55、仍可点击）以传达「正在刷新」，「搜索中…」状态行保持全透明度（2026-07-27 验收迭代决策）。
- 候选行：封面缩略图（`imageNsfw` → 模糊，无点击解锁）+ 主标题 + 原名（alttitle）+ 厂商·年份（`released` 前 4 位为数字才显示年份）+ VNDB 评分（**金色**语义，循 07-12 色板）。
- 已选卡片（用户决策 A）：封面小图（NSFW 同样模糊）+ 标题 + 原名 + vID + 「重新选择」按钮（`clearVndbSelection`）。
- 直连模式 hint：`x-show` 输入匹配 `^v\d+$` 时显示「将直接使用该 VNDB ID」。
- 关闭时机：`@click.outside` 关下拉；选中、清空、弹窗关闭时同步收敛状态。
- 候选行用 `@mousedown.prevent` 选中（保持输入框焦点，避免 blur 时序问题）。

### 样式（forms.css，B5c 模块归属）

- `.vndb-search`（relative 容器）/ `.vndb-search-dropdown`（absolute、max-height ≈ 320px 滚动、主题变量背景/边框/阴影、z-index 高于 modal 内容）/ `.vndb-search-option`（flex，hover 与 `.active` 同色）/ 缩略图约 40×56 `object-fit: cover` / `.vndb-search-selected` 卡片。
- 全部取主题 CSS 变量，明暗两态可用；480 断点收紧内边距。
- `nsfw-blur` 现有选择器作用域需在实现时确认（可能绑定 `.vn-card-image`）；若作用域不匹配则在 forms.css 补等效模糊规则，勿改动既有选择器。

### i18n（zh-CN / en 双侧，key 双向 diff 强制）

- 复用改文案：`index.vndbIdPlaceholder`（→「输入作品名称或 v 开头的 VNDB ID」）、`index.vndbIdHint`（→ 双模式说明）；硬编码 label「VNDB ID *」改为 `index.vndbSearchLabel` 词条。
- 新增：`index.vndbSearchSearching` / `index.vndbSearchNoResults` / `index.vndbSearchDirectHint` / `index.vndbSearchReselect` / `index.vndbSearchSelectRequired` / `prefix.searchFailed`（+ 下拉 listbox 的 aria-label 词条，如 `index.vndbSearchListLabel`）。

## 测试影响面（patch 型加载器纪律）

- **新增** `tests/router/vndb.search.test.mjs`：照 `index.start.test.mjs` 的 tempDir + stub 全套模式（auth/repository/utils/vndb/index-task/ulist-import）；vndb 桩的 `VNDBClient` 记录构造 token 与 searchVN 实参、返回定值数组。用例：401 信封 / q 空 400 / token 缺失 400 / 成功形态（`{success:true, data:[…]}`）/ limit clamp（999→20、非法→10）/ q trim 透传。
- **同步四桩**：`config.update` / `envelope` / `vn.status` / `index.start` 的 vndb 桩补 `export class VNDBClient {}`（router.js 新增该 import 后，缺导出即 crash——依赖图陷阱）。
- **新增** `tests/vndb/search.test.mjs`：照 `ulist-mapping.test.mjs` 的 fetch stub 模式断言 searchVN 请求体（search filter / searchrank / 新字段集 / results=limit）与映射（released 缺省空串、imageNsfw 边界 sexual|violence>1、rating 0-100→0-10、空 results→[]）。
- queue 测试不受影响（index.js 无改动；router.js 的 import 变化仅发生于既有 `./vndb.js` 依赖）。
- i18n key 双向 diff 测试自动覆盖新词条。

## 回滚

单 commit 功能变更，无 schema 迁移、无 wrangler 配置变更；回滚 = revert 该 commit（前后端同包回退，无兼容窗口）。

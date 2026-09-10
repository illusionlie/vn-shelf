# 管理员单条目 VNDB 刷新按钮

## Goal

管理员在首页书架上可以对**单个条目**一键重新拉取 VNDB 元数据（标题 / 封面 / 评分 / 开发商 / 标签等），无需进入编辑弹窗或跑全量索引任务。刷新后界面就地更新，不丢失滚动位置与筛选状态。

用户价值：VNDB 数据（尤其是封面、评分、标题翻译）会随时间变化，目前更新单条只能靠「批量索引」（全量、走 Queue、慢）或手动删除重加。单条刷新是最小代价的纠错路径。

## Confirmed Facts（仓库已验证）

- 后端 `PUT /api/vn/{id}` 已支持 `refreshVNDB: true`：`src/router.js:691` 内调用 `fetchVNDB(id, env)` 覆盖 `entry.vndb`，失败返回 500 `VNDB API错误: ...`。其余字段未出现时保持原值（三态语义）。**无需新增后端端点**。
- 管理员判定：前端统一使用 `$store.app.isAdmin`（`public/index.html:53/108/318`）。
- 卡片是 `div.vn-card[role=button]`，整卡 `@click="openDetail(vn)"` + `@keydown.enter.space`（`index.html:142`），封面区已有嵌套交互元素（NSFW 遮罩按钮），需阻止冒泡。
- 详情弹窗页脚在 `x-show="$store.app.isAdmin"` 下已有「编辑」「删除」两个按钮（`index.html:318-321`）。
- 现有增删改后统一 `loadVNList()` 全量重载并 `resetRenderWindow()`（`vnShelf.js:134-146`）——会重置渲染窗口 / 滚动，**本功能明确不走此路径**。
- 项目无图标库，图标以内联 SVG 形式写在 HTML 中；无构建步骤；i18n 通过 `t()` + `data-i18n`，两语言 key 由测试强制对齐。
- `PUT /api/vn/{id}` 响应 `data` 为完整条目（与 `GET /api/vn/{id}` 同形），`selectedVN` 亦为完整条目（`shared.js openDetail` 经 `vnAPI.get` 取得）——可直接互换。
- `saveVNEntry` 为 `INSERT OR REPLACE` 整行写入（`src/repository.js:203`）：刷新在途时并发删除会被复活、并发编辑会被覆盖 → 同一条目刷新中必须禁用编辑/删除。
- 全站尚无 `.btn:disabled` 样式（settings 页多处 `:disabled` 按钮无视觉反馈）。

## User Decisions（已确认）

| 决策 | 结论 |
|------|------|
| 是否走 Trellis | 是（本任务） |
| 按钮位置 | 卡片封面角落**图标按钮** + 详情弹窗页脚**文字按钮** |
| 刷新后 UI | **就地更新**该条目（列表项 + 已打开的详情），不调用 `loadVNList()` |
| 二次确认 | **不需要**（只覆盖 VNDB 元数据，用户数据不受影响） |

## Requirements

### R1 卡片图标按钮
- 仅 `$store.app.isAdmin` 时渲染（`x-if`，非管理员 DOM 中不存在）。
- 位于封面右上角；桌面端默认低可见 / 悬停或聚焦卡片时显现；触屏（`hover: none`）常显。
- 点击 / Enter / Space 触发刷新且**不**打开详情（`@click.stop`、`@keydown.stop`）。
- 具备 `aria-label`（i18n）、`type="button"`、可键盘聚焦、focus-visible 样式与项目一致。
- 刷新进行中：按钮 `aria-disabled="true"` + `aria-busy="true"` + 图标旋转动画；再次点击/回车无效（JS 守卫）。不用原生 `disabled`——会让键盘焦点掉到 body。

### R2 详情弹窗文字按钮
- 页脚在「编辑」左侧（或「编辑」「删除」之间，随设计稿）增加「刷新 VNDB」按钮，样式 `btn btn-secondary`。
- 进行中 `aria-disabled` + `aria-busy` + 文案切换为「刷新中...」（同上，不用原生 `disabled`，避免焦点逃出弹窗焦点陷阱）。
- **同一条目刷新进行中，「编辑」「删除」同步禁用**（后端整行 `INSERT OR REPLACE`，避免在途刷新复活已删条目 / 覆盖并发编辑；窗口约 1-2s）。刷新成功后若详情仍打开，用新数据就地重渲染，弹窗不关闭。

### R3 就地更新
- 请求：`vnAPI.update(id, { refreshVNDB: true })`，不携带任何用户字段。
- 成功后：
  - 用响应实体重算该条的**列表项**字段并替换 `vnList` 中对应元素（按 `id`），再重跑 `applyFilters` 得到 `filteredList`，**不**调用 `resetRenderWindow()`。
  - 若 `selectedVN?.id === id`，同步替换 `selectedVN`（详情弹窗内容更新）。
  - toast：`t('toast.refreshOk')`。
- 失败：toast `friendlyErrorMessage(error, t('prefix.refreshFailed'))`，界面数据不变。
- 并发：同一 id 进行中时忽略重复触发；不同 id 可并行（每条独立 loading 状态，用 `Set`/对象记录 `refreshingIds`）。

### R4 i18n
- 新增 key（zh-CN + en 同步）：`common.refreshVndb`（按钮文字）、`common.refreshing`、`index.refreshVndbAriaLabel`（含 `{title}` 占位，遵循 `index.*AriaLabel` 既有命名）、`toast.refreshOk`、`prefix.refreshFailed`。

### R6 通用禁用态（顺带修正）
- `base.css` 新增 `.btn:disabled` 视觉（降透明 + 屏蔽 hover 位移），使本功能与 settings 页既有禁用按钮获得一致反馈。

### R5 非管理员无副作用
- 访客模式下卡片与详情弹窗 DOM 与现状完全一致。

## Acceptance Criteria

- [ ] AC1 管理员登录后每张卡片封面右上角可见（或悬停可见）刷新图标按钮；访客看不到且 DOM 中不存在。
- [ ] AC2 点击卡片刷新图标不打开详情弹窗；键盘 Tab 至该按钮按 Enter/Space 同样不打开详情。
- [ ] AC3 点击后按钮进入 loading（aria-disabled + 旋转，焦点保持在按钮上），期间重复点击不发第二个请求（Network 面板只见一次 PUT）。
- [ ] AC4 成功后该卡片标题 / 封面 / 评分 / 开发商更新为 VNDB 最新值；页面滚动位置不变；`visibleCount` 不重置（已展开的「加载更多」条目仍在）；搜索词与状态筛选保持。
- [ ] AC5 个人评分 / 评价 / 游玩时长 / 状态 / 标签在刷新后保持不变（PUT 只传 `refreshVNDB`）。
- [ ] AC6 详情弹窗打开时点击页脚「刷新 VNDB」，弹窗内容就地更新且弹窗不关闭；卡片同步更新。
- [ ] AC7 VNDB 请求失败时出现错误 toast（通用文案，不泄露上游 message），条目数据保持刷新前状态，按钮恢复可用。
- [ ] AC8 `npm run lint` 与 `npm test` 通过；i18n key 对齐测试通过。
- [ ] AC9 新增后端测试：`PUT /api/vn/{id}` 仅传 `{ refreshVNDB: true }` 时重新拉取 VNDB 且用户字段原样保留；`fetchVNDB` 抛错时 500 且不落库（现有测试未覆盖该分支）。
- [ ] AC10 新增纯函数测试：`mergeVndbIntoListItem` 只覆盖 VNDB 派生字段、`titleCn` 回退链与 `rowToListItem` 一致、不修改入参。
- [ ] AC11 详情弹窗中该条目刷新进行中时「编辑」「删除」为 disabled；结束后恢复。
- [ ] AC12 NSFW 模糊封面上点击刷新按钮：触发刷新且不触发「点击显示」。

## Out of Scope

- Tier 页面（`/tier`）卡片不加刷新按钮（本期只做首页书架）。
- 批量选择 / 全部刷新（已有索引任务覆盖）。
- 刷新历史 / 上次刷新时间展示。
- 新的后端端点或改变 `PUT /api/vn/{id}` 契约。
- 频控 / 配额提示（依赖 `fetchVNDB` 已有 3 次重试）。

## Open Questions

- 无。技术方案见 `design.md`，执行计划见 `implement.md`。

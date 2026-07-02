# Journal - illusionlie (Part 1)

> AI development session journal
> Started: 2026-06-11

---



## Session 1: 代码库审阅落地：死代码清理、安全修复、公开配置与 CORS 改造

**Date**: 2026-06-12
**Task**: 代码库审阅落地：死代码清理、安全修复、公开配置与 CORS 改造
**Branch**: `master`

### Summary

全库审阅后按用户逐项决策分 4 批实施：1) 清理死代码（KV 绑定/BACKGROUND 变量/index-task 死导出/markdown 未用导出/success.html，保留 searchVN 与 cover.webp）；2) 修复生产 Cookie 缺 Secure（代码默认安全+wrangler 双轨配置+.dev.vars）、deploy 脚本竞态、CLAUDE.md/AGENTS.md 过时描述；3) 假 CORS 预检改为五个公开只读端点的真实 CORS，/api/config/appearance 并入 tags 配置消除访客 401，前端提取 shared.js mixin 并实现 translations-updated 热刷新；4) tier 校验提取、initDB batch 化、settings 单请求复用、前端搜索补 titleJa/排序本地化。测试 58→62 全绿。已知遗留：匿名访客仍有一次 /api/auth/verify 401（app.js checkAuth 既有行为，超出本任务范围）；索引 reconcile 机制按用户决策保持现状。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4a7024e` | (see git log) |
| `38d35ee` | (see git log) |
| `3d63403` | (see git log) |
| `943b06e` | (see git log) |
| `27b0243` | (see git log) |
| `7adb28e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: B1 前端健壮性与供应链修复

**Date**: 2026-06-28
**Task**: B1 前端健壮性与供应链修复
**Branch**: `master`

### Summary

侦察前端全量(public/ 5 HTML + 11 js 模块 + style.css)产出 docs/frontend-improvements.md(33 项/5 批次/21 任务单元/决策日志);纳入 Trellis 立项 06-28-frontend-b1-robustness 并完成 B1 批次:自托管 Alpine 3.14.9(5 HTML 切本地引用 + package.json alpineVersion + fetch:vendor 重复下载脚本)、修复 apiRequest headers 合并顺序(保留默认 Content-Type)、修复 toast id 同毫秒碰撞(模块级单调计数器)。lint/test 全绿(62 pass),AC1-AC8 验证;沉淀 3 条执行性约束到 frontend spec(Forbidden runtime CDN/headers 合并顺序/Date.now id)。AC9 冒烟待用户本地 npm run dev 走查。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `74e8ebd` | (see git log) |
| `fec9afe` | (see git log) |
| `a0dbc8e` | (see git log) |
| `edc13cb` | (see git log) |
| `b4bcf31` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: B2 前端缓存与重复消除

**Date**: 2026-06-28
**Task**: B2 前端缓存与重复消除
**Branch**: `master`

### Summary

B2 批次5交付物全部落地:(T2-A4)utils.js 抽 withLoading/debounce, settingsPage 四处 save* 改单行调用( isLoading=true 从 5 降到 1, 仅 startIndex 特殊流程保留), 行为不变含成功/失败 toast 文案;(T2-P1)vnShelf debouncedSearch=debounce(handleSearch,200)+index.html @input=debouncedSearch;(T2-P3)translations.js 模块级 _db 缓存+onclose/onversionchange 清理, 移除每事务 db.close()(否则缓存形同虚设);(T2-P2)version.json 24h 节流, 时间戳在 fetch 前写入防失败重试风暴;(T2-A2)Alpine.store('app') 承载 appearance, loadAppearance({force}) 带 _appearancePromise 去重+sessionStorage 直读+后台静默刷新派发 appearance-refreshed 事件, theme.js/shared.js 改从 Store 读并各自去掉 configAPI import, settings save 成功后 force 失效缓存。两处 deviation 经 trellis-check 核验为正确设计: 移除每事务 db.close()(否则 _db 缓存无意义) 及 settingsPage.loadConfig 保留走 /api/config 认证端点(公开 appearance 不含 hasVndbApiToken 等, 切 Store 会破坏 token 指示器破坏 AC8)。lint/test 全绿(62 pass)。沉淀 state-management 四条约定: 配置端点分层/auth vs public 勿混用、IDB 缓存勿每事务 close、节流时间戳须 fetch 前写、首屏并发加载器须 Promise 去重。AC1-AC10 验证通过, AC11 五页冒烟待用户本地 npm run dev 走查。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `89e2820` | (see git log) |
| `294f679` | (see git log) |
| `e2f717d` | (see git log) |
| `462dbbc` | (see git log) |
| `68d6da9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: B3 前端交互可达性与确认UI

**Date**: 2026-06-28
**Task**: B3 前端交互可达性与确认UI
**Branch**: `master`

### Summary

B3 批次8交付物落地: (K4/K5/K7)5页 toast aria-live+modal-close aria-label=关闭 x4+search/sort aria-label, utils.js 新增 trapFocus(el)返回清理函数;(K2)index.html vn-card div 改 role=button tabindex=0+@keydown.enter.space(tier 卡片已 button 不动);(K9)toggleMobileMenu 重写同步 aria-expanded+点外部/Esc 关闭+监听卫生,5页 more-menu role=menu/menuitem;(U1)新增 components/confirmDialog.js(Alpine.data, show/confirm/cancel/third, init() 把自身挂到 .app._confirmDialog—必须 init 非 x-init,因后者 this 回落到外层无 show 方法), layout.js injectShell() 渐进注入 progress/bg/toast/confirmDialog 到 <div id=app-shell> 占位, Store.confirm 返回 Promise<boolean|null>;(U1 替换)4处 native confirm 改 .app.confirm: deleteVN/deleteTier/clearTranslationCache(danger) + importData 三按钮(合并/替换/取消导入, null 路径不导入且清空文件输入, 成功 toast 区分 合并/替换 文案);(K3)shared/vnShelf/tierlistPage 的 open/closeDetail/openEdit/closeEdit/openTierEdit/closeTierEdit 接入 trapFocus release, 3内容模态加 role=dialog aria-modal aria-labelledby(放 .modal 面板非 overlay)+Esc 守卫 !.app._confirmDialog?.visible 防叠模态级联; confirmDialog Esc/点遮罩 在有 thirdText 时归 third() 安全项(Esc 不再触发 destructive replace)。布局 confirmDialog overlay z-index 1500 介于内容模态1000与 toast 2000 之间,修复删除弹窗被详情遮住。trellis-check 发现并修真实缺陷: 原 x-init 握手在 Alpine 表达式上下文 this 非组件实例致 show is not a function 报错(改为 init() 内挂);另补 tier/stats 登录项 role=menuitem 一致性。lint/test 62 pass 全绿。沉淀 spec quality-guidelines 四条新约束(native confirm 禁用/模态 role+面板级Esc/可点击div需role+键盘/图标按钮需aria-label+expanded)+Code Review Checklist。fetch-alpine.cjs 用 Node 内置 fetch 重写消 CodeQL shell-injection 告警, sha256 字节一致。AC1-AC12 验证通过, AC13 经用户现场验收(含删除弹窗层级/三按钮/Esc 归属/导入 toast 区分)。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `357b11b` | (see git log) |
| `5ab9758` | (see git log) |
| `255e48b` | (see git log) |
| `ad5c5f0` | (see git log) |
| `50704e5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: B4 前端拖拽键盘化与安全兜底

**Date**: 2026-07-03
**Task**: B4 前端拖拽键盘化与安全兜底
**Branch**: `master`

### Summary

B4 批次5交付物落地:(S3)theme.js safeBackgroundUrl 用 new URL+http/https 白名单拒换行/;/注释/javascript:/data:注入, 相对路径仍通过;(S4)api.js friendlyErrorMessage 按 code→status 映射, 5xx/网络合成通用文案, 4xx/本地保留后端友好中文 message 直出(因 src/utils.js errorResponse 返回无 code 字段且 message 已友好), apiRequest 网络失败封 code:NETWORK 防 Failed to fetch 泄露, 14 处 toast+withLoading 全接入;(B3-small)onDragOver null targetId 注释兜底末端+抽 applyDrop 鼠标/键盘共用;(K1)tier.html 卡片 :tabindex isAdmin?0:-1/:aria-grabbed/:aria-label/@keydown, tierlistPage.js onCardKeydown(Enter 抓取/方向键移 dropIndicator/Enter 提交/Esc 取消, Space 不拦截保留原生 click 开详情—键盘用户重排+开详情两能力并存), 非 admin tabindex=-1 不可 Tab 且 onCardKeydown 早退, 鼠标/键盘互斥双向早退, renderer 复用 .dragging 高亮;(S2)自托管 marked 18.0.5+dompurify 3.4.11 到 vendor/(.min.js 命名入 eslint 豁免, 内容为上游未压缩 ESM), markdown.js 重写为 186 行薄封装+完整 renderer 复刻 md-* 全套类(style.css 依赖), isSafeUrl 前移到 renderer.link/image, renderer.html 转义裸 HTML, DOMPurify 浏览器侧纵深防御(Node 无 DOM 降级不抛), 删自实现 parser 445→186 行, renderMarkdown 签名与 2 x-html 调用点不变, 测试扩展 6 fuzz(js:/data:/CSS 注释/嵌套/script/style)旧 5 断言字节不变。fetch:vendor 一脚本拉三 vendor(alpine+marked+dompurify)Node 内置 fetch, 各 sha256 校验。trellis-check 验证 4 处 deviation 前提均经读 src/router.js 源码确认成立。lint/test 68 pass 含 9 markdown 全绿。沉淀 spec: vendor .min.js 命名例外(未压缩 ESM 亦可)+friendlyErrorMessage 分层语义(5xx 合成 vs 4xx 保留)。AC1-AC11 验证通过, AC12 经用户现场验收(键盘拖拽/Esc/Space=开详情/非 admin 不可 Tab/背景注入/错误 toast 友好/markdown 多行段落间距)。已知 parity gap: ==高亮==/^上标^/~下标~ 非 GFM 标记不再生成, 若真实 review 数据用到会视觉退化, 留后续补救。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e0ecc1a` | (see git log) |
| `9ded589` | (see git log) |
| `65f00c5` | (see git log) |
| `f028393` | (see git log) |
| `6339474` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

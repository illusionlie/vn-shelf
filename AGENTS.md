# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目概述

VN Shelf - 视觉小说书架管理应用，部署于 Cloudflare Workers。项目无构建步骤，直接部署 ES Modules 与 `public/` 静态资源。

## Build / Test / Deploy Commands

- `npm run dev` - 本地开发服务器（`wrangler dev`）
- `npm run deploy` - 部署到 Cloudflare Workers（当前脚本为 `npm ci && wrangler deploy`）
- `npm run tail` - 实时查看 Worker 日志
- `npm run lint` - ESLint 检查（`src/**/*.js` + `public/js/**/*.js`）
- `npm run lint:fix` - 自动修复可修复的 lint 问题
- `npm run test` - 运行 Node 内置测试（`node --test`）

## 项目架构

```text
src/
├── index.js        # Worker 入口（fetch + queue）+ IndexStartLockDurableObject
├── index-task.js   # 索引任务逻辑（启动、状态查询）
├── ulist-import.js # VNDB ulist 用户列表导入管线
├── router.js       # API 路由分发与处理
├── db.js           # D1 Schema 定义与初始化
├── repository.js   # D1 数据访问层
├── stats.js        # 统计聚合纯函数（computeStats，/api/stats 数据源）
├── auth.js         # JWT + 密码哈希认证
├── vndb.js         # VNDB API 客户端
└── utils.js        # 通用工具函数

public/
├── index.html
├── login.html
├── settings.html
├── stats.html
├── tier.html
├── cover.webp
├── favicon.ico
├── robots.txt
├── css/
│   └── style.css
└── js/
    ├── app.js            # Alpine.js 入口：全局 Store + 组件注册
    ├── api.js            # API 封装
    ├── utils.js          # 工具函数（formatUserPlayTime, lockPageScroll/unlockPageScroll, toggleMobileMenu, initProgressBar）
    ├── theme.js          # 主题切换 + 自定义背景
    ├── markdown.js       # Markdown 渲染
    ├── translations.js   # Tags 翻译与缓存
    └── components/
        ├── shared.js       # 跨页面共享 mixin（tags 视图 + 详情弹窗）
        ├── vnShelf.js      # 主页书架组件
        ├── tierlistPage.js # Tier List 页组件
        ├── settingsPage.js # 设置页组件
        ├── loginPage.js    # 登录页组件
        └── statsPage.js    # 统计页组件

tests/
├── d1/
│   ├── migrations.test.mjs
│   └── repository.test.mjs
├── public/
│   ├── i18n.keys.test.mjs
│   ├── i18n.test.mjs
│   ├── markdown.security.test.mjs
│   ├── markdown.syntax.test.mjs
│   └── tier-diff.test.mjs
├── queue/
│   └── index.queue.test.mjs
├── router/
│   ├── config.update.test.mjs
│   ├── envelope.test.mjs
│   ├── index.start.test.mjs
│   └── vn.status.test.mjs
├── stats/
│   └── compute.test.mjs
└── vndb/
    ├── ulist-import.test.mjs
    └── ulist-mapping.test.mjs

.github/workflows/
├── ci.yml
└── deploy.yml
```

## Worker 执行模型

- HTTP 入口：[`fetch()`](src/index.js:141)
  - 非 `/api/*` 请求优先尝试 `env.ASSETS.fetch(request)` 获取静态资源。
  - 失败后回退到路由处理 [`handleRequest()`](src/router.js:80)。
- Queue 入口：[`queue()`](src/index.js:179)
  - 用于批量索引任务消费，带重试、幂等条目结果记录和状态汇总。
- Durable Object：[`IndexStartLockDurableObject`](src/index.js:30)
  - 全局单例，提供索引启动的分布式互斥锁（`/acquire`、`/release`、`/status`）。
  - 基于 Durable Object 存储，支持 TTL 自动过期。

## API 路由

路由总入口：[`handleAPI()`](src/router.js:116)

### 认证接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/auth/status` | 获取初始化 + 登录状态 | 公开 |
| POST | `/api/auth/init` | 初始化管理员密码（可同时写入 `vndbApiToken`） | 仅未初始化 |
| POST | `/api/auth/login` | 登录 | 公开 |
| POST | `/api/auth/logout` | 登出 | 公开 |
| GET | `/api/auth/verify` | 验证 Token | 公开 |

### VN 接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/vn` | 获取 VN 列表（支持 `sort`, `search`, `untiered`） | 公开 |
| GET | `/api/vn/{id}` | 获取单个 VN（ID 格式：`v17`） | 公开 |
| POST | `/api/vn` | 创建 VN 条目 | 需认证 |
| PUT | `/api/vn/{id}` | 更新 VN（支持 `refreshVNDB`） | 需认证 |
| DELETE | `/api/vn/{id}` | 删除 VN | 需认证 |
| PUT | `/api/vn/{id}/tier` | 更新单条 VN 的 Tier 归属与排序 | 需认证 |
| PUT | `/api/vn/tier/batch` | 批量更新 VN 的 Tier 归属与排序（上限 200） | 需认证 |

### Tier 接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/tier` | 获取 Tier 列表 | 公开 |
| POST | `/api/tier` | 创建 Tier | 需认证 |
| PUT | `/api/tier/order` | 更新 Tier 顺序 | 需认证 |
| PUT | `/api/tier/{id}` | 更新 Tier 名称/颜色 | 需认证 |
| DELETE | `/api/tier/{id}` | 删除 Tier（会先清空条目归属） | 需认证 |

### 统计接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/stats` | 获取统计聚合（概览四项 / 状态计数 / 评分直方图与分歧榜 / 完成时间线 / 开发商与标签 Top） | 公开 |

> data 层字段：既有四项（`total`/`totalPlayTimeMinutes`/`avgRating`/`avgPersonalRating`，语义不变）+ `statusCounts`、`ratingHistograms`（round 取整 1-10 分桶）、`ratingDiff`（个人 vs VNDB 双评分分歧榜）、`timeline`（按 `finish_date` 的月度聚合与通关跨度）、`topDevelopers`、`topTags`（vndb/user 双列表）。聚合口径与 shape 见 [`src/stats.js`](src/stats.js) 头注。

### 索引接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/index/start` | 启动批量索引 | 需认证 |
| GET | `/api/index/status` | 获取索引/导入状态（返回体含 `type`/`skipped`） | 需认证 |
| POST | `/api/ulist/import` | 启动 VNDB ulist 用户列表导入 | 需认证 |

### 配置接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/config` | 获取配置（脱敏） | 需认证 |
| PUT | `/api/config` | 更新配置（`vndbApiToken` / `newPassword` / tags 配置 / 外观配置） | 需认证 |
| GET | `/api/config/appearance` | 获取外观与公开 tags 配置（`backgroundUrl` / `backgroundOverlay` / `backgroundBlur` / `tagsMode` / `translateTags` / `translationUrl`） | 公开 |

### 导入导出接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/export` | 导出数据（含 `entries` 和 `tierList`） | 需认证 |
| POST | `/api/import` | 导入数据（`merge` / `replace`，支持 `tierList`） | 需认证 |

## 页面与静态资源路由

页面和静态资源由 Worker Assets 提供，配置见 [`wrangler.toml.example`](wrangler.toml.example)。

| 路径 | 说明 |
|------|------|
| `/` 或 `/index.html` | 首页 |
| `/login` | 登录页 |
| `/settings` | 设置页 |
| `/stats` | 统计页 |
| `/tier` | Tier List 页 |
| `/css/style.css` | 样式 |
| `/js/*.js` | 前端模块 |

> `html_handling = "auto-trailing-slash"`，因此页面路由使用无 `.html` 形式也可访问。

## Queue 处理机制（批量索引）

- Queue 绑定：`VN_INDEX_QUEUE`（配置见 [`wrangler.toml.example`](wrangler.toml.example)）
- 消费逻辑：[`queue()`](src/index.js:179)
- 索引启动：[`startIndexTask()`](src/index-task.js:42)，状态查询 [`getIndexTaskStatus()`](src/index-task.js:38)
- 分布式锁：[`IndexStartLockDurableObject`](src/index.js:30) 提供启动互斥，绑定名 `INDEX_START_LOCK`
- 重试策略：最多 3 次，重试延迟 60 秒（`retryCount` 累增）
- 幂等结果：按 `taskId + vndbId` 写入 `index_task_items` 表，成功结果对失败回写具有"粘性"
- 汇总机制：[`reconcileIndexStatusFromItems()`](src/repository.js:702) 基于 `index_task_items` 表汇总 `processed/failed`
- 延迟汇总：高频批次下仅临近完成时即时汇总，其余走 `ctx.waitUntil` 延迟汇总降载（最多 6 次，间隔 5s）
- 状态终态：`completed` 或 `partial`，D1 模式下聚合列表由 SQL 实时计算，无需手动重建
- 终态清理：汇总转入终态时自动清理 `index_task_items` 表对应记录

## 认证系统

- JWT 生成/校验：[`createJWT()`](src/auth.js:14)、[`verifyJWT()`](src/auth.js:44)
- 签名算法：HMAC-SHA256（Web Crypto API）
- Token 存储：`httpOnly` Cookie `auth_token`，有效期 24h
- 密码哈希：PBKDF2 + SHA-256（见 [`hashPassword()`](src/auth.js:132)）
- 初始化/校验：[`setAdminPassword()`](src/auth.js:251)、[`verifyAdminPassword()`](src/auth.js:268)

## VNDB API 集成

- API 基址：`https://api.vndb.org/kana`
- 客户端类：`VNDBClient`（`src/vndb.js`）
- 主要方法：`getVN()`、`searchVN()`、`getAuthInfo()`（GET `/authinfo`，校验 `listread` 权限）、`fetchUList()`（POST `/ulist` 分页拉取用户列表）
- 请求方法：`request(endpoint, body, method='POST')`，GET 不带 body（`/authinfo` 用 GET；`/vn`、`/ulist` 默认 POST）
- 共享映射：`mapVnObjectToVndbData(vn)` 将 VNDB vn 对象转本地格式，`getVN` 与 ulist 导入共用（回归保护）
- 统一入口：`fetchVNDB()`，默认 3 次重试 + 指数退避
- 配置来源：`config:settings/vndbApiToken`

## VNDB ulist 用户列表导入

- 管线：`src/ulist-import.js` 的 `startUListImport(env, ctx)` → `getAuthInfo` 取 uid → 建 `type='ulist_import'` 任务 → `ctx.waitUntil` 分页拉取 + 映射 + `saveVNEntry`
- 执行模型：waitUntil 分页循环（每页 ≤100，`vn.*` 一次拉全）；开始时一次性预载已存在 id 集合到内存，逐条命中判断走内存避免 N 次 subrequest
- 状态映射（07-11 固化）：label `1→playing, 2→finished, 3→stalled, 4→dropped, 5→wishlist`；多 label 终态优先 `2>4>3>1` 单值化；纯 wishlist（仅 label5、无 1-4）跳过；无 1-4 标签 → status null；`vote/10→personalRating`（vote 空→0）；`started→startDate`、`finished→finishDate`。映射常量与 `mapUListItemToEntry()` 落 `src/vndb.js`
- 进度语义：total（拉取到条目数）、processed、skipped（已存在 + 纯 wishlist）、failed（写库失败）；终态 `completed`/`partial`
- 任务状态复用 `index_tasks` 表（`type` 列区分 index/ulist_import，`skipped` 列记录跳过数）；启动端点 `POST /api/ulist/import` 复用 `INDEX_START_LOCK` Durable Object 与索引任务互斥；进度查询复用 `GET /api/index/status`（返回体含 `type`/`skipped`，前端按 `type` 区分文案）

## 数据结构

### VN 完整条目

```javascript
{
  id: "v17",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  vndb: {
    title: "CLANNAD",
    titleJa: "CLANNAD",
    titleCn: "CLANNAD",
    image: "https://...",
    imageNsfw: false,
    rating: 8.5,
    length: "60小时",
    lengthMinutes: 3600,
    developers: ["Key"],
    tags: ["Drama", "Romance"],
    allAge: false
  },
  user: {
    titleCn: "自定义中文名",
    personalRating: 9.0,
    playTime: "60小时30分钟",
    playTimeHours: 60,
    playTimePartMinutes: 30,
    playTimeMinutes: 3630,
    review: "评价内容",
    startDate: "2024-01-01",
    finishDate: "2024-02-01",
    status: "playing", // 游玩状态：playing/finished/stalled/dropped/wishlist，null = 未设置
    tags: ["自定义标签"],
    tierId: "tier-a",
    tierSort: 0
  }
}
```

### 列表项

```javascript
{
  id: "v17",
  title: "CLANNAD",
  titleJa: "CLANNAD",
  titleCn: "CLANNAD",
  image: "https://...",
  imageNsfw: false,
  rating: 8.5,
  personalRating: 9.0,
  playTimeMinutes: 3630,
  developers: ["Key"],
  allAge: false,
  tierId: "tier-a",
  tierSort: 0,
  status: "playing", // 游玩状态，同完整条目 user.status，null = 未设置
  createdAt: "2024-01-01T00:00:00.000Z"
}
```

### Tier 列表

```javascript
{
  tiers: [
    { id: "tier-s", name: "S", color: "#ff4757", order: 0 },
    { id: "tier-a", name: "A", color: "#ffa502", order: 1 }
  ],
  updatedAt: "2024-01-02T00:00:00.000Z"
}
```

## 前端架构

- 入口：[`public/js/app.js`](public/js/app.js) — Alpine.js 全局 Store 注册 + 组件注册（胶水层）
- API 封装：[`public/js/api.js`](public/js/api.js)
- 工具函数：[`public/js/utils.js`](public/js/utils.js) — `formatUserPlayTime`, `lockPageScroll`/`unlockPageScroll`, `toggleMobileMenu`, `initProgressBar`
- 主题与背景：[`public/js/theme.js`](public/js/theme.js) — 主题切换、自定义背景 overlay
- Markdown 渲染：[`renderMarkdown()`](public/js/markdown.js:159)（带安全 URL 校验）
- Tags 翻译：[`initTranslations()`](public/js/translations.js:240)
  - IndexedDB 缓存：`vn-shelf-translations`
  - 缓存键：`tagTranslations`
  - 策略：缓存优先 + 后台版本检查 + 自动更新事件 `translations-updated`

### 页面组件（`public/js/components/`）

| 组件 | 文件 | 说明 |
|------|------|------|
| `vnShelf` | [`vnShelf.js`](public/js/components/vnShelf.js) | 主页书架：列表加载、搜索、排序、详情/编辑弹窗 |
| `tierlistPage` | [`tierlistPage.js`](public/js/components/tierlistPage.js) | Tier List：拖拽排序、跨 Tier 移动、批量更新 |
| `settingsPage` | [`settingsPage.js`](public/js/components/settingsPage.js) | 设置：VNDB Token、密码、索引、导入导出、外观 |
| `loginPage` | [`loginPage.js`](public/js/components/loginPage.js) | 登录/初始化 |
| `statsPage` | [`statsPage.js`](public/js/components/statsPage.js) | 统计数据展示 |

### Tier List 前端行为

- 页面：[`public/tier.html`](public/tier.html)
- 逻辑：[`tierlistPage`](public/js/components/tierlistPage.js)
- 支持拖拽排序与跨 Tier 移动，调用批量接口 `/api/vn/tier/batch`
- 前端分片提交批量更新，单批上限与后端一致为 200

## 测试与 CI

- Queue 行为测试：[`tests/queue/index.queue.test.mjs`](tests/queue/index.queue.test.mjs)
   - 覆盖重试补发、ack/retry 分支、失败结果写入异常分支
- D1 数据访问层测试：[`tests/d1/repository.test.mjs`](tests/d1/repository.test.mjs)
- 统计聚合纯函数测试：[`tests/stats/compute.test.mjs`](tests/stats/compute.test.mjs)
- Markdown 安全测试：[`tests/public/markdown.security.test.mjs`](tests/public/markdown.security.test.mjs)
- 索引启动路由测试：[`tests/router/index.start.test.mjs`](tests/router/index.start.test.mjs)
- 配置更新路由测试：[`tests/router/config.update.test.mjs`](tests/router/config.update.test.mjs)
- CI（[`ci.yml`](.github/workflows/ci.yml)）
  - ESLint
  - Node 内置测试（`npm run test`）
  - Wrangler deploy dry-run（依赖 lint + test，基于 `wrangler.toml.example` 生成临时配置）

## 开发注意事项

1. **无构建步骤**：直接修改 `src/` 与 `public/` 文件即可。
2. **静态资源优先**：非 API 路由优先从 Assets 返回，API 才进入 Router。
3. **游玩时长字段约定**：后端仅接受 `playTimeHours` + `playTimePartMinutes`，不再接受旧字段 `playTime` / `playTimeMinutes` 作为输入。
4. **Tier 一致性**：删除 Tier 时先清理条目归属，再落库 Tier 列表。
5. **导入前全量校验**：`/api/import` 会先校验所有条目与 `tierList` 结构，再执行写入。
6. **敏感信息管理**：VNDB Token、密码哈希、JWT Secret 存储于 D1 settings 表，不直接暴露给前端。
7. **本地配置**：使用 `wrangler.toml.example` 生成实际 `wrangler.toml`，绑定 D1 数据库与 Queue 后再运行 `npm run dev`。
8. **Durable Object 绑定**：`INDEX_START_LOCK` Durable Object 绑定为必选项（提供索引启动互斥锁），缺失时 `/api/index/start` 会返回 500。
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

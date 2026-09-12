# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目概述

VN Shelf - 视觉小说书架管理应用，部署于 Cloudflare Workers。项目无构建步骤，直接部署 ES Modules 与 `public/` 静态资源。静态页面由 Worker Assets 提供（`html_handling = "auto-trailing-slash"`，`/login` 等无 `.html` 路径均可访问）。

## Build / Test / Deploy Commands

- `npm run dev` - 本地开发服务器（`wrangler dev`）
- `npm run deploy` - 部署到 Cloudflare Workers（当前脚本为 `npm ci && wrangler deploy`）
- `npm run tail` - 实时查看 Worker 日志
- `npm run lint` - ESLint 检查（`src/**/*.js` + `public/js/**/*.js`）
- `npm run lint:fix` - 自动修复可修复的 lint 问题
- `npm run test` - 运行 Node 内置测试（`node --test`）
- `npm run fetch:vendor` - 按 package.json 锁定版本拉取自托管前端依赖（`public/js/vendor/`）

## 项目架构

```text
src/
├── index.js        # Worker 入口（fetch + queue）+ IndexStartLockDurableObject
├── index-task.js   # 索引任务启动与状态查询
├── ulist-import.js # VNDB ulist 用户列表导入管线
├── router.js       # API 路由分发与处理
├── db.js           # D1 Schema 定义与初始化
├── repository.js   # D1 数据访问层
├── stats.js        # 统计聚合纯函数（computeStats，/api/stats 数据源）
├── auth.js         # JWT + 密码哈希认证
├── vndb.js         # VNDB API 客户端与字段映射（含 ulist 状态映射常量）
└── utils.js        # 通用工具函数

public/
├── index.html / login.html / settings.html / stats.html / tier.html
├── cover.webp / favicon.ico / robots.txt
├── css/                # base（全站共享）→ forms → cards-detail → 页面级样式
└── js/
    ├── app.js            # Alpine.js 入口（i18n 初始化 + 壳层注入 + 组件注册）
    ├── api.js            # API 封装
    ├── i18n.js           # t() / applyI18nDom() / setLocale()
    ├── locales/          # 词典：zh-CN.js（默认）+ en.js
    ├── layout.js         # injectShell() 公共壳层 + injectFooter() 页脚
    ├── constants.js      # 前端共享常量
    ├── utils.js          # 工具函数
    ├── theme.js          # 主题切换 + 自定义背景
    ├── markdown.js       # Markdown 渲染
    ├── translations.js   # Tags 翻译与 IndexedDB 缓存
    ├── tier-diff.js      # Tier 拖拽 diff 纯函数
    ├── vn-list-item.js   # 完整条目 → 列表项合并纯函数
    ├── vendor/           # 自托管第三方依赖（fetch-vendor.cjs 拉取脚本）
    └── components/
        ├── shared.js        # 跨页面共享 mixin（tags 视图 + 详情弹窗）
        ├── confirmDialog.js # 全局确认对话框
        ├── vnShelf.js       # 主页书架
        ├── tierlistPage.js  # Tier List 页
        ├── settingsPage.js  # 设置页
        ├── loginPage.js     # 登录页
        └── statsPage.js     # 统计页

tests/              # node --test，按域分目录：d1 / public / queue / router / stats / vndb

.github/workflows/
├── ci.yml          # lint + test + deploy dry-run
└── deploy.yml      # 手动部署（workflow_dispatch）
```

## Worker 执行模型

- HTTP 入口：[`fetch()`](src/index.js)
  - 非 `/api/*` 请求优先尝试 `env.ASSETS.fetch(request)` 获取静态资源。
  - 失败后回退到路由处理 [`handleRequest()`](src/router.js)。
- Queue 入口：[`queue()`](src/index.js)
  - 用于批量索引任务消费，带重试、幂等条目结果记录和状态汇总。
- Durable Object：[`IndexStartLockDurableObject`](src/index.js)
  - 全局单例，提供索引启动的分布式互斥锁（`/acquire`、`/release`、`/status`）。
  - 基于 Durable Object 存储，支持 TTL 自动过期。

## API 路由

路由总入口：[`handleAPI()`](src/router.js)

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/auth/status` | 初始化 + 登录状态 | 公开 |
| POST | `/api/auth/init` | 初始化管理员密码（可同时写入 `vndbApiToken`） | 仅未初始化 |
| POST | `/api/auth/login` | 登录 | 公开 |
| POST | `/api/auth/logout` | 登出 | 公开 |
| GET | `/api/auth/verify` | 验证 Token | 公开 |
| GET | `/api/vn` | VN 列表（`sort` / `search` / `untiered`） | 公开 |
| GET | `/api/vn/{id}` | 单个 VN（ID 格式 `v17`） | 公开 |
| POST | `/api/vn` | 创建 VN 条目 | 需认证 |
| PUT | `/api/vn/{id}` | 更新 VN（支持 `refreshVNDB`） | 需认证 |
| DELETE | `/api/vn/{id}` | 删除 VN | 需认证 |
| PUT | `/api/vn/{id}/tier` | 更新单条 Tier 归属与排序 | 需认证 |
| PUT | `/api/vn/tier/batch` | 批量更新 Tier 归属（上限 200） | 需认证 |
| GET | `/api/tier` | Tier 列表 | 公开 |
| POST | `/api/tier` | 创建 Tier | 需认证 |
| PUT | `/api/tier/order` | 更新 Tier 顺序 | 需认证 |
| PUT | `/api/tier/{id}` | 更新 Tier 名称/颜色 | 需认证 |
| DELETE | `/api/tier/{id}` | 删除 Tier（先清空条目归属） | 需认证 |
| GET | `/api/stats` | 统计聚合（口径与 shape 见 [`src/stats.js`](src/stats.js) 头注） | 公开 |
| POST | `/api/index/start` | 启动批量索引 | 需认证 |
| GET | `/api/index/status` | 索引/导入任务状态（含 `type`/`skipped`） | 需认证 |
| POST | `/api/ulist/import` | 启动 VNDB ulist 导入 | 需认证 |
| GET | `/api/vndb/search` | VNDB 模糊搜索（`q` trim 后必填、超 100 字符截断；`limit` clamp 1..20 默认 10） | 需认证 |
| GET | `/api/config` | 获取配置（脱敏） | 需认证 |
| PUT | `/api/config` | 更新配置（`vndbApiToken` / `newPassword` / tags / 外观） | 需认证 |
| GET | `/api/config/appearance` | 外观与公开 tags 配置 | 公开 |
| GET | `/api/export` | 导出数据（`entries` + `tierList`） | 需认证 |
| POST | `/api/import` | 导入数据（`merge`/`replace`，支持 `tierList`） | 需认证 |

## Queue 处理机制（批量索引）

- Queue 绑定：`VN_INDEX_QUEUE`（配置见 [`wrangler.toml.example`](wrangler.toml.example)）
- 消费逻辑：[`queue()`](src/index.js)；任务启动/状态查询：[`src/index-task.js`](src/index-task.js)
- 重试策略与延迟汇总频率见 `src/index.js` 顶部常量（`INDEX_MAX_RETRY` 等）
- 幂等结果：按 `taskId + vndbId` 写入 `index_task_items` 表，成功结果对失败回写具有"粘性"；[`reconcileIndexStatusFromItems()`](src/repository.js) 据此汇总 `processed/failed`，高频批次下部分汇总走 `ctx.waitUntil` 延迟执行降载
- 状态终态 `completed` / `partial`，转入终态时自动清理 `index_task_items` 对应记录

## 认证系统

- JWT 生成/校验：[`createJWT()`](src/auth.js)、[`verifyJWT()`](src/auth.js)
- 签名算法：HMAC-SHA256（Web Crypto API）
- Token 存储：`httpOnly` Cookie `auth_token`，有效期 24h
- 密码哈希：PBKDF2 + SHA-256（见 [`hashPassword()`](src/auth.js)）
- 初始化/校验：[`setAdminPassword()`](src/auth.js)、[`verifyAdminPassword()`](src/auth.js)

## VNDB API 集成

- API 基址：`https://api.vndb.org/kana`
- 客户端类：`VNDBClient`（`src/vndb.js`）
- 主要方法：`getVN()`、`searchVN()`（search filter + `sort: 'searchrank'`，`GET /api/vndb/search` 数据源）、`getAuthInfo()`（GET `/authinfo`，校验 `listread` 权限）、`fetchUList()`（POST `/ulist` 分页拉取用户列表）
- 请求方法：`request(endpoint, body, method='POST')`，GET 不带 body（`/authinfo` 用 GET；`/vn`、`/ulist` 默认 POST）
- 共享映射：`mapVnObjectToVndbData(vn)` 将 VNDB vn 对象转本地格式，`getVN` 与 ulist 导入共用（回归保护）
- 统一入口：`fetchVNDB()`，默认 3 次重试 + 指数退避
- 配置来源：`config:settings/vndbApiToken`

## VNDB ulist 用户列表导入

- 管线：[`startUListImport()`](src/ulist-import.js) → `getAuthInfo` 取 uid → 建 `type='ulist_import'` 任务 → `ctx.waitUntil` 分页拉取（每页 ≤100）+ 映射 + `saveVNEntry`；开始时预载已存在 id 集合到内存，避免 N 次 subrequest
- label → status 映射与多 label 单值化优先级固化在 [`src/vndb.js`](src/vndb.js) 常量与头注（`ULIST_LABEL_TO_STATUS` 等），回归由 `tests/vndb/ulist-mapping.test.mjs` 卡住
- 进度语义：total（拉取条目数）/ processed / skipped（已存在 + 纯 wishlist）/ failed；终态 `completed`/`partial`
- 任务复用 `index_tasks` 表与 `INDEX_START_LOCK` 互斥；进度查询复用 `GET /api/index/status`，前端按返回体 `type` 区分文案

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
    playTimeHours: 60,             // 写入仅接受此二字段
    playTimePartMinutes: 30,
    playTime: "60小时30分钟",       // 仅输出（派生），写入时忽略
    playTimeMinutes: 3630,         // 仅输出（派生），写入时忽略
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

- 入口：[`public/js/app.js`](public/js/app.js)（胶水层：i18n 初始化 + 壳层/页脚注入 + Store 与组件注册）；API 封装：[`public/js/api.js`](public/js/api.js)
- i18n：HTML 静态文案走 `data-i18n*` 标记由 `applyI18nDom()` 应用，JS 动态文案走 `t()`，Alpine 内联表达式走 `$t` magic；新增 key 必须同步 `zh-CN.js` 与 `en.js`（`tests/public/i18n.keys.test.mjs` 双向 parity 强制）
- 公共壳层/页脚：[`public/js/layout.js`](public/js/layout.js)（纯 DOM 注入，无 Alpine 依赖）
- 前后端同值常量在 [`public/js/constants.js`](public/js/constants.js)（如批量 Tier 上限 200），修改一端必须同步另一端
- 第三方依赖 vendor 自托管（版本锁定在 `package.json`，`npm run fetch:vendor` 拉取），禁止运行时 CDN

### 页面组件（`public/js/components/`）

| 组件 | 说明 |
|------|------|
| `vnShelf` | 主页书架：列表/搜索/排序、详情与编辑弹窗、渲染窗口化（哨兵追加 + 加载更多）、管理员单条目 VNDB 刷新 |
| `tierlistPage` | Tier List：拖拽排序、跨 Tier 移动、分片批量提交（单批上限 200） |
| `settingsPage` | 设置：VNDB Token、密码、索引、导入导出、外观、语言切换 |
| `loginPage` | 登录/初始化 |
| `statsPage` | 统计数据展示 |

## 测试与 CI

- 测试：`npm run test`（node --test），文件布局见架构树 `tests/`
- CI（[`ci.yml`](.github/workflows/ci.yml)）：ESLint → Node 测试 → Wrangler deploy dry-run（基于 `wrangler.toml.example` 生成临时配置）
- 手动部署（[`deploy.yml`](.github/workflows/deploy.yml)，`workflow_dispatch`）：部署前幂等预检/创建 D1 `vn-shelf-db` 与 Queue `vn-index-queue`；所需 Secrets 与配置步骤见 README

## 开发注意事项

1. **游玩时长字段**：后端仅接受 `playTimeHours` + `playTimePartMinutes`；`playTime` / `playTimeMinutes` 为派生输出字段，不作为输入。
2. **Tier 一致性**：删除 Tier 时先清理条目归属，再落库 Tier 列表。
3. **导入前全量校验**：`/api/import` 会先校验所有条目与 `tierList` 结构，再执行写入。
4. **敏感信息管理**：VNDB Token、密码哈希、JWT Secret 存储于 D1 settings 表，不直接暴露给前端。
5. **本地配置**：使用 `wrangler.toml.example` 生成实际 `wrangler.toml`，绑定 D1 数据库与 Queue 后再运行 `npm run dev`。
6. **Durable Object 绑定**：`INDEX_START_LOCK` Durable Object 绑定为必选项（提供索引启动互斥锁），缺失时 `/api/index/start` 会返回 500。
7. **CSS 分模块**：`public/css/` 下链接顺序固定为 base → forms → cards-detail → 页面文件；JS 注入的共享 DOM（壳层/页脚）样式进 `base.css`。
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

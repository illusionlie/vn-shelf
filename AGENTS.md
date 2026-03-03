# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目概述

VN Shelf - 视觉小说书架管理应用，部署于 Cloudflare Workers。项目无构建步骤，直接部署 ES Modules 与 `public/` 静态资源。

## Build / Test / Deploy Commands

- `npm run dev` - 本地开发服务器（`wrangler dev`）
- `npm run deploy` - 部署到 Cloudflare Workers（当前脚本为 `npm i & wrangler deploy`）
- `npm run tail` - 实时查看 Worker 日志
- `npm run lint` - ESLint 检查（`src/**/*.js` + `public/js/**/*.js`）
- `npm run lint:fix` - 自动修复可修复的 lint 问题
- `npm run test` - 运行 Node 内置测试（`node --test`）

## 项目架构

```text
src/
├── index.js      # Worker 入口（fetch + queue）
├── router.js     # API 路由分发与处理
├── kv.js         # KV 存储与聚合/索引状态逻辑
├── auth.js       # JWT + 密码哈希认证
├── vndb.js       # VNDB API 客户端
└── utils.js      # 通用工具函数

public/
├── index.html
├── login.html
├── settings.html
├── stats.html
├── tier.html
├── css/
│   └── style.css
└── js/
    ├── api.js
    ├── app.js
    ├── markdown.js
    └── translations.js

tests/
└── queue/
    └── index.queue.test.mjs

.github/workflows/
├── ci.yml
└── deploy.yml
```

## Worker 执行模型

- HTTP 入口：[`fetch()`](src/index.js:24)
  - 非 `/api/*` 请求优先尝试 `env.ASSETS.fetch(request)` 获取静态资源。
  - 失败后回退到路由处理 [`handleRequest()`](src/router.js:49)。
- Queue 入口：[`queue()`](src/index.js:63)
  - 用于批量索引任务消费，带重试、幂等条目结果记录和状态汇总。

## API 路由

路由总入口：[`handleAPI()`](src/router.js:79)

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
| GET | `/api/stats` | 获取统计数据 | 公开 |

### 索引接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/index/start` | 启动批量索引 | 需认证 |
| GET | `/api/index/status` | 获取索引状态 | 需认证 |

### 配置接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/config` | 获取配置（脱敏） | 需认证 |
| PUT | `/api/config` | 更新配置（`vndbApiToken` / `newPassword` / tags 配置） | 需认证 |

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
| `/success` | 静态成功页（对应 `public/success.html`） |
| `/css/style.css` | 样式 |
| `/js/*.js` | 前端模块 |

> `html_handling = "auto-trailing-slash"`，因此页面路由使用无 `.html` 形式也可访问。

## KV 键命名约定

| 键 | 说明 | 数据结构 |
|----|------|----------|
| `config:settings` | 全局配置 | `{ vndbApiToken, adminPasswordHash, jwtSecret, lastIndexTime, tagsMode, translateTags, translationUrl }` |
| `vn:list` | VN 列表聚合数据 | `{ items: [...], stats: {...}, updatedAt }` |
| `vn:{id}` | 单个 VN 条目 | 见下方完整条目结构 |
| `tier:list` | Tier 列表 | `{ tiers: [{id,name,color,order}], updatedAt }` |
| `index:status` | 当前索引任务状态 | `{ status, taskId, total, processed, failed, startedAt, completedAt, error, lastReconciledAt }` |
| `index:item:{taskId}:{vndbId}` | 索引单条结果（幂等键，TTL 14 天） | `{ taskId, vndbId, state, retryCount, error, updatedAt }` |

核心实现位于：[`getSettings()`](src/kv.js:104)、[`getVNList()`](src/kv.js:132)、[`getTierList()`](src/kv.js:161)、[`recordIndexItemResult()`](src/kv.js:591)。

## Queue 处理机制（批量索引）

- Queue 绑定：`VN_INDEX_QUEUE`（配置见 [`wrangler.toml.example`](wrangler.toml.example)）
- 消费逻辑：[`queue()`](src/index.js:63)
- 重试策略：最多 3 次，重试延迟 60 秒（`retryCount` 累增）
- 幂等结果：按 `taskId + vndbId` 写入 `index:item:*`，成功结果对失败回写具有“粘性”
- 汇总机制：[`reconcileIndexStatusFromItems()`](src/kv.js:694) 基于 item keys 汇总 `processed/failed`
- 状态终态：`completed` 或 `partial`，终态后会执行聚合重建 [`rebuildVNList()`](src/kv.js:326)

## 认证系统

- JWT 生成/校验：[`createJWT()`](src/auth.js:14)、[`verifyJWT()`](src/auth.js:44)
- 签名算法：HMAC-SHA256（Web Crypto API）
- Token 存储：`httpOnly` Cookie `auth_token`，有效期 24h
- 密码哈希：PBKDF2 + SHA-256（见 [`hashPassword()`](src/auth.js:132)）
- 初始化/校验：[`initAdminPassword()`](src/auth.js:239)、[`verifyAdminPassword()`](src/auth.js:256)

## VNDB API 集成

- API 基址：`https://api.vndb.org/kana`
- 客户端类：[`VNDBClient`](src/vndb.js:14)
- 主要方法：[`getVN()`](src/vndb.js:49)、[`searchVN()`](src/vndb.js:133)
- 统一入口：[`fetchVNDB()`](src/vndb.js:195)，默认 3 次重试 + 指数退避
- 配置来源：`config:settings/vndbApiToken`

## 数据结构

### VN 完整条目（`vn:{id}`）

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
    tags: ["自定义标签"],
    tierId: "tier-a",
    tierSort: 0
  }
}
```

### 列表项（`vn:list.items[]`）

```javascript
{
  id: "v17",
  title: "CLANNAD",
  titleJa: "CLANNAD",
  titleCn: "CLANNAD",
  image: "https://...",
  rating: 8.5,
  personalRating: 9.0,
  playTimeMinutes: 3630,
  developers: ["Key"],
  allAge: false,
  tierId: "tier-a",
  tierSort: 0,
  createdAt: "2024-01-01T00:00:00.000Z"
}
```

### Tier 列表（`tier:list`）

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

- API 封装：[`public/js/api.js`](public/js/api.js)
- 页面状态管理：[`public/js/app.js`](public/js/app.js)
  - 组件：`vnShelf` / `loginPage` / `settingsPage` / `statsPage` / `tierlistPage`
- Markdown 渲染：[`renderMarkdown()`](public/js/markdown.js:136)（带安全 URL 校验）
- Tags 翻译：[`initTranslations()`](public/js/translations.js:240)
  - IndexedDB 缓存：`vn-shelf-translations`
  - 缓存键：`tagTranslations`
  - 策略：缓存优先 + 后台版本检查 + 自动更新事件 `translations-updated`

### Tier List 前端行为

- 页面：[`public/tier.html`](public/tier.html)
- 逻辑：[`tierlistPage`](public/js/app.js:689)
- 支持拖拽排序与跨 Tier 移动，调用批量接口 `/api/vn/tier/batch`
- 前端分片提交批量更新，单批上限与后端一致为 200

## 测试与 CI

- Queue 行为测试：[`tests/queue/index.queue.test.mjs`](tests/queue/index.queue.test.mjs)
  - 覆盖重试补发、ack/retry 分支、失败结果写入异常分支
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
6. **敏感信息管理**：VNDB Token、密码哈希、JWT Secret 存储于 KV，不直接暴露给前端。
7. **本地配置**：使用 `wrangler.toml.example` 生成实际 `wrangler.toml`，绑定 KV 与 Queue 后再运行 `npm run dev`。

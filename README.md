# VN Shelf

一个部署在 Cloudflare Workers 上的视觉小说（Visual Novel）书架管理应用，支持 VNDB 数据拉取、分级 Tier 管理、批量索引、导入导出与基础统计。

## 功能特性

- VN 条目管理：创建、更新、删除、按条件检索
- VNDB 集成：根据 `v{id}` 拉取标题、封面、评分、时长、开发商、标签等信息
- Tier List：支持分层展示、拖拽排序、跨 Tier 移动（含批量更新）
- 认证系统：管理员初始化、登录态校验、JWT + HttpOnly Cookie
- 批量索引：基于 Cloudflare Queues 异步刷新条目 VNDB 信息
- 导入/导出：支持库数据备份与迁移（含 Tier 列表）
- 标签翻译：前端 IndexedDB 缓存 + 后台版本更新机制

## 技术栈

- 运行时：Cloudflare Workers（ES Modules）
- 存储：Cloudflare KV
- 队列：Cloudflare Queues
- 前端：原生 HTML/CSS/JavaScript（无构建步骤）
- 测试：Node.js 内置测试运行器（`node --test`）
- 代码质量：ESLint

## GitHub Actions 部署指南

部署工作流位于 `.github/workflows/deploy.yml`，需要配置以下 Secrets：

- `WORKER_NAME`
- `CF_API_TOKEN`
- `CF_KV_NAMESPACE_ID`
- `CF_ACCOUNT_ID`（可选，不填则通过 API token 自动获取）
- `CUSTOM_DOMAIN`（可选）

### 获取 Cloudflare API Token

1. 登录 Cloudflare 控制台，进入“管理账户” -> “API 令牌”页面。
2. 点击“创建令牌”按钮，选择“编辑 Cloudflare Workers”使用模板。
3. 在权限部分点击“添加更多”，选择“Queues”，并选择“编辑”权限。
4. 点击“继续以显示摘要” -> “创建令牌”按钮，复制生成的 API Token。

### 获取 Cloudflare KV Namespace ID

1. 登录 Cloudflare 控制台，进入“存储和数据库” -> “Workers KV”页面。
2. 创建一个 KV 命名空间（或使用现有），点击“名称”进入详情页。
3. 复制“ID”字段的值，即为 `CF_KV_NAMESPACE_ID`。

### 创建 Queue

1. 登录 Cloudflare 控制台，进入“Compute” -> “Queues”页面。
2. 点击“创建队列”按钮，队列名称为`vn-index-queue`，点击“创建”按钮。

### 配置 Secrets

1. 登录 GitHub 仓库，进入“Settings” -> “Secrets and variables” -> “Actions”页面。
2. 点击“New repository secret”按钮，添加上述 Secrets。

### 触发部署

1. 登录 GitHub 仓库，进入“Actions”页面。
2. 点击“Deploy to Cloudflare”工作流，点击“Run workflow”按钮。

## 本地开发指南

### 1) 安装依赖

```bash
npm ci
```

### 2) 配置 `wrangler.toml`

复制模板并生成实际配置文件：

```bash
# Windows (cmd)
copy wrangler.toml.example wrangler.toml

# macOS / Linux
cp wrangler.toml.example wrangler.toml
```

按需替换以下占位符：

- `__WORKER_NAME__`：你的 Worker 名称
- `__KV_NAMESPACE_ID__`：KV 命名空间 ID

模板中默认包含：

- KV 绑定：`KV`
- Queue 绑定：`VN_INDEX_QUEUE`（队列名 `vn-index-queue`）
- 静态资源绑定：`ASSETS`（目录 `./public`）

### 3) Cloudflare 资源准备

确保已创建并绑定：

- 1 个 KV 命名空间
- 1 个 Queue

### 4) 启动本地开发

```bash
npm run dev
```

### 5) 常用命令

```bash
npm run lint      # ESLint 检查
npm run lint:fix  # 自动修复可修复问题
npm run test      # 运行测试
npm run tail      # 查看 Worker 实时日志
npm run deploy    # 部署到 Cloudflare Workers
```

## Worker 执行模型

- HTTP 入口：
  - 非 `/api/*` 请求优先尝试 `env.ASSETS.fetch(request)` 获取静态资源
  - 未命中后回退到 API 路由处理
- Queue 入口：
  - 消费批量索引任务
  - 失败重试（最多 3 次，延迟 60 秒）
  - 写入幂等 item 结果并周期汇总任务状态

## API 概览

路由总入口：`/api/*`

### 认证

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/auth/status` | 获取初始化 + 登录状态 | 公开 |
| POST | `/api/auth/init` | 初始化管理员密码（可同时写入 `vndbApiToken`） | 仅未初始化 |
| POST | `/api/auth/login` | 登录 | 公开 |
| POST | `/api/auth/logout` | 登出 | 公开 |
| GET | `/api/auth/verify` | 验证 Token | 公开 |

### VN

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/vn` | 获取 VN 列表（支持 `sort`,`search`,`untiered`） | 公开 |
| GET | `/api/vn/{id}` | 获取单个 VN（ID 示例：`v17`） | 公开 |
| POST | `/api/vn` | 创建 VN 条目 | 需认证 |
| PUT | `/api/vn/{id}` | 更新 VN（支持 `refreshVNDB`） | 需认证 |
| DELETE | `/api/vn/{id}` | 删除 VN | 需认证 |
| PUT | `/api/vn/{id}/tier` | 更新单条 VN 的 Tier 归属与排序 | 需认证 |
| PUT | `/api/vn/tier/batch` | 批量更新 VN Tier（上限 200） | 需认证 |

### Tier

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/tier` | 获取 Tier 列表 | 公开 |
| POST | `/api/tier` | 创建 Tier | 需认证 |
| PUT | `/api/tier/order` | 更新 Tier 顺序 | 需认证 |
| PUT | `/api/tier/{id}` | 更新 Tier 名称/颜色 | 需认证 |
| DELETE | `/api/tier/{id}` | 删除 Tier（会先清空条目归属） | 需认证 |

### 其他接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/stats` | 获取统计数据 | 公开 |
| POST | `/api/index/start` | 启动批量索引 | 需认证 |
| GET | `/api/index/status` | 获取索引状态 | 需认证 |
| GET | `/api/config` | 获取配置（脱敏） | 需认证 |
| PUT | `/api/config` | 更新配置（`vndbApiToken` / `newPassword` / tags） | 需认证 |
| GET | `/api/export` | 导出数据（含 `entries`、`tierList`） | 需认证 |
| POST | `/api/import` | 导入数据（`merge` / `replace`） | 需认证 |

## 页面路由

静态资源由 Worker Assets 提供（`html_handling = "auto-trailing-slash"`）。

| 路径 | 说明 |
|------|------|
| `/` 或 `/index.html` | 首页 |
| `/login` | 登录页 |
| `/settings` | 设置页 |
| `/stats` | 统计页 |
| `/tier` | Tier List 页 |
| `/success` | 成功页 |

## 许可证

MIT License。详见 `LICENSE`
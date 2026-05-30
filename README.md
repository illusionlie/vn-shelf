<h1 align="center">VN Shelf</h1>

<p align="center">
  <img src="public/cover.webp" alt="VN Shelf cover image" height="300">
</p>

<p align="center">
  <a href="https://vn.illusionlie.com/"><img src="https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare" alt="Deploy to Cloudflare Workers" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/illusionlie/vn-shelf?style=flat-square" alt="License" /></a>
</p>

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
- 存储：Cloudflare D1
- 队列：Cloudflare Queues
- 前端：原生 HTML/CSS/JavaScript（无构建步骤）
- 测试：Node.js 内置测试运行器（`node --test`）
- 代码质量：ESLint

## GitHub Actions 部署指南

部署工作流位于 `.github/workflows/deploy.yml`，需要配置以下 Secrets：

- `WORKER_NAME`
- `CF_API_TOKEN`
- `CF_D1_DATABASE_ID`
- `CF_ACCOUNT_ID`（可选，不填则通过 API token 自动获取）
- `CUSTOM_DOMAIN`（可选）

### 获取 Cloudflare API Token

1. 登录 Cloudflare 控制台，进入“管理账户” -> “API 令牌”页面。
2. 点击“创建令牌”按钮，选择“编辑 Cloudflare Workers”使用模板。
3. 在权限部分点击“添加更多”，选择“Queues”，并选择“编辑”权限。
4. 点击“继续以显示摘要” -> “创建令牌”按钮，复制生成的 API Token。

### 获取 Cloudflare D1 Database ID

1. 登录 Cloudflare 控制台，进入"存储和数据库" -> "D1 SQL Database"页面。
2. 创建一个 D1 数据库（或使用现有），复制数据库 ID，即为 `CF_D1_DATABASE_ID`。

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
- `__D1_DATABASE_ID__`：D1 数据库 ID

模板中默认包含：

- D1 数据库绑定：`DB`
- Queue 绑定：`VN_INDEX_QUEUE`（队列名 `vn-index-queue`）
- Durable Object 绑定：`INDEX_START_LOCK`（类名 `IndexStartLockDurableObject`）
- 静态资源绑定：`ASSETS`（目录 `./public`）

### 3) Cloudflare 资源准备

确保已创建并绑定：

- 1 个 D1 数据库
- 1 个 Queue
- 1 个 Durable Object（`IndexStartLockDurableObject`）

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

## API 及技术详情

见 [AGENTS.md](./AGENTS.md)

## 许可证

MIT License。详见 [LICENSE](./LICENSE)
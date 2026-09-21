<h1 align="center">VN Shelf</h1>

<p align="center">
  <img src="public/cover.webp" alt="VN Shelf cover image" height="320">
</p>

<p align="center">
  <a href="https://deepwiki.com/illusionlie/vn-shelf"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
  <a href="https://vn.illusionlie.com/"><img src="https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare" alt="Deploy to Cloudflare Workers" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/illusionlie/vn-shelf?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  <img src="https://count.illusionlie.com/@github-vn-shelf?theme=moebooru&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto" alt="Counter">
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

- `WORKER_NAME`（必填）
- `CF_API_TOKEN`（必填）
- `CF_D1_DATABASE_ID`（可选，仅在需要绑定既有/非默认名 `vn-shelf-db` 的数据库时填写；不填则按名查找 `vn-shelf-db`，缺失自动创建）
- `CF_ACCOUNT_ID`（可选，不填则通过 API token 自动获取；token 挂了多个账号时建议显式填写）
- `CUSTOM_DOMAIN`（可选）

### 获取 Cloudflare API Token

1. 登录 Cloudflare 控制台，进入“管理账户” -> “API 令牌”页面。
2. 点击“创建令牌”按钮，选择“编辑 Cloudflare Workers”使用模板。
3. 在权限部分点击“添加更多”，依次添加“D1”与“Queues”，权限均选择“编辑”（工作流会用它们自动创建数据库与队列）。
4. 点击“继续以显示摘要” -> “创建令牌”按钮，复制生成的 API Token。

### D1 数据库与 Queue（自动创建）

部署工作流会在部署前自动预检并按需创建以下资源，**无需手工在控制台创建**：

- D1 数据库 `vn-shelf-db`：按名查找，存在则复用其 ID，缺失则自动创建。
- Queue `vn-index-queue`：存在则复用，缺失则自动创建。

预检步骤是幂等的，重复运行不会重复创建。如需绑定一个既有的 D1 数据库（例如名字不是 `vn-shelf-db`），在 Cloudflare 控制台“存储和数据库” -> “D1 SQL Database”页面复制其数据库 ID，填入 `CF_D1_DATABASE_ID`；此时工作流只校验该 ID 存在、不会创建新库，ID 无效则部署失败。

> 注意：若 `vn-shelf-db` 被删除且未设置 `CF_D1_DATABASE_ID`，下次部署会自动新建一个**空库**并在日志中给出 `::warning::` 提示，请留意数据是否符合预期。

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

模板已包含全部绑定（D1 / Queue / Durable Object / 静态资源）。Durable Object 由 Worker 代码直接导出，无需在控制台创建；D1 数据库与 Queue 仅在实际部署时需要，可由部署工作流自动创建（见上文「GitHub Actions 部署指南」）。本地 `npm run dev` 由 wrangler 本地模拟运行。

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

## 登录人机验证（Cloudflare Turnstile，可选）

为公开登录端点增加 Cloudflare Turnstile 人机校验，与内置 IP 限流（连续 5 次失败锁 10 分钟）组成纵深防御。**未配置时零行为变化**——登录页不加载任何第三方脚本。

### 开启步骤

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) → Turnstile → Add site：域名填站点实际域名（本地开发需额外加入 `localhost`），Widget Mode 按需选择（Managed 推荐）。
2. 拿到 Site Key 与 Secret Key。
3. 进入本站「设置 → 登录人机验证（Turnstile）」，填入两把密钥，先点「测试」验证可用（测试用**输入框当前值**直接调用 Cloudflare 校验服务，未保存也能测），绿灯后再「保存」。
4. **两把密钥都保存后才会启用**；只配一把 = 不生效（状态行会提示）。清空 Secret 保存 = 关闭该功能。

### 锁死恢复

若误配导致无法登录（如 Site Key 域名不符），直接改库清除两键即可恢复无验证登录：

```bash
# 本地
npx wrangler d1 execute vn-shelf-db --local --command "SELECT value FROM settings WHERE key='config:settings'"
# 把该 JSON 里 turnstileSiteKey/turnstileSecretKey 改为 "" 后 UPDATE 回去；线上用 --remote
```

### 本地测试用 dummy keys（无需账号，[官方 Testing 页](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)）

| 用途 | 值 |
|------|-----|
| Site Key 恒通过（可见） | `1x00000000000000000000AA` |
| Secret Key 恒通过 | `1x0000000000000000000000000000000AA` |
| Secret Key 恒失败 | `2x0000000000000000000000000000000AA` |

技术契约（双钥匙启用门 / 校验服务异常时登录 fail-open、测试端点 fail-closed / 限流计数不混入 Turnstile 拒绝）见 [AGENTS.md](./AGENTS.md) 与 `.trellis/spec/backend/conventions.md`。

## API 说明

所有接口均在 `/api/*` 前缀下，返回 JSON。列表/详情读取、统计与外观配置为公开接口；其余（全部写操作及部分管理用查询）需管理员登录（JWT + HttpOnly Cookie）。

| 分组 | 端点 | 说明 |
|------|------|------|
| 认证 | `GET /api/auth/status`、`GET /api/auth/verify`、`POST /api/auth/init`、`POST /api/auth/login`、`POST /api/auth/logout` | 管理员初始化、登录与登出 |
| VN 条目 | `GET` / `POST /api/vn`、`GET` / `PUT` / `DELETE /api/vn/{id}` | 条目增删改查；`PUT` 支持 `refreshVNDB` 从 VNDB 刷新 |
| Tier 归属 | `PUT /api/vn/{id}/tier`、`PUT /api/vn/tier/batch` | 单条 / 批量（上限 200）Tier 归属与排序 |
| Tier 列表 | `GET` / `POST /api/tier`、`PUT /api/tier/order`、`PUT` / `DELETE /api/tier/{id}` | Tier 增删改与排序 |
| 统计 | `GET /api/stats` | 概览、状态计数、评分直方图、完成时间线、Top 榜 |
| 索引与导入 | `POST /api/index/start`、`GET /api/index/status`、`POST /api/ulist/import` | 批量索引与 VNDB ulist 用户列表导入 |
| VNDB 搜索 | `GET /api/vndb/search` | 添加条目弹窗的候选搜索 |
| 配置 | `GET` / `PUT /api/config`、`GET /api/config/appearance`、`POST /api/config/turnstile/test` | Token / 密码 / tags / 外观；`appearance` 为公开只读；`turnstile/test` 用输入值预验 Turnstile 密钥对 |
| 备份 | `GET /api/export`、`POST /api/import` | 导出 / 导入库数据（含 Tier 列表，支持 `merge` / `replace`） |

请求参数、数据结构与内部实现等技术详情见 [AGENTS.md](./AGENTS.md)。

## 许可证

MIT License。详见 [LICENSE](./LICENSE)
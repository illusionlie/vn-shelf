# 本地开发

## 1) 安装依赖

```bash
npm ci
```

## 2) 配置 `wrangler.toml`

复制模板并生成实际配置文件：

```bash
# Windows (cmd)
copy wrangler.toml.example wrangler.toml

# macOS / Linux
cp wrangler.toml.example wrangler.toml
```

按需替换以下占位符：

- `__WORKER_NAME__`：你的 Worker 名称（建议填默认名 `vn-shelf`，与 GitHub Actions 部署的缺省值一致）
- `__D1_DATABASE_ID__`：D1 数据库 ID

模板中默认包含：

- D1 数据库绑定：`DB`
- Queue 绑定：`VN_INDEX_QUEUE`（队列名 `vn-index-queue`）
- Durable Object 绑定：`INDEX_START_LOCK`（类名 `IndexStartLockDurableObject`）
- 静态资源绑定：`ASSETS`（目录 `./public`）

## 3) Cloudflare 资源准备

模板已包含全部绑定（D1 / Queue / Durable Object / 静态资源）。Durable Object 由 Worker 代码直接导出，无需在控制台创建；D1 数据库与 Queue 仅在实际部署时需要，可由部署工作流自动创建（见[部署指南](deployment.md)）。本地 `npm run dev` 由 wrangler 本地模拟运行。

## 4) 启动本地开发

```bash
npm run dev
```

## 5) 常用命令

```bash
npm run lint      # ESLint 检查
npm run lint:fix  # 自动修复可修复问题
npm run test      # 运行测试
npm run tail      # 查看 Worker 实时日志
npm run deploy    # 部署到 Cloudflare Workers
```

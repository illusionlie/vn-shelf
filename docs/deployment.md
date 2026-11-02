# 部署指南

VN Shelf 通过 GitHub Actions 工作流部署（位于 `.github/workflows/deploy.yml`，手动触发）。工作流会在部署前自动预检并按需创建 D1 数据库与 Queue，**无需手工在控制台创建资源**。

只有一个必填 Secret（`CF_API_TOKEN`），其余均为可选覆盖。最简流程：[创建 API Token](#获取-cloudflare-api-token) -> [配置 Secrets](#配置-secrets) -> [触发部署](#触发部署)。

## Secrets 一览

| 名称 | 说明 | 必须 |
|------|------|------|
| `CF_API_TOKEN` | Cloudflare API Token，获取步骤见下文 | 是 |
| `WORKER_NAME` | Worker 名称；不填则使用默认名 `vn-shelf` | 否 |
| `CF_D1_DATABASE_ID` | 仅在需要绑定既有/非默认名 `vn-shelf-db` 的数据库时填写；不填则按名查找 `vn-shelf-db`，缺失自动创建 | 否 |
| `CF_ACCOUNT_ID` | 不填则通过 API Token 自动获取；token 挂了多个账号时建议显式填写 | 否 |
| `CUSTOM_DOMAIN` | 自定义域名，填写后追加为 Worker 的 `routes` 配置 | 否 |

## 获取 Cloudflare API Token

**方式一：一键预填（推荐）**

打开下面的链接，令牌名称与所需权限（Workers Scripts / D1 / Queues 编辑 + Account Settings 读取）已自动填好：

```text
https://dash.cloudflare.com/?to=/:account/api-tokens/create?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22queues%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=VN%20Shelf%20Deploy
```

确认表单中四条权限齐全后，点击“继续以显示摘要” -> “创建令牌”，复制生成的 API Token。

> 若打开后权限不足四条，说明个别权限 key 未被控制台识别（会被静默丢弃），请改用方式二手动创建。

**方式二：手动创建**

1. 登录 Cloudflare 控制台，进入[用户 API 令牌](https://dash.cloudflare.com/profile/api-tokens)或[账户 API 令牌](https://dash.cloudflare.com/?to=/:account/api-tokens/create)页面。
2. 点击“创建令牌”按钮，选择“编辑 Cloudflare Workers”使用模板。
3. 在权限部分点击“添加更多”，依次添加“D1”与“Queues”，权限均选择“编辑”（工作流会用它们自动创建数据库与队列）。
4. 点击“继续以显示摘要” -> “创建令牌”按钮，复制生成的 API Token。

> 预填链接基于 Cloudflare 的[令牌模板 URL 机制](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/)，只预填表单，创建动作仍需本人完成。

## D1 数据库与 Queue（自动创建）

部署工作流会在部署前自动预检并按需创建以下资源：

- D1 数据库 `vn-shelf-db`：按名查找，存在则复用其 ID，缺失则自动创建。
- Queue `vn-index-queue`：存在则复用，缺失则自动创建。

预检步骤是幂等的，重复运行不会重复创建。如需绑定一个既有的 D1 数据库（例如名字不是 `vn-shelf-db`），在 Cloudflare 控制台“存储和数据库” -> “D1 SQL Database”页面复制其数据库 ID，填入 `CF_D1_DATABASE_ID`；此时工作流只校验该 ID 存在、不会创建新库，ID 无效则部署失败。

> 注意：若 `vn-shelf-db` 被删除且未设置 `CF_D1_DATABASE_ID`，下次部署会自动新建一个**空库**并在日志中给出 `::warning::` 提示，请留意数据是否符合预期。

## 配置 Secrets

1. 登录 GitHub 仓库，进入“Settings” -> “Secrets and variables” -> “Actions”页面。
2. 点击“New repository secret”按钮，添加上述 Secrets。

## 触发部署

1. 登录 GitHub 仓库，进入“Actions”页面。
2. 点击“Deploy to Cloudflare”工作流，点击“Run workflow”按钮。

部署完成后访问 `https://<worker名>.<你的子域>.workers.dev`（默认 `vn-shelf`），按页面提示初始化管理员密码。

## 可选：登录人机验证（Cloudflare Turnstile）

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
# Design：deploy.yml 资源预检步骤

## 边界

- 改动面：`.github/workflows/deploy.yml`（新增 1 步、修改 2 步）、`README.md`（部署指南段）、`AGENTS.md`（一句说明）。
- 不改：`wrangler.toml.example`、`ci.yml`、`src/`、`public/`、`tests/`。

## 步骤流

```
Checkout → Validate Secrets(改) → Setup Node → npm ci → Fetch Account ID
        → Ensure Cloudflare resources(新, id: ensure_resources)
        → Generate wrangler.toml(改: 用 steps.ensure_resources.outputs.d1_id) → Deploy
```

## Validate Secrets（改）

- 保留 `WORKER_NAME`、`CF_API_TOKEN` 两项硬校验。
- 删除 `CF_D1_DATABASE_ID` 硬校验；改为一行提示：有值 → "will bind the provided D1 database"；无值 → "will resolve/create D1 by name"。

## Ensure Cloudflare resources（新）

```yaml
- name: Ensure Cloudflare resources (D1 + Queue)
  id: ensure_resources
  shell: bash
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ steps.fetch_account_id.outputs.account_id }}
    WRANGLER_HIDE_BANNER: "true"     # banner 走 stdout，保证 d1 list --json 是纯 JSON
    WRANGLER_SEND_METRICS: "false"   # 此时 wrangler.toml 尚未生成
    D1_NAME: vn-shelf-db          # 与 wrangler.toml.example 的 database_name 一致
    QUEUE_NAME: vn-index-queue    # 与 wrangler.toml.example 的 queue 一致
    PROVIDED_D1_ID: ${{ secrets.CF_D1_DATABASE_ID }}
  run: |
    set -euo pipefail

    d1_list() { npx wrangler d1 list --json; }
    d1_id_by_name() { d1_list | jq -r --arg n "$D1_NAME" '.[] | select(.name == $n) | .uuid' | head -n1; }

    # ---- D1 ----
    if [[ -n "$PROVIDED_D1_ID" ]]; then
      if d1_list | jq -e --arg id "$PROVIDED_D1_ID" '.[] | select(.uuid == $id)' >/dev/null; then
        echo "Using provided CF_D1_DATABASE_ID (verified to exist in account)."
        D1_ID="$PROVIDED_D1_ID"
      else
        echo "::error::CF_D1_DATABASE_ID is set but no D1 database with that id exists in this account. Fix or remove the secret."
        exit 1
      fi
    else
      D1_ID="$(d1_id_by_name)"
      if [[ -n "$D1_ID" ]]; then
        echo "D1 database '$D1_NAME' already exists, reusing."
      else
        echo "::warning::D1 database '$D1_NAME' not found — creating a NEW EMPTY database. If you expected existing data, stop and check the Cloudflare dashboard."
        npx wrangler d1 create "$D1_NAME"
        D1_ID="$(d1_id_by_name)"
        if [[ -z "$D1_ID" ]]; then
          echo "::error::D1 database '$D1_NAME' was created but its id could not be resolved."
          exit 1
        fi
      fi
    fi
    echo "::add-mask::$D1_ID"
    echo "d1_id=$D1_ID" >> "$GITHUB_OUTPUT"
    echo "Resolved D1 '$D1_NAME' -> ****${D1_ID: -4}"

    # ---- Queue ----
    if npx wrangler queues info "$QUEUE_NAME" >/dev/null 2>/tmp/queue-info.err; then
      echo "Queue '$QUEUE_NAME' already exists, reusing."
    else
      echo "Queue '$QUEUE_NAME' lookup failed (output below), attempting to create it..."
      cat /tmp/queue-info.err || true
      npx wrangler queues create "$QUEUE_NAME"
    fi
```

要点：

- **先查再建**：`d1 create` / `queues create` 对同名资源会报错，幂等靠查找而非靠 create 容错。
- **覆盖路径按 uuid 校验，不按名**：既有用户的库名可能不是 `vn-shelf-db`。
- **mask 在写 output 之前**：`::add-mask::` 后续所有日志（含下一步 sed 的 echo）都会被遮蔽。
- **Queue 查失败不吞错**：打印 `queues info` 的 stderr 再尝试 create；若是权限问题，create 同样失败并终止步骤，错误可见。
- `set -euo pipefail` 下 `d1_id_by_name` 为空字符串不会触发退出（`jq -r` 无匹配退出码为 0）；`jq -e` 仅用于覆盖路径的布尔判断。
- `head -n1` 防御同名多库（理论上 D1 名唯一，但保持脚本输出单值）。
- **stdout 纯净性**：wrangler 版本 banner 经 `console.log` 走 stdout（实测无 `--json` 时 84 bytes），`WRANGLER_HIDE_BANNER=true` 显式关掉，不依赖 `--json` 的隐式抑制（见 research 补充）。
- 覆盖路径日志标签用 `D1_LABEL` 区分「provided CF_D1_DATABASE_ID」与「'vn-shelf-db'」，避免绑定别名库时日志误导。

## Generate wrangler.toml（改）

- `__D1_DATABASE_ID__` 替换源由 `${{ secrets.CF_D1_DATABASE_ID }}` 改为 `${{ steps.ensure_resources.outputs.d1_id }}`。
- 其余（`WORKER_NAME`、`CUSTOM_DOMAIN` 追加 routes）不变。

## 文档改动

### README「GitHub Actions 部署指南」

- Secrets 列表：
  - `WORKER_NAME`、`CF_API_TOKEN`（必填）
  - `CF_D1_DATABASE_ID`（可选：仅当要绑定既有/非 `vn-shelf-db` 名字的数据库时填写；不填则按名 `vn-shelf-db` 查找，缺失自动创建）
  - `CF_ACCOUNT_ID`（可选）、`CUSTOM_DOMAIN`（可选）不变
- 「获取 Cloudflare API Token」第 3 步：Queues Edit 之外加 **D1 Edit**。
- 「获取 Cloudflare D1 Database ID」→ 改名「D1 数据库与 Queue（自动创建）」：说明首次部署自动创建 `vn-shelf-db` 与 `vn-index-queue`；如需绑定既有库再手工取 id 填 `CF_D1_DATABASE_ID`。
- 「创建 Queue」一节并入上节（保留"也可手工在控制台创建同名队列"一句）。
- 提示：若 D1 被删除，下次部署会新建空库并在日志给出 warning。

### AGENTS.md

- 「测试与 CI」下加一条：`deploy.yml` 在部署前按名预检/创建 D1 `vn-shelf-db` 与 Queue `vn-index-queue`，`CF_D1_DATABASE_ID` 为可选覆盖。

## 兼容性与回滚

- 兼容：既有配置了 `CF_D1_DATABASE_ID` 的仓库行为不变（多一次存在性校验）。
- 回滚：revert 单个 commit 即回到手工配置模式；无远端状态需要清理（已创建的资源可保留复用）。

## 取舍记录

- 不用 `wrangler d1 info <name> --json`：`list --json` 一次调用即可同时服务「按名查」与「按 id 校验」两条路径。
- 不用 `--x-provision`：隐藏 experimental，不含 Queue（见 research/wrangler-provisioning.md）。
- 不加 workflow_dispatch 开关：用户已选「缺失即创建 + warning」；若日后需要更保守策略，可加 `create_missing_resources` input 作为后续迭代。

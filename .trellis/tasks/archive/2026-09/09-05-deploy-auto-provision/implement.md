# Implement：执行清单

## 顺序

1. [ ] `.github/workflows/deploy.yml`
   - [ ] 「Validate Secrets」：移除 `CF_D1_DATABASE_ID` 硬校验，改为有/无值的提示行
   - [ ] 在「Fetch Account ID」之后新增「Ensure Cloudflare resources (D1 + Queue)」步骤（`id: ensure_resources`），脚本按 `design.md` 实现
   - [ ] 「Generate wrangler.toml from template」：`__D1_DATABASE_ID__` 替换源改为 `${{ steps.ensure_resources.outputs.d1_id }}`
2. [ ] `README.md`「GitHub Actions 部署指南」按 `design.md`「文档改动」重写相关小节
3. [ ] `AGENTS.md`「测试与 CI」补一条 deploy 预检说明

## 验证命令

```bash
# YAML 语法
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml', encoding='utf-8')); print('yaml ok')"
# 若本机有 actionlint 则一并跑
actionlint .github/workflows/deploy.yml || true

# 抽取内嵌 bash 做语法检查（把 ensure_resources 的 run 块另存为临时文件后）
bash -n /tmp/ensure_resources.sh

# 回归（不触及 src/public，确认无副作用）
npm run lint
npm run test
```

## 本地模拟（无需真实账号）

用 stub 的 `npx`/`wrangler` 函数覆盖 4 种路径，确认脚本分支与退出码：

1. 未提供 id + D1 存在 + Queue 存在 → 无 create，输出 d1_id
2. 未提供 id + D1 缺失 → 出现 `::warning::`，调用 `d1 create`，再次查询拿到 id
3. 提供有效 id → 不 create，d1_id 等于提供值
4. 提供无效 id → `::error::` 且退出码 1，不调用任何 create

## 评审门

- 实现完成后跑 `trellis-check` 子代理：对照 `prd.md` 验收项逐条核对，重点看幂等、mask 先于 output、Queue 失败不吞错、README/AGENTS 同步。

## 回滚点

- 单 commit 改动，`git revert` 即回到手工配置模式。

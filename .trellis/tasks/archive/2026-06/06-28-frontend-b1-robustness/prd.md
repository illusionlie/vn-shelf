# PRD — B1 前端健壮性与供应链修复

> 上下文：`docs/frontend-improvements.md` 批次 B1（决策已拍板：Alpine 自托管、纳入 Trellis）。
> 设计文档：`docs/frontend-improvements.md` 第二/三部分（本 PRD 不重复技术细节，只列要求与验收）。

## 背景

前端通过五个 HTML 各自引用 `cdn.jsdelivr.net/npm/alpinejs@3.x.x`（未锁版本、无 SRI），且 `api.js`/`app.js` 存在两处可立即修复的 bug。B1 作为整个前端改进计划的首批，目标是低风险地消除供应链依赖与已知小 bug，为后续批次打底。

## 目标（范围）

本任务含三个独立可验证交付物：

1. **自托管 Alpine**（对应 `docs` 中 T1-S1）
   - 锁定 Alpine 稳定版本（3.14.x 最新 patch），下载 `cdn.min.js` 到 `public/js/vendor/alpine.min.js`。
   - 五个 HTML（`index.html:10`、`login.html:9`、`settings.html:9`、`stats.html:9`、`tier.html:9`）改为引用本地 `/js/vendor/alpine.min.js`。
   - `package.json` 记录 Alpine 锁定版本，并新增可重复下载脚本（如 `fetch:vendor`），便于升级审计。

2. **修复 `apiRequest` headers 合并顺序 bug**（T1-B1）
   - `public/js/api.js:33-39` 中 `...options` 在末尾展开会整体覆盖合并好的 `config.headers`，导致调用方传任意 `headers` 时 `Content-Type` 丢失。
   - 修改为：先展开 `options`，再单独合并 `headers`，保证默认 `Content-Type: application/json` 始终生效（除非调用方显式覆盖）。

3. **修复 Toast id 同毫秒碰撞**（T1-B2）
   - `public/js/app.js:44` `const id = Date.now()` 改为模块级递增计数器（或 `crypto.randomUUID()`），确保并发 toast `id` 不重复，`removeToast` 不误删。

## 范围外（不属本批次）

- DOMPurify / Markdown 改造（B4）。
- appearance 缓存、搜索防抖、`withLoading` 抽象（B2）。
- a11y 与壳层抽离（B3）。
- 不改后端接口信封。

## 约束

- **无构建步骤**：直接修改 `public/` 与 `package.json`，部署走 Assets；vendor 文件需纳入版本控制。
- **保持行为不变**：除上述 bug 修复外，不改变任何现有功能与交互。
- **不引入运行时第三方 CDN**：Alpine 一律本地引用。
- 遵循 `AGENTS.md` 开发注意事项（静态资源优先、敏感信息管理等）。

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | `public/js/vendor/alpine.min.js` 存在且为锁定版本 | 文件存在 + `package.json` 记录版本号 |
| AC2 | 五个 HTML 不再引用任何 `cdn.jsdelivr.net` / 第三方 CDN | `grep -rn "cdn.jsdelivr" public/*.html` 无输出 |
| AC3 | 五个 HTML 改为引用 `/js/vendor/alpine.min.js` | `grep -n "vendor/alpine.min.js" public/*.html` |
| AC4 | `package.json` 存在可重复的 vendor 下载脚本 | `npm run` 列表新增脚本；脚本可手动校验哈希/版本 |
| AC5 | `apiRequest` 传自定义 `headers` 时仍携带 `Content-Type: application/json` | 新增针对 `apiRequest` 的小用例（或控制台手测断言 fetch 内容） |
| AC6 | 并发调用 `addToast` 两次生成的 `id` 不相等 | 代码审查 + 必要时小用例 |
| AC7 | `npm run lint` 通过 | 命令退出 0 |
| AC8 | `npm run test` 通过 | 命令退出 0 |
| AC9 | 本地 `npm run dev` 下 Alpine 功能正常（首页加载、组件 x-data 生效、登录/设置等交互可用） | 手动冒烟 |

## 风险与回滚

- **风险**：vendor 文件版本与原 CDN `3.x.x` 漂移导致 Alpine 行为差异 → 选 3.14.x 最新稳定 patch 并做冒烟。
- **回滚**：单提交粒度（vendor / headers / toast 三提交），任一回归可单独 revert。
- **降级**：如自托管在某环境出问题，可临时切回 CDN（不属本任务目标，仅作应急说明）。
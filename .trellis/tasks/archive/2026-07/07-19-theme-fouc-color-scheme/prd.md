# 主题初始化防白闪与跟随系统色彩偏好

## Goal

主题 class 目前由 JS 模块加载后才写入（`theme.js:70 initTheme`），暗色用户每次刷新先渲染亮色再翻转，产生白闪（FOUC）；且首次访问不读系统偏好，暗色系统用户默认拿到亮色。要求：暗色刷新无白闪；首访跟随 `prefers-color-scheme`；用户显式选择（localStorage）优先级最高。

## Requirements

1. 提前应用主题：在四个页面（index / tier / stats / settings / login）的 `<head>` 中加入一段极小的内联同步脚本，在首帧渲染前完成主题判定：
   - 读 `localStorage['theme']`：`'dark'` → 暗色；`'light'` → 亮色；
   - 无存储值时回退 `matchMedia('(prefers-color-scheme: dark)')`。
2. class 挂载点决策：head 阶段 `document.body` 尚不存在，脚本只能写 `document.documentElement`。两个可选方案（实现时二选一，保持全站一致）：
   - a) 主题 class 迁移到 `<html>`：CSS 中 `body.dark-mode` 选择器（`base.css:41`、`cards-detail.css:803/807/811`）改为根元素选择器，`theme.js` 的 toggle/读取（`toggleTheme`、`applyBackgroundOverlay:189`）同步改挂载点；
   - b) 保持 body class，脚本放在 `<body>` 开头第一个子节点。
   方案 a 更标准（消除对 body 解析时机的依赖），推荐；但改动面更大，需全量搜 `dark-mode` 引用点。
3. `initTheme` 与内联脚本逻辑保持单一事实：initTheme 不得再与内联判定打架（如内联判定暗色后 initTheme 又按旧逻辑移除）；显式选择后 `toggleTheme` 写 localStorage 的行为不变。
4. 四个页面均生效，包括 `login-page`。

## Acceptance Criteria

- [x] 暗色主题下刷新无白闪：主题 class 由 head 同步内联脚本在任何渲染前写入 `<html>`（脚本位于 CSS link 之前，无异步窗口期）；真机肉眼复核待人工确认。
- [x] 清空 localStorage 后跟随系统偏好：无存储值时回退 `matchMedia('(prefers-color-scheme: dark)')`。
- [x] 手动切换后刷新保持手动选择：`localStorage['theme']` 判定优先于系统偏好（'light' 显式值不触发暗色回退）。
- [x] 主题切换按钮、背景遮罩、自定义背景正常：theme.js 全部 5 处 `document.body.classList` 读写迁移至 `documentElement`，grep 确认无残留 `body.dark-mode` 引用；toggle 行为与持久化逻辑不变。
- [x] `npm run lint` 通过；`npm run test` 通过（159 tests，无回归）。

### 实现记录

- 采用方案 a（class 挂 `<html>`）：CSS 4 处选择器迁移（`base.css` 变量块 + `cards-detail.css` 三处 md-*），`initTheme` 简化为仅同步按钮图标/aria（class 写入职责移交内联脚本，单一事实）。
- CSP 核验：`src/` 与 wrangler 配置无 Content-Security-Policy 头，inline script 无阻碍。
- 加分项已做：`:root { color-scheme: light }` / `html.dark-mode { color-scheme: dark }`，UA 原生控件与滚动条跟随主题。
- 五个页面（含 login）均注入同一段脚本；新页面需复制该脚本（已入 spec）。

## Notes

- 需确认 Worker 响应头没有禁止 inline script 的 CSP（搜 `src/` 中 Content-Security-Policy）；若有，改为放行该脚本 hash 或改用阻塞式外部小脚本。
- 可选加分项：`<meta name="color-scheme" content="light dark">` 让 UA 默认控件/滚动条跟随主题，实现时顺手评估。

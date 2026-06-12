# Claude.md

本文件为 Claude 提供项目上下文指导。

## 项目概述

VN Shelf - 视觉小说书架管理应用，部署于 Cloudflare Workers。项目无构建步骤，直接部署 ES Modules 与 `public/` 静态资源。

## 常用命令

- `npm run dev` - 本地开发服务器（`wrangler dev`）
- `npm run lint` - ESLint 检查（`src/**/*.js` + `public/js/**/*.js`）
- `npm run lint:fix` - 自动修复 lint 问题
- `npm run test` - 运行 Node 内置测试（`node --test`）
- `npm run deploy` - 部署到 Cloudflare Workers

## 项目架构

```text
src/
├── index.js        # Worker 入口（fetch + queue）+ IndexStartLockDurableObject
├── index-task.js   # 索引任务逻辑（启动、状态查询）
├── router.js       # API 路由分发与处理
├── db.js           # D1 Schema 定义与初始化
├── repository.js   # D1 数据访问层
├── auth.js         # JWT + 密码哈希认证
├── vndb.js         # VNDB API 客户端
└── utils.js        # 通用工具函数

public/js/
├── app.js            # Alpine.js 入口：全局 Store + 组件注册
├── api.js            # API 封装
├── utils.js          # 工具函数（formatUserPlayTime, scroll lock, toggleMobileMenu, progress bar）
├── theme.js          # 主题切换 + 自定义背景
├── markdown.js       # Markdown 渲染
├── translations.js   # Tags 翻译与缓存
└── components/
    ├── shared.js       # 跨页面共享 mixin（tags 视图 + 详情弹窗）
    ├── vnShelf.js      # 主页书架组件
    ├── tierlistPage.js # Tier List 页组件
    ├── settingsPage.js # 设置页组件
    ├── loginPage.js    # 登录页组件
    └── statsPage.js    # 统计页组件

tests/
├── d1/
│   └── repository.test.mjs
├── public/
│   └── markdown.security.test.mjs
├── queue/
│   └── index.queue.test.mjs
└── router/
    ├── index.start.test.mjs
    └── config.update.test.mjs
```

## 前端模块关系

- `app.js` 是唯一入口，负责注册 Alpine.js 全局 Store 和所有页面组件
- `components/` 下每个文件导出一个 Alpine component factory function
- `utils.js` 提供跨组件共享的工具函数（scroll lock、格式化等）
- `theme.js` 管理主题切换和自定义背景状态
- 组件通过 `../api.js`、`../utils.js`、`../theme.js` 等相对路径导入依赖

## 开发注意事项

1. **无构建步骤**：直接修改 `src/` 与 `public/` 文件即可，浏览器原生 ES Modules。
2. **前端组件拆分**：每个页面组件独立一个文件，通过 `app.js` 统一注册到 Alpine.js。
3. **游玩时长字段**：后端仅接受 `playTimeHours` + `playTimePartMinutes`。
4. **Tier 一致性**：删除 Tier 时先清理条目归属，再落库 Tier 列表。
5. **敏感信息**：VNDB Token、密码哈希、JWT Secret 存储于 D1 settings 表，不暴露给前端。
6. **ESLint**：修改前端 JS 后务必运行 `npm run lint` 确认无错误。

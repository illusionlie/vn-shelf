# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目概述

VN Shelf - 视觉小说书架管理应用，部署于 Cloudflare Workers，无构建步骤，直接部署 ES 模块。

## Build/Deploy Commands

- `npm run dev` - 本地开发服务器 (wrangler dev)
- `npm run deploy` - 部署到 Cloudflare Workers
- `npm run tail` - 实时查看 Worker 日志

## 项目架构

```
src/
├── index.js      # Worker 入口（fetch + queue 处理 + Assets 代理）
├── router.js     # 路由分发与 API 处理
├── kv.js         # KV 存储操作
├── auth.js       # JWT 认证系统
├── vndb.js       # VNDB API 客户端
├── utils.js      # 工具函数
└── templates.js  # [已废弃] 保留仅供参考

public/           # 静态资源（Worker Assets）
├── index.html    # 主页
├── login.html    # 登录页
├── settings.html # 设置页
├── stats.html    # 统计页
├── css/
│   └── style.css # 样式文件
└── js/
    ├── api.js            # API 封装
    ├── app.js            # Alpine.js 组件
    ├── markdown.js       # Markdown 渲染
    └── translations.js   # Tags 翻译模块
```

## API 路由

### 认证接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/auth/status` | 获取认证状态 | 公开 |
| POST | `/api/auth/init` | 初始化管理员密码 | 仅未初始化 |
| POST | `/api/auth/login` | 登录 | 公开 |
| POST | `/api/auth/logout` | 登出 | 公开 |
| GET | `/api/auth/verify` | 验证 Token | 公开 |

### VN 接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/vn` | 获取 VN 列表（支持 `sort`, `search` 参数） | 公开 |
| GET | `/api/vn/{id}` | 获取单个 VN（ID 格式: `v17`） | 公开 |
| POST | `/api/vn` | 创建 VN 条目 | 需认证 |
| PUT | `/api/vn/{id}` | 更新 VN（支持 `refreshVNDB` 刷新数据） | 需认证 |
| DELETE | `/api/vn/{id}` | 删除 VN | 需认证 |

### 统计接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/stats` | 获取统计数据 | 公开 |

### 索引接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/index/start` | 启动批量索引 | 需认证 |
| GET | `/api/index/status` | 获取索引状态 | 需认证 |

### 配置接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/config` | 获取配置（不返回敏感信息） | 需认证 |
| PUT | `/api/config` | 更新配置（支持 `vndbApiToken`, `newPassword`） | 需认证 |

### 导入导出接口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/export` | 导出所有数据 | 需认证 |
| POST | `/api/import` | 导入数据（支持 `merge`/`replace` 模式） | 需认证 |

### 页面路由
| 路径 | 说明 |
|------|------|
| `/` 或 `/index.html` | 主页 |
| `/login` | 登录页 |
| `/settings` | 设置页 |
| `/stats` | 统计页 |
| `/css/style.css` | CSS 样式文件 |
| `/js/*.js` | JavaScript 模块 |

> 页面和静态资源由 Worker Assets 提供，配置 `html_handling = "auto-trailing-slash"`

## KV 键命名约定

| 键 | 说明 | 数据结构 |
|----|------|----------|
| `config:settings` | 全局配置 | `{vndbApiToken, jwtSecret, adminPasswordHash, lastIndexTime}` |
| `vn:list` | VN 列表聚合数据 | `{items: [...], stats: {...}}` |
| `vn:{id}` | 单个 VN 条目 | `{id, createdAt, vndb: {...}, user: {...}}` |
| `index:status` | 批量索引状态 | `{status, total, processed, failed, startedAt, completedAt}` |

## Queue 处理机制

- 批量索引通过 Cloudflare Queue 异步处理
- Queue 绑定: `VN_INDEX_QUEUE`
- 重试策略：最多 3 次，每次延迟 60 秒
- 完成后自动调用 [`rebuildVNList()`](src/kv.js:93) 重建聚合数据

## 认证系统

- JWT 使用 Web Crypto API 实现 HMAC-SHA256 签名
- Token 存储在 httpOnly Cookie 中，有效期 24 小时
- 密码使用 PBKDF2 + SHA-256 哈希存储
- 首次访问 `/api/auth/init` 初始化管理员密码

## 前端资源

- 静态资源存放在 `public/` 目录，由 Worker Assets 提供
- 前端使用 Alpine.js，无需构建
- JS 模块使用 ES Module 方式加载，通过 `Alpine.data()` 注册组件
- 脚本加载顺序：先加载 `app.js`（模块），再加载 Alpine.js（defer）
- `src/templates.js` 已废弃，保留仅供参考

## VNDB API 集成

- API 端点: `https://api.vndb.org/kana`
- 需要 API Token 认证（存储在 `config:settings/vndbApiToken`）
- ID 格式: `v{数字}` (如 `v17`)
- 客户端类: [`VNDBClient`](src/vndb.js:13)
- 主要方法: `getVN(id)`, `getVNBatch(ids)`, `searchVN(query)`

## VN 条目数据结构

### 完整条目结构 (存储在 `vn:{id}`)

```javascript
{
  id: "v17",                              // VNDB ID
  createdAt: "2024-01-01T00:00:00.000Z", // 创建时间
  updatedAt: "2024-01-02T00:00:00.000Z", // 更新时间
  vndb: {                                 // VNDB 数据（处理后）
    title: "CLANNAD",                     // 英文标题（VNDB主标题）
    titleJa: "CLANNAD",                   // 日文标题，没有则使用英文
    titleCn: "CLANNAD",                   // 中文标题（优先官方，其次汉化组）
    image: "https://...",                 // 封面图片 URL
    imageNsfw: false,                     // 是否为 NSFW 图片
    rating: 8.5,                          // VNDB 评分 (0-10)
    length: "60小时",                     // 游玩时长文本
    lengthMinutes: 3600,                  // 游玩时长（分钟）
    developers: ["Key"],                  // 开发商列表
    tags: ["泣系", "恋爱"],               // 标签列表（最多10个，按��分排序）
    allAge: false                         // 全年龄标记（基于 g235 标签）
  },
  user: {                                 // 用户数据
    titleCn: "自定义中文名",              // 自定义中文标题
    personalRating: 9.0,                  // 个人评分 (0-10)
    playTime: "60小时",                   // 游玩时长文本
    playTimeMinutes: 3600,                // 游玩时长（分钟）
    review: "评价内容",                   // 评价内容（Markdown 格式）
    startDate: "2024-01-01",              // 开始日期
    finishDate: "2024-02-01",             // 完成日期
    tags: ["自定义标签"]                  // 用户自定义标签
  }
}
```

### 列表项结构 (存储在 `vn:list.items[]`)

```javascript
{
  id: "v17",                              // VNDB ID
  title: "CLANNAD",                       // 英文标题
  titleJa: "CLANNAD",                     // 日文标题
  titleCn: "CLANNAD",                     // 中文标题（优先用户设置）
  image: "https://...",                   // 封面图片 URL
  rating: 8.5,                            // VNDB 评分 (0-10)
  personalRating: 9.0,                    // 个人评分 (0-10)
  developers: ["Key"],                    // 开发商列表
  allAge: false,                          // 全年龄标记
  createdAt: "2024-01-01T00:00:00.000Z"  // 创建时间
}
```

## 工具函数 (src/utils.js)

- [`parsePlayTime(text)`](src/utils.js:48) - 解析游玩时长文本为分钟数
- [`renderMarkdown(text)`](src/utils.js:209) - 渲染 Markdown 为 HTML
- [`isValidVNDBId(id)`](src/utils.js) - 验证 VNDB ID 格式
- [`jsonResponse(data)`](src/utils.js:128) / [`errorResponse(msg, status)`](src/utils.js) - 统一响应格式

## Tags 翻译模块 (public/js/translations.js)

前端翻译模块，负责 VNDB tags 的中文翻译功能。

### 核心功能

- **翻译数据加载**: 从远程 JSON 文件加载 tags 翻译数据
- **本地缓存**: 使用 IndexedDB 缓存翻译数据，减少网络请求
- **版本检查**: 通过 version.json 轻量级检查更新
- **后台更新**: 缓存优先策略，后台自动检查并更新翻译

### 缓存策略

```
缓存优先 + 后台更新：
1. 无缓存 → 直接下载完整数据
2. 有缓存 → 立即返回缓存，后台检查版本并更新
3. 版本更新 → 自动下载并更新缓存，触发 translations-updated 事件
```

### IndexedDB 存储

- 数据库名: `vn-shelf-translations`
- 存储对象: `translations`
- 键名: `tagTranslations`
- 缓存结构:
  ```javascript
  {
    version: "1.0.0",
    updatedAt: "2024-01-01T00:00:00.000Z",
    sourceUrl: "https://...",
    translations: { "original_tag": "中文翻译", ... }
  }
  ```

### 事件

- `translations-updated`: 后台更新完成时触发，包含 `detail.version`

## 开发注意事项

1. **无构建步骤**: 直接修改 `src/` 下的 JS 文件即可
2. **CSS 修改**: 修改 `public/css/style.css` 文件
3. **本地开发**: 使用 `wrangler dev`，需要配置本地 KV 命名空间
4. **环境变量**: 在 `wrangler.toml` 的 `[vars]` 中配置
5. **敏感配置**: API Token 等存储在 KV 中，通过 `/api/config` 接口管理
6. **翻译数据**: 翻译数据缓存在浏览器 IndexedDB 中，可通过设置页刷新

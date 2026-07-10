# WordPicker 技术栈总览

WordPicker 是一款浏览器扩展，支持按住 Ctrl 悬停查词、一键收录到 WordBase 单词本。本文档完整列出项目所用的技术栈。

---

## 1. 基本信息

| 类别 | 技术 | 版本 |
|------|------|------|
| **扩展规范** | Manifest V3 | - |
| **支持浏览器** | Chrome / Safari | - |
| **语言** | TypeScript | ^6.0.3 |
| **模块系统** | ES Modules | - |
| **包管理** | npm | - |
| **应用 ID** | WordPicker | - |

---

## 2. 核心架构

### 2.1 扩展组件

| 组件 | 文件路径 | 说明 |
|------|---------|------|
| **Content Script** | `content/content-script.ts` | 页面注入脚本，悬停查词、卡片展示 |
| **Popup** | `popup/popup.ts` + `popup.html` + `popup.css` | 工具栏弹出面板 |
| **Options Page** | `options/options.ts` + `options.html` | 设置页面（独立标签页打开） |
| **Service Worker** | `service/service-worker.ts` | Chrome 后台服务 |
| **Safari Background** | `service/safari-background.ts` | Safari 后台页面 |

### 2.2 核心库（`lib/`）

| 库 | 文件 | 用途 |
|----|------|------|
| **Supabase** | `lib/supabase.ts` | Supabase 客户端封装，数据同步 |
| **离线词典** | `lib/offlineDict.ts` | 本地 ECDict 英汉词典查询 |
| **翻译** | `lib/translator.ts` | 多源翻译（有道 / MyMemory / Free Dictionary API） |
| **存储** | `lib/storage.ts` | 浏览器存储（chrome.storage / browser.storage）封装 |
| **缓存** | `lib/cache.ts` | 查询结果缓存管理 |
| **消息通信** | `lib/messaging.ts` | 扩展各部分之间的消息传递 |
| **日志** | `lib/logger.ts` | 统一日志输出 |
| **工具函数** | `lib/utils.ts` | 通用工具函数 |
| **常量** | `lib/constants.ts` | 常量定义 |

### 2.3 内容脚本（`content/`）

| 文件 | 用途 |
|------|------|
| `content-script.ts` | 主逻辑：悬停检测、查词、卡片渲染、收录交互 |
| `shared.ts` | 内容脚本共享工具 |
| `fireworks.ts` | 烟花特效（收录单词成功动画） |
| `globals.d.ts` | 全局类型声明 |

---

## 3. 数据 & 存储

| 类别 | 技术 | 说明 |
|------|------|------|
| **后端 BaaS** | Supabase | 与 WordBase 共用数据库 |
| **Supabase SDK** | `@supabase/supabase-js` | ^2.110.2 |
| **本地存储** | `chrome.storage` / `browser.storage` | 扩展 API 存储 |
| **离线词典** | ECDict | 英汉词典本地数据 |
| **词典数据格式** | JSON（`ecdict.min.json`）+ CSV 源 | - |
| **词典数据位置** | `assets/dict/ecdict.min.json` | - |

---

## 4. 浏览器兼容

| 类别 | 技术 | 版本 |
|------|------|------|
| **WebExtension Polyfill** | `webextension-polyfill` | ^0.12.0 |
| **类型定义** | `@types/webextension-polyfill` | ^0.12.5 |
| **Chrome** | Manifest V3 | service_worker 后台 |
| **Safari** | Manifest V3 | background page 后台 |

---

## 5. 构建系统

### 5.1 构建脚本

| 脚本 | 命令 | 功能 |
|------|------|------|
| **编译 TS** | `npm run build:ts` | TypeScript 编译（两个 tsconfig） |
| **构建 Chrome** | `npm run build:chrome` | 构建 Chrome 版本 |
| **构建 Safari** | `npm run build:safari` | 构建 Safari 版本 |
| **构建全部** | `npm run build` | 构建所有浏览器版本 |
| **构建词典** | `npm run build:dict` | 从 CSV 构建离线词典 JSON |
| **生成图标** | `npm run generate:icons` | 从 SVG 生成各尺寸图标 |
| **打包 Chrome** | `npm run pack:chrome` | 打包 Chrome zip |
| **打包 Safari** | `npm run pack:safari` | 打包 Safari |
| **打包全部** | `npm run pack` | 打包所有浏览器 |
| **完整发布** | `npm run release` | 构建词典 + 打包全部 |

### 5.2 构建工具脚本（`scripts/`）

| 脚本 | 用途 |
|------|------|
| `build-cross-browser.ts` | 跨浏览器构建（Chrome / Safari），处理 manifest 差异 |
| `build-dict.ts` | 从 ECDict CSV 数据构建精简版 JSON 词典 |
| `copy-static.ts` | 静态资源拷贝 |
| `generate-icons.ts` | 从 SVG 生成各尺寸 PNG 图标 |
| `pack.ts` | 打包为 zip 等发布格式 |

### 5.3 TypeScript 配置

| 配置文件 | 用途 |
|---------|------|
| `tsconfig.json` | 基础配置 |
| `tsconfig.extension.json` | 扩展代码编译配置（content / popup / options / service / lib） |
| `tsconfig.scripts.json` | 构建脚本编译配置（scripts/ 目录） |

### 5.4 Manifest 配置

| 文件 | 用途 |
|------|------|
| `manifest.base.json` | 基础 manifest（共用部分） |
| `manifest.chrome.json` | Chrome 专用配置覆盖 |
| `manifest.safari.json` | Safari 专用配置覆盖 |

---

## 6. 扩展权限

| 权限类型 | 权限 | 用途 |
|---------|------|------|
| **API 权限** | `storage` | 本地存储 |
| **API 权限** | `alarms` | 定时任务 |
| **Host 权限** | `dictionaryapi.dev` | Free Dictionary API |
| **Host 权限** | `mymemory.translated.net` | MyMemory 翻译 |
| **Host 权限** | `dict.youdao.com` | 有道词典 |
| **Host 权限** | `localhost:3001` | 本地开发 API |
| **Host 权限** | `<all_urls>` | 所有页面注入 content script |

---

## 7. 代码质量

| 类别 | 技术 | 版本 |
|------|------|------|
| **Lint** | ESLint | ^9.13.0 |
| **TS Lint** | `typescript-eslint` | ^8.62.0 |
| **ESLint 配置格式** | Flat Config | `eslint.config.js` |
| **测试框架** | Vitest | ^2.1.3 |
| **测试配置** | `vitest.config.ts` + `tests/setup.ts` | - |
| **测试文件** | `tests/utils.test.ts` | 工具函数测试 |
| **Node 类型** | `@types/node` | ^26.0.1 |
| **Sharp 类型** | `@types/sharp` | ^0.31.1 |

### ESLint 规则亮点

- 未使用变量：warn（`_` 前缀参数忽略）
- `any` 类型：warn（渐进式收紧）
- `console`：关闭（允许 console 输出）
- `prefer-const`：warn
- `eqeqeq`：warn（smart 模式）

---

## 8. CI/CD（GitHub Actions）

| Workflow | 触发条件 | 功能 |
|----------|---------|------|
| `ci.yml` | push 到 main/dev、PR | Lint + Test + Build |
| `release.yml` | tag | 构建发布（含 Dev Snapshot 预览版） |

**CI 环境：**
- Node.js 20
- Ubuntu latest
- npm cache

---

## 9. 开发工具

| 类别 | 技术 | 版本 |
|------|------|------|
| **图像处理** | sharp | ^0.35.3 |
| **编辑器配置** | `.editorconfig` | - |

---

## 10. 与 WordBase 的关系

| 维度 | 说明 |
|------|------|
| **产品定位** | WordPicker = 采集端，WordBase = 学习端 |
| **数据共享** | 共用 Supabase 数据库（单词本、单词表等） |
| **用户体系** | 共用 Supabase Auth 用户系统 |
| **设计语言** | 统一 logo（靛蓝琥珀配色 + 双书叠放） |
| **代码仓库** | 两个独立仓库（word-picker / word-base） |

---

## 11. 技术栈全景图

```
┌───────────────────────────────────────────────────────────────────┐
│                      浏览器扩展 UI 层                               │
│  Content Script（DOM 注入） + Popup + Options Page                │
│  原生 HTML/CSS + TypeScript                                        │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                        业务逻辑层                                   │
│  lib/ 目录：Supabase / 离线词典 / 翻译 / 存储 / 缓存 / 消息        │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                        数据 & 存储层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ chrome.storage │  │ ECDict 离线词典 │  │  Supabase 云端  │            │
│  │  (本地 KV)      │  │  (JSON 本地)     │  │  (PostgreSQL)    │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                        浏览器扩展平台                               │
│  Chrome（MV3 + Service Worker） / Safari（MV3 + Background Page）  │
│  WebExtension Polyfill 跨浏览器兼容                                 │
└───────────────────────────────────────────────────────────────────┘
```

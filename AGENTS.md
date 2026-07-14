# AGENTS.md — WordPicker 浏览器扩展项目指令

本文档供 AI coding agents（Trae / Claude Code / Cursor / Codex / Copilot 等）在本项目工作时自动读取。
请严格遵循以下约定。

---

## 项目概览

WordPicker 是一款跨浏览器（Chrome/Edge/Safari）的英语查词扩展：按住修饰键悬停单词即可弹窗查词，一键收录到 WordBase 云端单词本，支持 SRS 复习、AI 释义、烟花特效。

- **语言**：TypeScript（Manifest V3，原生 WebExtensions API，通过 `webextension-polyfill` 统一跨浏览器）
- **构建**：`tsc` 编译 TS → 自定义 `build-cross-browser.ts` 脚本拷贝 + 注入环境变量 + 合并 manifest → `pack.ts` 打 zip
- **测试**：Vitest（unit/integration） + Playwright（e2e）
- **包管理器**：npm（不要用 pnpm/yarn）
- **配套后端**：WordBase（部署在 `https://word-base.pages.dev`，API 根域为 `https://word-base.pages.dev`，前端为 `/app`）

### 项目结构

```
word-picker/
├── assets/                  # 图标、Logo、离线词典 JSON
│   ├── icons/               # 扩展图标（16/32/48/128）
│   └── dict/                # 构建后离线词典
├── content/                 # Content Script（注入页面）
│   ├── content-script.ts    # 查词主逻辑（悬停检测、弹窗、键盘监听）
│   ├── fireworks.ts         # 加词烟花/粒子特效
│   ├── shared.ts            # 共享 API（escapeHtml、sendMessage、logger）
│   └── globals.d.ts         # 全局类型声明
├── lib/                     # 共享业务逻辑（被 content/options/popup/service 共用）
│   ├── constants.ts         # 常量、平台检测（detectPlatform）、类型 LookupKey/Platform
│   ├── storage.ts           # chrome.storage.local 封装（words/books/cache/settings）
│   ├── supabase.ts          # Supabase Auth（signIn/signUp/refresh/signOut）
│   ├── translator.ts        # 翻译（MyMemory + 有道词典 fallback）
│   ├── offlineDict.ts       # 离线 ECDICT 词典查询
│   ├── cache.ts             # LRU 查询缓存
│   ├── logger.ts            # 分级日志（debug/info/warn/error）
│   ├── messaging.ts         # 消息类型常量
│   └── utils.ts             # 工具函数
├── options/                 # 扩展设置页（options_ui）
│   ├── options.html
│   └── options.ts           # 设置加载/保存、账号登录注册、同步触发
├── popup/                   # 工具栏弹窗（action.default_popup）
│   ├── popup.html
│   ├── popup.ts             # 单词列表、搜索、导出、单词本切换、手动同步
│   └── popup.css
├── service/                 # Service Worker（后台）
│   ├── service-worker.ts    # 消息路由、同步队列、认证、定时 alarm
│   └── safari-background.ts # Safari 专用适配
├── scripts/                 # 构建/打包脚本（TS 编译后在 dist/scripts/ 运行）
│   ├── build-cross-browser.ts  # 跨浏览器构建 + 环境变量注入 + manifest 合并
│   ├── build-dict.ts           # 生成精简离线词典
│   ├── copy-static.ts          # 拷贝 HTML/CSS/静态资源
│   ├── generate-icons.ts       # 生成多尺寸图标
│   └── pack.ts                 # 打 Chrome/Safari 上架 zip
├── tests/                   # 测试
│   ├── unit/                # Vitest 单测
│   ├── integration/         # Service Worker 集成测试
│   ├── e2e/                 # Playwright E2E（需先 build:chrome）
│   └── setup.ts             # Vitest 配置 / browser.storage mock
├── manifest.base.json       # 基础 manifest（共享配置）
├── manifest.chrome.json     # Chrome/Edge 覆盖
├── manifest.safari.json     # Safari 覆盖
├── tsconfig.json            # 根 tsconfig（含 node 类型，用于 scripts）
├── tsconfig.extension.json  # 扩展代码 tsconfig（webextension-polyfill 类型）
├── tsconfig.scripts.json    # 构建脚本 tsconfig
├── .env.example             # 环境变量模板（入库）
├── .env.local               # 本地环境变量（gitignore，不入库）
└── TRACKING.md              # 跨会话待办清单（审计/新会话先读此文件）
```

### 平台区分

- **Chrome/Edge**：共用 `manifest.chrome.json`，产物 `dist/chrome/`，打包 `wordpicker-chrome.zip`
- **Safari**：使用 `manifest.safari.json` + `safari-background.ts`，产物 `dist/safari/`，打包 `wordpicker-safari.zip`
- Content Script 在运行时通过 `navigator.platform` 检测 Mac/Windows（`detectPlatform()` in `lib/constants.ts`）

---

## 常用命令

所有命令在项目根目录执行。

### 本地开发

```bash
npm install                  # 安装依赖
npm run build:chrome         # 编译 TS + 构建 Chrome 产物到 dist/chrome/
# 在 chrome://extensions 打开开发者模式，"加载已解压的扩展"选 dist/chrome/
# 修改代码后重新 build:chrome，在扩展页点刷新按钮
npm run build:safari         # 构建 Safari 产物到 dist/safari/
```

### 验证（提交前必须通过）

```bash
npm run lint                 # ESLint 检查
npm run build:ts             # tsc 类型检查 + 编译
npm test                     # Vitest 单测 + 集成测试
npm run build:chrome         # 构建 Chrome（验证无编译/拷贝错误）
# 如需 E2E（可选，较慢）：
# npm run test:e2e
```

### 打包发布

```bash
npm run build:dict           # 构建离线词典（首次或更新词典时）
npm run build                # 构建 Chrome + Safari 双端
npm run pack                 # 打出上架用 zip 到 dist/wordpicker-{chrome,safari}.zip
```

---

## 环境变量

- `.env`、`.env.local` 被 `.gitignore`，只有 `.env.example` 入库
- 构建脚本 `scripts/build-cross-browser.ts` 在拷贝文件时通过 `replaceEnvVars()` 注入
- 可用变量：

| 变量 | 用途 | 默认值（生产） |
|------|------|---------------|
| `SUPABASE_URL` | Supabase 实例 URL | `https://zzmolktkgorerpaoglpr.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase 匿名公钥 | 见 `.env.example` |
| `SYNC_BASE_URL` | WordBase API 根 URL（**不要加 /app**） | `https://word-base.pages.dev` |
| `WORD_BASE_APP_URL` | WordBase 前端 URL（Logo 跳转/登录页） | `https://word-base.pages.dev/app` |
| `RELEASE_VERSION` | CI 注入的版本号（x.y.z 或 x.y.z.w） | manifest 默认值 |

- **关键**：API base URL 是 `https://word-base.pages.dev`（路径 `/api/v1/...`），前端跳转才是 `https://word-base.pages.dev/app`，两个不能混用
- `SUPABASE_SERVICE_ROLE_KEY` 等后端 secret **不能**出现在扩展代码中，扩展只用 anon key
- 本地开发把真实值写到 `.env.local`（已在 .gitignore 中）

---

## 代码规范

### Commit Message 格式

遵循 Conventional Commits：

```
<type>(<scope>): <一句话总结>

[可选 body：列出关键改动点]
```

**type**：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `perf` / `style`
**scope**：`content` / `options` / `popup` / `service` / `lib` / `scripts` / `ci` / `build`

示例：
```
fix(content): strictly match selected lookup key, remove Control/Meta bridge
feat(options): persist per-platform lookup key settings
fix(sync): correct API base URL to avoid HTML response
```

### 通用约定

- 不要加注释（除非用户要求）
- 优先编辑已有文件，不新建文件（除非绝对必要）
- 不主动创建 .md 文档，用户明确要求时才创建
- Content Script 运行在页面隔离世界，不能访问页面 JS 变量；通过 `window.__WordPickerShared` / `window.__WordPickerFireworks` 桥接同扩展内脚本
- Service Worker 中不要访问 `window`/`document`/`import.meta`，用 `self` 或纯 Node 风格 API
- 快捷键配置按平台独立存储：`settings.lookupKeys = { mac: LookupKey, win: LookupKey }`，默认都是 `"Control"`
- 平台检测统一用 `lib/constants.ts` 的 `detectPlatform()`，不要自己写 `navigator.platform` 判断
- 快捷键触发必须**严格匹配**用户选择的键：选 Control 就只响应 Control，选 Command 就只响应 Meta，不能做"Control 或 Meta" 的桥接
- Manifest V3 service worker 是模块 type（`"type": "module"`），import 路径必须带 `.js` 后缀
- API 请求 URL 通过 `normalizeBaseUrl(settings)` 处理，不要手动拼接 `/app/api/...`
- 同步推送单词前必须先从服务端拉取已有单词，保留其 `level`/`familiarity` SRS 字段，避免覆盖学习数据
- 数据迁移逻辑放在 `lib/storage.ts` 的 `ensureDefaults()` 中，每次启动都会跑
- 环境变量通过构建脚本静态替换（`process.env.SUPABASE_URL` → 字符串字面量），不是运行时读取
- 图标必须是真实 PNG/SVG，不要用文本占位符

---

## 数据结构要点

### Settings（chrome.storage.local）

```ts
interface Settings {
  lookupKeys: { mac: LookupKey; win: LookupKey };  // 各平台独立快捷键
  hoverDelay: number;                              // 悬停触发延迟（ms）
  translator: "free" | "fallback";
  useYoudaoDict: boolean;
  autoSpeak: boolean;
  maxCacheSize: number;
  syncEnabled: boolean;
  rememberDevice7Days: boolean;
  syncBaseUrl: string;                             // API 根 URL，不带 /app
  fireworksEffect: "canvas" | "css" | "none";
}
```

`LookupKey = "Control" | "Meta" | "Alt" | "Shift"`，Windows 选项无 Meta。

### Word

```ts
interface Word {
  word: string;
  frequency: number;           // 上下文条数
  translation: string;
  timeAdded: number;
  timeUpdated: number;
  contexts: WordContext[];
  bookId: string;
  phonetic?: string;
  exampleEn?: string;
  exampleZh?: string;
}
```

---

## Git 工作流

### 分支

| 分支 | 用途 |
|------|------|
| `main` | 生产，合并触发正式 Release（自动递增 patch 版本） |
| `dev` | 开发集成，push 触发 Dev Snapshot（tag=snapshot，prerelease，固定版本 0.0.0.0 覆盖安装） |
| `feature/<描述>` / `fix/<描述>` | 功能/修复分支 |

### 提交指令（开发者说以下话时执行）

#### 「提交代码」—— 仅 commit + push 当前分支

1. `git status` 检查
2. **先验证**：`npm run build:ts` + `npm test` + `npm run lint`，失败则停止并报告
3. 按 `.trae/rules/git-commit-message.md` 规则拆分原子 commit（**不要 squash 成一个 commit**，按文件类型/业务模块/独立功能拆分）
4. 每个 commit 使用 Conventional Commits 格式（type(scope): subject + body）
5. `git push origin <当前分支>`

#### 「提交代码并合并到 dev」

1. 同上步骤 1-3（验证 + 原子提交 + push）
2. `git fetch origin dev`
3. 冲突预检：`git merge --no-commit --no-ff origin/dev`
   - 有冲突 → `git merge --abort`，报告冲突文件列表，**停止，不自动解决**
   - 无冲突 → `git merge --abort` 继续
4. `gh pr create --base dev --head <当前分支>` 创建 PR（使用 PR 模板）
5. `git checkout dev && git pull origin dev && git merge --no-ff <当前分支> && git push origin dev`
6. 输出 PR 链接 + merge 结果，`git checkout <原分支>`

#### 「创建 PR」—— 仅建 PR 不合并

1. 验证 + 提交推送后，`gh pr create` 即停止，输出 PR 链接等待 review

### 合并到 main

**不自动**。必须手动从 `dev` 提 PR 到 `main`，review 后合并。合并后 CI 自动：
- 基于最新 v* tag 递增 patch 版本
- 注入版本号到 manifest
- 打 zip 包
- 创建 GitHub Release 并上传产物

手动指定版本发布：`git tag v1.2.3 && git push origin v1.2.3` 触发对应版本的 Release。

### 冲突规则

- **禁止 AI 自动解决冲突**，列出文件和冲突类型，等待开发者处理
- 开发者说「继续合并」后从冲突检查步骤继续

---

## CI/CD

- `.github/workflows/ci.yml`：PR/push 时跑 lint + tsc + vitest + build
- `.github/workflows/release.yml`：
  - push `v*` tag → 正式 Release（使用指定版本号）
  - push `main` → 正式 Release（自动 patch+1，如 v1.2.3 → v1.2.4）
  - push `dev` → Dev Snapshot（tag=`snapshot`，版本固定 `0.0.0.0` 每次覆盖，prerelease）
  - 流程：checkout → npm ci → lint → test → resolve-tag → build:dict → build（注入 RELEASE_VERSION）→ pack → upload artifacts → create GitHub Release
  - Secrets 需要配置：`SUPABASE_URL`、`SUPABASE_ANON_KEY`
- **Chrome Web Store 自动上架**暂未实现（记录在 TRACKING.md P1），目前 zip 产物附在 GitHub Release 上，手动上传到 Chrome Developer Dashboard

---

## 关键文件索引

| 文件 | 用途 |
|------|------|
| `lib/constants.ts` | 常量、`detectPlatform()`、LookupKey/Platform 类型、DEFAULT_SYNC_BASE_URL |
| `lib/storage.ts` | chrome.storage 封装 + 默认值 + 旧格式迁移逻辑 |
| `lib/supabase.ts` | Supabase Auth API 调用 |
| `content/content-script.ts` | 查词核心：键盘监听、悬停检测、弹窗渲染、选词查词 |
| `content/fireworks.ts` | 加词烟花特效（canvas/css 两种模式） |
| `service/service-worker.ts` | 消息路由、认证、同步队列、alarm 定时同步 |
| `options/options.ts` | 设置页：加载/保存、登录注册、手动同步 |
| `popup/popup.ts` | 单词本弹窗：列表、搜索、导出、删除、单词本切换 |
| `scripts/build-cross-browser.ts` | 跨浏览器构建 + replaceEnvVars 环境变量注入 + 版本号注入 |
| `scripts/pack.ts` | 调用系统 zip 打商店上传包（排除 .map、.DS_Store） |
| `manifest.base.json` | 共享 manifest（权限、content_scripts、action、options_ui） |
| `manifest.chrome.json` | Chrome/Edge 覆盖（background service_worker、CSP、commands） |
| `manifest.safari.json` | Safari 覆盖 |
| `TRACKING.md` | 跨会话待办清单，新会话/审计时**必须先读** |
| `.env.example` | 环境变量模板 |

---

## 不要做的事

- 不要用 pnpm/yarn，只用 npm
- 不要提交 `.env`、`.env.local` 文件
- 不要把 Supabase service role key 等服务端密钥放进扩展代码
- 不要把 sync API URL 设成 `https://word-base.pages.dev/app`（这是前端地址，API 在根域）
- 不要做 Control/Meta 键桥接（选什么键就只响应什么键，严格匹配用户选择）
- 不要在同步推送时覆盖服务端单词的 `level`/`familiarity` 等 SRS 字段
- 不要在 service worker 里访问 window/document/import.meta
- 不要在 shared/lib 里引用 content/popup/options 特有 DOM API
- 不要创建假的占位图标/图片文件，必须用真实 PNG/SVG
- 不要直接在 main/dev 分支上提交，用 feature/fix 分支
- 不要手动改 dist/ 目录（构建产物）
- 不要把多个无关改动合成一个 commit，按原子规则拆分
- 不要给代码加注释（除非用户明确要求）
- 不要主动创建 .md 文档（用户明确要求才创建）

# WordPicker 待办事项清单

> 本文件记录尚未完成的任务。代码审计 / 新会话开始时请先读取此文件，按优先级逐项处理。

---

## 🔴 P0 - 阻塞发布（必须做）

- [ ] **Chrome Web Store 首次手动上架**
  - 注册 Chrome 开发者账号（一次性 $5）
  - 在 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) 创建新扩展条目
  - 上传 `dist/wordpicker-chrome.zip`（从 GitHub Release 下载）
  - 填写描述、截图、隐私政策、分类等元数据
  - 提交审核，获取 Extension ID
  - 参考：https://developer.chrome.com/docs/webstore/publish

---

## 🟡 P1 - 发布后体验优化

- [ ] **Chrome Web Store 自动发布 CI**
  - 前提：完成 P0 首次上架，拿到 Extension ID
  - 在 Google Cloud Console 启用 Chrome Web Store API，创建 OAuth Client
  - 获取 REFRESH_TOKEN，配置为 GitHub Secret：`CHROME_CLIENT_ID`、`CHROME_CLIENT_SECRET`、`CHROME_REFRESH_TOKEN`、`CHROME_EXTENSION_ID`
  - 在 `.github/workflows/release.yml` 中新增 "Upload to Chrome Web Store" 步骤
  - 推荐工具：`chrome-webstore-upload-cli`（`npx chrome-webstore-upload upload --auto-publish`）
  - 触发条件：tag（v*）触发正式版时自动上传发布；main/dev 触发时跳过或上传为 draft
  - 文档：https://github.com/fregante/chrome-webstore-upload-cli

- [ ] **Safari 分发方案**
  - 用 Xcode 打开 Safari Web Extension 项目
  - 配置 App Store Connect 应用条目、签名证书
  - 评估是否需要 CI 自动化（Safari 自动化需要 macOS runner，成本较高，建议手动 Xcode Archive + Upload）

- [ ] **Windows Chrome 烟花特效兼容性**
  - 用户反馈：Mac Chrome 上烟花特效正常，Windows Chrome 无反应
  - 需要在 Windows 环境实际测试并定位
  - 涉及文件：`content/fireworks.ts`

---

## 🟢 P2 - 功能增强

- [ ] **图片 OCR 取词 — 临时隐藏，待浏览器实测与调优后重新开启**
  - 基础实现 + 置信度/多语言过滤/超时调优已完成
  - **2026-08-03 修复**：离屏文档创建 bug（`hasDocument().then(() => true)` 丢弃返回值）、Content Script 10s 超时过短、空闲计时器 60s 过短，OCR 现在可正常执行
  - **2026-08-05 状态**：用户入口已临时隐藏。在 `content/content-script.ts` 中 `IMAGE_OCR_ENABLED` 设为 `false`（默认关闭悬停图片取词），后端 `IMAGE_OCR` 处理器与 offscreen 代码保持可用，待真实网页实测充分后改回 `true` 即可恢复
  - 需要在真实网页上测试各种图片（跨域、data URL、动态加载）
  - 关注首次加载语言模型的速度（~4MB 英文模型）
  - OCR 识别精度调优（小字、模糊图片、复杂背景）

---

## 📦 当前已完成（供参考）

- [x] 按平台独立的快捷键配置（Mac/Win 互不干扰）
- [x] 严格按用户选择触发（移除 Control/Meta 桥接）
- [x] Supabase 凭证通过环境变量注入（不硬编码）
- [x] 注册后自动创建默认单词本，避免首次同步失败
- [x] 同步推送保留服务端 SRS/AI 字段（不覆盖学习数据）
- [x] Logo 大小放大三倍，跳转链接指向 /app
- [x] 同步 API 基础 URL 正确区分 API 根与前端 app 路径
- [x] 快捷键/特效选择后自动保存
- [x] 版本号自动注入 manifest（CI 构建时）
- [x] Release workflow 支持 main/dev/tag 三种触发
- [x] 旧数据格式迁移（lookupKey → lookupKeys、错误 syncBaseUrl 清理）
- [x] .env.example 模板完善
- [x] 图片 OCR 取词基础实现（Tesseract.js + Offscreen Document + 单词热区叠加）
- [x] 多语言识别配置（英/法/西 + 日语 TinySegmenter 分词）
- [x] 翻译弹窗来源语言标注（[英]/[法]/[西]/[日]）
- [x] 查词浮窗语言标签 + 快捷切换下拉菜单
- [x] 设置页版本号展示（options 页底部）
- [x] 设置项云端同步（后端 API + 客户端推拉逻辑 + 触发时机）
- [x] OCR 调优（置信度阈值、多语言字符过滤、30s 超时）
- [x] OCR offscreen document 竞态修复（PING 就绪检查 + onMessage 监听器旁路，解决“Receiving end does not exist”）
- [x] Content script 防御性检查（browser.storage?.onChanged 可选链，防止扩展重载后崩溃）
- [x] 日语分词 + 来源语言标注（[英]/[法]/[西]/[日]）
- [x] 德语支持（Latin 字母 + 变音符号，OCR/正则/翻译全链路）
- [x] 韩语支持（Hangul 字符检测 + 空格分词 + OCR/翻译全链路）
- [x] OCR 离屏文档创建 bug 修复（hasDocument 返回值丢弃 + connect 就绪探测不可靠 + Content Script 10s 超时 → 120s + 空闲超时 60s → 300s + 关键路径日志）

---

## 代码审计报告（2026-08-03）

### 基础检查

| 检查项 | 结果 |
|--------|------|
| tsc 类型检查 | 0 错误 |
| ESLint | 0 错误（2 预存 warning） |
| Vitest 单测 | 82/82 通过 |
| Chrome 构建 | 成功 |

### 代码规模

| 文件 | 行数 | 职责 |
|------|------|------|
| content/content-script.ts | ~2000 | 查词主逻辑、弹窗渲染、OCR 热区 |
| service/service-worker.ts | ~1770 | 消息路由、同步队列、认证、OCR 调度 |
| lib/storage.ts | 593 | 存储封装、数据迁移、缓存管理 |
| options/options.ts | 417 | 设置页交互 |
| lib/translator.ts | 446 | 翻译 API 调用 |
| popup/popup.ts | 324 | 单词本弹窗 |
| lib/offlineDict.ts | 278 | 离线词库（IndexedDB） |
| lib/utils.ts | 194 | 工具函数 |
| lib/cache.ts | 172 | LRU 翻译缓存 |
| lib/supabase.ts | 169 | Supabase Auth 调用 |
| content/shared.ts | 129 | 共享 API（escapeHtml/sendMessage/logger） |
| content/fireworks.ts | 525 | 烟花特效（canvas/css/5种新特效） |
| offscreen/ocr.ts | 157 | OCR 图片文字识别（Tesseract.js） |
| lib/content-helpers.ts | ~150 | Content Script 语言检测/分词辅助 |
| **合计** | **~7600** | |

### 2026-08-03 新增修复

#### CRITICAL: OCR 离屏文档创建 bug
- `ensureOffscreenDocument()` 中 `hasDocument().then(() => true)` 将实际返回值丢弃，恒返回 true
- `chrome.runtime.connect()` 不抛异常，就绪检查永远"成功"，`offscreenCreated` 被设为 true
- 15 次重试全失败后仍设 `offscreenCreated = true`，系统进入永久"认为已创建"状态
- Content Script `sendMessage` 默认 10s 超时，远小于 OCR 实际耗时（30-90s）
- `OFFSCREEN_IDLE_TIMEOUT_MS = 60s`，首次加载 Tesseract 语言包可能触发提前关闭
- **修复**：重写 `ensureOffscreenDocument` 直接取 `hasDocument()` 真实返回值，去掉 `connect` 探测；OCR 调用超时改为 2 分钟；空闲超时改为 5 分钟；关键路径加日志
- 涉及：`service/service-worker.ts`、`content/content-script.ts`

### 历史问题（2026-07-30）

#### MEDIUM: Word 缺少 sourceLang 字段
- 单词保存时不记录来源语言，所有语言混在同一单词本
- 弹窗里的 `[英]/[法]/[한]` 标签仅在查词时显示，不持久化
- 无法按语言筛选或导出单词
- **建议**：后续给 Word 接口加 `sourceLang` 字段，保存时记录

#### MEDIUM: handleSaveWord 未登录时直接报错
- `syncEnabled` 为 true 但未登录时，抛异常「请先登录才能添加单词」
- 用户可能只是想本地使用，不想登录
- **建议**：未登录时允许本地保存，跳过同步即可

#### LOW: content-script.ts 重复定义 lib/ 中的类型和常量
- Settings、LookupKey、Platform、LANGUAGE_WORD_PATTERNS 等在 content-script.ts 有独立副本
- 这是设计如此（content script 运行在隔离世界，无法 import lib/），但增加维护成本
- 添加新语言时必须同时更新 constants.ts 和 content-script.ts
- **建议**：可接受，暂无更好方案

#### LOW: clearUserData 重复删除同一 storage key
- `service-worker.ts` L1348-1361 同时删除字符串字面量 `'syncQueue'` 和常量 `STORAGE_SYNC_QUEUE`，两者值相同
- 不影响功能，只是冗余代码

#### LOW: lowercaseFirstLetter 仅处理纯英文单词
- 正则 `/^[A-Za-z][A-Za-z'-]*$/` 只匹配纯英文，法语/德语/西班牙语单词不会被规范化
- 可能导致 "Bonjour" 和 "bonjour" 被视为不同单词
- **建议**：后续可扩展为非英文 Latin 字母的首字母小写

#### LOW: saveRememberedCredentials 的 password 参数传入但未存储
- 函数签名接收 `_password` 但函数体只存储 email，密码未持久化
- 调用方 `handleAuthLogin` / `handleAuthRegister` 传入了明文 password 但无实际效果
- 可以清理函数签名，去掉 password 参数

#### LOW: handleAuthLogout 重复清理 storage
- `clearUserData()` 已删除 `STORAGE_AUTH`、`STORAGE_CURRENT_USER_EMAIL`、`STORAGE_DEVICE_ID` 等
- 之后又单独调用 `browser.storage.local.remove(['deviceId'])`，完全冗余
- `setAuthData(null)` + `setCurrentUserEmail(null)` 也在 `clearUserData()` 中做过

#### LOW: pushWords 中 book_id 长度校验使用魔法数字
- `bookId.length < 10` 和 `mapped.book_id.length <= 20` 是硬编码阈值
- 用于过滤本地生成的临时 bookId（如 `local_default_book`），但 UUID 是 36 字符
- 如果服务端 book ID 格式变化，可能误过滤

### 架构评价

- 同步机制健壮：队列持久化 + 指数退避重试 + 锁机制 + token 自动刷新
- 翻译链路三层降级：缓存 → 离线词库 → 网络 API，体验流畅
- 多语言扩展性好：添加 Latin 系语言只需改配置，无需修改核心逻辑
- 安全性好：无 service role key 泄露风险，CSV 导出有公式注入防护
- popup/options 代码清晰：escapeHtml 使用正确，无 XSS 风险
- fireworks.ts 使用 Shadow DOM 隔离样式，尊重 prefers-reduced-motion
- supabase.ts 简洁，readEnv 兼容 process.env 和 import.meta.env

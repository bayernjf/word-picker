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

- [ ] **图片 OCR 取词 — 浏览器实测与调优**
  - 已完成基础实现 + 置信度/多语言过滤/超时调优
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
- [x] 日语分词 + 来源语言标注（[英]/[法]/[西]/[日]）

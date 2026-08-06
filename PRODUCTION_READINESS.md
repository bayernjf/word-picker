# WordPicker 生产上线就绪度评估

> 评判标准：真实投入生产（Chrome Web Store 上架 + 后端云同步可用）的工程标准，而非"本地能跑"。
>
> 生成日期：2026-06-27 · 更新日期：2026-07-31 · 评估对象：当前 `feature/20260602` 分支

---

## 总览

| 模块 | 就绪度 | 结论 |
|---|---|---|
| 核心查词交互 | 🟢 90% | 接近可上线 |
| 本地单词本 / 存储 | 🟢 95% | 可直接上生产 |
| 设置页 | 🟢 90% | 可上线 |
| 翻译能力 | 🟡 65% | 有合规 + 配额风险 |
| 账号 / 云同步 | 🟢 85% | 已对接生产环境，可上线 |
| 工程质量保障 | 🟡 60% | 单测 + CI + E2E 已就位，仍需补充核心链路测试 |

**结论**：作为**纯本地查词 + 单词本工具**，已可上线（修掉翻译合规问题即可）。作为**带账号云同步的完整产品**，同步链路已对接生产环境（Supabase + WordBase API），可进入上架准备阶段。

---

## 模块一：核心查词交互 ✅ 基本完成

| 功能点 | 状态 | 说明 |
|---|---|---|
| 默认 Ctrl 悬停查词 | ✅ | content-script 状态机（IDLE/PEN/LOADING/SHOWING）完整 |
| Shadow DOM 弹窗隔离 | ✅ | `attachShadow` 防样式污染，`z-index` 拉满 |
| 弹窗定位 / 跟随 / 置顶 / ESC 关闭 | ✅ | 视口边界处理、滚动重定位都有 |
| 笔形光标、单词高亮 | ✅ | 自定义 SVG cursor |
| 选词 / 句子上下文提取 | ✅ | `extractSentenceFromDetection` |

**风险**：刚修复的 `_logger.debug` 崩溃说明**这条核心链路没有自动化测试**，一次重构就能整条打挂还无人发现。生产标准下属于高危。

---

## 模块二：翻译能力 ⚠️ 完成但有合规 / 稳定性风险

| 功能点 | 状态 | 说明 |
|---|---|---|
| 三级查词（缓存→离线词典→网络） | ✅ | `handleTranslate` 设计良好 |
| 离线 ECDICT 词库（IndexedDB） | ✅ | `offlineDict.js` 幂等导入、词形还原 |
| LRU 缓存淘汰 | ✅ | `pruneCache` |
| 多源聚合 + 超时降级 | ✅ | `Promise.allSettled` + `withTimeout` |

**风险（上线阻塞级）**：

1. **有道接口 `dict.youdao.com/jsonapi` 是未公开私有 API**（`lib/translator.js`）——随时可能失效或被封，且**未在 manifest `host_permissions` 声明**，MV3 下生产环境这个请求会被 CORS / 权限直接拦截。
2. **MyMemory 免费接口有每日匿名调用配额**，多用户上量后必被限流。生产需要自有翻译代理或付费 key。

---

## 模块三：单词本与本地存储 ✅ 完成度高

| 功能点 | 状态 |
|---|---|
| 增删改查 / 搜索 / 去重（按 word+context） | ✅ |
| 多单词本（books） | ✅ |
| 导出 JSON / CSV | ✅ |
| 旧格式迁移 `migrateOldWordFormat` | ✅ |
| 首字母规范化（保留 NASA/iOS） | ✅ 细节到位 |
| XSS 防护 | ✅ 列表渲染全部 `escapeHtml` |

这是整个项目**质量最高**的部分，可直接上生产。

---

## 模块四：账号与云同步 ✅ 已对接生产环境

| 功能点 | 状态 | 说明 |
|---|---|---|
| 登录 / 注册 / 登出 | ✅ | Supabase Auth，生产环境 `word-base.pages.dev` |
| Token 刷新 + 401 重试 | ✅ | `doRefreshToken` 区分真失效 / 临时错误 |
| 同步队列（push/pull/delete） | ✅ | 离线入队、去重、后台 flush |
| “记住 7 天”登录态 | ✅ | |
| 多账号切换清数据 | ✅ | `clearUserData` |
| 设置双向同步 | ✅ | 推/拉 + 触发时机（登录/手动同步/设置变更） |

**已修复项**：
- ✅ 后端地址已改为生产域名（环境变量注入，`SYNC_BASE_URL = https://word-base.pages.dev`）
- ✅ `host_permissions` 已补齐 Supabase 域名
- ✅ 同步推送前会先拉取服务端单词，保留 SRS 字段不覆盖

**剩余风险**：
- 🟠 Token 存于 `chrome.storage.local`，扩展常见做法，但安全审计角度可优化
- 🟠 同步无冲突合并策略：`pullChanges` 用整体覆盖，多设备并发可能丢未同步数据

---

## 模块五：设置页 ✅ 完成

查词键、悬停延迟、翻译源、有道开关、缓存上限、同步开关、记住登录——均有 UI 和持久化，`SETTINGS_LIMITS` 有边界钳制。可上线。

---

## 模块六：工程化与质量保障 ⚠️ 已大幅改善

| 项 | 状态 | 生产标准要求 |
|---|---|---|
| 单元测试 | ✅ 62 个用例（storage/sync/translator/utils） | 核心链路仍需补充 |
| 集成测试 | ✅ service-worker 集成测试 | |
| E2E 测试 | ✅ Playwright（查词/导出/烟花/设置/单词本） | |
| CI | ✅ `ci.yml`（lint + tsc + vitest + build） | |
| CD / Release | ✅ `release.yml`（正式版 + Dev Snapshot） | |
| 错误监控 / 上报 | ⚠️ 分级日志（logger.ts），无外部监控 | 生产崩溃无感知 |
| 隐私政策 | ❌ 无 | Chrome Web Store **强制要求**（涉及账号 + 网络请求） |
| 图标 / 截图 / 商店素材 | ⚠️ 仅有 icon | 上架需要 |

---

## 上线前必办清单（按优先级）

### P0（阻塞，不做无法上线）

- [ ] Chrome Web Store 首次手动上架（$5 开发者账号 + 上传 zip + 填写元数据）
- [ ] 补隐私政策 + 商店素材（截图、描述、分类）
- [ ] 评估有道接口合规性（未公开私有 API，随时可能失效）

### P1（强烈建议）

- [ ] 给核心链路（content-script 查词、`handleTranslate`）补集成测试
- [ ] 接错误监控（Sentry 等）
- [ ] Chrome Web Store 自动发布 CI

### P2（体验 / 健壮性）

- [ ] 同步冲突合并策略（避免覆盖丢数据）
- [ ] 翻译接口自建代理，规避免费配额限流
- [ ] Safari 分发（Xcode Archive + Upload）

---

## 备注

- 本文档为静态评估快照，随代码演进需更新。
- 勾选清单可作为后续逐项解决的跟踪表。

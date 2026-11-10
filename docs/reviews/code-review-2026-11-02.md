# WordPicker 代码评审报告（2026-11-02）

> 评审方式：只读深度评审（未修改任何源码、未提交、未安装依赖）。
> 评审基线：`dev` 分支 HEAD（`2cea8d2`），工作区干净，89 个 git 跟踪文件。
> 证据原则：每条结论均给出 `文件:行号` 或实际命令输出；未验证项明确标注"未确认"。

---

## 一、仓库定位与规模概览

WordPicker 是一个 Manifest V3 跨浏览器（Chrome/Edge/Safari）查词扩展：按住修饰键悬停放网页单词弹窗翻译，一键收录到 Supabase/WordBase 云端单词本，含离线 ECDICT 词库（IndexedDB）、多语言识别、Tesseract.js 图片 OCR（当前关闭）、SRS 复习提醒、烟花特效。

| 维度 | 数据 |
|---|---|
| 源码规模 | TS 约 8600 行（`wc -l` 实测），最大文件 `content/content-script.ts` 2089 行、`service/service-worker.ts` 1770 行 |
| 组件边界 | content script（查词 UI）/ service worker（消息路由+同步+认证）/ offscreen document（OCR）/ popup / options，职责划分清晰 |
| 构建 | `tsc` 双 tsconfig + 自研 `build-cross-browser.ts`（manifest 合并、env 字面量注入、host_permissions 动态注入）+ `pack.ts` |
| 测试 | Vitest 6 文件 95 用例全过；Playwright e2e 6 个 spec（本次未执行，原因见验证门） |
| CI/CD | `ci.yml`（lint+test+build）、`release.yml`（tag/main 正式版 + dev snapshot） |

---

## 二、结论摘要

**计数：P0 × 0 ｜ P1 × 2 ｜ P2 × 9 ｜ P3 × 8**

最关键的三条：

1. **【P1 数据丢失】Token 过期即清空全部本地单词**：`handleAuthStatus` 发现 auth 过期时调用 `clearUserData()`，删除 `words`/`books`/`syncQueue`/`deleteQueue`，未同步的本地数据直接蒸发（`service/service-worker.ts:1543-1551` + `1408-1421`）。
2. **【P1 功能缺陷】未登录用户完全无法保存单词**：`handleSaveWord` 在 `syncEnabled && !isLoggedIn` 时直接 throw（`service/service-worker.ts:405-411`），而 `syncEnabled` 默认为 `true`（`lib/storage.ts:78`），等于把"本地单词本"这个核心功能锁死在登录之后。
3. **【P2 XSS 加固缺口】服务端下发的 `recognizeLanguages` 未经转义进入 content script `innerHTML`**：语言标签拼接处未走 `escapeHtml`（`content/content-script.ts:1247-1251`、`1321-1331`），而该设置项在服务端可同步白名单内（`service/service-worker.ts:599-602`），同步服务器被污染时可在任意页面注入。

---

## 三、逐条发现（按严重度排序）

### P1 — 严重缺陷

#### P1-1 Token 过期清空全部本地单词数据（数据丢失）

- **位置**：`service/service-worker.ts:1543-1551`（`handleAuthStatus`）、`1408-1421`（`clearUserData`）
- **证据**：
  ```ts
  // 1546-1550: 登录态已过期：清除并视为未登录
  if (auth && isAuthExpired(auth)) {
    await setAuthData(null);
    await setCurrentUserEmail(null);
    await clearUserData();   // ← 删除 words/books/syncQueue/deleteQueue/deviceId
  ```
  `clearUserData`（1409-1420）`browser.storage.local.remove([... 'words','books','syncQueue','deleteQueue' ...])`。
- **影响**：`AUTH_STATUS` 每次打开 popup/options 都会触发。用户 JWT 过期（默认 1 小时，refresh token 也可能失效）后，本地所有单词、以及尚未推送的同步队列被静默删除。refresh token 续期逻辑（`flushSyncQueue` 1172-1195）在 `isAuthExpired` 为真时根本不执行（1164-1169 直接清空登出），过期即丢数据。这是真实可达的数据丢失路径。
- **修复建议**：`handleAuthStatus` 过期分支只清认证态（`authData`/`currentUserEmail`），不得调用 `clearUserData`；本地单词保留并在重新登录后按"用户切换"逻辑处理。同时给该路径补回归测试。

#### P1-2 未登录用户无法保存任何单词（功能缺陷）

- **位置**：`service/service-worker.ts:405-411`
- **证据**：
  ```ts
  const syncEnabled = settings.syncEnabled !== false;
  const isLoggedIn = Boolean(auth?.accessToken && auth?.refreshToken);
  if (syncEnabled && !isLoggedIn) {
    throw new Error('请先登录才能添加单词');
  }
  ```
- **影响**：`syncEnabled` 默认 `true`（`lib/storage.ts:78`），新装用户不注册/登录就完全无法使用"保存到单词本"这一核心卖点；popup 在未登录时也只显示登录墙（`popup/popup.ts:313-324`）。`handoff.md:102` 已自认此问题（"should allow local-only save"）但未修。
- **修复建议**：未登录时允许本地保存（`isLoggedIn=false` 分支已存在，466-479 行），去掉 throw；或默认 `syncEnabled=false`，登录后再开启。

### P2 — 质量/安全/性能问题

#### P2-1 content script 与 `lib/content-helpers.ts` 重复实现且已发生漂移

- **位置**：`content/content-script.ts:64-121`（本地副本）vs `lib/constants.ts:46-53` / `lib/content-helpers.ts:19-80`
- **证据**：`content-helpers.ts:1-3` 头注释明确写着"单一事实来源，避免 content-script 重复定义常量与逻辑（此前副本已与 lib 漂移）"，但 content script 仍保留本地 `normalizeLookupKeys`/`detectWordLanguage`/`buildWordPattern`/`extractSentence`/`computeWordSignature` 副本。且德语正则已实际漂移：content 版 `de: "[A-Za-z\u00C0-\u00F6\u00F8-\u00FF]..."`（`content-script.ts:68`）排除了 `\u00F7`（÷），constants 版 `de: "[A-Za-z\u00C0-\u00FF]..."`（`lib/constants.ts:50`）包含之。单测只覆盖 lib 版，content 实际运行的是无测试副本。
- **影响**：查词核心正则与语言检测在生产路径上零测试覆盖，且两套实现会继续漂移。
- **修复建议**：让 content script 从 shared.js 或构建期注入复用 lib 实现；至少消除德语正则差异。

#### P2-2 语言标签未转义进入 innerHTML（XSS 加固缺口）

- **位置**：`content/content-script.ts:1247-1251`、`:1321-1331`；数据源 `service/service-worker.ts:599-602`
- **证据**：
  ```ts
  // 1247-1251
  dropdown.innerHTML = configuredLangs.map(code => {
    const label = code.toUpperCase();          // ← 未 escapeHtml
    ...
    return `<div class="popup-lang-option${active}" data-lang="${escapeHtml(code)}">${label}</div>`;
  // 1322-1326
  const langLabel = currentLang.toUpperCase(); // ← 未 escapeHtml
  const langDropdownMarkup = configuredLangs.length > 1
    ? `<span class="popup-lang-wrap"><span class="popup-lang-tag" ...>${langLabel} ▾</span></span>`
  ```
  `recognizeLanguages` 在 `SYNCABLE_SETTING_KEYS` 内（`service-worker.ts:599-602`），`pullSettingsFromServer`（629-648）会把服务端值合并进本地 settings，再经 `storage.onChanged` 流入 content script。
- **影响**：同文件其它用户数据全部 `escapeHtml`（1309-1339），唯独语言码两处漏网。攻击前提是同步服务器返回恶意 settings（或恶意账号数据），属于纵深防御缺口而非独立可利用漏洞。
- **修复建议**：对 `label`/`langLabel`/`currentLang` 一律 `escapeHtml`，并对 settings 中字符串枚举做白名单校验（`SUPPORTED_LANGUAGES` 的 code 集合）。

#### P2-3 `host_permissions` 含 `<all_urls>`，超出最小化原则

- **位置**：`manifest.base.json:21-27`
- **证据**：host_permissions 同时列出 `<all_urls>` 与四个具体 API 域名。
- **影响**：content_scripts 的 `matches: <all_urls>`（30-32 行）已足够注入页面；host 层 `<all_urls>` 的实际增量用途是 service worker 里 `fetch(imageUrl)`（`service-worker.ts:1637`，OCR 取图）。这使扩展拥有对任意源的身份免 CORS 读取能力，商店审核与用户信任成本都更高；而 OCR 入口当前被 `IMAGE_OCR_ENABLED = false` 关闭（`content/content-script.ts:62`），即权限为死功能保留。
- **修复建议**：OCR 上线前保留并写明 justification；长期看可改为 optional_host_permissions 按需申请。

#### P2-4 认证 token 明文存于 `chrome.storage.local`

- **位置**：`service/service-worker.ts:1317-1325`（`authData` 含 accessToken/refreshToken）
- **影响**：`chrome.storage.local` 以明文落盘（用户 profile 目录），本机任意能读该目录的程序均可取走 refresh token 长期冒用。浏览器扩展无更优标准方案，但应知悉并缩短 refresh token 生命周期/开启 Supabase RLS 最小授权。正面证据：记住密码功能只存 email 不存密码（1329-1350，password 显式 `undefined`）。
- **修复建议**：保持现状但文档化风险；评估 Supabase refresh token rotation。

#### P2-5 同步冲突条目永久滞留队列、无限退避重试

- **位置**：`service/service-worker.ts:1092-1094`、`1282-1305`
- **证据**：`pushWords` 遇 conflict 仅把非冲突条目出队，随后 `throw new Error('sync_conflict')`；`flushSyncQueue` catch 后 `recordSyncFailure`（113-120）退避，冲突条目永不出队。
- **影响**：一旦某词条与服务器冲突，该条目永远留在队列，每次 flush 都重新推送、重新冲突，队列被毒化且退避拉长到 1 小时，后续正常词条也被拖累。
- **修复建议**：冲突条目单独隔离（死信队列）或按服务端版本合并后出队，并在 UI 暴露冲突数。

#### P2-6 `pullChanges` 整体覆盖式合并，多设备可能丢本地改动

- **位置**：`service/service-worker.ts:886-912`
- **证据**：`mergedWords = [...pendingWords, ...localWords.filter(...)]` 后 `saveWords(mergedWords)`，本地不在 pending 队列的词条完全被服务端快照替换。
- **影响**：`PRODUCTION_READINESS.md:86-88` 已自认"多设备并发可能丢未同步数据"。设备 A 离线期间的本地修改若未入队（或入队被 500 条上限截断），下次同步即被服务端覆盖。
- **修复建议**：引入按 `timeUpdated` 的 last-write-wins 字段级合并，或至少按单词级比较。

#### P2-7 两套 `sendMessage` 超时默认值漂移，长翻译可能误报超时

- **位置**：`content/shared.ts:109`（默认 10000ms）vs `lib/utils.ts:19`（默认 5000ms）
- **影响**：content script 的 TRANSLATE 走 10s 超时；`lib/translator.ts` 并发闸门（99-126，最多 3 并发、50 排队）+ 2.5s×N + 1.5s 例句翻译，在队列积压时超过 10s，用户看到"消息发送超时"，而后台翻译其实成功——弹窗显示错误但结果未展示。
- **修复建议**：统一超时常量；TRANSLATE 显式提高超时或由 SW 侧约束总时长。

#### P2-8 鼠标移动对长文本节点做全量 `matchAll`，存在性能热点

- **位置**：`content/content-script.ts:820`（`[...text.matchAll(wordPattern)]`，在 `updateHoverHighlight` 的每次 rAF 中经 `detectWordAtPoint` 触发，636-652）
- **影响**：对超长单文本节点（几千字一段的页面，如无分段的文章/小说站），每次 mousemove rAF 都正则扫描整个节点文本 → O(n)/帧。一般页面无碍，极端页面可感卡顿。已确认有 rAF 节流（639-651），属于"有证据的热点"而非失控。
- **修复建议**：先用二分/前后窗口定位 caret 附近片段再匹配，或对文本长度设上限回退。

#### P2-9 Anki 导出未转义 API 返回内容

- **位置**：`service/service-worker.ts:574-591`（`toAnki` 直接拼接 `phonetic`/`meaning`/`exampleEn`/`contexts` 进 HTML 模板）
- **影响**：翻译/词典 API 返回内容原样进入 Anki 卡片 HTML；恶意或畸形内容会破坏导入文件结构。CSV 导出已有公式注入防护（565-572），Anki 路径不对齐。
- **修复建议**：导出前对字段做 HTML 转义或过滤。

### P3 — 体验/规范问题

1. **README 开发指引过时**：`README.md:14-20` 让读者直接"加载当前项目目录"，但仓库根无 `manifest.json`（只有 `manifest.base.json`），必须先 `npm run build:chrome` 并配置 `.env.local`；`README.md:51` 称 `tests/` 是"手动测试清单"，实际已是 Vitest+Playwright 自动化；`README.md:12` 未提云同步/账号体系。
2. **`PRODUCTION_READINESS.md:49` 断言失效**：称有道接口"未在 manifest host_permissions 声明，MV3 下会被拦截"，但 `manifest.base.json:25` 已声明 `https://dict.youdao.com/*`——该阻塞项实际已修复，文档未更新。
3. **测试数量文档过期**：`docs/TECH_STACK.md:154` 称"62 个单测"，实测 95 通过；`handoff.md:86` 的快照（82/82）同样过期（属历史快照，低优先）。
4. **`handoff.md:165` 硬编码真实 Supabase 项目 URL**（`https://zzmolktkgorerpaoglpr.supabase.co`）：非密钥但属内部基础设施信息，建议改为占位符。
5. **队列截断静默丢数据**：`service-worker.ts:817`、`:827` `slice(0, QUEUE_MAX_LENGTH)`（500）直接丢弃最旧条目，无任何日志/用户提示。
6. **复习提醒与同步开关错误耦合**：`service-worker.ts:704-705` `if (settings.syncEnabled === false) return;`——关闭云同步会同时关掉本地 SRS 复习提醒，语义不符。
7. **同步载荷 `level` 硬编码 `'B2'`**：`lib/syncPayload.ts:84`，所有词条推送同一等级，污染服务端数据模型。
8. **CI build 不注入生产 URL**：`.github/workflows/ci.yml:39-43` 只注入 Supabase 变量，build 产物内含 `http://localhost:3001`（`lib/constants.ts:6`）与 localhost 应用链接（`popup/popup.html:23`）。该产物仅作构建验证不发布（release.yml 117-124 有注入），风险低但值得注明。

---

## 四、分维度总结

### 1. 架构与模块边界 ✅ 良好
content/SW/offscreen/popup/options 边界清晰；消息经 `MESSAGE_TYPES` 白名单路由（`lib/messaging.ts:27-29` + `service-worker.ts:260-262`），未知类型拒绝；offscreen 用命名 port（`offscreen/ocr.ts:166-167`）隔离。`syncPayload.ts` 刻意无浏览器依赖以便跨仓库契约测试，是好实践。扣分项为 P2-1 的 content/lib 实现漂移。

### 2. 正确性与潜在 bug
见 P1-1、P1-2、P2-5、P2-6。DOM 交互侧：弹窗用 Shadow DOM + request token 防串扰（`content-script.ts:694,718`）、`pagehide` 解绑事件（313-335）、`__WordPickerContentLoaded` 防重复注入（17-20），做得较细；发现的小问题见 P2-8。content script 直接依赖 `chrome.storage.onChanged`（`content-script.ts:305`）在 Safari content script 环境的行为**未确认**（Safari 对 chrome 命名空间支持有限，polyfill 只定义 `browser`）。

### 3. 安全
- 无 `onMessageExternal`/`externally_connectable`（Grep 全仓确认），网页 JS 无法直接向扩展发消息；`AUTH_GET_CREDENTIALS` 额外校验 sender 为扩展页（`service-worker.ts:298-301`）。✅
- CSP：`script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self'; base-uri 'self'`（`manifest.base.json:58-60`），wasm 例外为 Tesseract 所需，合理。✅
- HTML 注入面：全部 innerHTML 点已逐一核对，用户数据均 `escapeHtml`（`content/shared.ts:100-107` 转义含引号），除 P2-2 两处语言标签。CSV 公式注入已防护（`service-worker.ts:567-569`）。✅（除 P2-2）
- 密钥：`.env.local` 未入库且被 `.gitignore:16-17` 排除；`SUPABASE_ANON_KEY` 构建期字面量注入产物（`scripts/build-cross-browser.ts:187-188`）——anon key 本就设计为公开，可接受；service-role key 未出现。✅
- 扣分：P2-2（XSS 加固）、P2-3（权限过大）、P2-4（明文 token）。

### 4. 数据模型与迁移一致性 ✅ 基本一致
本地迁移集中在 `ensureDefaults`（`lib/storage.ts:174-281`）：旧格式单词迁移（`migrateOldWordFormat` 124-160）、`lookupKey`→`lookupKeys` 设置迁移（243-262）、重复词去重（199-217），幂等且有 patch 最小写入。与服务端映射双向成对（`service-worker.ts:915-953` vs `lib/syncPayload.ts:59-94`）。`tools/check-migrations.sh` 针对 `supabase/migrations|db/migrations`，本仓无此目录（schema 在 word-base 仓），脚本当前无对象可检。扣分：P3-7（level 硬编码）。

### 5. 错误处理与失败模式 ✅ 较好
SW 有全局 `unhandledrejection`/`error` 监听（`service-worker.ts:73-79`）；`fetchSyncJson` 区分 401/网络/JSON 错误（`lib/utils.ts:158-193`）；同步有指数退避（`service-worker.ts:113-120`）；port 通信检查 `chrome.runtime.lastError`（`service-worker.ts:1674-1676`）。吞错点多为有意为之并带日志。扣分：P2-5（冲突不可恢复）、P3-5（静默截断）。

### 6. 测试覆盖与验证门真实性
实测：`npm run lint` → 0 error / 2 warning（content-script.ts 两处 `any`）；`npm test` → **6 文件 95 用例全部通过**（2.32s）；`tsc -p tsconfig.extension.json --noEmit` 与 `tsconfig.scripts.json --noEmit` 均 0 错误。CI 三道门与本仓库脚本一致。**缺口**：2089 行的 content script 状态机零单测（仅纯函数副本有测，且与运行副本漂移，见 P2-1）；P1-1/P1-2 两条数据/登录路径无回归测试；fireworks.ts 525 行无测试；同步退避/锁/冲突逻辑无测试。

### 7. 依赖与构建健康 ✅ 健康
`package.json` 依赖克制（4 runtime + 9 dev）；`package-lock.json` 在库；npm 单包管理。构建脚本含 env 校验（缺 SUPABASE_* 直接退出，`scripts/build-cross-browser.ts:259-265`）、生产 URL 校验（267-281）、未替换 readEnv 告警（210-216）。`pack.ts` 依赖系统 `zip` 命令（15-25 有检测提示）。多 manifest 走 base+override 深合并（45-55, 90），一致性好。本次未实际执行完整 `npm run build`（会写 `dist/`，违反只读约束），以 `--noEmit` 类型检查替代验证编译健康。

### 8. 性能热点
仅一处有证据：P2-8 长文本节点全量 matchAll。其余（缓存 LRU、`ensureDictImported` 幂等 promise、storage 内存缓存、alarm 3 分钟空转成本低）均合理。

### 9. 文档与实现一致性
抽查 9 处：4 处一致（CSP 声明、OCR 关闭状态 `handoff.md:136-142` 与 `content-script.ts:62` 一致、fireworks `prefers-reduced-motion` 声明确有实现 `fireworks.ts:490`、导出格式与代码一致）；5 处不一致——见 P3-1（README×3）、P3-2（PRODUCTION_READINESS 有道权限）、P3-3（测试计数）。

---

## 五、验证门实际执行结果

| 命令 | 结果 | 输出摘要 |
|---|---|---|
| `npm run lint` | ✅ 通过 | `eslint .` → 0 errors, 2 warnings（`content/content-script.ts:305,325` `no-explicit-any`） |
| `npm test` | ✅ 通过 | Vitest 2.1.9：6 文件 95/95 通过，2.32s（content-helpers 32、translator 19、utils 16、sync 13、storage 8、service-worker 集成 7） |
| `npx tsc -p tsconfig.extension.json --noEmit` | ✅ 通过 | 0 错误 |
| `npx tsc -p tsconfig.scripts.json --noEmit` | ✅ 通过 | 0 错误 |
| `npm run test:e2e` | ⏭ 跳过 | 需先完整 `build:chrome`（写 dist/，违反只读约束）并启动 Playwright 浏览器，预估 >3 分钟 |
| `npm run build` | ⏭ 跳过 | 会写入 `dist/` 产物，违反本次只读评审约束；以 tsc --noEmit 替代验证编译健康 |

---

## 六、修复优先级建议

1. **立即（下个小版本）**：P1-1（去掉 `handleAuthStatus` 的 `clearUserData` 调用）+ P1-2（允许未登录本地保存），并各补一个回归测试——这两条都直接关系用户数据安全与核心功能可用性，改动量小。
2. **近期**：P2-5（同步冲突死信/合并）、P2-1（消除 content/lib 正则漂移）、P2-2（语言标签转义 + settings 白名单校验）。
3. **发布前**：P2-3（权限收敛评估）、P2-9（Anki 转义）、P3-1/P3-2（文档更新，尤其 README 构建前置步骤）。
4. **排期跟进**：P2-6（同步合并策略，属架构演进）、P2-4（token 存储风险文档化）、P3 余项。

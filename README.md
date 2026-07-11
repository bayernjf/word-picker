# WordPicker

一个基于 Chromium Manifest V3 的浏览器扩展：按住 `Ctrl` 悬停英文单词即可查词翻译，并支持一键收藏到本地单词本。

## 功能

- 按住 `Ctrl` 进入查词模式，鼠标悬停英文单词触发翻译
- 使用 Shadow DOM 渲染悬浮弹窗，避免页面样式污染
- 一键保存单词、句子上下文、来源地址与标题
- Popup 页面支持搜索、删除、导出 `JSON / CSV`
- Options 页面支持配置查词键、悬停延迟、免费翻译源与缓存上限
- 使用 `chrome.storage.local` 存储单词本、设置与翻译缓存

## 开发使用

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 选择"加载已解压的扩展程序"
4. 选择当前项目目录
5. 默认即使用免费公开接口，无需额外填写 `App Key` 或 `App Secret`

## 离线词库

项目内置 `data/ecdict.mini.csv`（基于 [ECDICT](https://github.com/skywind3000/ECDICT) 开源词库，MIT 协议），包含按词频排序的 Top 100k 词条，满足日常构建需求。

### 构建词库

```bash
npm run build:dict
```

默认使用仓库内置的 `data/ecdict.mini.csv`，生成 `assets/dict/ecdict.min.json`。

### 更新词库到最新版本

如需使用 ECDICT 上游最新数据重建词库：

1. 从 [ECDICT Releases](https://github.com/skywind3000/ECDICT/releases) 下载完整版 CSV
2. 重命名为 `ecdict.csv` 放到 `data/` 目录（该文件已在 `.gitignore` 中排除，不会入库）
3. 执行 `npm run build:dict`，脚本会自动优先使用完整版 `ecdict.csv`

## 目录

- `manifest.json`：扩展清单
- `content/`：内容脚本与弹窗样式
- `service/`：Service Worker
- `popup/`：单词本 Popup 页面
- `options/`：设置页
- `lib/`：共享存储、缓存与翻译逻辑
- `data/`：离线词库 CSV 原料（`ecdict.mini.csv` 入库，`ecdict.csv` 本地排除）
- `tests/`：手动测试清单

# Bangumi 保管库

**Bangumi 保管库** 是一个本地优先的 Bangumi 收藏备份工具。它可以把 Bangumi 收藏条目同步到本地，支持封面缓存、离线备份、导出表格和恢复数据。

> 本项目是独立第三方工具，不隶属于 Bangumi，也不代表 Bangumi 官方。

<img width="2468" height="1466" alt="界面1" src="https://github.com/user-attachments/assets/124161de-a6ad-4f16-8b98-d03b39ca6ab1" />
<img width="2468" height="1534" alt="界面2" src="https://github.com/user-attachments/assets/f9881869-4f98-412c-bcba-722a85cf9587" />
UI我还是挺满意的（确信

## 下载与使用

### 推荐：Windows 安装版

普通用户建议在 GitHub Releases 下载：

- `Bangumi-Vault-0.29.0-win-x64.exe`

这是已经编译完成的 Windows 安装版，双击安装即可使用。

### 源码版

有能力修改、二次开发或自行打包的用户，可以下载源码压缩包：

- `Bangumi-Vault-v0.29.0-source.zip`

源码版需要先安装 Node.js LTS，然后运行：

```bash
npm install
npm start
```

Windows 用户也可以双击：

```text
Start-BangumiVault-Desktop.cmd
```

### 在线网站版

在线体验地址：

https://akibangumibackup.netlify.app

在线版是纯前端版本，不需要安装。它适合临时查看、简单同步和导出备份，但与桌面版相比有一些限制：

- 不能把封面缓存到本地文件夹；
- 不能使用桌面端的 `资料库/封面缓存`、`资料库/备份` 等本地目录能力；
- 数据保存在浏览器本地存储中；
- 清理浏览器缓存或网站数据可能会清空本地数据；
- 建议定期使用应用内“导出备份”保存自己的数据。

## 名称说明

- 应用显示名：**Bangumi 保管库**
- 仓库名 / 包名：`bangumi-vault`
- Windows 发布文件名：`Bangumi-Vault-...`

中文名用于界面和普通用户看到的地方；`Vault` 用于仓库、包名、文件名和自动化脚本，避免跨平台路径、终端编码和自动化工具兼容问题。

## 功能

- 同步 Bangumi 收藏条目；
- 区分备份「我的标签」和条目「公共标签」；
- 支持点击标签在本地筛选，公共标签可跳转到 Bangumi 标签页；
- 支持为当前筛选结果补全公共标签；
- 本地保存收藏数据到 `资料库/收藏数据.json`；
- 本地缓存封面到 `资料库/封面缓存/`；
- 支持导入、导出和完整备份；
- 支持导出 JSON、CSV、Excel、Word、离线 HTML 和完整 ZIP；
- Electron 独立桌面窗口运行，不需要手动打开浏览器；
- 提供纯前端在线版，方便临时使用。

## 桌面版数据目录

桌面版默认使用项目目录下的中文资料库目录：

```text
资料库/
  收藏数据.json
  封面缓存/
  备份/
  日志/
```

旧版本使用的 `VaultData/` 会在启动时自动迁移到新的 `资料库/`，原目录不会被删除。

## Windows 打包

```bash
npm run dist:win
```

或者双击：

```text
Build-Windows-Desktop.cmd
```

打包结果会生成在 `dist/` 目录。发布给普通用户时，建议优先发布 `dist/` 中生成的安装包，而不是让普通用户下载源码运行。

## 目录说明

```text
app/                         前端页面
build/                       应用图标资源
docs/                        文档与发布说明
scripts/                     开发和打包辅助脚本
server/                      旧版本地服务脚本，保留作兼容/参考
资料库/                       本地用户数据，默认不提交到 Git
```

## 给开发者

欢迎 Fork、修改、二次开发和提交 Pull Request。本项目使用 MIT License 开源，允许自由使用、复制、修改、分发和再授权，只要保留许可证和版权声明。

开发建议：

```bash
npm install
npm start
npm run check
```

## GitHub Release 建议

每次发布建议同时上传：

1. Windows 安装版：`Bangumi-Vault-0.29.0-win-x64.exe`  
   推荐普通用户下载。
2. 源码压缩包：`Bangumi-Vault-v0.29.0-source.zip`  
   给开发者或想自行修改的人使用。
3. Release notes：说明桌面版、源码版、在线版的差异。

## 开源许可

Copyright (c) 2026 AKISATO

本项目以 [MIT License](LICENSE) 开源。任何人都可以使用、复制、修改、合并、发布、分发、再授权或出售本软件副本，只要保留许可证和版权声明。

项目作者与声明见 [AUTHORS.md](AUTHORS.md) 和 [NOTICE](NOTICE)。

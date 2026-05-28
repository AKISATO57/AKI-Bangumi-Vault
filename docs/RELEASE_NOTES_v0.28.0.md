# Bangumi 保管库 v0.28.0

## 推荐下载

### Windows 安装版

- `Bangumi-Vault-0.28.0-win-x64.exe`

推荐普通用户下载这个文件。双击安装后即可作为桌面应用使用。

### 源码压缩包

- `Bangumi-Vault-v0.28.0-source.zip`

适合想要查看源码、修改功能或自行打包的用户。

### 在线网站版

- https://akibangumibackup.netlify.app

在线版是纯前端版本，除了封面缓存到本地目录等桌面功能不可用，其他简单同步和导出备份功能可以临时使用。数据保存在浏览器本地存储中，删除浏览器缓存或网站数据可能会清空。

## 主要变化

- 桌面端改为 Electron 独立窗口；
- 应用显示名改为「Bangumi 保管库」；
- 使用粉色电视图标作为窗口和任务栏图标；
- 顶部标题栏与网页界面融合；
- 本地数据目录中文化为 `资料库/`；
- 整理 README、LICENSE、NOTICE、AUTHORS、CONTRIBUTING、SECURITY 等开源发布文件；
- 准备 GitHub Actions Windows 打包流程。

## 注意事项

- 本项目是独立第三方工具，不隶属于 Bangumi，也不代表 Bangumi 官方。
- 请妥善保管自己的 Access Token 和导出备份文件。
- 从源码运行需要安装 Node.js LTS。


## v0.29.9

- 重新整理设置窗口为更紧凑的横向布局，折叠高级网络设置时尽量一屏显示。
- 项目链接移动到底部信息栏，降低视觉权重。
- 优化高级网络设置展开动画和设置项对齐。

## v0.29.7

- 新增高级网络设置：API 地址、图片反代地址、Bangumi 站点地址。
- 默认登录与收藏同步仍使用官方 api.bgm.tv；可手动开启“收藏同步 / 登录也使用自定义 API”。
- 公共标签等公开条目信息可使用自定义 API。
- 支持将 lain.bgm.tv / bgm.tv 图片地址改写到自定义图片反代。
- 支持将“打开 Bangumi”和标签跳转改到自定义站点镜像。
- 设置页增加 Access Token 经第三方反代的安全提示。


## v0.29.1 - Time fields and public tag refresh preview

- Refresh public tags for the current filtered result set instead of only filling empty tags.
- Add separated time fields for collection marked time, collection update time, comment time, first backup time, and local sync time.
- Include new time fields in exports.

# Changelog

## v0.29.4

- 公共标签改为纯 API 获取，不再抓取 Bangumi 官网页面。
- 标签区保持命名为「公共标签」。
- 将详情页「Bangumi记录更新」改名为「API更新时间」。
- 明确 API 标签可能与网页展示略有差异。


## v0.29.0

- 新增「我的标签 / 公共标签」分离显示。
- 新增「补全公共标签」按钮，可为当前筛选结果逐条读取 Bangumi 条目公共标签。
- 标签筛选侧栏支持按「我的标签」和「公共标签」分别筛选。
- 条目详情页新增公共标签区，公共标签支持跳转到 Bangumi 标签页。
- JSON、CSV、Excel、Word、离线 HTML 和完整 ZIP 导出会保留我的标签、公共标签与全部标签。

## v0.28.0

- 桌面端改为 Electron 独立窗口。
- 应用显示名改为「Bangumi 保管库」。
- 使用粉色电视图标作为窗口和任务栏图标。
- 顶部标题栏与网页界面融合。
- 本地数据目录中文化为 `资料库/`。
- 支持旧版 `VaultData/` 自动迁移到 `资料库/`。
- 整理 GitHub 开源发布文件。
- 增加在线网站版说明：https://akibangumibackup.netlify.app

## 历史版本

历史变更记录见 `docs/CHANGELOG_v0.xx.txt`。

## v0.29.10

- 修正设置界面横向布局、边框错位与输入框对齐。
- 调整账号与同步区域高度，减少空白。
- 高级网络设置改为独立折叠条，不影响其它卡片边框。
- 底部 GitHub / Bangumi 图标放大并增强可读性。
- 新增主题色选项。
- 将“同步最近”按钮改为轻量紫色样式。

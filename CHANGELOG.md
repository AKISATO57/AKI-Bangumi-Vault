
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

# Windows 发布流程

## 本地打包

1. 安装 Node.js LTS。
2. 运行：

```bash
npm install
npm run dist:win
```

也可以双击：

```text
Build-Windows-Desktop.cmd
```

输出目录：

```text
dist/
```

## 发布前检查

- 不要把 `node_modules/`、`dist/`、`.npm-cache/` 提交到 Git。
- 不要把真实的 `资料库/收藏数据.json`、封面缓存、备份、Access Token 提交到 Git。
- Release 页面建议上传安装包和便携版 exe。
- 如果开发模式任务栏图标仍显示旧图标，取消固定旧图标、换新目录运行，或运行打包后的 exe。

## 开源声明

项目采用 MIT License。发布源码时请保留：

- `LICENSE`
- `NOTICE`
- `AUTHORS.md`

Copyright (c) 2026 AKISATO。

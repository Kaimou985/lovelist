# 恋爱 100 件小事

一个为 iPhone 优化的离线 PWA，包含恋爱清单、完成回忆、照片、约会账本和本地备份。

## 特性

- 内置分类整理的 100 件恋爱小事
- 完成日期、地点、心情、文字和照片记录
- 约会账本与月度分类统计
- IndexedDB 本地存储，无账号、无服务器
- Service Worker 离线运行
- JSON 完整备份和恢复
- iPhone 主屏幕安装和安全区域适配

## 本地预览

PWA 功能需要通过 HTTP 访问，不能直接双击 `index.html`。任选一种静态服务器：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080`。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库。
2. 将本目录所有文件推送到仓库的 `main` 分支。
3. 进入仓库 `Settings → Pages`。
4. 在 `Build and deployment → Source` 中选择 `GitHub Actions`。
5. 等待 `Deploy static PWA to GitHub Pages` 工作流完成。

站点内资源全部使用相对路径，因此既支持用户名主页仓库，也支持普通项目仓库。

## iPhone 安装

1. 使用 Safari 打开部署后的 HTTPS 地址。
2. 点击 Safari 的分享按钮。
3. 选择“添加到主屏幕”。
4. 从主屏幕打开应用；完成首次缓存后即可离线使用。

> 用户照片和记录仅存在当前设备的浏览器存储中。清理 Safari 网站数据或删除主屏幕应用可能造成数据丢失，请定期在“我们 → 数据备份”中导出 JSON 文件。

# Youtube-Obsidian-Clipper｜一键保存油管站字幕

在有关视频页抓取字幕，预览后可复制 Markdown、下载字幕文件，并一键写入 Obsidian（Local REST API）。

## 功能

- 油管英文视频字幕抓取
- 字幕预览、复制 Markdown
- 下载字幕文件（`srt/txt`）
- 保存到 Obsidian（Local REST API）

### 阅读视图（v1.0.18+）

沉浸式布局，支持排版调整、主题切换、字幕同步等。

> 稍后再看页面的阅读视图体验尚不完善，推荐在普通视频页使用。

### AI 侧边栏（v1.1.0+）

支持围绕当前视频字幕进行轻量对话，也可在普通网页中作为通用 AI 对话侧边栏使用。

内置历史对话、预设提示词、模型切换等能力，适合快速总结、整理与提炼视频内容。

## 安装方式

1. Chrome:`chrome://extensions/` → 右上角开 开发者模式 → 加载已解压的扩展程序 → 选`release/youtube-obsidian-clipper-v1.0.0-chrome` 文件夹
2. 以后改了代码只需点扩展卡片上的 🔄 Reload

## Obsidian 配置

1. 在 Obsidian 社区插件市场安装并启用 `Local REST API with MCP`
2. 在插件设置中勾选 `Enable Non-encrypted (HTTP) Server`
3. 复制插件页面里的 API Key
4. 在扩展设置页填写 `Local REST API 地址`、`API Key`、`笔记目录`

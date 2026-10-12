# LinuxDo Star ⭐ - 收藏助手

> **学 AI 上 L 站，好帖不错过。**

为 [linux.do](https://linux.do) 打造的浏览器扩展，让你轻松收藏帖子和评论。

## 功能

### 核心收藏
- **帖子收藏** — 标题旁 + 操作栏都有星标按钮，一键收藏
- **评论收藏** — 每条评论操作栏（❤️ 旁边）都有星标，收藏评论自动关联帖子
- **自动 Markdown 归档** — 点击收藏时抓取当前帖子/评论正文并转成 Markdown
- **图片存档** — 收藏时普通图片按内容哈希转成 Base64 资源并去重，表情图片跳过归档并保留原始链接
- **Markdown 导出** — 页面只提供一个帖子导出按钮，生成包含主贴和全部评论的 ZIP；Markdown 与图片分开存放，图片按队列处理并显示进度
- **外部保存** — 帖子页、管理页和 Popup 的帖子旁都可将主贴与全部评论保存到 Obsidian、Notion 或飞书；外部保存与 ZIP 共用同一份内容构建逻辑
- **Obsidian 图片** — 可选通过 Local REST API 将归档图片写入 Vault 的 `media` 目录；未配置时保留图片原链接
- **Notion / 飞书去重** — Notion 按 URL 查询已有页面，飞书按帖子链接匹配已有记录后更新，避免重复保存
- **大帖读取** — 评论按每批 100 条读取，批次间隔请求；遇到 429 或服务端错误会按 `Retry-After` 和指数退避重试
- **归档设置** — 管理页「收藏设置」可开关收藏时的正文存档，默认开启；存档只写入收藏数据，不会自动下载文件
- **收藏夹分类** — 创建多个收藏夹（技术、职场、生活…），归类管理
- **悬浮选择器** — 鼠标悬停星标 500ms 弹出收藏夹选择器，支持搜索和快速新建

### 管理
- **Popup 预览** — 点击扩展图标快速浏览收藏，按收藏夹分组，可折叠展开
- **独立管理页** — 完整的收藏管理：搜索、排序、标签、备注、详情面板
- **导入/导出** — 所有导出入口统一生成包含 Markdown 与图片的 ZIP 文档；导入仍支持 JSON 备份文件

### 同步
- **GitHub Gist 同步** — 通过私有 Gist 跨设备同步收藏数据
- **自动同步** — 收藏变更 30s 后自动上传 + 每 30 分钟定时拉取
- **智能合并** — 多设备冲突时取并集，单条目以最新修改为准，不丢数据

## 安装

1. Clone 本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」→ 选择本项目目录
5. 访问 linux.do 任意帖子页面即可使用

## 使用

### 收藏操作
| 操作 | 效果 |
|------|------|
| **点击**星标按钮 | 收藏到默认收藏夹 |
| **悬停** 500ms | 弹出收藏夹选择器 |
| 选择器中选择收藏夹 | 收藏到指定收藏夹 |
| 再次**点击**已收藏的星标 | 取消收藏 |

### 同步设置
1. 打开管理页面（popup 右上角网格图标 → "管理全部"）
2. 点击侧边栏「☁️ 同步设置」
3. 输入 GitHub Personal Access Token（需要 `gist` scope）
4. 点击「连接 GitHub」
5. 完成！之后会自动同步

> Token 创建：[GitHub Settings → Tokens → New](https://github.com/settings/tokens/new?scopes=gist&description=LinuxDo+Star+Sync)，勾选 `gist` 权限即可

### 保存到外部服务
1. 打开管理页，进入「收藏设置」
2. 配置需要使用的目标：
   - **Obsidian**：填写 Vault 名称和文件夹；需要本地保存图片时，再填写 Local REST API 插件的 API Key 和端口
   - **Notion**：填写 Internal Integration Token 和 Database ID，并将 Integration 连接到 Database
   - **飞书**：填写自建应用的 App ID / Secret、多维表格 `app_token` 和 `table_id`
3. 在帖子标题旁、管理页帖子卡片或 Popup 帖子旁点击「保存到外部」，选择一个或全部已配置目标

Notion Database 推荐准备 `标题`（Title）、`链接`（URL）、`作者`、`分类`、`标签`、`保存日期` 和 `评论数` 属性。飞书多维表格默认使用 `标题`、`链接`、`作者`、`保存时间`、`评论数` 和 `正文` 字段；Markdown 附件为可选项。

## 项目结构

```
LinuxDoStar/
├── manifest.json       # Chrome MV3 扩展配置
├── markdown.js         # HTML → Markdown 转换与链接处理
├── integrations.js     # 页面侧外部保存与 Obsidian URI
├── integrations-esm.js # 后台 Notion / 飞书 API 与 Obsidian REST API
├── storage.js          # 数据结构 & 持久化
├── sync.js             # GitHub Gist 同步模块
├── background.js       # Service Worker (badge + 同步调度)
├── content.js          # 内容脚本 (注入星标到页面)
├── content.css         # 注入样式
├── popup.html/css/js   # 弹窗预览
├── manage.html/css/js  # 独立管理页面
└── icons/              # 扩展图标
```

## 数据结构

```jsonc
{
  "collections": {
    "default": { "id": "default", "name": "默认收藏夹", "icon": "⭐", ... },
    "col_xxx": { "id": "col_xxx", "name": "技术文章", "icon": "💻", ... }
  },
  "assets": {
    "asset_<sha256>": {
      "id": "asset_<sha256>",
      "mimeType": "image/png",
      "dataUrl": "data:image/png;base64,...",
      "originalUrl": "https://linux.do/uploads/...",
      "originalUrls": ["https://linux.do/uploads/..." ]
    }
  },
  "bookmarks": {
    "topic_2066807": {
      "topicId": 2066807,
      "topicTitle": "帖子标题",
      "topicUrl": "https://linux.do/t/topic/2066807",
      "collectionId": "default",
      "contentMarkdown": "帖子正文 Markdown（图片使用 asset:// 引用）...",
      "contentCapturedAt": "2026-06-10T11:30:00.000Z",
      "starred": true,
      "tags": ["标签"],
      "note": "我的备注",
      "posts": {
        "post_12": {
          "postNumber": 12,
          "author": "username",
          "excerpt": "评论内容摘要...",
          "contentMarkdown": "评论正文 Markdown（图片使用 asset:// 引用）...",
          "contentCapturedAt": "2026-06-10T11:30:00.000Z"
        }
      }
    }
  }
}
```

## 技术细节

### Discourse 虚拟滚动适配
Discourse 使用虚拟滚动回收 DOM 节点，传统 MutationObserver 不够可靠。本扩展使用三重检测策略：
1. **MutationObserver** — 监听 `#main-outlet` 子树变化
2. **Scroll 监听** — 滚动时 300ms 防抖扫描缺失的星标
3. **定时轮询** — 每 5 秒兜底检查

### 合并算法
同步时使用 union-merge 策略：
- Collections 和 Bookmarks 取并集
- 同一条目冲突时比较 `updatedAt` 时间戳，保留较新版本
- 不会丢失任何一端的数据

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 本地存储收藏数据 |
| `unlimitedStorage` | 为 Base64 图片归档提供更大的本地存储配额 |
| `activeTab` | 读取当前页面信息 |
| `alarms` | 定时同步调度 |
| `linux.do` | 注入收藏按钮、读取帖子与图片 |
| `http://*/*` / `https://*/*` | 通过后台请求跨域图片并归档 |
| `api.github.com` | Gist 同步 API |
| `api.notion.com` | Notion Database / Page API |
| `open.feishu.cn` / `open.larksuite.com` | 飞书 / Lark 多维表格 API |

## License

MIT

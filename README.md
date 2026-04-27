# LinuxDo Star ⭐ - 收藏助手

> **学 AI 上 L 站，好帖不错过。**

为 [linux.do](https://linux.do) 打造的浏览器扩展，让你轻松收藏帖子和评论。

## 功能

### 核心收藏
- **帖子收藏** — 标题旁 + 操作栏都有星标按钮，一键收藏
- **评论收藏** — 每条评论操作栏（❤️ 旁边）都有星标，收藏评论自动关联帖子
- **收藏夹分类** — 创建多个收藏夹（技术、职场、生活…），归类管理
- **悬浮选择器** — 鼠标悬停星标 500ms 弹出收藏夹选择器，支持搜索和快速新建

### 管理
- **Popup 预览** — 点击扩展图标快速浏览收藏，按收藏夹分组，可折叠展开
- **独立管理页** — 完整的收藏管理：搜索、排序、标签、备注、详情面板
- **导入/导出** — JSON 格式，方便备份和迁移

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

## 项目结构

```
LinuxDoStar/
├── manifest.json       # Chrome MV3 扩展配置
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
  "bookmarks": {
    "topic_2066807": {
      "topicId": 2066807,
      "topicTitle": "帖子标题",
      "topicUrl": "https://linux.do/t/topic/2066807",
      "collectionId": "default",
      "starred": true,
      "tags": ["标签"],
      "note": "我的备注",
      "posts": {
        "post_12": {
          "postNumber": 12,
          "author": "username",
          "excerpt": "评论内容摘要..."
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
| `activeTab` | 读取当前页面信息 |
| `alarms` | 定时同步调度 |
| `linux.do` | 注入收藏按钮 |
| `api.github.com` | Gist 同步 API |

## License

MIT

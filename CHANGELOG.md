# Changelog

## 1.0.0 — 2026-09-18

Amadeus 1.0 建立后续开发与部署基线。

### 文档与预览

- PDF、Word、PowerPoint 分页阅读，支持文字层、缩放、跳页、移动端手势和大文件 Range 请求。
- Office 文件通过 ONLYOFFICE Document Builder 转为可缓存的 PDF 阅读版本。
- Markdown 安全渲染、KaTeX 公式、同标签及并排预览和打印导出。
- 浏览器 SwiftLaTeX XeTeX/dvipdfmx 编译，支持中文、`ctexart`、常用 TikZ、PDF 文字层和下载。

### 编辑与同步

- CodeMirror 6 文本编辑、语法高亮、自动换行、字号控制、撤销/重做和保存快捷键。
- 未保存状态、关闭确认、文件轮询与服务器变更自动刷新。
- 基于文件版本的原子保存、自动合并和 CodeMirror 三方冲突编辑。

### 对话与工作区

- 文件和对话选区注释、注释胶囊、回答引用、悬浮详情与原文荧光定位。
- 项目文件上传、下载、ZIP、删除和目录轮询。
- 持久终端 WebSocket、输入合并与会话恢复。
- Amadeus 品牌、Logo、主题和 `El Psy Kongroo` 首页。

### 部署与安全

- Basic 认证、HTTPS/nginx 模板、systemd 模板与单用户权限模型。
- 工作区边界、符号链接逃逸防护、上传与预览大小限制。
- Node.js 24 构建、四个独立 DSH 插件包和完整测试基线。

### 破坏性变更

- 项目自有命名空间统一为 `amadeus`。
- 配置文件改为 `amadeus.local.yml`，覆盖变量改为 `AMADEUS_CONFIG`。
- HTTP 路由改为 `/amadeus/*`，插件 ID、缓存键和 DOM 扩展点同步更名。
- 默认数据目录改为 `.amadeus/dsh-home`，DSH Profile 改为 `amadeus`。
- systemd 单元改为 `amadeus.service`，推荐应用目录为 `/opt/amadeus` 或 `/srv/amadeus`。

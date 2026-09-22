# Changelog

## 1.1.0-alpha.1（预发布）

基于 `@deepseek-ai/dsh@0.1.6-alpha.2` 的兼容重写，删除与 DSH 原生能力重复的代码。

### 移除（由 DSH 原生能力替代）

- 移除 `open_sidebar` 主动工具及配套 SSE 通道：原生侧栏已默认预览文件引用。
- 移除 terminal 插件：原生侧栏终端支持多标签、刷新恢复与系统用户权限。
- 移除 ONLYOFFICE 转换链路（`convert.mjs`、`onlyoffice.mjs`、`pdf-http.mjs`、`/amadeus/preview` 路由、预览缓存与分页阅读器）：原生 `dsh-office-to-pdf` 使用 LibreOffice 引擎转换 Office 文件，原生 PDF/Office 预览自带可选择文字层，并支持 Excel。
- 移除配置项 `onlyOffice*`、`previewWorkers`、`previewTimeoutMs`、`previewCacheVersion`、`maxPreviewBytes`。

### 新增

- 为原生侧栏 PDF/Office 文字层注入固定半透明蓝选中色 `rgba(68,118,254,.45)`，替代几乎不可见的主题悬停色（需 `!important` 以压过后插入的懒加载 PDF 样式）。
- 注释引用点击跳转在原生 PDF 预览内按 `data-pdf-page` 定位到原页；原生预览内的文字选区自动记录页码。
- files 插件新增 `PUT /amadeus/files/artifact`：编译产物等自生成文件的无条件覆盖写入（原子临时文件 + 改名，受 `maxUploadBytes` 限制）。
- LaTeX「编译为 PDF」：编译结果写入工作区同名 `.pdf`，并作为普通文件交给原生侧栏预览（文字层 + 蓝色选中），与手动上传的 PDF 走同一条渲染路线。

### 移除（LaTeX 自带查看器）

- 删除 `GeneratedPdfPreview` 及其缩放、页码跳转、双指缩放控件，连带 `latex-preview.jsx`、`page-control.*`、`scroll-page.mjs`、`loading.*`、`usePdfPinchZoom`、`currentPageAt`。
- 移除 `pdfjs-dist` 依赖与 reader 资产中的 pdf.worker/cmaps/standard_fonts/wasm 拷贝；reader 资产只保留 SwiftLaTeX 与 KaTeX。

### 兼容适配（0.1.6-alpha.2 破坏性变更）

- 会话多实例：`sessions.list` 快照不再含 `current`，改为从 Amadeus 渲染的会话级表面捕获活跃会话。
- `sidebarRight.mounted()` 已移除，「编译并在右侧打开预览」改为记忆分栏并在失败时重新分栏。
- 首页标题 `El Psy Kongroo` 改为文本节点替换（locale 词典由命名空间所有者独占注册，`main.conversation` 不再透传 `t`）。
- 编辑器接管逻辑保留：原生 `text` 标签页中可编辑文档仍由 CodeMirror 编辑器渲染，PDF/Office 完全交回原生预览。

### 版本

- 工作区与 Reader 1.1.0-alpha.1；Files 1.0.3；login 保持 1.0.1。

## 1.0.3 - 2026-09-21

- 修复 Markdown「编译并在右侧打开预览」触发的文档状态反复创建、加载和渲染，以及由此导致的浏览器卡死和内存持续增长。
- 文档回收同时检查正文持有者和订阅者；分屏切换时将回收延迟到微任务，并再次核对引用状态，允许同一次 React 更新中的卸载与重挂载复用记录。
- 回收前确认缓存中的对象仍是原记录，防止旧记录的清理回调误删新记录；保留未保存和正在保存的文档。
- 通知订阅者时遍历集合快照，避免监听器在通知期间取消并重新订阅后，被同一轮 Set 遍历反复调用。
- 重复打开并排预览时复用已有分栏，并在分栏更新后再打开预览，避免连续点击产生重复预览。
- 增加分屏重挂载、多个活跃文档、旧记录清理和订阅重入回归测试。
- 工作区和 Reader 版本更新为 1.0.3；其他插件保留各自版本。

## 1.0.1 — 2026-09-19

- 将 DSH WebSocket 心跳间隔从 2 秒调整为 15 秒，连续两次漏回后约 30 秒才判定连接失效。
- 保留断线检测和自动重连，同时降低公网短暂抖动、浏览器暂停或网络切换引发的误断线。
- 目录与文本轮询行为保持不变。

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

# CoFolio

![dsh](https://img.shields.io/badge/dsh-0.1.6--alpha.1-536DFE)
![Node.js](https://img.shields.io/badge/Node.js-24%2B-43853D)
![version](https://img.shields.io/badge/CoFolio-0.1.0-blue)

面向学习资料阅读的 **DeepSeek Harness（dsh）插件集**。在自己的服务器上阅读文档、选中文字向 agent 提问，并管理项目文件。界面沿用 dsh 的样式与明暗主题。

适配版本固定为 `@deepseek-ai/dsh@0.1.6-alpha.1`。标签：`dsh` · `dsh-plugin` · `deepseek-harness` · `document-preview`。

## 功能

| 插件 | 功能 |
| --- | --- |
| `dsh-cofolio-login` | 浏览器原生账密登录；服务器 YAML 配置；认证后允许远程修改 dsh 设置 |
| `dsh-cofolio-terminal` | 持久 WebSocket 输入与控制；高延迟时合并按键；保留原生输出通道 |
| `dsh-cofolio-files` | 上传文件/文件夹、保留结构；文件下载、文件夹 ZIP；重名询问与删除确认 |
| `dsh-cofolio-reader` | PDF、Word、PPT 分页阅读、选中文字与来源注释；保留原生 Markdown 和代码渲染 |

选区旁点击“添加到对话”，填写可选问题并点圆形勾确认；点击其他位置取消。多条注释收成一个小胶囊，悬浮展开；发送后胶囊位于消息上方。文件注释包含原文件路径和页码，对话注释包含原文与消息定位。

Office 阅读链路：**PPT/PPTX、DOC/DOCX → ONLYOFFICE Document Builder → PDF.js 页面与文字层**。原文件不修改。Excel 暂不接入；在线文本编辑、LaTeX 排版及 OCR 不在当前版本中。

## Linux 直接部署

需要 Node.js 24+、npm，以及 ONLYOFFICE Document Builder。建议以独立普通用户运行。

### 安装转换器

从 [ONLYOFFICE Document Builder 官方下载页](https://www.onlyoffice.com/download-builder.aspx) 获取适合服务器架构的 Linux 安装包。Ubuntu/Debian 安装下载的包，例如：

```bash
sudo apt install ./onlyoffice-documentbuilder*.deb
sudo apt install fonts-noto-cjk fonts-liberation
sudo fc-cache -f
```

找到实际的 `docbuilder` 路径并填入配置；常见位置为 `/opt/onlyoffice/documentbuilder/docbuilder`。无需安装 LibreOffice、Python UNO，也无需启动 ONLYOFFICE Docs 编辑服务。

字体会影响布局与 Word 分页。服务器应安装文档使用的字体或合适替代字体；中文文档至少安装 CJK 字体，自备字体需有使用许可。

### 安装和启动

```bash
git clone https://github.com/whyself/CoFolio.git
cd CoFolio
npm ci
npm run build
cp cofolio.example.yml cofolio.local.yml
chmod 600 cofolio.local.yml
```

私有仓库克隆前需登录有访问权限的 GitHub 账号。编辑 `cofolio.local.yml`：

```yaml
username: your-name
password: 'replace-with-a-long-random-password'
host: 127.0.0.1
port: 3080
onlyOfficeMode: native
onlyOfficeBuilder: /opt/onlyoffice/documentbuilder/docbuilder
previewWorkers: 1
```

执行 `npm start`，访问 `http://127.0.0.1:3080`，浏览器会弹出账密输入框。登录后在 dsh 设置中配置模型，再选择服务器上的项目目录。登录密码与模型 API 密钥分别管理。

需要直接访问服务器端口时把 `host` 改为 `0.0.0.0`；公网部署建议保留回环监听，并使用 HTTPS 反向代理。Basic 认证依赖 HTTPS 保护传输。

### systemd 和 HTTPS

[deploy/cofolio.service](deploy/cofolio.service) 默认使用 `/srv/cofolio` 和 `cofolio` 用户。将项目部署到该目录，创建服务用户并设置项目权限，核对 Node 的路径，然后：

```bash
sudo cp deploy/cofolio.service /etc/systemd/system/cofolio.service
sudo systemctl daemon-reload
sudo systemctl enable --now cofolio
sudo journalctl -u cofolio -f
```

将 [deploy/nginx.conf.example](deploy/nginx.conf.example) 放入已有 HTTPS `server` 块，并配置域名与证书。模板包含 WebSocket、长连接和上传大小设置。不要同时暴露另一套没有认证的 dsh 服务。

`COFOLIO_CONFIG=/absolute/path/config.yml` 可指定外部配置。路径字段建议使用绝对路径。

## 可选：Docker 按需转换

CoFolio 仍直接在主机运行，仅转换任务使用 Docker。CoFolio 服务用户必须能访问 Docker daemon。

```bash
docker pull onlyoffice/documentserver@sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212
```

```yaml
onlyOfficeMode: docker
previewWorkers: 1
# 自备字体目录，只读挂载：
# onlyOfficeFontsDir: /srv/cofolio/fonts
```

默认锁定已验证的 ONLYOFFICE 9.4.0 镜像。每次只启动其中的 `docbuilder`，任务完成后删除容器，不启动编辑器、数据库或 HTTP 服务，无需开放 8082 端口。容器禁用网络，仅挂载当前任务目录和可选字体目录。默认每个任务最多 2 GiB 内存、2 CPU、128 个进程。Linux 使用宿主服务用户的 UID/GID。

此模式仍使用完整官方 Docs 镜像，磁盘占用较大（本机约 4.9 GB）；追求更小安装体积时选原生 Document Builder。转换高峰仍消耗内存，默认同时只处理一份文档。

## 缓存和配置

默认数据目录保持为 `<项目>/.cofolio/dsh-home`，**预览缓存保持为 `<home>/preview-cache`**。升级时沿用原来的 `home`，其中也保存会话与模型配置。

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `previewWorkers` | `1` | 同时转换数，1–4；任务完成后进程退出 |
| `previewTimeoutMs` | `120000` | 转换超时，毫秒 |
| `previewCacheVersion` | `'1'` | 原生转换器升级或字体更换后递增，使旧 PDF 失效 |
| `maxPreviewBytes` | `104857600` | 原文档及输出 PDF 上限，100 MiB |
| `maxUploadBytes` | `1073741824` | 单个上传文件上限，1 GiB |
| `sessionHours` | `12` | WebSocket 登录凭据有效期 |

首次打开时转换并缓存；原文件不变时直接命中 PDF，相同内容复用转换，并发请求合并。PDF 缓存默认约 512 MiB，按生成时间淘汰旧结果；不会复用原 LibreOffice 输出。

清理时先停止 CoFolio，只删除 `<home>/preview-cache` 内的内容，再启动。**不要删除整个 home**，其中保存会话和模型凭据。下次打开 Office 文件会重新转换。

## 阅读与权限边界

- PDF.js 按需渲染页面和文字层，支持 Range、ETag、页码跳转和重新加载。Word 页码按转换后的 PDF 计算，PPT 每张幻灯片一页。
- 扫描件、图片文字不能直接选中。复杂公式、特效与字体替换可能导致显示差异。旧 DOC/PPT 可尝试读取，优先使用 DOCX/PPTX。
- 这是单用户工作台。登录用户能修改设置、操作项目文件及使用终端，应视为可信服务器用户；不提供多租户隔离。
- 文件操作限定在当前会话项目目录，拒绝目录越界和符号链接。文件夹 ZIP 包含隐藏文件。删除需确认，根目录不可删除。
- 支持目录选择 API 的安全上下文浏览器可保留空目录，其他浏览器回退到文件夹文件选择。
- 原生 Builder 以服务用户权限执行；Docker 模式额外限制转换网络与挂载。文档不会上传第三方转换网站。

## 开发和插件安装

```bash
npm test
npm run build
npm run pack:plugins
```

四个插件包位于 `.release/`。已有 dsh 环境可用 `dsh plugin --profile web add <包路径>` 安装，然后在该 Profile 的 `cordis.patch.yml` 中配置 `cofolio-webserver` 的 `username/password/host/port`，以及 `cofolio-reader` 的 `executable`（Builder 路径）、`mode`、`cacheDir`。运行 `dsh --profile web --no-open`。登录插件缺少账密时拒绝启动；独立安装的其他插件应位于受认证保护的服务之后。

真实转换测试：

```bash
COFOLIO_TEST_ONLYOFFICE=docker node --test tests/onlyoffice.test.mjs
# 或：
COFOLIO_TEST_ONLYOFFICE=native COFOLIO_TEST_BUILDER=/path/to/docbuilder node --test tests/onlyoffice.test.mjs
```

`tests/fixtures` 包含人工生成的两页 Word/PPT。测试覆盖认证、文件边界、上传/ZIP/删除、终端输入、注释、转换排队与超时、缓存和 Range；真实转换测试用 PDF.js 核对页数与文字。

浏览器集成已在 Windows + Docker Linux 转换器验证：PPTX/DOCX/PDF 阅读、选区注释、路径与页码、缓存及 Range。Linux 原生 Builder 和 systemd 模板仍需在目标服务器验证。

注释提示词结构见 [docs/codex-selection-format.md](docs/codex-selection-format.md)。插件包含 dsh 0.1.6 专用适配，升级 dsh 前需要重新验证。

仓库不附带 ONLYOFFICE 二进制或系统字体；相关第三方软件与字体遵循各自许可证。

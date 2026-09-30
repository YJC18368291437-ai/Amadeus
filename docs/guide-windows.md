# Windows 本地使用指南（从零开始）

**适合谁**：只有一台 Windows 电脑，想在本机直接把 Amadeus 用起来，不需要平板 / 手机远程。
**目标**：全程复制粘贴即可。装好后浏览器打开 `http://127.0.0.1:3080` 就能用。

> 如果你还想用 iPad 远程连这台电脑，请改看 [WSL + iPad 远程使用指南](guide-wsl-ios.md)。

---

## 0. 先准备

- Windows 10 / 11（64 位），建议内存 8GB 以上。
- 能上网。第一次启动要下载不少东西（code-server、扩展、镜像层），慢是正常的。
- 需要用「管理员」身份安装软件。

整个过程分为 6 步。**每一步做完再做下一步，不要跳。**

---

## 1. 安装 Docker Desktop

Amadeus 用 Docker 打包好了一切（Node.js、code-server、TeX Live），所以只要装 Docker 就行。

1. 打开 <https://www.docker.com/products/docker-desktop/> ，点 **Download for Windows**。
2. 双击下载的 `Docker Desktop Installer.exe`，一路「下一步」。
   - 安装选项里如果问 **Use WSL 2 instead of Hyper-V**，保持勾选。
3. 装完**重启电脑**。
4. 打开「Docker Desktop」。第一次会弹窗要你同意条款、可能要求登录，可以跳过登录。
5. 等左下角的小鲸鱼图标变绿、不再转圈，说明 Docker 已就绪。
6. 验证：按 `Win` 键，输入 `powershell` 打开 **Windows PowerShell**，输入：

   ```powershell
   docker --version
   ```

   能显示版本号（例如 `Docker version 27.x.x`）就算成功。

> **国内下载慢？** Docker Desktop 安装包本身可先在官网下载；镜像拉取慢的话，之后在 Docker Desktop 的
> **Settings → Docker Engine** 里可以换成国内镜像加速地址（例：`https://docker.mirrors.ustc.edu.cn`），
> 但多数情况下直连也能用。先按默认来，卡住了再考虑。

---

## 2. 安装 Git

1. 打开 <https://git-scm.com/download/win> ，下载并安装，全部用默认选项即可。
2. 回到 PowerShell，验证：

   ```powershell
   git --version
   ```

> **不想装 Git？** 也可以到项目网页点绿色的 **Code → Download ZIP**，解压到例如 `D:\Amadeus`，
> 然后跳过下面的 `git clone`，直接进到该文件夹操作。只是以后升级没 `git` 方便。

---

## 3. 下载本项目

在 PowerShell 里，先想好放哪儿（示例放 `D:\`）：

```powershell
cd D:\
git clone https://github.com/YJC18368291437-ai/Amadeus.git
cd Amadeus
```

---

## 4. 配置登录账号和密码

还在 `Amadeus` 目录里，依次执行：

```powershell
Copy-Item amadeus.docker.example.yml amadeus.local.yml
New-Item -ItemType Directory -Force workspace
```

然后用**记事本**打开 `amadeus.local.yml`（在文件上右键 → 打开方式 → 记事本），找到这一行：

```yaml
password: CHANGE-ME
```

把 `CHANGE-ME` 改成你自己的密码（`username` 想改也可以）。**密码不能留成 CHANGE-ME，否则启动会失败。**

保存并关闭。`workspace` 文件夹就是你以后放资料的地方，它对应你在网页里看到的文件。

---

## 5. 第一次启动

在 `Amadeus` 目录里执行：

```powershell
docker compose up -d --build
```

第一次构建比较久（10～30 分钟都可能），请耐心等待。想看进度：

```powershell
docker compose logs -f amadeus
```

当你看到类似 `dsh web: http://127.0.0.1:3080` 的日志时，就说明起好了。
按 `Ctrl + C` 只是**停止看日志**，不会关掉服务，可放心按。

---

## 6. 打开使用

1. 浏览器打开 <http://127.0.0.1:3080> 。
2. 用第 4 步设置的账号 / 密码登录。
3. 进入后：点左侧文件预览，点文件旁的编辑按钮进入内嵌编辑器；`Ctrl + S` 保存。
4. 第一次打开编辑器要等 code-server 和桥接扩展就绪，稍等几秒即可。

---

## 7. 日常维护

| 你想做的事 | 命令（都在 `Amadeus` 目录里执行） |
| --- | --- |
| 启动 | `docker compose up -d` |
| 停止 | `docker compose down` |
| 重启 | `docker compose restart amadeus` |
| 看日志 | `docker compose logs --tail=200 amadeus` |
| 看状态 | `docker compose ps` |

- 开机后 Docker Desktop 会自动启动；若服务没起来，手动执行一次 `docker compose up -d` 即可。
- 你的资料在 `Amadeus\workspace\` 里；会话、设置、扩展等保存在 Docker 数据卷 `amadeus-data` 里，不要删。
- 升级：在 `Amadeus` 目录执行 `git pull`，再 `docker compose up -d --build`（保留 `amadeus.local.yml` 和 `workspace\`）。

---

## 8. 常见问题

- **`docker` 命令找不到**：Docker Desktop 没启动，先打开它并等图标变绿。
- **打不开 127.0.0.1:3080**：先 `docker compose logs amadeus` 看有没有报错；多数是密码还留着 `CHANGE-ME`。
- **登录页一直转圈**：刷新页面重试；若仍不行，`docker compose restart amadeus`。
- **编辑器空白 / 一直加载**：等 code-server 就绪后刷新编辑器页面；仍然空白就 `docker compose restart amadeus`。
- **Office 文件预览空白**：扫描件没有文字层，属于正常；普通 Office 文件会由 LibreOffice 转成预览。

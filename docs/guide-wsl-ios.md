# WSL + iPad 远程使用指南（从零开始）

**适合谁**：有一台 Windows 电脑当「服务器」，想用 iPad / iPhone 在**任何地方**（校园网外也行）远程连上来用。
**本文是改良分支的重点场景，从一台「什么都没装」的电脑开始写。**

**原理（一句话）**：Windows 里跑一个 Ubuntu（WSL2），Ubuntu 里跑 Amadeus 和 code-server；
Windows 上和 iPad 上都装 Tailscale 并登录**同一个账号**，`tailscale serve` 把 `127.0.0.1:3080`
用 HTTPS 暴露给内网，iPad 用 Safari 打开那个网址即可。

> 如果你只在本机用、不需要 iPad 远程，请改看 [Windows 本地使用指南](guide-windows.md)（更简单）。

---

## 0. 先准备

- Windows 10 / 11（64 位），虚拟化已开启（`wsl --install` 会帮忙处理）。
- 一台 iPad / iPhone。
- 一个 Tailscale 账号（免费）：可用邮箱、Google、Microsoft 或 GitHub 注册。
- 能上网（首次下载较多）。

整件事分 5 部分，**按顺序做**。

---

## 第 1 部分：安装 WSL2 + Ubuntu

1. 右键左下角开始菜单 → 打开「**终端(管理员)**」（或「Windows PowerShell(管理员)」）。
2. 执行：

   ```
   wsl --install -d Ubuntu
   ```

   它会自动开启所需 Windows 功能并下载 Ubuntu。完成后**重启电脑**。
3. 重启后会自动弹出 Ubuntu 窗口，让你设置 **Linux 用户名** 和 **密码**。
   - 密码记住，之后 `sudo` 要用；输入密码时屏幕不显示字符，是正常的，输完回车即可。
4. 回到 PowerShell 验证：

   ```
   wsl -l -v
   ```

   能看到 `Ubuntu`，且 `VERSION` 是 `2` 就对了。

> 报错的话：先在管理员 PowerShell 里 `wsl --update` 再试；仍不行就到「控制面板 → 程序 →
> 启用或关闭 Windows 功能」，勾选「适用于 Linux 的 Windows 子系统」和「虚拟机平台」，重启后再 `wsl --install -d Ubuntu`。

5. **在 Ubuntu 里开启 systemd**（Amadeus 用它做开机服务）。在 Ubuntu 窗口执行：

   ```
   sudo tee /etc/wsl.conf >/dev/null <<'EOF'
   [boot]
   systemd=true
   EOF
   ```

   然后回 PowerShell 执行 `wsl --shutdown`，再打开一次「Ubuntu」重新进入。

以后进入 Ubuntu：开始菜单搜「Ubuntu」，或在 PowerShell 输入 `wsl`。

---

## 第 2 部分：在 Ubuntu 里装 Node 24 与 code-server

以下命令都在 **Ubuntu 窗口**里执行（提示符形如 `你的名字@电脑名:~$`）。

更新系统并装基础工具：

```
sudo apt update && sudo apt install -y curl git build-essential xz-utils
```

装 Node 24（放到 `/opt/node`，避免和系统自带的旧版本冲突）：

```
sudo mkdir -p /opt/node
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.9.0/node-v24.9.0-linux-x64.tar.xz
sudo tar -xJf node-v24.9.0-linux-x64.tar.xz -C /opt/node --strip-components=1
echo 'export PATH=/opt/node/bin:$PATH' | sudo tee /etc/profile.d/node.sh
source /etc/profile.d/node.sh
node --version        # 应显示 v24.9.0
```

> 国内下载慢可用镜像地址：
> `curl -fsSLO https://npmmirror.com/mirrors/node/v24.9.0/node-v24.9.0-linux-x64.tar.xz`

装 code-server `4.104.2`（本项目固定这个版本）：

```
cd /tmp
curl -fsSL https://github.com/coder/code-server/releases/download/v4.104.2/code-server-4.104.2-linux-amd64.tar.gz -o code-server.tar.gz
sudo mkdir -p /opt/code-server
sudo tar -xzf code-server.tar.gz --strip-components=1 -C /opt/code-server
sudo ln -sf /opt/code-server/bin/code-server /usr/local/bin/code-server
code-server --version  # 应显示 4.104.2
```

> 若你的电脑是 ARM 架构（少见），把上面两条命令里的 `amd64` 换成 `arm64`。
> GitHub 下载慢：可稍后重试，或先给 Ubuntu 配好网络代理。

---

## 第 3 部分：下载并构建 Amadeus

```
sudo mkdir -p /srv
sudo git clone https://github.com/YJC18368291437-ai/Amadeus.git /srv/amadeus
cd /srv/amadeus
sudo /opt/node/bin/npm ci
sudo /opt/node/bin/node scripts/build.mjs
sudo /opt/node/bin/node scripts/patch-code-server.mjs /opt/code-server
```

安装**必需的**编辑器桥接扩展：

```
sudo mkdir -p /srv/amadeus/.amadeus/code-server/extensions
sudo cp -a /srv/amadeus/packages/editor/extension \
           /srv/amadeus/.amadeus/code-server/extensions/amadeus.amadeus-bridge-1.0.0
```

<details>
<summary>（可选）安装 LaTeX 支持</summary>

要用 LaTeX 编译才需要，不用可跳过：

```
cd /tmp
curl -fsSL https://open-vsx.org/api/James-Yu/latex-workshop/10.9.0/file/James-Yu.latex-workshop-10.9.0.vsix -o lw.vsix
sudo /opt/code-server/bin/code-server \
  --extensions-dir /srv/amadeus/.amadeus/code-server/extensions \
  --user-data-dir /tmp/cs-install --install-extension /tmp/lw.vsix
sudo rm -rf /tmp/cs-install
sudo /opt/node/bin/node /srv/amadeus/scripts/patch-latex-workshop.mjs \
     /srv/amadeus/.amadeus/code-server/extensions/james-yu.latex-workshop-10.9.0
```

另外还要在 Ubuntu 里装 TeX Live 和中文字体（体积很大）：

```
sudo apt install -y texlive-xetex texlive-lang-chinese texlive-latex-extra latexmk biber fonts-noto-cjk
```
</details>

---

## 第 4 部分：配置账号密码 + 做成开机服务

### 4.1 写配置文件

```
cd /srv/amadeus
sudo cp amadeus.example.yml amadeus.local.yml
sudo nano amadeus.local.yml
```

把内容改成下面这样（`password` 换成你自己的，**不能留 CHANGE-ME**）：

```yaml
username: amadeus
password: 换成你的密码
host: 0.0.0.0
port: 3080
sessionHours: 168
workspace: /srv/amadeus-workspace
editor:
  upstream: http://127.0.0.1:8080
playwrightMcp:
  enabled: false
```

保存退出 nano：按 `Ctrl+O` → 回车 → `Ctrl+X`。然后建好工作区目录：

```
sudo mkdir -p /srv/amadeus-workspace
```

### 4.2 写两个 systemd 服务

创建 `/etc/systemd/system/code-server.service`：

```
sudo tee /etc/systemd/system/code-server.service >/dev/null <<'EOF'
[Unit]
Description=code-server for Amadeus editor
After=network.target

[Service]
Type=simple
Environment=AMADEUS_EDITOR_BRIDGE_DIR=/srv/amadeus/.amadeus/dsh-home/editor/bridge
ExecStart=/usr/local/bin/code-server --bind-addr 127.0.0.1:8080 --auth none --disable-telemetry --disable-update-check --disable-workspace-trust --user-data-dir /srv/amadeus/.amadeus/code-server --extensions-dir /srv/amadeus/.amadeus/code-server/extensions /srv/amadeus-workspace
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

创建 `/etc/systemd/system/amadeus.service`：

```
sudo tee /etc/systemd/system/amadeus.service >/dev/null <<'EOF'
[Unit]
Description=Amadeus DSH document workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/amadeus
Environment=NODE_ENV=production
Environment=AMADEUS_CONFIG=/srv/amadeus/amadeus.local.yml
Environment=PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
ExecStart=/opt/node/bin/node /srv/amadeus/scripts/start.mjs
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
```

启用并启动：

```
sudo systemctl daemon-reload
sudo systemctl enable --now code-server amadeus
systemctl --no-pager status code-server amadeus
```

本机自测（在 Ubuntu 里）：

```
curl -I http://127.0.0.1:3080
```

返回 `401`（要求登录）或 `200` 都说明服务正常。

---

## 第 5 部分：Tailscale（让 iPad 连进来）

WSL 里的服务对 Windows 来说就是 `127.0.0.1:3080`（WSL 自动把端口映射到本机 localhost）。
Tailscale 负责把 Windows 变成一个内网节点，再把 `127.0.0.1:3080` 用 HTTPS 暴露给同账号的设备。

### 5.1 Windows 上安装 Tailscale

1. 打开 <https://tailscale.com/download/windows> 下载并安装。
2. 启动后点 **Log in**，用邮箱 / Google / Microsoft / GitHub 注册或登录。
   **记住你用的是哪个账号，iPad 上必须用同一个。**
3. 安装完成后，在 PowerShell 里查看本机 Tailscale 名称：

   ```
   tailscale status
   ```

   第一行形如 `100.x.x.x  laptop-xxxx  ...  windows`，`laptop-xxxx` 就是你的设备名。

### 5.2 开启 HTTPS 证书（首次用 `serve` 需要）

打开 <https://login.tailscale.com/admin/dns> ：

- 确认 **MagicDNS** 已开启；
- 在 **HTTPS Certificates** 处点 **Enable HTTPS**。

### 5.3 把 Amadeus 暴露到内网

在 **Windows 管理员 PowerShell** 执行（`3080` 换成你 `amadeus.local.yml` 里的 `port`）：

```
tailscale serve --bg 3080
```

它会生成一个 HTTPS 地址，形如：

```
https://laptop-xxxx.你的tailnet名.ts.net
```

**记下这个地址**，iPad 就用它访问。查看当前代理状态用 `tailscale serve status`。

### 5.4 iPad 上安装 Tailscale

1. 打开 iPad 的 **App Store**，搜索 **Tailscale**，安装。
   - **国内 App Store 可能搜不到**（中国区 Apple ID 未上架）。两个办法：
     - 用一个**海外（非中国区）Apple ID** 登录 App Store 后再搜；
     - 如果上面一时搞不定，可以到 <https://www.iios.ga> 找一个可用的 Apple ID，登录 App Store 把 Tailscale 下载下来。
       **注意**：共享 Apple ID 只用来**下载 App**，下完请切回自己的 Apple ID，不要用它登录 iCloud。
2. 打开 Tailscale App，用**和 Windows 上完全相同的账号**登录，并打开连接开关（顶部出现 VPN 标志）。

### 5.5 iPad 上使用

用 Safari 打开 5.3 拿到的地址 `https://laptop-xxxx.xxx.ts.net`，输入你在 `amadeus.local.yml`
里设置的账号 / 密码即可登录。

建议：在 Safari 里点 **分享 → 添加到主屏幕**，以后像 App 一样一点就开。

---

## 日常使用 & 排错

- **开机后**：确认 Windows 上 Tailscale 已登录（托盘图标正常）；打开一次「Ubuntu」（或在 PowerShell
  运行一次 `wsl -d Ubuntu true`）让 WSL 和 systemd 服务起来。
- **升级 Amadeus**：

  ```
  cd /srv/amadeus
  sudo git pull
  sudo /opt/node/bin/npm ci
  sudo /opt/node/bin/node scripts/build.mjs
  sudo systemctl restart amadeus
  ```

- **连不上时按顺序排查**：
  1. Ubuntu 里：`curl -I http://127.0.0.1:3080` 有无响应；没有就 `systemctl status amadeus` 看报错。
  2. Windows 里：`tailscale status` 应能看到本机和 iPad 都 `online`；`tailscale serve status` 看代理还在不在。
  3. iPad 里：Tailscale 开关是否打开、是否和 Windows 同一个账号。
- **改过端口后**：`tailscale serve reset`，再 `tailscale serve --bg 新端口`。

**（可选）开机自动拉起 WSL**：WSL 里的 systemd 会随 WSL 启动，而 WSL 默认不会自己起。
若想让 Windows 一登录就自动起，用「任务计划程序」新建任务，触发器选「登录时」，操作填：

```
wsl.exe -d Ubuntu -u root -e /bin/true
```

# AutoOpenClaw

一个本地部署助手，目标是把 OpenClaw 的初装、状态检查和配置编辑收敛到一个入口里。

## 功能

- 自动识别当前系统和常见包管理器
- 一键调用 OpenClaw 官方安装器
- 一键卸载 OpenClaw 服务、本地状态和当前安装目录
- 显示 `Node / curl / git / OpenClaw` 当前状态
- 在本地网页里直接编辑 `~/.openclaw/openclaw.json`
- 提供 `doctor / status / gateway start / restart / stop` 固定运维动作
- 提供几个常用 JSON5 配置模板

## 使用方式

### macOS / Linux

```bash
chmod +x bootstrap.sh
./bootstrap.sh
```

### Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\bootstrap.ps1
```

## GitHub 远程启动

上传到 GitHub 后，推荐把 `bootstrap.sh` 和 `bootstrap.ps1` 放在仓库根目录，作为统一入口。

### macOS / Linux

官方仓库默认可直接这样启动：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yofers/AutoClaw/main/bootstrap.sh)
```

如果你要使用自己的 fork 或指定 tag / branch，再显式传入仓库和版本：

```bash
AUTOOPENCLAW_REPO=<user>/<repo> AUTOOPENCLAW_REF=<tag-or-branch> bash <(curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/<tag-or-branch>/bootstrap.sh)
```

### Windows PowerShell

官方仓库默认可直接这样启动：

```powershell
irm https://raw.githubusercontent.com/yofers/AutoClaw/main/bootstrap.ps1 | iex
```

如果你要使用自己的 fork 或指定 tag / branch，再显式传入仓库和版本：

```powershell
$env:AUTOOPENCLAW_REPO = "<user>/<repo>"
$env:AUTOOPENCLAW_REF = "<tag-or-branch>"
irm https://raw.githubusercontent.com/<user>/<repo>/<tag-or-branch>/bootstrap.ps1 | iex
```

脚本会优先这样处理：

1. 默认把“当前执行命令时所在目录”作为项目目录；显式设置 `AUTOOPENCLAW_ROOT_DIR` 时，以该目录为准。
2. 如果目标目录已经是完整项目，直接使用本地项目文件。
3. 如果目标目录不是项目目录，会默认从 `yofers/AutoClaw` 拉取到该目录；显式设置了 `AUTOOPENCLAW_REPO` 时，则优先使用你指定的仓库。
4. 如果目标目录非空且不是项目目录，脚本会停止，避免覆盖现有文件。
5. 如果本地已安装 `openclaw`，网页内的运维、初始化和更新动作会直接复用该 `openclaw`。

默认会启动本地管理页：

```text
http://127.0.0.1:31870/
```

Web 管理页配置统一放在 `config/web.yaml`，包括：

- `server.host`
- `server.port`
- `auth.*`
- `security.loopbackOnly`

如果你要在 VPS 上远程访问管理页，至少要关闭回环限制：

```yaml
security:
  loopbackOnly: false
```

其中：

- `server.host` 用于页面里的链接和地址展示
- 服务监听默认使用 `0.0.0.0`
- 是否允许外部访问由 `security.loopbackOnly` 控制

同时请自行配好防火墙、反向代理和强密码。默认配置仍然偏向本地使用。

## 目录

- `bootstrap.sh`: macOS / Linux 一键入口
- `bootstrap.ps1`: Windows 一键入口
- `server/index.js`: 轻量本地服务，负责状态探测、调用官方安装器、读写配置
- `public/`: 本地网页

## 已知约束

- 当前网页里的配置编辑器是原始 JSON5 编辑器，不做 schema 级联表单渲染。
- Windows 平台按官方建议，实际运行 OpenClaw 时更推荐 WSL2；这里仍保留了 PowerShell 安装入口。
- OpenClaw 的完整配置能力本身已经存在于官方 Dashboard Config Tab，本工具更偏向“统一入口”和“开箱部署”。
- 远程启动模式依赖 GitHub 仓库公开可访问；如果未安装 `git`，脚本会回退到归档下载。
- `config/auth.yaml` 已不再使用，Web 登录配置统一以 `config/web.yaml` 为准。

## 发布建议

推荐把仓库发布到 GitHub，并用 `tag` 做稳定分发，而不是直接指向 `main`。

建议流程：

1. 上传仓库到 GitHub。
2. 创建版本标签，例如 `v0.1.0`。
3. README 中所有远程启动命令都使用该标签。
4. 后续更新时发布新标签，而不是修改旧标签对应内容。

## 参考

- 安装文档: https://docs.openclaw.ai/install
- 配置文档: https://docs.openclaw.ai/gateway/configuration
- Dashboard 文档: https://docs.openclaw.ai/dashboard

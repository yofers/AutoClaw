$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = if ($env:AUTOOPENCLAW_ROOT_DIR) { $env:AUTOOPENCLAW_ROOT_DIR } else { $ScriptRoot }
$HostIp = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$Port = if ($env:PORT) { $env:PORT } else { "31870" }
$DefaultRemoteRepo = "yofers/AutoClaw"
$RemoteRepo = if ($env:AUTOOPENCLAW_REPO) { $env:AUTOOPENCLAW_REPO } else { $DefaultRemoteRepo }
$RemoteRef = if ($env:AUTOOPENCLAW_REF) { $env:AUTOOPENCLAW_REF } else { "main" }
$CacheRoot = if ($env:AUTOOPENCLAW_CACHE_DIR) { $env:AUTOOPENCLAW_CACHE_DIR } else { Join-Path $env:TEMP "auto-openclaw-bootstrap" }

function Write-Log($Message) {
  Write-Host "[AutoOpenClaw] $Message"
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Find-OpenClaw {
  $command = Get-Command openclaw -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $localBinary = Join-Path $HOME ".openclaw\bin\openclaw.cmd"
  if (Test-Path $localBinary) {
    return $localBinary
  }

  return $null
}

function Download-RepoArchive($Repo, $Ref) {
  $target = Join-Path $CacheRoot (($Repo -replace "[/\\:]", "-") + "-" + ($Ref -replace "[/\\:]", "-"))
  $zipPath = "$target.zip"
  $extractRoot = "$target.extract"
  $archiveUrl = "https://github.com/$Repo/archive/$Ref.zip"

  Remove-Item -Recurse -Force $target, $zipPath, $extractRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Write-Log "从 GitHub 下载 AutoOpenClaw 仓库归档: $Repo@$Ref"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
  $extracted = Get-ChildItem -Directory $extractRoot | Select-Object -First 1
  if (-not $extracted) {
    throw "GitHub 归档解压失败。"
  }
  Move-Item -Path $extracted.FullName -Destination $target
  Remove-Item -Recurse -Force $zipPath, $extractRoot -ErrorAction SilentlyContinue
  return $target
}

function Clone-Repo($Repo, $Ref) {
  $target = Join-Path $CacheRoot (($Repo -replace "[/\\:]", "-") + "-" + ($Ref -replace "[/\\:]", "-"))
  Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
  Write-Log "从 GitHub 克隆 AutoOpenClaw 仓库: $Repo@$Ref"
  git clone --depth 1 --branch $Ref "https://github.com/$Repo.git" $target | Out-Null
  return $target
}

function Resolve-RootDir {
  if ((Test-Path (Join-Path $RootDir "backend\index.js")) -and (Test-Path (Join-Path $RootDir "web\index.html"))) {
    return $RootDir
  }

  if (-not $env:AUTOOPENCLAW_REPO) {
    Write-Log "当前不是本地仓库运行，未显式设置 AUTOOPENCLAW_REPO，默认回退到 $DefaultRemoteRepo@$RemoteRef。"
  }

  if (Test-Command "git") {
    return Clone-Repo $RemoteRepo $RemoteRef
  }

  return Download-RepoArchive $RemoteRepo $RemoteRef
}

function Ensure-Node {
  if (Test-Command "node") {
    $major = [int](node -p "process.versions.node.split('.')[0]")
    if ($major -ge 22) {
      Write-Log "Node $(node -v) 已满足要求。"
      return
    }
  }

  if (Test-Command "winget") {
    Write-Log "使用 winget 安装 Node.js LTS 和 Git。"
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
    Refresh-Path
    return
  }

  if (Test-Command "choco") {
    Write-Log "使用 Chocolatey 安装 Node.js 和 Git。"
    choco install -y nodejs-lts git
    Refresh-Path
    return
  }

  if (Test-Command "scoop") {
    Write-Log "使用 Scoop 安装 Node.js 和 Git。"
    scoop install nodejs-lts git
    Refresh-Path
    return
  }

  throw "未检测到 winget / choco / scoop，无法自动安装 Node。"
}

Ensure-Node
$RootDir = Resolve-RootDir

$OpenClawPath = Find-OpenClaw
if ($OpenClawPath) {
  Write-Log "已检测到本地 OpenClaw: $OpenClawPath"
  Write-Log "管理页中的运维、初始化和更新动作会直接复用该 OpenClaw。"
} else {
  Write-Log "尚未检测到本地 OpenClaw；需要时可在网页里点击“安装 / 更新 OpenClaw”。"
}

Write-Log "项目目录: $RootDir"
Write-Log "启动本地管理页: http://${HostIp}:${Port}/"
Start-Process "http://${HostIp}:${Port}/" | Out-Null
node "$RootDir/server/index.js"

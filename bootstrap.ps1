$ErrorActionPreference = "Stop"

$LaunchDir = (Get-Location).Path
$RootDir = if ($env:AUTOOPENCLAW_ROOT_DIR) { $env:AUTOOPENCLAW_ROOT_DIR } else { $LaunchDir }
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

function Get-WebConfigValue($RootDir, $Section, $Key, $DefaultValue) {
  $configPath = Join-Path $RootDir "config\web.yaml"
  if (-not (Test-Path $configPath)) {
    return $DefaultValue
  }

  $currentSection = ""
  foreach ($line in Get-Content $configPath) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') {
      continue
    }

    if ($line -match '^([^\s][^:]*):\s*$') {
      $currentSection = $matches[1]
      continue
    }

    if ($currentSection -eq $Section -and $line -match "^\s{2}$Key:\s*(.+?)\s*$") {
      $value = $matches[1].Trim()
      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        return $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }

  return $DefaultValue
}

function Test-ProjectRoot($Dir) {
  return (Test-Path (Join-Path $Dir "server\index.js")) -and (Test-Path (Join-Path $Dir "public\index.html"))
}

function Test-CanPopulateDir($Dir) {
  if (-not (Test-Path $Dir)) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    return $true
  }

  $allowed = @("bootstrap.sh", "bootstrap.ps1", ".DS_Store", "Thumbs.db")
  $entries = Get-ChildItem -Force $Dir
  foreach ($entry in $entries) {
    if ($allowed -notcontains $entry.Name) {
      return $false
    }
  }

  return $true
}

function Copy-RepoToDir($SourceDir, $TargetDir) {
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  Get-ChildItem -Force $SourceDir | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $TargetDir -Recurse -Force
  }
}

function Download-RepoArchiveToDir($Repo, $Ref, $TargetDir) {
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
  $workDir = Join-Path $CacheRoot ([System.Guid]::NewGuid().ToString())
  $zipPath = Join-Path $workDir "repo.zip"
  $extractRoot = Join-Path $workDir "extract"
  $archiveUrl = "https://github.com/$Repo/archive/$Ref.zip"

  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Write-Log "从 GitHub 下载 AutoOpenClaw 仓库到 ${TargetDir}: $Repo@$Ref"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
  $extracted = Get-ChildItem -Directory $extractRoot | Select-Object -First 1
  if (-not $extracted) {
    throw "GitHub 归档解压失败。"
  }
  Copy-RepoToDir $extracted.FullName $TargetDir
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}

function Clone-RepoToDir($Repo, $Ref, $TargetDir) {
  $workDir = Join-Path $CacheRoot ([System.Guid]::NewGuid().ToString())
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
  Write-Log "从 GitHub 克隆 AutoOpenClaw 仓库到 ${TargetDir}: $Repo@$Ref"
  git clone --depth 1 --branch $Ref "https://github.com/$Repo.git" $workDir | Out-Null
  Copy-RepoToDir $workDir $TargetDir
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}

function Resolve-RootDir {
  if (Test-ProjectRoot $RootDir) {
    return $RootDir
  }

  if (-not $env:AUTOOPENCLAW_REPO) {
    Write-Log "当前目录不是完整项目，未显式设置 AUTOOPENCLAW_REPO，默认回退到 $DefaultRemoteRepo@$RemoteRef。"
  }

  if (-not (Test-CanPopulateDir $RootDir)) {
    throw "目标目录 $RootDir 不是空目录，且不是 AutoOpenClaw 项目目录；为避免覆盖现有文件，已停止。请在空目录中执行脚本，或显式设置 AUTOOPENCLAW_ROOT_DIR 指向目标目录。"
  }

  if (Test-Command "git") {
    Clone-RepoToDir $RemoteRepo $RemoteRef $RootDir
  } else {
    Download-RepoArchiveToDir $RemoteRepo $RemoteRef $RootDir
  }

  if (-not (Test-ProjectRoot $RootDir)) {
    throw "项目文件拉取完成，但目录结构不完整，请检查仓库内容。"
  }

  return $RootDir
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
$HostIp = Get-WebConfigValue $RootDir "server" "host" $HostIp
$Port = Get-WebConfigValue $RootDir "server" "port" $Port

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

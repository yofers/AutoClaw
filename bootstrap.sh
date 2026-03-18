#!/usr/bin/env bash
set -euo pipefail

LAUNCH_DIR="$(pwd -P)"
ROOT_DIR="${AUTOOPENCLAW_ROOT_DIR:-${LAUNCH_DIR}}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-31870}"
DEFAULT_REMOTE_REPO="yofers/AutoClaw"
REMOTE_REPO="${AUTOOPENCLAW_REPO:-${DEFAULT_REMOTE_REPO}}"
REMOTE_REF="${AUTOOPENCLAW_REF:-main}"
CACHE_ROOT="${AUTOOPENCLAW_CACHE_DIR:-${TMPDIR:-/tmp}/auto-openclaw-bootstrap}"

log() {
  printf '[AutoOpenClaw] %s\n' "$1" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

detect_openclaw() {
  if have openclaw; then
    command -v openclaw
    return 0
  fi

  if [[ -x "${HOME}/.openclaw/bin/openclaw" ]]; then
    printf '%s\n' "${HOME}/.openclaw/bin/openclaw"
    return 0
  fi

  return 1
}

need_sudo() {
  if [[ "${EUID}" -eq 0 ]]; then
    return 1
  fi
  return 0
}

run_privileged() {
  if need_sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

ensure_homebrew() {
  if have brew; then
    return
  fi
  log "Homebrew 未找到，开始安装。"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_node() {
  if have node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" -ge 22 ]]; then
      log "Node $(node -v) 已满足要求。"
      return
    fi
  fi

  case "$(uname -s)" in
    Darwin)
      ensure_homebrew
      log "安装 Node 22。"
      brew install node@22 git
      local prefix
      prefix="$(brew --prefix node@22)"
      export PATH="${prefix}/bin:${PATH}"
      ;;
    Linux)
      if have apt-get; then
        log "使用 apt 安装 Node 22 / git / curl。"
        run_privileged apt-get update
        run_privileged apt-get install -y ca-certificates curl git
        curl -fsSL https://deb.nodesource.com/setup_22.x | run_privileged bash
        run_privileged apt-get install -y nodejs
      elif have dnf; then
        log "使用 dnf 安装 Node 22 / git / curl。"
        run_privileged dnf install -y curl git
        curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash
        run_privileged dnf install -y nodejs
      elif have yum; then
        log "使用 yum 安装 Node 22 / git / curl。"
        run_privileged yum install -y curl git
        curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash
        run_privileged yum install -y nodejs
      elif have pacman; then
        log "使用 pacman 安装 Node / git / curl。"
        run_privileged pacman -Sy --noconfirm nodejs npm git curl
      else
        log "当前 Linux 发行版没有内置自动安装逻辑，请先安装 Node 22+。"
        exit 1
      fi
      ;;
    *)
      log "当前系统不支持 bootstrap.sh，请改用对应平台脚本。"
      exit 1
      ;;
  esac
}

ensure_tools() {
  local missing=()

  if ! have git; then
    missing+=("git")
  fi

  if ! have curl; then
    missing+=("curl")
  fi

  if [[ "${#missing[@]}" -eq 0 ]]; then
    log "git / curl 已满足要求。"
    return
  fi

  log "缺少基础工具: ${missing[*]}，开始安装。"

  case "$(uname -s)" in
    Darwin)
      ensure_homebrew
      brew install "${missing[@]}"
      ;;
    Linux)
      if have apt-get; then
        run_privileged apt-get install -y "${missing[@]}"
      elif have dnf; then
        run_privileged dnf install -y "${missing[@]}"
      elif have yum; then
        run_privileged yum install -y "${missing[@]}"
      elif have pacman; then
        run_privileged pacman -Sy --noconfirm "${missing[@]}"
      else
        log "当前系统没有内置 ${missing[*]} 自动安装逻辑，请手动安装后重试。"
        exit 1
      fi
      ;;
  esac
}

open_browser() {
  local url="$1"
  if have open; then
    open "$url" >/dev/null 2>&1 || true
  elif have xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

is_project_dir() {
  local dir="$1"
  [[ -f "${dir}/server/index.js" && -f "${dir}/public/index.html" ]]
}

can_populate_dir() {
  local dir="$1"
  local entry

  mkdir -p "${dir}"

  while IFS= read -r entry; do
    case "${entry##*/}" in
      bootstrap.sh|bootstrap.ps1|.DS_Store|Thumbs.db)
        ;;
      *)
        return 1
        ;;
    esac
  done < <(find "${dir}" -mindepth 1 -maxdepth 1 -print)

  return 0
}

copy_repo_to_dir() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "${target_dir}"
  cp -R "${source_dir}/." "${target_dir}/"
}

download_repo_archive_to_dir() {
  local repo="$1"
  local ref="$2"
  local target_dir="$3"
  local work_dir
  local archive_path
  local extract_root
  local archive_url="https://github.com/${repo}/archive/${ref}.tar.gz"

  mkdir -p "${CACHE_ROOT}"
  work_dir="$(mktemp -d "${CACHE_ROOT}/archive-XXXXXX")"
  archive_path="${work_dir}/repo.tar.gz"
  extract_root="${work_dir}/extract"

  mkdir -p "${extract_root}"
  log "从 GitHub 下载 AutoOpenClaw 仓库到 ${target_dir}: ${repo}@${ref}"
  curl -fsSL "${archive_url}" -o "${archive_path}"
  tar -xzf "${archive_path}" -C "${extract_root}"

  local extracted_dir
  extracted_dir="$(find "${extract_root}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${extracted_dir}" ]]; then
    log "GitHub 归档解压失败。"
    exit 1
  fi

  copy_repo_to_dir "${extracted_dir}" "${target_dir}"
  rm -rf "${work_dir}"
}

clone_repo_to_dir() {
  local repo="$1"
  local ref="$2"
  local target_dir="$3"
  local work_dir

  mkdir -p "${CACHE_ROOT}"
  work_dir="$(mktemp -d "${CACHE_ROOT}/clone-XXXXXX")"
  rm -rf "${work_dir}"

  log "从 GitHub 克隆 AutoOpenClaw 仓库到 ${target_dir}: ${repo}@${ref}"
  git clone --depth 1 --branch "${ref}" "https://github.com/${repo}.git" "${work_dir}" >/dev/null 2>&1
  copy_repo_to_dir "${work_dir}" "${target_dir}"
  rm -rf "${work_dir}"
}

resolve_root_dir() {
  if is_project_dir "${ROOT_DIR}"; then
    printf '%s\n' "${ROOT_DIR}"
    return 0
  fi

  if [[ -z "${AUTOOPENCLAW_REPO:-}" ]]; then
    log "当前目录不是完整项目，未显式设置 AUTOOPENCLAW_REPO，默认回退到 ${DEFAULT_REMOTE_REPO}@${REMOTE_REF}。"
  fi

  if ! can_populate_dir "${ROOT_DIR}"; then
    log "目标目录 ${ROOT_DIR} 不是空目录，且不是 AutoOpenClaw 项目目录；为避免覆盖现有文件，已停止。"
    log "请在空目录中执行脚本，或显式设置 AUTOOPENCLAW_ROOT_DIR 指向目标目录。"
    exit 1
  fi

  if have git; then
    clone_repo_to_dir "${REMOTE_REPO}" "${REMOTE_REF}" "${ROOT_DIR}"
  elif have tar; then
    download_repo_archive_to_dir "${REMOTE_REPO}" "${REMOTE_REF}" "${ROOT_DIR}"
  else
    log "缺少 git 或 tar，无法从 GitHub 拉取项目。"
    exit 1
  fi

  if ! is_project_dir "${ROOT_DIR}"; then
    log "项目文件拉取完成，但目录结构不完整，请检查仓库内容。"
    exit 1
  fi

  printf '%s\n' "${ROOT_DIR}"
}

main() {
  ensure_node
  ensure_tools
  ROOT_DIR="$(resolve_root_dir)"
  local openclaw_bin=""
  if openclaw_bin="$(detect_openclaw)"; then
    log "已检测到本地 OpenClaw: ${openclaw_bin}"
    log "管理页中的运维、初始化和更新动作会直接复用该 OpenClaw。"
  else
    log "尚未检测到本地 OpenClaw；需要时可在网页里点击“安装 / 更新 OpenClaw”。"
  fi
  log "项目目录: ${ROOT_DIR}"
  log "启动本地管理页: http://${HOST}:${PORT}/"
  open_browser "http://${HOST}:${PORT}/"
  exec node "${ROOT_DIR}/server/index.js"
}

main "$@"

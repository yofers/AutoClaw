#!/usr/bin/env bash
set -euo pipefail

LAUNCH_DIR="$(pwd -P)"
ROOT_DIR="${AUTOOPENCLAW_ROOT_DIR:-${LAUNCH_DIR}}"
DEFAULT_REMOTE_REPO="yofers/AutoClaw"
REMOTE_REPO="${AUTOOPENCLAW_REPO:-${DEFAULT_REMOTE_REPO}}"
REMOTE_REF="${AUTOOPENCLAW_REF:-main}"
CACHE_ROOT="${AUTOOPENCLAW_CACHE_DIR:-${TMPDIR:-/tmp}/auto-openclaw-bootstrap}"
STATE_DIR_NAME=".autoclaw"
DEFAULT_WEB_CONFIG=$'# AutoOpenClaw Web manager configuration\n# Changes to host/port require restarting the manager process.\n\nserver:\n  host: "127.0.0.1"\n  port: 31870\n\nsite:\n  title: "AutoOpenClaw"\n  subtitle: "本地优先、状态清晰、动作可回退的 OpenClaw 控制面板"\n\nauth:\n  enabled: true\n  username: "admin"\n  password: "change-this-password"\n  sessionTtlHours: 12\n\nsecurity:\n  loopbackOnly: true\n'
MENU_KEYS=("1" "2" "4" "5" "6" "7" "8")

if [[ -t 1 ]]; then
  COLOR_RESET=$'\033[0m'
  COLOR_DIM=$'\033[2m'
  COLOR_MUTED=$'\033[38;5;244m'
  COLOR_PANEL=$'\033[38;5;111m'
  COLOR_ACCENT=$'\033[38;5;81m'
  COLOR_SUCCESS=$'\033[38;5;42m'
  COLOR_WARNING=$'\033[38;5;214m'
  COLOR_DANGER=$'\033[38;5;203m'
  COLOR_SELECTED_BG=$'\033[48;5;236m'
  COLOR_SELECTED_FG=$'\033[38;5;231m'
else
  COLOR_RESET=""
  COLOR_DIM=""
  COLOR_MUTED=""
  COLOR_PANEL=""
  COLOR_ACCENT=""
  COLOR_SUCCESS=""
  COLOR_WARNING=""
  COLOR_DANGER=""
  COLOR_SELECTED_BG=""
  COLOR_SELECTED_FG=""
fi

MESSAGE=""
SCRIPT_STATUS="unknown"
SCRIPT_STATUS_TEXT="未检查"
SCRIPT_STATUS_TONE="warning"
SCRIPT_REMOTE_CACHE=""
PANEL_STATUS="not-installed"
PANEL_STATUS_TEXT="未安装"
PANEL_STATUS_TONE="warning"
PANEL_LOCAL_VERSION=""
PANEL_REMOTE_VERSION=""

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
  [[ "${EUID}" -ne 0 ]]
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
        run_privileged apt-get update
        run_privileged apt-get install -y ca-certificates curl git
        curl -fsSL https://deb.nodesource.com/setup_22.x | run_privileged bash
        run_privileged apt-get install -y nodejs
      elif have dnf; then
        run_privileged dnf install -y curl git
        curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash
        run_privileged dnf install -y nodejs
      elif have yum; then
        run_privileged yum install -y curl git
        curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash
        run_privileged yum install -y nodejs
      elif have pacman; then
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
    return
  fi

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
  [[ -f "${dir}/server/index.js" && -f "${dir}/public/index.html" && -f "${dir}/package.json" ]]
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
    log "当前目录不是完整项目，默认回退到 ${DEFAULT_REMOTE_REPO}@${REMOTE_REF}。"
  fi

  if ! can_populate_dir "${ROOT_DIR}"; then
    log "目标目录 ${ROOT_DIR} 不是空目录，且不是 AutoOpenClaw 项目目录；为避免覆盖现有文件，已停止。"
    log "请在空目录中执行脚本，或显式设置 AUTOOPENCLAW_ROOT_DIR 指向目标目录。"
    exit 1
  fi

  ensure_tools

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

state_dir() {
  printf '%s\n' "${ROOT_DIR}/${STATE_DIR_NAME}"
}

pid_file() {
  printf '%s\n' "$(state_dir)/panel.pid"
}

log_file() {
  printf '%s\n' "$(state_dir)/panel.log"
}

web_config_path() {
  printf '%s\n' "${ROOT_DIR}/config/web.yaml"
}

ensure_panel_state_dir() {
  mkdir -p "$(state_dir)"
}

ensure_web_config() {
  if ! is_project_dir "${ROOT_DIR}"; then
    return
  fi

  mkdir -p "$(dirname "$(web_config_path)")"
  if [[ ! -f "$(web_config_path)" ]]; then
    printf '%s' "${DEFAULT_WEB_CONFIG}" > "$(web_config_path)"
  fi
}

yaml_get() {
  local section="$1"
  local key="$2"
  local default_value="$3"
  local file
  file="$(web_config_path)"

  if [[ ! -f "${file}" ]]; then
    printf '%s\n' "${default_value}"
    return
  fi

  awk -v section="${section}" -v key="${key}" -v default_value="${default_value}" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    /^[^[:space:]][^:]*:[[:space:]]*$/ {
      current=$0
      sub(/:.*/, "", current)
      next
    }
    current == section && $0 ~ ("^[[:space:]]{2}" key ":[[:space:]]*") {
      value=$0
      sub(/^[[:space:]]{2}[^:]+:[[:space:]]*/, "", value)
      gsub(/^"/, "", value)
      gsub(/"$/, "", value)
      gsub(/^'\''/, "", value)
      gsub(/'\''$/, "", value)
      print value
      found=1
      exit
    }
    END {
      if (!found) {
        print default_value
      }
    }
  ' "${file}"
}

yaml_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

yaml_replace_value() {
  local section="$1"
  local key="$2"
  local value="$3"
  local file
  local tmp_file

  file="$(web_config_path)"
  tmp_file="$(mktemp)"

  awk -v section="${section}" -v key="${key}" -v value="${value}" '
    BEGIN {
      current=""
      updated=0
    }
    /^[^[:space:]][^:]*:[[:space:]]*$/ {
      if (current == section && !updated) {
        printf "  %s: %s\n", key, value
        updated=1
      }
      current=$0
      sub(/:.*/, "", current)
      print
      next
    }
    {
      if (current == section && $0 ~ ("^[[:space:]]{2}" key ":[[:space:]]*")) {
        printf "  %s: %s\n", key, value
        updated=1
        next
      }
      print
    }
    END {
      if (current == section && !updated) {
        printf "  %s: %s\n", key, value
      }
    }
  ' "${file}" > "${tmp_file}"

  mv "${tmp_file}" "${file}"
}

panel_host() {
  yaml_get "server" "host" "127.0.0.1"
}

panel_port() {
  yaml_get "server" "port" "31870"
}

panel_password() {
  yaml_get "auth" "password" "change-this-password"
}

panel_url() {
  printf 'http://%s:%s/\n' "$(panel_host)" "$(panel_port)"
}

panel_session_url() {
  printf '%sapi/session\n' "$(panel_url)"
}

panel_session_json() {
  if ! have curl; then
    return 1
  fi

  curl --noproxy '*' --max-time 2 -fsS "$(panel_session_url)" 2>/dev/null || true
}

is_current_panel_on_port() {
  local body expected_config_path
  body="$(panel_session_json)"
  if [[ -z "${body}" ]]; then
    return 1
  fi

  expected_config_path="$(web_config_path)"
  [[ "${body}" == *"\"configPath\":\"${expected_config_path}\""* ]]
}

port_listener_pid() {
  local port
  port="$(panel_port)"

  if have lsof; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1
    return 0
  fi

  if have ss; then
    ss -ltnp 2>/dev/null | awk -v port=":${port}" '
      index($4, port) {
        if (match($0, /pid=[0-9]+/)) {
          print substr($0, RSTART + 4, RLENGTH - 4)
          exit
        }
      }
    '
    return 0
  fi

  return 1
}

panel_pid() {
  local file
  local pid

  file="$(pid_file)"
  if [[ -f "${file}" ]]; then
    pid="$(tr -d '[:space:]' < "${file}")"
    if [[ -n "${pid}" ]]; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi

  if is_current_panel_on_port; then
    pid="$(port_listener_pid)"
    if [[ -n "${pid}" ]]; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi
}

panel_running() {
  local pid
  pid="$(panel_pid)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  rm -f "$(pid_file)"
  return 1
}

port_in_use() {
  local pid
  pid="$(port_listener_pid || true)"
  [[ -n "${pid}" ]]
}

remember_running_panel_pid() {
  local pid
  pid="$(port_listener_pid || true)"
  if [[ -n "${pid}" ]]; then
    ensure_panel_state_dir
    printf '%s\n' "${pid}" > "$(pid_file)"
  fi
}

read_package_version() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    return 1
  fi

  sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${file}" | head -n 1
}

panel_local_version() {
  if ! is_project_dir "${ROOT_DIR}"; then
    return 0
  fi
  read_package_version "${ROOT_DIR}/package.json"
}

fetch_remote_file() {
  local relative_path="$1"
  curl -fsSL "https://raw.githubusercontent.com/${REMOTE_REPO}/${REMOTE_REF}/${relative_path}"
}

refresh_script_status() {
  SCRIPT_STATUS="unknown"
  SCRIPT_STATUS_TEXT="无法检查"
  SCRIPT_STATUS_TONE="warning"

  if ! have curl; then
    return
  fi

  local remote_bootstrap
  remote_bootstrap="$(fetch_remote_file "bootstrap.sh" 2>/dev/null || true)"
  if [[ -z "${remote_bootstrap}" ]]; then
    return
  fi

  SCRIPT_REMOTE_CACHE="${remote_bootstrap}"

  if [[ ! -f "${ROOT_DIR}/bootstrap.sh" ]]; then
    SCRIPT_STATUS="missing"
    SCRIPT_STATUS_TEXT="可安装"
    SCRIPT_STATUS_TONE="warning"
    return
  fi

  local local_sum remote_sum
  local_sum="$(cksum < "${ROOT_DIR}/bootstrap.sh" | awk '{print $1 ":" $2}')"
  remote_sum="$(printf '%s' "${remote_bootstrap}" | cksum | awk '{print $1 ":" $2}')"

  if [[ "${local_sum}" == "${remote_sum}" ]]; then
    SCRIPT_STATUS="latest"
    SCRIPT_STATUS_TEXT="已是最新"
    SCRIPT_STATUS_TONE="success"
  else
    SCRIPT_STATUS="outdated"
    SCRIPT_STATUS_TEXT="可更新"
    SCRIPT_STATUS_TONE="warning"
  fi
}

refresh_panel_status() {
  PANEL_STATUS="not-installed"
  PANEL_STATUS_TEXT="未安装"
  PANEL_STATUS_TONE="warning"
  PANEL_LOCAL_VERSION=""
  PANEL_REMOTE_VERSION=""

  if ! is_project_dir "${ROOT_DIR}"; then
    return
  fi

  PANEL_LOCAL_VERSION="$(panel_local_version)"
  PANEL_STATUS="installed"
  PANEL_STATUS_TEXT="已安装"
  PANEL_STATUS_TONE="success"

  if ! have curl; then
    return
  fi

  PANEL_REMOTE_VERSION="$(fetch_remote_file "package.json" 2>/dev/null | sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1 || true)"
  if [[ -z "${PANEL_REMOTE_VERSION}" ]]; then
    PANEL_STATUS_TEXT="已安装，远端未知"
    PANEL_STATUS_TONE="warning"
    return
  fi

  if [[ "${PANEL_LOCAL_VERSION}" == "${PANEL_REMOTE_VERSION}" ]]; then
    PANEL_STATUS="latest"
    PANEL_STATUS_TEXT="已是最新 ${PANEL_LOCAL_VERSION}"
    PANEL_STATUS_TONE="success"
  else
    PANEL_STATUS="outdated"
    PANEL_STATUS_TEXT="可更新 ${PANEL_LOCAL_VERSION} -> ${PANEL_REMOTE_VERSION}"
    PANEL_STATUS_TONE="warning"
  fi
}

refresh_runtime_state() {
  refresh_script_status
  refresh_panel_status
}

panel_action_label() {
  case "${PANEL_STATUS}" in
    not-installed) printf '安装面板' ;;
    outdated) printf '更新面板' ;;
    latest) printf '面板已是最新' ;;
    *) printf '安装 / 更新面板' ;;
  esac
}

script_action_label() {
  case "${SCRIPT_STATUS}" in
    latest) printf '脚本已是最新' ;;
    missing) printf '安装脚本' ;;
    outdated) printf '更新脚本' ;;
    *) printf '更新脚本' ;;
  esac
}

service_action_label() {
  if panel_running; then
    printf '停止面板'
  else
    printf '启动面板'
  fi
}

status_tone_color() {
  case "$1" in
    success) printf '%s' "${COLOR_SUCCESS}" ;;
    warning) printf '%s' "${COLOR_WARNING}" ;;
    danger) printf '%s' "${COLOR_DANGER}" ;;
    *) printf '%s' "${COLOR_MUTED}" ;;
  esac
}

clear_screen() {
  printf '\033[2J\033[H'
}

hide_cursor() {
  if [[ -t 1 ]]; then
    tput civis >/dev/null 2>&1 || true
  fi
}

show_cursor() {
  if [[ -t 1 ]]; then
    tput cnorm >/dev/null 2>&1 || true
  fi
}

cleanup() {
  show_cursor
}

trap cleanup EXIT INT TERM

prompt_input() {
  local title="$1"
  local prompt="$2"
  local default_value="$3"
  local value

  clear_screen >&2
  printf '%s╭──────────────────────────────────────────────────────────────╮%s\n' "${COLOR_PANEL}" "${COLOR_RESET}" >&2
  printf '%s│ %-60s │%s\n' "${COLOR_PANEL}" "${title}" "${COLOR_RESET}" >&2
  printf '%s╰──────────────────────────────────────────────────────────────╯%s\n\n' "${COLOR_PANEL}" "${COLOR_RESET}" >&2
  printf '%s\n' "${prompt}" >&2
  if [[ -n "${default_value}" ]]; then
    printf '%s[%s] %s' "${COLOR_MUTED}" "${default_value}" "${COLOR_RESET}" >&2
  fi
  IFS= read -r value </dev/tty
  if [[ -z "${value}" ]]; then
    value="${default_value}"
  fi
  printf '%s' "${value}"
}

prompt_secret() {
  local title="$1"
  local prompt="$2"
  local value

  clear_screen >&2
  printf '%s╭──────────────────────────────────────────────────────────────╮%s\n' "${COLOR_PANEL}" "${COLOR_RESET}" >&2
  printf '%s│ %-60s │%s\n' "${COLOR_PANEL}" "${title}" "${COLOR_RESET}" >&2
  printf '%s╰──────────────────────────────────────────────────────────────╯%s\n\n' "${COLOR_PANEL}" "${COLOR_RESET}" >&2
  printf '%s' "${prompt}" >&2
  IFS= read -rs value </dev/tty
  printf '\n' >&2
  printf '%s' "${value}"
}

confirm_action() {
  local title="$1"
  local question="$2"
  local expected="$3"
  local typed

  typed="$(prompt_input "${title}" "${question}" "")"
  [[ "${typed}" == "${expected}" ]]
}

start_panel() {
  ensure_node
  ensure_tools
  ROOT_DIR="$(resolve_root_dir)"
  ensure_web_config
  ensure_panel_state_dir

  if panel_running; then
    MESSAGE=""
    return
  fi

  if is_current_panel_on_port; then
    remember_running_panel_pid
    MESSAGE=""
    return
  fi

  if port_in_use; then
    local occupied_pid
    occupied_pid="$(port_listener_pid || true)"
    MESSAGE="端口 $(panel_port) 已被占用"
    if [[ -n "${occupied_pid}" ]]; then
      MESSAGE="${MESSAGE}（PID ${occupied_pid}）"
    fi
    MESSAGE="${MESSAGE}，且不是当前项目的面板。请先释放端口，或使用“修改端口”更换面板端口。"
    return
  fi

  local launch_log
  launch_log="$(log_file)"
  : > "${launch_log}"

  (
    cd "${ROOT_DIR}"
    if have setsid; then
      nohup setsid env -u HOST -u PORT node "${ROOT_DIR}/server/index.js" </dev/null >> "${launch_log}" 2>&1 &
    else
      nohup env -u HOST -u PORT node "${ROOT_DIR}/server/index.js" </dev/null >> "${launch_log}" 2>&1 &
    fi
    local launched_pid
    launched_pid=$!
    disown "${launched_pid}" 2>/dev/null || true
    echo "${launched_pid}" > "$(pid_file)"
  )

  sleep 1
  if panel_running || is_current_panel_on_port; then
    remember_running_panel_pid
    open_browser "$(panel_url)"
    MESSAGE=""
    return
  fi

  MESSAGE="面板启动失败。请检查日志：${launch_log}"
}

stop_panel() {
  if ! panel_running; then
    MESSAGE="面板当前未运行。"
    return
  fi

  local pid
  pid="$(panel_pid)"
  kill "${pid}" >/dev/null 2>&1 || true

  local attempt
  for attempt in 1 2 3 4 5; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi

  rm -f "$(pid_file)"
  MESSAGE="面板已停止。"
}

install_or_update_panel() {
  ensure_node
  ensure_tools

  local was_running="false"
  if panel_running; then
    was_running="true"
    stop_panel
  fi

  ROOT_DIR="$(resolve_root_dir)"
  ensure_web_config

  if [[ "${PANEL_STATUS}" == "not-installed" ]]; then
    MESSAGE="面板已安装到 ${ROOT_DIR}"
  else
    local preserved_config=""
    if [[ -f "$(web_config_path)" ]]; then
      preserved_config="$(mktemp)"
      cp "$(web_config_path)" "${preserved_config}"
    fi

    if [[ -d "${ROOT_DIR}/.git" ]] && git -C "${ROOT_DIR}" remote get-url origin >/dev/null 2>&1; then
      git -C "${ROOT_DIR}" pull --ff-only origin "${REMOTE_REF}"
    else
      local temp_dir
      temp_dir="$(mktemp -d "${CACHE_ROOT}/update-XXXXXX")"
      rm -rf "${temp_dir}"
      mkdir -p "${temp_dir}"
      download_repo_archive_to_dir "${REMOTE_REPO}" "${REMOTE_REF}" "${temp_dir}"
      cp -R "${temp_dir}/." "${ROOT_DIR}/"
      rm -rf "${temp_dir}"
    fi

    if [[ -n "${preserved_config}" && -f "${preserved_config}" ]]; then
      mkdir -p "$(dirname "$(web_config_path)")"
      cp "${preserved_config}" "$(web_config_path)"
      rm -f "${preserved_config}"
    fi

    MESSAGE="面板已更新到最新可用版本。"
  fi

  ensure_web_config

  if [[ "${was_running}" == "true" ]]; then
    start_panel
  fi
}

update_script_files() {
  ensure_tools

  local bootstrap_sh bootstrap_ps1
  bootstrap_sh="${SCRIPT_REMOTE_CACHE}"
  if [[ -z "${bootstrap_sh}" ]]; then
    bootstrap_sh="$(fetch_remote_file "bootstrap.sh" 2>/dev/null || true)"
  fi

  bootstrap_ps1="$(fetch_remote_file "bootstrap.ps1" 2>/dev/null || true)"

  if [[ -z "${bootstrap_sh}" ]]; then
    MESSAGE="无法从远端获取 bootstrap.sh。"
    return
  fi

  mkdir -p "${ROOT_DIR}"
  printf '%s' "${bootstrap_sh}" > "${ROOT_DIR}/bootstrap.sh"
  chmod +x "${ROOT_DIR}/bootstrap.sh"

  if [[ -n "${bootstrap_ps1}" ]]; then
    printf '%s' "${bootstrap_ps1}" > "${ROOT_DIR}/bootstrap.ps1"
  fi

  MESSAGE="脚本文件已更新到 ${ROOT_DIR}"
}

uninstall_panel() {
  if ! is_project_dir "${ROOT_DIR}"; then
    MESSAGE="当前目录没有已安装的面板。"
    return
  fi

  if ! confirm_action "卸载面板" "输入 DELETE 确认卸载面板并删除当前目录下的项目文件: " "DELETE"; then
    MESSAGE="已取消卸载。"
    return
  fi

  if panel_running; then
    stop_panel
  fi

  find "${ROOT_DIR}" -mindepth 1 -maxdepth 1 \
    ! -name 'bootstrap.sh' \
    ! -name 'bootstrap.ps1' \
    -exec rm -rf {} +

  MESSAGE="面板项目文件已卸载，已保留启动脚本。"
}

change_port() {
  ROOT_DIR="$(resolve_root_dir)"
  ensure_web_config

  local next_port
  next_port="$(prompt_input "修改端口" "请输入新的 Web 端口（1-65535）:" "$(panel_port)")"
  if [[ ! "${next_port}" =~ ^[0-9]+$ ]] || (( next_port < 1 || next_port > 65535 )); then
    MESSAGE="端口必须是 1-65535 之间的整数。"
    return
  fi

  yaml_replace_value "server" "port" "${next_port}"
  MESSAGE="端口已更新为 ${next_port}。如果面板正在运行，请重启面板使其生效。"
}

change_password() {
  ROOT_DIR="$(resolve_root_dir)"
  ensure_web_config

  local first second
  first="$(prompt_secret "修改密码" "请输入新的登录密码: ")"
  if [[ -z "${first}" ]]; then
    MESSAGE="密码不能为空。"
    return
  fi

  second="$(prompt_secret "修改密码" "请再次输入新的登录密码: ")"
  if [[ "${first}" != "${second}" ]]; then
    MESSAGE="两次输入的密码不一致。"
    return
  fi

  yaml_replace_value "auth" "password" "$(yaml_quote "${first}")"
  MESSAGE="登录密码已更新。新密码会在下一次登录时生效。"
}

render_option() {
  local key="$1"
  local label="$2"
  local description="$3"
  local selected="$4"

  if [[ "${selected}" == "true" ]]; then
    printf '%s%s  [%s] %-20s%s\n' "${COLOR_SELECTED_BG}${COLOR_SELECTED_FG}" "❯" "${key}" "${label}" "${COLOR_RESET}"
    printf '%s%s     %s%s\n' "${COLOR_SELECTED_BG}${COLOR_SELECTED_FG}" "" "${description}" "${COLOR_RESET}"
  else
    printf '%s%s  [%s] %-20s%s\n' "${COLOR_ACCENT}" " " "${key}" "${label}" "${COLOR_RESET}"
    printf '%s%s     %s%s\n' "${COLOR_MUTED}" "" "${description}" "${COLOR_RESET}"
  fi
}

draw_menu() {
  local selected_index="$1"
  local host="127.0.0.1"
  local port="31870"
  local password_preview="未设置"
  local runtime_text="未启动"
  local runtime_tone="warning"
  local openclaw_text="未检测"
  local openclaw_bin=""

  if is_project_dir "${ROOT_DIR}"; then
    ensure_web_config
    host="$(panel_host)"
    port="$(panel_port)"
    password_preview="$(panel_password)"
    if [[ -n "${password_preview}" ]]; then
      password_preview="$(printf '%*s' "${#password_preview}" '' | tr ' ' '*')"
    fi
  fi

  if panel_running; then
    runtime_text="运行中"
    runtime_tone="success"
  fi

  if openclaw_bin="$(detect_openclaw 2>/dev/null)"; then
    openclaw_text="${openclaw_bin}"
  fi

  clear_screen
  printf '%s╭──────────────────────────────────────────────────────────────────────────────╮%s\n' "${COLOR_PANEL}" "${COLOR_RESET}"
  printf '%s│ %-76s │%s\n' "${COLOR_PANEL}" "AutoOpenClaw Launcher" "${COLOR_RESET}"
  printf '%s│ %-76s │%s\n' "${COLOR_PANEL}" "↑/↓ 选择，Enter 执行，数字键可直达，Q 退出" "${COLOR_RESET}"
  printf '%s╰──────────────────────────────────────────────────────────────────────────────╯%s\n' "${COLOR_PANEL}" "${COLOR_RESET}"
  printf '\n'
  printf '%s项目目录%s %s\n' "${COLOR_DIM}" "${COLOR_RESET}" "${ROOT_DIR}"
  printf '%s面板地址%s %s\n' "${COLOR_DIM}" "${COLOR_RESET}" "http://${host}:${port}/"
  printf '%s运行状态%s %s%s%s\n' "${COLOR_DIM}" "${COLOR_RESET}" "$(status_tone_color "${runtime_tone}")" "${runtime_text}" "${COLOR_RESET}"
  printf '%s面板版本%s %s%s%s\n' "${COLOR_DIM}" "${COLOR_RESET}" "$(status_tone_color "${PANEL_STATUS_TONE}")" "${PANEL_STATUS_TEXT}" "${COLOR_RESET}"
  printf '%s脚本状态%s %s%s%s\n' "${COLOR_DIM}" "${COLOR_RESET}" "$(status_tone_color "${SCRIPT_STATUS_TONE}")" "${SCRIPT_STATUS_TEXT}" "${COLOR_RESET}"
  printf '%sOpenClaw%s %s\n' "${COLOR_DIM}" "${COLOR_RESET}" "${openclaw_text}"
  printf '%s当前密码%s %s\n' "${COLOR_DIM}" "${COLOR_RESET}" "${password_preview}"
  printf '\n'

  render_option "1" "$(script_action_label)" "同步 bootstrap 启动脚本到当前目录。" "$([[ "${selected_index}" -eq 0 ]] && printf 'true' || printf 'false')"
  render_option "2" "$(panel_action_label)" "检测本地面板版本并安装或更新项目文件。" "$([[ "${selected_index}" -eq 1 ]] && printf 'true' || printf 'false')"
  render_option "4" "$(service_action_label)" "启动本地 Web 面板；若已运行则停止。" "$([[ "${selected_index}" -eq 2 ]] && printf 'true' || printf 'false')"
  render_option "5" "卸载面板" "删除当前目录下的面板项目文件，保留启动脚本。" "$([[ "${selected_index}" -eq 3 ]] && printf 'true' || printf 'false')"
  render_option "6" "修改端口" "更新 config/web.yaml 中的 server.port。" "$([[ "${selected_index}" -eq 4 ]] && printf 'true' || printf 'false')"
  render_option "7" "修改密码" "更新 config/web.yaml 中的登录密码。" "$([[ "${selected_index}" -eq 5 ]] && printf 'true' || printf 'false')"
  render_option "8" "退出脚本" "关闭启动菜单，结束当前会话。" "$([[ "${selected_index}" -eq 6 ]] && printf 'true' || printf 'false')"

  if [[ -n "${MESSAGE}" ]]; then
    printf '\n%s%s%s\n' "${COLOR_WARNING}" "${MESSAGE}" "${COLOR_RESET}"
  fi
}

read_menu_key() {
  local key=""
  IFS= read -rsn1 key || true

  if [[ "${key}" == $'\x1b' ]]; then
    local rest=""
    IFS= read -rsn2 -t 1 rest || true
    case "${rest}" in
      "[A") printf 'up' ;;
      "[B") printf 'down' ;;
      *) printf 'noop' ;;
    esac
    return
  fi

  case "${key}" in
    "") printf 'enter' ;;
    $'\x0a'|$'\x0d') printf 'enter' ;;
    k|K) printf 'up' ;;
    j|J) printf 'down' ;;
    1|2|4|5|6|7|8) printf '%s' "${key}" ;;
    q|Q) printf '8' ;;
    *) printf 'noop' ;;
  esac
}

execute_selection() {
  local menu_key="$1"

  case "${menu_key}" in
    1)
      update_script_files
      ;;
    2)
      if [[ "${PANEL_STATUS}" == "latest" ]]; then
        MESSAGE="面板已是最新版本，无需更新。"
      else
        install_or_update_panel
      fi
      ;;
    4)
      if panel_running; then
        stop_panel
      else
        start_panel
      fi
      ;;
    5)
      uninstall_panel
      ;;
    6)
      change_port
      ;;
    7)
      change_password
      ;;
    8)
      clear_screen
      exit 0
      ;;
  esac
}

main() {
  local selected_index=0
  local action

  hide_cursor
  refresh_runtime_state

  while true; do
    draw_menu "${selected_index}"
    action="$(read_menu_key)"

    case "${action}" in
      up)
        if (( selected_index == 0 )); then
          selected_index=$((${#MENU_KEYS[@]} - 1))
        else
          selected_index=$((selected_index - 1))
        fi
        ;;
      down)
        selected_index=$(((selected_index + 1) % ${#MENU_KEYS[@]}))
        ;;
      enter)
        MESSAGE=""
        execute_selection "${MENU_KEYS[${selected_index}]}"
        refresh_runtime_state
        ;;
      1|2|4|5|6|7|8)
        MESSAGE=""
        execute_selection "${action}"
        refresh_runtime_state
        ;;
      noop)
        ;;
    esac
  done
}

main "$@"

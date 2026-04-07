const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { randomBytes, randomUUID, timingSafeEqual } = require("crypto");
const { spawn } = require("child_process");

const CONFIG_DIR = path.join(__dirname, "..", "config");
const WEB_CONFIG_PATH = path.join(CONFIG_DIR, "web.yaml");
const STATIC_DIR = path.join(__dirname, "..", "public");
const SESSION_COOKIE_NAME = "autoclaw_session";
const MAX_JOB_OUTPUT = 24_000;
const MAX_JOBS = 20;
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WEB_CONFIG = `# AutoOpenClaw Web manager configuration
# Changes to host/port require restarting the manager process.
# To allow remote access on a VPS:
# 1. set server.host to "0.0.0.0"
# 2. set security.loopbackOnly to false

server:
  host: "127.0.0.1"
  port: 31870

site:
  title: "AutoOpenClaw"
  subtitle: "本地优先、状态清晰、动作可回退的 OpenClaw 控制面板"

auth:
  enabled: true
  username: "admin"
  password: "change-this-password"
  sessionTtlHours: 12

security:
  loopbackOnly: true
`;
const DEFAULT_WEB_SETTINGS = {
  server: {
    host: "127.0.0.1",
    port: 31870,
  },
  site: {
    title: "AutoOpenClaw",
    subtitle: "本地优先、状态清晰、动作可回退的 OpenClaw 控制面板",
  },
  auth: {
    enabled: true,
    username: "admin",
    password: "change-this-password",
    sessionTtlHours: 12,
  },
  security: {
    loopbackOnly: true,
  },
};
const DEFAULT_CONFIG = `{
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "replace-me",
      allowTailscale: true,
    },
  },
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
    },
  },
  ui: {
    assistant: {
      name: "OpenClaw",
      avatar: "OC",
    },
  },
}`;

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:18789/";
const CLAWHUB_SKILLS_ENDPOINT = "https://wry-manatee-359.convex.cloud/api/query";

function ensureWebConfigFile() {
  if (fs.existsSync(WEB_CONFIG_PATH)) {
    return false;
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(WEB_CONFIG_PATH, DEFAULT_WEB_CONFIG, "utf8");
  return true;
}

function parseYamlScalar(value) {
  const text = String(value || "").trim();
  if (!text.length) return "";

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    const inner = text.slice(1, -1);
    if (text.startsWith('"')) {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }

  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }

  return text;
}

function parseSimpleYaml(raw) {
  const root = {};
  const stack = [{ indent: -2, value: root }];
  const lines = String(raw || "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const indent = line.match(/^ */)[0].length;
    if (indent % 2 !== 0) {
      throw new Error(`web.yaml 第 ${index + 1} 行缩进必须使用 2 个空格。`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (indent > parent.indent + 2) {
      throw new Error(`web.yaml 第 ${index + 1} 行缩进层级不合法。`);
    }

    const content = line.slice(indent);
    const separatorIndex = content.indexOf(":");
    if (separatorIndex < 1) {
      throw new Error(`web.yaml 第 ${index + 1} 行格式不正确。`);
    }

    const key = content.slice(0, separatorIndex).trim();
    const remainder = content.slice(separatorIndex + 1).trim();

    if (!remainder) {
      const child = {};
      parent.value[key] = child;
      stack.push({ indent, value: child });
      return;
    }

    parent.value[key] = parseYamlScalar(remainder);
  });

  return root;
}

function validatePositiveInteger(value, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}必须是 ${min}-${max} 之间的整数。`);
  }
  return number;
}

function validatePort(value, label = "Gateway 端口") {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label}必须是 1-65535 之间的整数。`);
  }
  return port;
}

function normalizeWebConfig(rawConfig = {}) {
  const server = rawConfig.server || {};
  const site = rawConfig.site || {};
  const auth = rawConfig.auth || {};
  const security = rawConfig.security || {};

  const host = String(server.host ?? DEFAULT_WEB_SETTINGS.server.host).trim();
  const title = String(site.title ?? DEFAULT_WEB_SETTINGS.site.title).trim();
  const subtitle = String(site.subtitle ?? DEFAULT_WEB_SETTINGS.site.subtitle).trim();
  const username = String(auth.username ?? DEFAULT_WEB_SETTINGS.auth.username).trim();
  const password = String(auth.password ?? DEFAULT_WEB_SETTINGS.auth.password);

  if (!host) {
    throw new Error("Web 服务 host 不能为空。");
  }

  if (!title) {
    throw new Error("站点标题不能为空。");
  }

  if (!subtitle) {
    throw new Error("站点副标题不能为空。");
  }

  const enabled =
    typeof auth.enabled === "boolean" ? auth.enabled : DEFAULT_WEB_SETTINGS.auth.enabled;

  if (enabled && !username) {
    throw new Error("启用登录后，用户名不能为空。");
  }

  if (enabled && !password.trim()) {
    throw new Error("启用登录后，密码不能为空。");
  }

  return {
    server: {
      host,
      port: validatePort(server.port ?? DEFAULT_WEB_SETTINGS.server.port, "Web 页面端口"),
    },
    site: {
      title,
      subtitle,
    },
    auth: {
      enabled,
      username,
      password,
      sessionTtlHours: validatePositiveInteger(
        auth.sessionTtlHours ?? DEFAULT_WEB_SETTINGS.auth.sessionTtlHours,
        "登录会话时长",
        1,
        168
      ),
    },
    security: {
      loopbackOnly:
        typeof security.loopbackOnly === "boolean"
          ? security.loopbackOnly
          : DEFAULT_WEB_SETTINGS.security.loopbackOnly,
    },
  };
}

function loadWebConfig() {
  ensureWebConfigFile();
  const raw = fs.readFileSync(WEB_CONFIG_PATH, "utf8");
  const parsed = parseSimpleYaml(raw);
  return normalizeWebConfig(parsed);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtmlTemplate(raw) {
  return String(raw)
    .replaceAll("{{APP_TITLE}}", escapeHtml(WEB_CONFIG.site.title))
    .replaceAll("{{APP_SUBTITLE}}", escapeHtml(WEB_CONFIG.site.subtitle))
    .replaceAll("{{APP_HOST}}", escapeHtml(HOST));
}

function parseCookies(header) {
  return String(header || "")
    .split(/;\s*/)
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex < 0) {
        return cookies;
      }
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

const WEB_CONFIG = loadWebConfig();
const HOST = process.env.HOST || WEB_CONFIG.server.host;
const PORT = Number(process.env.PORT || WEB_CONFIG.server.port);

function json(data, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function send(res, payload) {
  res.writeHead(payload.statusCode, payload.headers);
  res.end(payload.body);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildExecutableCommand(binary, args = []) {
  if (process.platform === "win32") {
    const parts = [`& '${String(binary).replace(/'/g, "''")}'`];
    args.forEach((arg) => {
      parts.push(`'${String(arg).replace(/'/g, "''")}'`);
    });
    return parts.join(" ");
  }

  return [escapeShell(binary), ...args.map(escapeShell)].join(" ");
}

function hasCommand(command) {
  return new Promise((resolve) => {
    const checker =
      process.platform === "win32"
        ? spawn("where", [command], { stdio: "ignore" })
        : spawn("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    checker.on("close", (code) => resolve(code === 0));
    checker.on("error", () => resolve(false));
  });
}

function buildShellExecution(command, options = {}) {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : "bash";
  const args = isWindows
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
    : ["-lc", command];

  return {
    shell,
    args,
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
  };
}

function runCommand(command, options = {}) {
  const execution = buildShellExecution(command, options);

  return new Promise((resolve) => {
    const child = spawn(execution.shell, execution.args, {
      env: execution.env,
      cwd: execution.cwd,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: `${stderr}${error.message}\n`,
        command,
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        command,
      });
    });
  });
}

const actionJobs = new Map();
const sessions = new Map();
let latestVersionCache = null;

function sessionTtlMs() {
  return WEB_CONFIG.auth.sessionTtlHours * 60 * 60 * 1000;
}

function setSessionCookie(token) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(sessionTtlMs() / 1000)}`,
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

function pruneSessions() {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (!session || session.expiresAt <= now) {
      sessions.delete(token);
    }
  });
}

function getSession(req) {
  if (!WEB_CONFIG.auth.enabled) {
    return {
      username: WEB_CONFIG.auth.username,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }

  pruneSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function isAuthenticated(req) {
  return Boolean(getSession(req));
}

function createSession(username) {
  pruneSessions();
  const token = randomBytes(32).toString("hex");
  const session = {
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionTtlMs(),
  };
  sessions.set(token, session);
  return { token, session };
}

function destroySession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    sessions.delete(token);
  }
}

function publicSessionData(req) {
  return {
    authenticated: isAuthenticated(req),
    authEnabled: WEB_CONFIG.auth.enabled,
    appTitle: WEB_CONFIG.site.title,
    appSubtitle: WEB_CONFIG.site.subtitle,
    configPath: WEB_CONFIG_PATH,
    sessionTtlHours: WEB_CONFIG.auth.sessionTtlHours,
    loopbackOnly: WEB_CONFIG.security.loopbackOnly,
  };
}

function trimJobBuffer(value) {
  if (!value) return "";
  return value.length > MAX_JOB_OUTPUT
    ? value.slice(value.length - MAX_JOB_OUTPUT)
    : value;
}

function normalizeVersion(value) {
  const text = String(value || "").trim();
  const match = text.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : "";
}

function extractFirstUrl(value) {
  const text = String(value || "");
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : "";
}

function buildDashboardUrl(rawValue) {
  const fallback = DEFAULT_DASHBOARD_URL;
  const candidate = extractFirstUrl(rawValue) || fallback;

  try {
    const url = new URL(candidate);
    url.hostname = HOST;
    return url.toString();
  } catch {
    return fallback.replace("127.0.0.1", HOST);
  }
}

function extractConfigBlock(raw, blockName) {
  const marker = new RegExp(`${blockName}\\s*:\\s*\\{`, "m");
  const match = marker.exec(String(raw || ""));
  if (!match) return "";

  let depth = 0;
  let start = match.index + match[0].length - 1;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start + 1, index);
      }
    }
  }

  return "";
}

function extractConfigString(raw, key) {
  const match = new RegExp(`${key}\\s*:\\s*"([^"]+)"`, "m").exec(String(raw || ""));
  return match ? match[1] : "";
}

function extractConfigNumber(raw, key) {
  const match = new RegExp(`${key}\\s*:\\s*(\\d+)`, "m").exec(String(raw || ""));
  return match ? Number(match[1]) : null;
}

function generateGatewaySecret() {
  return randomBytes(24).toString("hex");
}

function boolFromBody(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function pushFlag(args, name, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  args.push(name, String(value));
}

function updateJobBuffer(job, field, chunk) {
  job[field] = trimJobBuffer(`${job[field]}${chunk.toString()}`);
  job.updatedAt = new Date().toISOString();
}

function pruneJobs() {
  while (actionJobs.size > MAX_JOBS) {
    const oldestKey = actionJobs.keys().next().value;
    if (!oldestKey) {
      break;
    }
    actionJobs.delete(oldestKey);
  }
}

function serializeJob(job) {
  return {
    id: job.id,
    action: job.action,
    status: job.status,
    ok: job.ok,
    code: job.code,
    command: job.command,
    stdout: job.stdout,
    stderr: job.stderr,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function createFinishedJob(action, result) {
  const stamp = new Date().toISOString();
  const job = {
    id: randomUUID(),
    action,
    status: "finished",
    ok: result.ok,
    code: result.code,
    command: result.command,
    stdout: trimJobBuffer(result.stdout || ""),
    stderr: trimJobBuffer(result.stderr || ""),
    createdAt: stamp,
    updatedAt: stamp,
  };
  actionJobs.set(job.id, job);
  pruneJobs();
  return job;
}

function startActionJob(action, command, options = {}) {
  const stamp = new Date().toISOString();
  const execution = buildShellExecution(command, options);
  const job = {
    id: randomUUID(),
    action,
    status: "running",
    ok: null,
    code: null,
    command,
    stdout: "",
    stderr: "",
    createdAt: stamp,
    updatedAt: stamp,
  };

  actionJobs.set(job.id, job);
  pruneJobs();

  const child = spawn(execution.shell, execution.args, {
    env: execution.env,
    cwd: execution.cwd,
  });

  child.stdout.on("data", (chunk) => {
    updateJobBuffer(job, "stdout", chunk);
  });

  child.stderr.on("data", (chunk) => {
    updateJobBuffer(job, "stderr", chunk);
  });

  child.on("error", (error) => {
    updateJobBuffer(job, "stderr", `${error.message}\n`);
    job.status = "finished";
    job.ok = false;
    job.code = 1;
    job.updatedAt = new Date().toISOString();
  });

  child.on("close", (code) => {
    job.status = "finished";
    job.ok = code === 0;
    job.code = code;
    job.updatedAt = new Date().toISOString();
  });

  return job;
}

async function detectPackageManager() {
  if (process.platform === "darwin") {
    return (await hasCommand("brew")) ? "brew" : "homebrew-missing";
  }
  if (process.platform === "win32") {
    if (await hasCommand("winget")) return "winget";
    if (await hasCommand("choco")) return "choco";
    if (await hasCommand("scoop")) return "scoop";
    return "windows-manual";
  }
  if (await hasCommand("apt-get")) return "apt";
  if (await hasCommand("dnf")) return "dnf";
  if (await hasCommand("yum")) return "yum";
  if (await hasCommand("pacman")) return "pacman";
  if (await hasCommand("zypper")) return "zypper";
  return "unknown";
}

async function detectGlobalJsManager() {
  if (await hasCommand("npm")) return "npm";
  if (await hasCommand("pnpm")) return "pnpm";
  if (await hasCommand("bun")) return "bun";
  return null;
}

async function getLatestOpenClawVersion() {
  const now = Date.now();
  if (latestVersionCache && now - latestVersionCache.checkedAt < VERSION_CACHE_TTL_MS) {
    return latestVersionCache;
  }

  if (!(await hasCommand("npm"))) {
    latestVersionCache = {
      version: "",
      source: "unavailable",
      error: "npm not found",
      checkedAt: now,
    };
    return latestVersionCache;
  }

  const result = await runCommand("npm view openclaw@latest version --json");
  const version = normalizeVersion(result.stdout);

  latestVersionCache = {
    version,
    source: version ? "npm" : "unavailable",
    error: version ? "" : trimOutput(result.stderr || result.stdout || "Unable to resolve latest version."),
    checkedAt: now,
  };

  return latestVersionCache;
}

function getPaths() {
  const home = os.homedir();
  if (process.platform === "win32") {
    return {
      home,
      configPath:
        process.env.OPENCLAW_CONFIG_PATH ||
        path.join(home, ".openclaw", "openclaw.json"),
      localBinary: path.join(home, ".local", "bin", "openclaw.cmd"),
      localPrefix: path.join(home, ".openclaw"),
    };
  }

  return {
    home,
    configPath:
      process.env.OPENCLAW_CONFIG_PATH ||
      path.join(home, ".openclaw", "openclaw.json"),
    localBinary: path.join(home, ".openclaw", "bin", "openclaw"),
    localPrefix: path.join(home, ".openclaw"),
  };
}

function ensureConfigFile(configPath) {
  if (fs.existsSync(configPath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${DEFAULT_CONFIG}\n`, "utf8");
  return true;
}

function isOutsidePrefix(targetPath, prefixPath) {
  const target = path.resolve(targetPath);
  const prefix = `${path.resolve(prefixPath)}${path.sep}`;
  return !target.startsWith(prefix);
}

async function resolveOpenClawBinary() {
  if (await hasCommand("openclaw")) {
    return "openclaw";
  }
  const paths = getPaths();
  if (fs.existsSync(paths.localBinary)) {
    return paths.localBinary;
  }
  return null;
}

function trimOutput(value) {
  return value.trim().slice(0, 8000);
}

function expandHome(targetPath) {
  const text = String(targetPath || "").trim();
  if (!text) {
    return "";
  }

  if (text === "~") {
    return os.homedir();
  }

  if (text.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), text.slice(2));
  }

  return text;
}

function extractSkillSummary(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  let inFrontmatter = false;
  for (const line of lines) {
    if (!line) continue;
    if (line === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    if (line.startsWith("#")) continue;
    return line;
  }

  return "";
}

function listSkillsInDirectory(rootPath, scope) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(rootPath, entry.name);
      const skillFile = path.join(skillPath, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        return null;
      }

      const raw = fs.readFileSync(skillFile, "utf8");
      return {
        id: entry.name,
        name: entry.name,
        summary: extractSkillSummary(raw),
        path: skillPath,
        scope,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function readDirectoryNames(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function findSkillDirectory(rootPath) {
  if (fs.existsSync(path.join(rootPath, "SKILL.md"))) {
    return rootPath;
  }

  const entries = readDirectoryNames(rootPath);
  for (const entry of entries) {
    const childPath = path.join(rootPath, entry);
    if (fs.existsSync(path.join(childPath, "SKILL.md"))) {
      return childPath;
    }
  }

  return "";
}

async function fetchPublicSkillsPage(cursor = "") {
  const pageArgs = {
    dir: "desc",
    highlightedOnly: false,
    nonSuspiciousOnly: true,
    numItems: 25,
    sort: "downloads",
  };

  if (stringOrEmpty(cursor)) {
    pageArgs.cursor = String(cursor);
  }

  const response = await fetch(CLAWHUB_SKILLS_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      origin: "https://clawhub.ai",
      referer: "https://clawhub.ai/",
      "convex-client": "npm-1.34.0",
    },
    body: JSON.stringify({
      path: "skills:listPublicPageV4",
      format: "convex_encoded_json",
      args: [pageArgs],
    }),
  });

  if (!response.ok) {
    throw new Error(`ClawHub 请求失败: ${response.status}`);
  }

  const payload = await response.json();
  const page = Array.isArray(payload?.value?.page) ? payload.value.page : [];

  return {
    hasMore: Boolean(payload?.value?.hasMore),
    nextCursor: payload?.value?.nextCursor || null,
    items: page.map((entry) => ({
      id: String(entry?.skill?._id || ""),
      slug: String(entry?.skill?.slug || ""),
      name: String(entry?.skill?.displayName || entry?.skill?.slug || "未命名技能"),
      summary: String(entry?.skill?.summary || ""),
      downloads: Number(entry?.skill?.stats?.downloads || 0),
      installs: Number(entry?.skill?.stats?.installsCurrent || 0),
      stars: Number(entry?.skill?.stats?.stars || 0),
      ownerHandle: String(entry?.ownerHandle || entry?.owner?.handle || ""),
      ownerName: String(entry?.owner?.displayName || ""),
      version: String(entry?.latestVersion?.version || ""),
      highlighted: Boolean(entry?.skill?.badges?.highlighted),
      url: entry?.skill?.slug ? `https://clawhub.ai/skills/${entry.skill.slug}` : "https://clawhub.ai",
    })),
  };
}

async function getSkillsData(cursor = "", includeInstalled = true) {
  const onboarding = await getOnboardingDefaults();
  const workspace = expandHome(onboarding.values.workspace || "~/.openclaw/workspace");
  const sharedRoot = path.join(os.homedir(), ".openclaw", "skills");
  const workspaceRoot = path.join(workspace, "skills");
  const installed = includeInstalled
    ? [
        ...listSkillsInDirectory(workspaceRoot, "workspace"),
        ...listSkillsInDirectory(sharedRoot, "shared"),
      ]
    : [];

  let store = {
    hasMore: false,
    nextCursor: null,
    items: [],
    error: "",
  };

  try {
    const result = await fetchPublicSkillsPage(cursor);
    store = {
      ...result,
      error: "",
    };
  } catch (error) {
    store.error = error.message;
  }

  return {
    store,
    installed,
    workspaceRoot,
    sharedRoot,
  };
}

async function installSkillBySlug({ slug, scope, workspace }) {
  const cleanedSlug = stringOrEmpty(slug);
  if (!cleanedSlug) {
    throw new Error("技能 slug 不能为空。");
  }

  const installScope = stringOrEmpty(scope || "workspace");
  if (!["workspace", "shared"].includes(installScope)) {
    throw new Error("安装位置必须是 workspace 或 shared。");
  }

  const onboarding = await getOnboardingDefaults();
  const defaultWorkspace = expandHome(onboarding.values.workspace || "~/.openclaw/workspace");
  const targetWorkspace =
    installScope === "shared"
      ? path.join(os.homedir(), ".openclaw")
      : expandHome(workspace || defaultWorkspace);
  const skillsRoot = path.join(targetWorkspace, "skills");
  const installPath = path.join(skillsRoot, cleanedSlug);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autoclaw-skill-"));
  const zipPath = path.join(tempRoot, `${cleanedSlug}.zip`);
  const unpackRoot = path.join(tempRoot, "unzipped");
  const downloadUrl = `https://wry-manatee-359.convex.site/api/v1/download?slug=${encodeURIComponent(
    cleanedSlug
  )}`;

  try {
    if (!(await hasCommand("unzip"))) {
      throw new Error("本机缺少 unzip，无法解压 skills 包。");
    }

    const response = await fetch(downloadUrl, {
      headers: {
        accept: "*/*",
        origin: "https://clawhub.ai",
        referer: "https://clawhub.ai/",
      },
    });

    if (!response.ok) {
      throw new Error(`下载 skill 失败: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(unpackRoot, { recursive: true });
    fs.writeFileSync(zipPath, buffer);

    const unzipResult = await runCommand(
      `${buildExecutableCommand("unzip", ["-oq", zipPath, "-d", unpackRoot])}`
    );
    if (!unzipResult.ok) {
      throw new Error(trimOutput(unzipResult.stderr || unzipResult.stdout || "解压失败"));
    }

    const extractedSkillDir = findSkillDirectory(unpackRoot);
    if (!extractedSkillDir) {
      throw new Error("下载包中未找到 SKILL.md，无法安装。");
    }

    fs.mkdirSync(skillsRoot, { recursive: true });
    rmrf(installPath);
    fs.cpSync(extractedSkillDir, installPath, { recursive: true });

    return {
      ok: true,
      slug: cleanedSlug,
      scope: installScope,
      installedPath: installPath,
      downloadUrl,
    };
  } finally {
    rmrf(tempRoot);
  }
}

function gatewayServiceInstalled(statusText) {
  const text = String(statusText || "").trim();
  if (!text) {
    return false;
  }

  return !/Service not installed|Service unit not found/i.test(text);
}

function gatewayServiceLoaded(statusText) {
  const text = String(statusText || "").trim();
  if (!text) {
    return false;
  }

  return (
    gatewayServiceInstalled(text) &&
    !/not loaded|RPC probe:\s*failed|Runtime:\s*unknown/i.test(text)
  );
}

function gatewayStartNeedsInstall(statusText) {
  return /Service not installed|Service unit not found/i.test(String(statusText || ""));
}

function gatewayStartFailed(statusText) {
  const text = String(statusText || "");
  return (
    gatewayStartNeedsInstall(text) ||
    /not loaded|RPC probe:\s*failed|Runtime:\s*unknown/i.test(text)
  );
}

function buildGatewayStartCommand(binary, gatewayStatusText) {
  const installStep = gatewayStartNeedsInstall(gatewayStatusText)
    ? [buildExecutableCommand(binary, ["gateway", "install"])]
    : [];

  const statusCommand = buildExecutableCommand(binary, ["gateway", "status"]);
  const startCommand = buildExecutableCommand(binary, ["gateway", "start"]);

  if (process.platform === "win32") {
    return [
      ...installStep,
      startCommand,
      `$statusOutput = ${statusCommand} 2>&1 | Out-String`,
      "Write-Output $statusOutput",
      "if ($statusOutput -match 'Service not installed|Service unit not found|not loaded|RPC probe:\\s*failed|Runtime:\\s*unknown') { exit 1 }",
    ].join("; ");
  }

  return [
    ...installStep,
    startCommand,
    `status_output="$(${statusCommand} 2>&1)"`,
    'printf "%s\\n" "$status_output"',
    `if printf "%s" "$status_output" | grep -Eiq 'Service not installed|Service unit not found|not loaded|RPC probe:[[:space:]]*failed|Runtime:[[:space:]]*unknown'; then exit 1; fi`,
  ].join(" ; ");
}

async function getStatus() {
  const paths = getPaths();
  const binary = await resolveOpenClawBinary();
  const packageManager = await detectPackageManager();
  const latest = await getLatestOpenClawVersion();
  const commands = {
    curl: await hasCommand("curl"),
    git: await hasCommand("git"),
    node: await hasCommand("node"),
  };

  const version = binary
    ? await runCommand(buildExecutableCommand(binary, ["--version"]))
    : { ok: false, stdout: "", stderr: "" };
  const gatewayStatus = binary
    ? await runCommand(buildExecutableCommand(binary, ["gateway", "status"]))
    : { ok: false, stdout: "", stderr: "" };
  const dashboardInfo = binary
    ? await runCommand(buildExecutableCommand(binary, ["dashboard", "--no-open"]))
    : { ok: false, stdout: "", stderr: "" };

  let configRaw = "";
  let configExists = false;
  if (fs.existsSync(paths.configPath)) {
    configExists = true;
    configRaw = fs.readFileSync(paths.configPath, "utf8");
  }

  const installedVersion = normalizeVersion(version.stdout || version.stderr || "");
  const latestVersion = latest.version;
  const gatewayStatusText = trimOutput(gatewayStatus.stdout || gatewayStatus.stderr || "");
  const serviceInstalled = gatewayServiceInstalled(gatewayStatusText);
  const serviceLoaded = gatewayServiceLoaded(gatewayStatusText);
  const dashboardUrl = buildDashboardUrl(dashboardInfo.stdout || dashboardInfo.stderr || "");
  const versionKnown = Boolean(installedVersion);
  const latestKnown = Boolean(latestVersion);
  const updateAvailable =
    Boolean(binary) &&
    versionKnown &&
    latestKnown &&
    installedVersion !== latestVersion;
  const upToDate =
    Boolean(binary) &&
    versionKnown &&
    latestKnown &&
    installedVersion === latestVersion;

  return {
    manager: {
      title: WEB_CONFIG.site.title,
      subtitle: WEB_CONFIG.site.subtitle,
      host: HOST,
      port: PORT,
      url: `http://${HOST}:${PORT}/`,
      configPath: WEB_CONFIG_PATH,
      authEnabled: WEB_CONFIG.auth.enabled,
      sessionTtlHours: WEB_CONFIG.auth.sessionTtlHours,
      loopbackOnly: WEB_CONFIG.security.loopbackOnly,
    },
    system: {
      platform: process.platform,
      release: os.release(),
      arch: os.arch(),
      packageManager,
      nodeVersion: process.version,
      commands,
    },
    openclaw: {
      installed: Boolean(binary),
      binary,
      version: trimOutput(version.stdout || version.stderr || ""),
      installedVersion,
      latestVersion,
      latestVersionSource: latest.source,
      latestVersionError: latest.error,
      versionKnown,
      latestKnown,
      updateAvailable,
      upToDate,
      status: gatewayStatusText,
      serviceInstalled,
      serviceLoaded,
      dashboardUrl,
      configPath: paths.configPath,
      localPrefix: paths.localPrefix,
      configExists,
      configRaw,
    },
  };
}

async function getOnboardingDefaults() {
  const paths = getPaths();
  const binary = await resolveOpenClawBinary();
  const raw = fs.existsSync(paths.configPath)
    ? fs.readFileSync(paths.configPath, "utf8")
    : DEFAULT_CONFIG;
  const gatewayBlock = extractConfigBlock(raw, "gateway");
  const authBlock = extractConfigBlock(gatewayBlock, "auth");
  const agentsBlock = extractConfigBlock(raw, "agents");
  const defaultsBlock = extractConfigBlock(agentsBlock, "defaults");

  const gatewayAuthMode = extractConfigString(authBlock, "mode") || "token";
  const gatewayToken = extractConfigString(authBlock, "token") || generateGatewaySecret();
  const gatewayPassword = extractConfigString(authBlock, "password");
  const gatewayBind = extractConfigString(gatewayBlock, "bind") || "loopback";
  const gatewayPort = extractConfigNumber(gatewayBlock, "port") || 18789;
  const workspace =
    extractConfigString(defaultsBlock, "workspace") || "~/.openclaw/workspace";

  return {
    installed: Boolean(binary),
    configPath: paths.configPath,
    values: {
      authChoice: "skip",
      modelApiKey: "",
      workspace,
      gatewayAuth: gatewayAuthMode === "password" ? "password" : "token",
      gatewayToken,
      gatewayPassword,
      gatewayBind,
      gatewayPort,
      installDaemon: true,
      riskAccepted: false,
    },
  };
}

async function buildOnboardingCommand(body) {
  const binary = await resolveOpenClawBinary();
  if (!binary) {
    throw new Error("OpenClaw 尚未安装，无法运行初始化向导。");
  }

  const authChoice = stringOrEmpty(body.authChoice || "skip");
  const allowedAuthChoices = new Set([
    "skip",
    "openai-api-key",
    "anthropic-api-key",
    "gemini-api-key",
    "openrouter-api-key",
  ]);
  if (!allowedAuthChoices.has(authChoice)) {
    throw new Error("暂不支持该模型认证类型。");
  }

  if (!boolFromBody(body.riskAccepted)) {
    throw new Error("请先确认你理解 agent 具备本机执行能力。");
  }

  const workspace = stringOrEmpty(body.workspace || "~/.openclaw/workspace");
  if (!workspace) {
    throw new Error("Workspace 不能为空。");
  }

  const gatewayAuth = stringOrEmpty(body.gatewayAuth || "token");
  if (!["token", "password"].includes(gatewayAuth)) {
    throw new Error("Gateway 认证方式必须是 token 或 password。");
  }

  const gatewayBind = stringOrEmpty(body.gatewayBind || "loopback");
  if (!["loopback", "tailnet", "lan", "auto", "custom"].includes(gatewayBind)) {
    throw new Error("Gateway 绑定方式不合法。");
  }

  const gatewayPort = validatePort(body.gatewayPort || 18789);
  const installDaemon = boolFromBody(body.installDaemon, true);
  const modelApiKey = stringOrEmpty(body.modelApiKey);
  const gatewayToken =
    gatewayAuth === "token"
      ? stringOrEmpty(body.gatewayToken || generateGatewaySecret())
      : "";
  const gatewayPassword =
    gatewayAuth === "password" ? stringOrEmpty(body.gatewayPassword) : "";

  if (gatewayAuth === "token" && !gatewayToken) {
    throw new Error("Token 模式下必须提供 Gateway Token。");
  }

  if (gatewayAuth === "password" && !gatewayPassword) {
    throw new Error("Password 模式下必须提供 Gateway Password。");
  }

  if (authChoice !== "skip" && !modelApiKey) {
    throw new Error("选择模型认证后，需要填写对应的 API Key。");
  }

  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--mode",
    "local",
    "--flow",
    "manual",
    "--auth-choice",
    authChoice,
    "--workspace",
    workspace,
    "--gateway-auth",
    gatewayAuth,
    "--gateway-bind",
    gatewayBind,
    "--gateway-port",
    gatewayPort,
    "--skip-channels",
    "--skip-search",
    "--skip-skills",
    "--skip-ui",
  ];

  if (installDaemon) {
    args.push("--install-daemon");
  } else {
    args.push("--no-install-daemon");
  }

  if (gatewayAuth === "token") {
    pushFlag(args, "--gateway-token", gatewayToken);
  } else {
    pushFlag(args, "--gateway-password", gatewayPassword);
  }

  if (authChoice === "openai-api-key") {
    pushFlag(args, "--openai-api-key", modelApiKey);
  } else if (authChoice === "anthropic-api-key") {
    pushFlag(args, "--anthropic-api-key", modelApiKey);
  } else if (authChoice === "gemini-api-key") {
    pushFlag(args, "--gemini-api-key", modelApiKey);
  } else if (authChoice === "openrouter-api-key") {
    pushFlag(args, "--openrouter-api-key", modelApiKey);
  }

  return buildExecutableCommand(binary, args);
}

async function installCommand() {
  const binary = await resolveOpenClawBinary();
  if (binary) {
    return buildExecutableCommand(binary, ["update"]);
  }

  const paths = getPaths();
  if (process.platform === "win32") {
    return '& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard';
  }

  return [
    "curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh",
    `| bash -s -- --prefix ${escapeShell(paths.localPrefix)} --no-onboard`,
  ].join(" ");
}

async function uninstallCommand() {
  const binary = await resolveOpenClawBinary();
  const paths = getPaths();
  const globalManager = await detectGlobalJsManager();
  const commands = [];
  const removeExternalConfig = isOutsidePrefix(paths.configPath, paths.localPrefix);

  if (binary) {
    commands.push(buildExecutableCommand(binary, ["uninstall", "--all", "--yes", "--non-interactive"]));
  }

  if (process.platform === "win32") {
    if (globalManager === "npm") {
      commands.push("npm rm -g openclaw");
    } else if (globalManager === "pnpm") {
      commands.push("pnpm remove -g openclaw");
    } else if (globalManager === "bun") {
      commands.push("bun remove -g openclaw");
    }
    commands.push(
      `if (Test-Path '${String(paths.localPrefix).replace(/'/g, "''")}') { Remove-Item -Recurse -Force '${String(
        paths.localPrefix
      ).replace(/'/g, "''")}' }`
    );
    if (removeExternalConfig) {
      commands.push(
        `if (Test-Path '${String(paths.configPath).replace(/'/g, "''")}') { Remove-Item -Force '${String(
          paths.configPath
        ).replace(/'/g, "''")}' }`
      );
    }
    return commands.join("; ");
  }

  if (binary === "openclaw" && globalManager === "npm") {
    commands.push("npm rm -g openclaw");
  } else if (binary === "openclaw" && globalManager === "pnpm") {
    commands.push("pnpm remove -g openclaw");
  } else if (binary === "openclaw" && globalManager === "bun") {
    commands.push("bun remove -g openclaw");
  }

  commands.push(`rm -rf ${escapeShell(paths.localPrefix)}`);
  if (removeExternalConfig) {
    commands.push(`rm -f ${escapeShell(paths.configPath)}`);
  }
  return commands.join(" ; ");
}

async function resolveManagedAction(action) {
  const binary = await resolveOpenClawBinary();
  const paths = getPaths();

  if (action === "install" || action === "start") {
    ensureConfigFile(paths.configPath);
  }

  let gatewayStatusText = "";
  if (binary && action === "start") {
    const gatewayStatus = await runCommand(buildExecutableCommand(binary, ["gateway", "status"]));
    gatewayStatusText = trimOutput(gatewayStatus.stdout || gatewayStatus.stderr || "");
  }

  const startCommand = binary ? buildGatewayStartCommand(binary, gatewayStatusText) : null;

  const actions = {
    install: await installCommand(),
    uninstall: await uninstallCommand(),
    doctor: binary
      ? buildExecutableCommand(binary, ["doctor", "--non-interactive"])
      : null,
    status: binary ? buildExecutableCommand(binary, ["gateway", "status"]) : null,
    restart: binary
      ? buildExecutableCommand(binary, ["gateway", "restart"])
      : null,
    start: startCommand,
    stop: binary ? buildExecutableCommand(binary, ["gateway", "stop"]) : null,
    dashboard:
      binary
        ? buildExecutableCommand(binary, ["dashboard", "--no-open"])
        : process.platform === "win32"
          ? `Write-Output '${DEFAULT_DASHBOARD_URL}'`
          : `printf '${DEFAULT_DASHBOARD_URL}\\n'`,
  };

  const command = actions[action];
  if (!command) {
    return {
      runnable: false,
      ok: false,
      code: 1,
      stdout: "",
      stderr:
        action === "install"
          ? "Unsupported install target.\n"
          : "OpenClaw is not installed yet.\n",
      command: "",
    };
  }

  return {
    runnable: true,
    command,
    env:
      action === "install"
        ? { SHARP_IGNORE_GLOBAL_LIBVIPS: "1" }
        : undefined,
  };
}

async function startManagedAction(action) {
  const resolved = await resolveManagedAction(action);
  if (!resolved.runnable) {
    return createFinishedJob(action, resolved);
  }

  return startActionJob(action, resolved.command, {
    env: resolved.env,
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function ensureLoopback(req) {
  const remote = req.socket.remoteAddress || "";
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1"
  );
}

function ensureAllowedClient(req) {
  return !WEB_CONFIG.security.loopbackOnly || ensureLoopback(req);
}

function normalizePathname(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function loginRedirectLocation(pathname) {
  const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return `/login${next}`;
}

function resolveStaticPath(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === "/") return "/index.html";
  if (normalizedPathname === "/login") return "/login.html";
  return normalizedPathname;
}

function backupName(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.bak-${stamp}`;
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function handleApi(req, res, pathname) {
  const normalizedPathname = normalizePathname(pathname);

  if (!ensureAllowedClient(req)) {
    send(res, json({ error: "Loopback only." }, 403));
    return;
  }

  if (req.method === "GET" && normalizedPathname === "/api/session") {
    send(res, json(publicSessionData(req)));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/login") {
    if (!WEB_CONFIG.auth.enabled) {
      send(res, json({ ok: true, ...publicSessionData(req) }));
      return;
    }

    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const username = stringOrEmpty(body.username);
    const password = String(body.password || "");

    if (
      !safeEqual(username, WEB_CONFIG.auth.username) ||
      !safeEqual(password, WEB_CONFIG.auth.password)
    ) {
      send(res, json({ error: "用户名或密码错误。" }, 401));
      return;
    }

    const { token } = createSession(username);
    send(
      res,
      json(
        {
          ok: true,
          ...publicSessionData(req),
          authenticated: true,
        },
        200,
        {
          "Set-Cookie": setSessionCookie(token),
        }
      )
    );
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/logout") {
    destroySession(req);
    send(
      res,
      json(
        {
          ok: true,
          ...publicSessionData(req),
          authenticated: false,
        },
        200,
        {
          "Set-Cookie": clearSessionCookie(),
        }
      )
    );
    return;
  }

  if (WEB_CONFIG.auth.enabled && !isAuthenticated(req)) {
    send(res, json({ error: "请先登录。", loginUrl: "/login" }, 401));
    return;
  }

  if (req.method === "GET" && normalizedPathname === "/api/status") {
    send(res, json(await getStatus()));
    return;
  }

  if (req.method === "GET" && normalizedPathname === "/api/onboard") {
    send(res, json(await getOnboardingDefaults()));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/action") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const action = body.action;
    const job = await startManagedAction(action);
    send(res, json(serializeJob(job), 202));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/onboard") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const command = await buildOnboardingCommand(body);
    const job = startActionJob("onboard", command);
    send(res, json(serializeJob(job), 202));
    return;
  }

  if (req.method === "GET" && normalizedPathname.startsWith("/api/action/")) {
    const jobId = normalizedPathname.slice("/api/action/".length);
    const job = actionJobs.get(jobId);
    if (!job) {
      send(res, json({ error: "Action job not found." }, 404));
      return;
    }
    send(res, json(serializeJob(job)));
    return;
  }

  if (req.method === "GET" && normalizedPathname === "/api/config") {
    const paths = getPaths();
    if (!fs.existsSync(paths.configPath)) {
      send(
        res,
        json({
          exists: false,
          configPath: paths.configPath,
          raw: DEFAULT_CONFIG,
        })
      );
      return;
    }
    send(
      res,
      json({
        exists: true,
        configPath: paths.configPath,
        raw: fs.readFileSync(paths.configPath, "utf8"),
      })
    );
    return;
  }

  if (req.method === "GET" && normalizedPathname === "/api/skills") {
    send(res, json(await getSkillsData()));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/skills/page") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    send(res, json(await getSkillsData(body.cursor, false)));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/skills/install") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    send(res, json(await installSkillBySlug(body)));
    return;
  }

  if (req.method === "POST" && normalizedPathname === "/api/config") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const nextRaw = String(body.raw || "").trim();
    const paths = getPaths();
    fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
    if (fs.existsSync(paths.configPath)) {
      fs.copyFileSync(paths.configPath, backupName(paths.configPath));
    }
    fs.writeFileSync(paths.configPath, `${nextRaw}\n`, "utf8");
    send(
      res,
      json({
        ok: true,
        configPath: paths.configPath,
      })
    );
    return;
  }

  send(res, json({ error: "Not found." }, 404));
}

function serveStatic(res, pathname) {
  const cleanPath = resolveStaticPath(pathname);
  const filePath = path.join(STATIC_DIR, cleanPath);
  if (!filePath.startsWith(STATIC_DIR) || !fs.existsSync(filePath)) {
    send(
      res,
      json({ error: "Not found." }, 404)
    );
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store",
  });
  if (filePath.endsWith(".html")) {
    res.end(renderHtmlTemplate(fs.readFileSync(filePath, "utf8")));
    return;
  }
  res.end(fs.readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const normalizedPathname = normalizePathname(url.pathname);

    if (normalizedPathname.startsWith("/api/")) {
      await handleApi(req, res, normalizedPathname);
      return;
    }

    if (!ensureAllowedClient(req)) {
      send(res, json({ error: "Loopback only." }, 403));
      return;
    }

    const authenticated = isAuthenticated(req);
    const isLoginPage =
      normalizedPathname === "/login" || normalizedPathname === "/login.html";

    if (isLoginPage) {
      if (!WEB_CONFIG.auth.enabled || authenticated) {
        redirect(res, "/");
        return;
      }
      serveStatic(res, normalizedPathname);
      return;
    }

    if (
      WEB_CONFIG.auth.enabled &&
      !authenticated &&
      (normalizedPathname === "/" || normalizedPathname.endsWith(".html"))
    ) {
      redirect(res, loginRedirectLocation(`${normalizedPathname}${url.search || ""}`));
      return;
    }

    serveStatic(res, normalizedPathname);
  } catch (error) {
    send(
      res,
      json(
        {
          error: error.message,
        },
        500
      )
    );
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `AutoOpenClaw manager running at http://${HOST}:${PORT}/\n`
  );
});

server.on("error", (error) => {
  process.stderr.write(`AutoOpenClaw manager failed: ${error.message}\n`);
  process.exit(1);
});

const statusList = document.querySelector("#status-list");
const platformChip = document.querySelector("#platform-chip");
const installSummaryCard = document.querySelector("#install-summary-card");
const heroInstallState = document.querySelector("#hero-install-state");
const heroInstallDetail = document.querySelector("#hero-install-detail");
const gatewaySummaryCard = document.querySelector("#gateway-summary-card");
const heroGatewayState = document.querySelector("#hero-gateway-state");
const heroGatewayDetail = document.querySelector("#hero-gateway-detail");
const configSummaryCard = document.querySelector("#config-summary-card");
const heroConfigState = document.querySelector("#hero-config-state");
const heroConfigDetail = document.querySelector("#hero-config-detail");
const gatewayInstalledCard = document.querySelector("#gateway-installed-card");
const gatewayLoadedCard = document.querySelector("#gateway-loaded-card");
const gatewayServiceInstalled = document.querySelector("#gateway-service-installed");
const gatewayServiceLoaded = document.querySelector("#gateway-service-loaded");
const consoleOutput = document.querySelector("#console-output");
const configEditor = document.querySelector("#config-editor");
const configPath = document.querySelector("#config-path");
const dashboardLink = document.querySelector("#dashboard-link");
const installButton = document.querySelector("#install-button");
const wizardChip = document.querySelector("#wizard-chip");
const onboardForm = document.querySelector("#onboard-form");
const authChoiceInput = document.querySelector("#auth-choice");
const modelApiKeyField = document.querySelector("#model-api-key-field");
const modelApiKeyInput = document.querySelector("#model-api-key");
const workspaceInput = document.querySelector("#workspace-input");
const gatewayBindInput = document.querySelector("#gateway-bind");
const gatewayPortInput = document.querySelector("#gateway-port");
const gatewayAuthInput = document.querySelector("#gateway-auth");
const gatewayTokenField = document.querySelector("#gateway-token-field");
const gatewayTokenInput = document.querySelector("#gateway-token");
const gatewayPasswordField = document.querySelector("#gateway-password-field");
const gatewayPasswordInput = document.querySelector("#gateway-password");
const installDaemonInput = document.querySelector("#install-daemon");
const riskAcceptedInput = document.querySelector("#risk-accepted");
const reloadOnboardButton = document.querySelector("#reload-onboard");
const runOnboardButton = document.querySelector("#run-onboard");
const saveConfigButton = document.querySelector("#save-config");
const reloadConfigButton = document.querySelector("#reload-config");
const refreshStatusButton = document.querySelector("#refresh-status");
const actionButtons = Array.from(document.querySelectorAll("[data-action]"));

const presets = {
  minimal: `{
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "replace-me",
    },
  },
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
    },
  },
}`,
  lan: `{
  gateway: {
    port: 18789,
    bind: "lan",
    auth: {
      mode: "token",
      token: "replace-me-with-a-long-random-token",
      allowTailscale: true,
    },
  },
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
    },
  },
}`,
  multiAgent: `{
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "replace-me",
    },
  },
  agents: {
    list: [
      { id: "home", default: true, workspace: "~/.openclaw/workspace-home" },
      { id: "work", workspace: "~/.openclaw/workspace-work" },
    ],
  },
  bindings: [
    { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
    { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } },
  ],
}`,
  whitelist: `{
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "replace-me",
    },
  },
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: {
        "*": {
          requireMention: true,
        },
      },
    },
  },
  messages: {
    groupChat: {
      mentionPatterns: ["@openclaw"],
    },
  },
}`,
};

const state = {
  busy: false,
  installLocked: false,
  onboardingLocked: false,
};

function printConsole(title, payload) {
  const sections = [title];
  if (payload.command) sections.push(`$ ${payload.command}`);
  if (payload.stdout) sections.push(payload.stdout);
  if (payload.stderr) sections.push(payload.stderr);
  consoleOutput.textContent = sections.join("\n\n").trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setHidden(element, hidden) {
  element.hidden = hidden;
  element.classList.toggle("is-hidden", hidden);
}

function setChipTone(element, tone = "neutral") {
  if (tone === "neutral") {
    delete element.dataset.tone;
    return;
  }

  element.dataset.tone = tone;
}

function setSurfaceTone(element, tone = "neutral") {
  if (!element) return;
  if (tone === "neutral") {
    delete element.dataset.tone;
    return;
  }

  element.dataset.tone = tone;
}

function clearOnboardValidationState() {
  onboardForm
    .querySelectorAll(".is-invalid")
    .forEach((element) => element.classList.remove("is-invalid"));
}

function markInvalidField(input) {
  input.classList.add("is-invalid");
  input.focus();
}

function markInvalidSwitch(input) {
  const row = input.closest(".switch-row");
  if (row) {
    row.classList.add("is-invalid");
  }
  input.focus();
}

function validateOnboardForm() {
  clearOnboardValidationState();

  if (state.onboardingLocked) {
    return "请先安装 OpenClaw，再运行初始化向导。";
  }

  if (gatewayPortInput.value.trim()) {
    const port = Number(gatewayPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      markInvalidField(gatewayPortInput);
      return "Gateway 端口必须是 1-65535 之间的整数。";
    }
  }

  if (authChoiceInput.value !== "skip" && !modelApiKeyInput.value.trim()) {
    markInvalidField(modelApiKeyInput);
    return "选择模型认证后，需要填写对应的 API Key。";
  }

  if (gatewayAuthInput.value === "password" && !gatewayPasswordInput.value.trim()) {
    markInvalidField(gatewayPasswordInput);
    return "Password 模式下必须提供 Gateway Password。";
  }

  if (!riskAcceptedInput.checked) {
    markInvalidSwitch(riskAcceptedInput);
    return "请先确认你理解 agent 具备本机执行能力。";
  }

  return "";
}

function applyBusyState() {
  actionButtons.forEach((button) => {
    if (state.busy) {
      button.disabled = true;
      return;
    }

    if (button === installButton) {
      button.disabled = state.installLocked;
      return;
    }

    button.disabled = false;
  });

  refreshStatusButton.disabled = state.busy;
  saveConfigButton.disabled = state.busy;
  reloadConfigButton.disabled = state.busy;
  reloadOnboardButton.disabled = state.busy;
  runOnboardButton.disabled = state.busy || state.onboardingLocked;
  onboardForm.querySelectorAll("input, select").forEach((field) => {
    field.disabled = state.busy;
  });
}

function syncOnboardFieldVisibility() {
  const needsModelApiKey = authChoiceInput.value !== "skip";
  const useToken = gatewayAuthInput.value === "token";

  setHidden(modelApiKeyField, !needsModelApiKey);
  modelApiKeyInput.required = needsModelApiKey;

  setHidden(gatewayTokenField, !useToken);
  gatewayTokenInput.required = useToken;

  setHidden(gatewayPasswordField, useToken);
  gatewayPasswordInput.required = !useToken;
}

function statusLabel(job) {
  if (job.status === "running") return "执行中";
  if (job.ok) return "已完成";
  return "失败";
}

async function pollActionJob(jobId, action) {
  while (true) {
    const job = await fetchJson(`/api/action/${jobId}`);
    printConsole(`动作: ${action} (${statusLabel(job)})`, job);
    if (job.status !== "running") {
      return job;
    }
    await sleep(1200);
  }
}

function renderStatus(status) {
  const boolLabel = (value, yesLabel, noLabel) => (value ? yesLabel : noLabel);
  const statusTone = (value, negativeTone = "warning") => (value ? "success" : negativeTone);
  const latestVersionText = status.openclaw.latestKnown
    ? status.openclaw.latestVersion
    : status.openclaw.latestVersionError || "未知";
  const updateText = !status.openclaw.installed
    ? "未安装"
    : status.openclaw.upToDate
      ? "已是最新版"
      : status.openclaw.updateAvailable
        ? "有可用更新"
        : "无法判断";
  const items = [
    ["平台", `${status.system.platform} / ${status.system.arch}`],
    ["系统版本", status.system.release],
    ["Node", status.system.nodeVersion],
    ["包管理器", status.system.packageManager],
    ["curl", boolLabel(status.system.commands.curl, "可用", "缺失")],
    ["git", boolLabel(status.system.commands.git, "可用", "缺失")],
    ["OpenClaw 已安装", boolLabel(status.openclaw.installed, "已安装", "未安装")],
    ["OpenClaw 路径", status.openclaw.binary || "未找到"],
    ["OpenClaw 版本", status.openclaw.version || "未知"],
    ["最新版本", latestVersionText],
    ["更新状态", updateText],
    ["配置文件", status.openclaw.configPath],
    ["本地前缀", status.openclaw.localPrefix],
    ["Dashboard", status.openclaw.dashboardUrl],
  ];

  statusList.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="status-row"><dt>${label}</dt><dd>${String(value)}</dd></div>`
    )
    .join("");

  platformChip.textContent = `${status.system.platform} ${status.system.arch}`;
  setChipTone(platformChip, "neutral");
  heroInstallState.textContent = boolLabel(status.openclaw.installed, "已安装", "未安装");
  heroInstallDetail.textContent = !status.openclaw.installed
    ? "点击上方安装按钮开始部署。"
    : status.openclaw.updateAvailable
      ? `当前 ${status.openclaw.version || "已安装"}，可更新到 ${latestVersionText}。`
      : status.openclaw.version || "已检测到本地安装。";
  setSurfaceTone(
    installSummaryCard,
    !status.openclaw.installed ? "warning" : status.openclaw.updateAvailable ? "warning" : "success"
  );
  heroGatewayState.textContent = boolLabel(status.openclaw.serviceLoaded, "已加载", "未加载");
  heroGatewayDetail.textContent = status.openclaw.serviceLoaded
    ? status.openclaw.dashboardUrl
    : status.openclaw.serviceInstalled
      ? "服务已安装，等待启动。"
      : "服务尚未安装。";
  setSurfaceTone(
    gatewaySummaryCard,
    status.openclaw.serviceLoaded ? "success" : status.openclaw.serviceInstalled ? "warning" : "danger"
  );
  heroConfigState.textContent = boolLabel(status.openclaw.configExists, "已检测", "未创建");
  heroConfigDetail.textContent = status.openclaw.configPath;
  setSurfaceTone(configSummaryCard, status.openclaw.configExists ? "success" : "warning");
  gatewayServiceInstalled.textContent = boolLabel(
    status.openclaw.serviceInstalled,
    "已安装",
    "未安装"
  );
  setSurfaceTone(gatewayInstalledCard, statusTone(status.openclaw.serviceInstalled, "danger"));
  gatewayServiceLoaded.textContent = boolLabel(
    status.openclaw.serviceLoaded,
    "已加载",
    "未加载"
  );
  setSurfaceTone(
    gatewayLoadedCard,
    status.openclaw.serviceLoaded ? "success" : status.openclaw.serviceInstalled ? "warning" : "danger"
  );
  configPath.textContent = status.openclaw.configPath;
  configPath.title = status.openclaw.configPath;
  dashboardLink.href = status.openclaw.dashboardUrl;

  if (!status.openclaw.installed) {
    installButton.textContent = "安装 OpenClaw";
    state.installLocked = false;
  } else if (status.openclaw.upToDate) {
    installButton.textContent = "已是最新版本";
    state.installLocked = true;
  } else if (status.openclaw.updateAvailable) {
    installButton.textContent = "更新 OpenClaw";
    state.installLocked = false;
  } else {
    installButton.textContent = "安装 / 更新 OpenClaw";
    state.installLocked = false;
  }

  if (!status.openclaw.installed) {
    wizardChip.textContent = "先安装";
    setChipTone(wizardChip, "warning");
    state.onboardingLocked = true;
  } else if (!status.openclaw.configExists) {
    wizardChip.textContent = "可初始化";
    setChipTone(wizardChip, "success");
    state.onboardingLocked = false;
  } else {
    wizardChip.textContent = "已配置";
    setChipTone(wizardChip, "success");
    state.onboardingLocked = false;
  }

  applyBusyState();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadStatus() {
  const status = await fetchJson("/api/status");
  renderStatus(status);
  return status;
}

async function loadConfig() {
  const config = await fetchJson("/api/config");
  configEditor.value = config.raw;
  configPath.textContent = config.configPath;
  configPath.title = config.configPath;
}

function fillOnboardForm(values) {
  authChoiceInput.value = values.authChoice || "skip";
  modelApiKeyInput.value = values.modelApiKey || "";
  workspaceInput.value = values.workspace || "~/.openclaw/workspace";
  gatewayBindInput.value = values.gatewayBind || "loopback";
  gatewayPortInput.value = String(values.gatewayPort || 18789);
  gatewayAuthInput.value = values.gatewayAuth || "token";
  gatewayTokenInput.value = values.gatewayToken || "";
  gatewayPasswordInput.value = values.gatewayPassword || "";
  installDaemonInput.checked = Boolean(values.installDaemon);
  riskAcceptedInput.checked = Boolean(values.riskAccepted);
  syncOnboardFieldVisibility();
}

async function loadOnboardDefaults() {
  const data = await fetchJson("/api/onboard");
  fillOnboardForm(data.values);
  if (!data.installed) {
    wizardChip.textContent = "先安装";
    setChipTone(wizardChip, "warning");
    state.onboardingLocked = true;
    applyBusyState();
  }
}

function readOnboardPayload() {
  return {
    authChoice: authChoiceInput.value,
    modelApiKey: modelApiKeyInput.value,
    workspace: workspaceInput.value,
    gatewayBind: gatewayBindInput.value,
    gatewayPort: gatewayPortInput.value,
    gatewayAuth: gatewayAuthInput.value,
    gatewayToken: gatewayTokenInput.value,
    gatewayPassword: gatewayPasswordInput.value,
    installDaemon: installDaemonInput.checked,
    riskAccepted: riskAcceptedInput.checked,
  };
}

async function runAction(action) {
  if (
    action === "uninstall" &&
    !window.confirm(
      "这会卸载 OpenClaw 服务并删除本地状态、配置和安装目录。确认继续？"
    )
  ) {
    printConsole("已取消卸载", {});
    return;
  }

  printConsole(`执行 ${action}...`, {
    stdout:
      action === "install"
        ? "正在调用 OpenClaw 官方安装器。首次安装通常需要几分钟；如果网络较慢，日志会稍后出现。"
        : "",
  });
  const job = await fetchJson("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const result = await pollActionJob(job.id, action);
  await Promise.all([loadStatus(), loadConfig(), loadOnboardDefaults()]);
  return result;
}

async function runOnboarding() {
  printConsole("执行 onboard...", {
    stdout:
      "正在调用 openclaw onboard --non-interactive。这个流程会跳过 channels / skills / search，只完成本地 Gateway 初始化。",
  });
  const job = await fetchJson("/api/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readOnboardPayload()),
  });
  const result = await pollActionJob(job.id, "onboard");
  await Promise.all([loadStatus(), loadConfig(), loadOnboardDefaults()]);
  return result;
}

refreshStatusButton.addEventListener("click", async () => {
  state.busy = true;
  applyBusyState();
  try {
    await loadStatus();
    printConsole("状态已刷新", {});
  } finally {
    state.busy = false;
    applyBusyState();
  }
});

reloadConfigButton.addEventListener("click", async () => {
  state.busy = true;
  applyBusyState();
  try {
    await loadConfig();
    printConsole("配置已重新读取", {});
  } finally {
    state.busy = false;
    applyBusyState();
  }
});

saveConfigButton.addEventListener("click", async () => {
  state.busy = true;
  applyBusyState();
  try {
    const result = await fetchJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: configEditor.value }),
    });
    printConsole("配置已保存", {
      stdout: `saved: ${result.configPath}`,
    });
    await Promise.all([loadStatus(), loadOnboardDefaults()]);
  } catch (error) {
    printConsole("保存配置失败", { stderr: error.message });
  } finally {
    state.busy = false;
    applyBusyState();
  }
});

reloadOnboardButton.addEventListener("click", async () => {
  state.busy = true;
  applyBusyState();
  try {
    await loadOnboardDefaults();
    printConsole("初始化向导默认值已刷新", {});
  } catch (error) {
    printConsole("加载向导默认值失败", { stderr: error.message });
  } finally {
    state.busy = false;
    applyBusyState();
  }
});

authChoiceInput.addEventListener("change", syncOnboardFieldVisibility);
gatewayAuthInput.addEventListener("change", syncOnboardFieldVisibility);

onboardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const validationError = validateOnboardForm();
  if (validationError) {
    printConsole("初始化向导未开始", { stderr: validationError });
    return;
  }

  state.busy = true;
  applyBusyState();
  try {
    await runOnboarding();
  } catch (error) {
    printConsole("初始化向导失败", { stderr: error.message });
  } finally {
    state.busy = false;
    applyBusyState();
  }
});

actionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    state.busy = true;
    applyBusyState();
    try {
      await runAction(button.dataset.action);
    } catch (error) {
      printConsole(`动作失败: ${button.dataset.action}`, {
        stderr: error.message,
      });
    } finally {
      state.busy = false;
      applyBusyState();
    }
  });
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    configEditor.value = presets[button.dataset.preset];
    printConsole(`已载入模板: ${button.dataset.label || button.textContent.trim()}`, {});
  });
});

Promise.all([loadStatus(), loadConfig(), loadOnboardDefaults()])
  .then(() => {
    applyBusyState();
  })
  .catch((error) => {
    printConsole("初始化失败", { stderr: error.message });
  });

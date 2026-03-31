import { dom } from "./dom.mjs";
import { state } from "./state.mjs";

function boolLabel(value, yesLabel, noLabel) {
  return value ? yesLabel : noLabel;
}

function statusTone(value, negativeTone = "warning") {
  return value ? "success" : negativeTone;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function printConsole(title, payload = {}) {
  const sections = [title];

  if (payload.command) sections.push(`$ ${payload.command}`);
  if (payload.stdout) sections.push(payload.stdout);
  if (payload.stderr) sections.push(payload.stderr);

  dom.consoleOutput.textContent = sections.join("\n\n").trim();
}

export function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  element.classList.toggle("is-hidden", hidden);
}

export function setChipTone(element, tone = "neutral") {
  if (!element) return;

  if (tone === "neutral") {
    delete element.dataset.tone;
    return;
  }

  element.dataset.tone = tone;
}

export function setSurfaceTone(element, tone = "neutral") {
  if (!element) return;

  if (tone === "neutral") {
    delete element.dataset.tone;
    return;
  }

  element.dataset.tone = tone;
}

function isValidViewId(viewId) {
  return dom.viewPanels.some((panel) => panel.id === viewId);
}

function buildLocationUrl(viewId = state.activeViewId) {
  const url = new URL(window.location.href);
  url.hash = `#${viewId}`;

  if (viewId === "skills-view") {
    const search = String(state.skills.search || "").trim();
    if (search) {
      url.searchParams.set("q", search);
    } else {
      url.searchParams.delete("q");
    }

    if (state.skills.filter) {
      url.searchParams.set("filter", state.skills.filter);
    } else {
      url.searchParams.delete("filter");
    }
  } else {
    url.searchParams.delete("q");
    url.searchParams.delete("filter");
  }

  return url;
}

export function getViewIdFromLocation() {
  const hashViewId = String(window.location.hash || "").replace(/^#/, "").trim();
  return isValidViewId(hashViewId) ? hashViewId : "dashboard-view";
}

export function syncSkillsStateFromLocation() {
  const url = new URL(window.location.href);
  state.skills.search = url.searchParams.get("q") || "";

  const filter = url.searchParams.get("filter");
  state.skills.filter = filter === "uninstalled" ? "uninstalled" : "installed";
}

export function syncSkillsQueryToLocation() {
  const nextUrl = buildLocationUrl();
  window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

export function setActiveView(viewId, options = {}) {
  const nextViewId = isValidViewId(viewId) ? viewId : "dashboard-view";
  state.activeViewId = nextViewId;

  dom.viewButtons.forEach((button) => {
    const isActive = button.dataset.viewTarget === nextViewId;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });

  dom.viewPanels.forEach((panel) => {
    panel.hidden = panel.id !== nextViewId;
  });

  if (options.updateHash !== false) {
    const nextUrl = buildLocationUrl(nextViewId);
    const nextLocation = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentLocation !== nextLocation) {
      window.history.replaceState(null, "", nextLocation);
    }
  }
}

export function syncActiveViewFromLocation() {
  setActiveView(getViewIdFromLocation(), {
    updateHash: false,
  });
}

export function updateSyncStamp() {
  state.lastSyncAt = Date.now();
  dom.lastSyncStamp.textContent = `同步于 ${new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(state.lastSyncAt))}`;
}

export function applyBusyState() {
  dom.lockedControls.forEach((control) => {
    control.disabled = state.busy;
  });

  dom.actionButtons.forEach((button) => {
    if (button === dom.installButton) {
      button.disabled = state.busy || state.installLocked;
      return;
    }

    button.disabled = state.busy;
  });

  dom.refreshStatusButton.disabled = state.busy;
  dom.logoutButton.disabled = state.busy;
  dom.runOnboardButton.disabled = state.busy || state.onboardingLocked;
}

export function syncOnboardFieldVisibility() {
  const needsModelApiKey = dom.authChoiceInput.value !== "skip";
  const useToken = dom.gatewayAuthInput.value === "token";

  setHidden(dom.modelApiKeyField, !needsModelApiKey);
  dom.modelApiKeyInput.required = needsModelApiKey;

  setHidden(dom.gatewayTokenField, !useToken);
  dom.gatewayTokenInput.required = useToken;

  setHidden(dom.gatewayPasswordField, useToken);
  dom.gatewayPasswordInput.required = !useToken;
}

export function clearOnboardValidationState() {
  dom.onboardForm
    .querySelectorAll(".is-invalid")
    .forEach((element) => element.classList.remove("is-invalid"));
}

export function markInvalidField(input) {
  input.classList.add("is-invalid");
  input.focus();
}

export function markInvalidSwitch(input) {
  const row = input.closest(".switch-row");
  if (row) {
    row.classList.add("is-invalid");
  }

  input.focus();
}

export function validateOnboardForm() {
  clearOnboardValidationState();

  if (state.onboardingLocked) {
    return "请先安装 OpenClaw，再运行初始化向导。";
  }

  if (dom.gatewayPortInput.value.trim()) {
    const port = Number(dom.gatewayPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      markInvalidField(dom.gatewayPortInput);
      return "Gateway 端口必须是 1-65535 之间的整数。";
    }
  }

  if (dom.authChoiceInput.value !== "skip" && !dom.modelApiKeyInput.value.trim()) {
    markInvalidField(dom.modelApiKeyInput);
    return "选择模型认证后，需要填写对应的 API Key。";
  }

  if (dom.gatewayAuthInput.value === "password" && !dom.gatewayPasswordInput.value.trim()) {
    markInvalidField(dom.gatewayPasswordInput);
    return "Password 模式下必须提供 Gateway Password。";
  }

  if (!dom.riskAcceptedInput.checked) {
    markInvalidSwitch(dom.riskAcceptedInput);
    return "请先确认你理解 agent 具备本机执行能力。";
  }

  return "";
}

export function fillOnboardForm(values) {
  dom.authChoiceInput.value = values.authChoice || "skip";
  dom.modelApiKeyInput.value = values.modelApiKey || "";
  dom.workspaceInput.value = values.workspace || "~/.openclaw/workspace";
  dom.gatewayBindInput.value = values.gatewayBind || "loopback";
  dom.gatewayPortInput.value = String(values.gatewayPort || 18789);
  dom.gatewayAuthInput.value = values.gatewayAuth || "token";
  dom.gatewayTokenInput.value = values.gatewayToken || "";
  dom.gatewayPasswordInput.value = values.gatewayPassword || "";
  dom.installDaemonInput.checked = Boolean(values.installDaemon);
  dom.riskAcceptedInput.checked = Boolean(values.riskAccepted);
  syncOnboardFieldVisibility();
}

export function renderConfig(config) {
  dom.configEditor.value = config.raw;
  dom.configPath.textContent = config.configPath;
  dom.configPath.title = config.configPath;
}

function skillKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "-";
}

function buildWorkspaceOptions() {
  const map = new Map();

  const defaultWorkspace = String(state.designer.workspace || "").trim();
  if (defaultWorkspace) {
    map.set(defaultWorkspace, {
      path: defaultWorkspace,
      labels: ["默认"],
    });
  }

  state.designer.agents.forEach((agent) => {
    const workspace = String(agent.workspace || "").trim();
    if (!workspace) return;

    const current = map.get(workspace) || { path: workspace, labels: [] };
    current.labels.push(agent.name?.trim() || agent.id?.trim() || "agent");
    map.set(workspace, current);
  });

  return Array.from(map.values());
}

function buildSkillRows(data) {
  const installedMap = new Map();

  data.installed.forEach((skill) => {
    const keys = new Set([skillKey(skill.id), skillKey(skill.name)]);
    keys.forEach((key) => {
      if (!key) return;
      const current = installedMap.get(key) || [];
      current.push(skill);
      installedMap.set(key, current);
    });
  });

  const matchedInstalledKeys = new Set();
  const rows = data.store.items.map((skill) => {
    const matches = [
      ...(installedMap.get(skillKey(skill.slug)) || []),
      ...(installedMap.get(skillKey(skill.name)) || []),
    ].filter((item, index, list) => list.findIndex((entry) => entry.path === item.path) === index);

    matches.forEach((match) => {
      matchedInstalledKeys.add(match.path);
    });

    return {
      name: skill.name,
      slug: skill.slug,
      summary: skill.summary,
      owner: skill.ownerName || skill.ownerHandle || "未知",
      version: skill.version || "未知",
      downloads: formatCount(skill.downloads),
      installed: matches.length > 0,
      source: matches.length > 0 ? matches.map((item) => item.scope).join(" / ") : "ClawHub",
      url: skill.url,
    };
  });

  data.installed
    .filter((skill) => !matchedInstalledKeys.has(skill.path))
    .forEach((skill) => {
      rows.push({
        name: skill.name,
        slug: skill.id,
        summary: skill.summary,
        owner: "本地",
        version: "-",
        downloads: "-",
        installed: true,
        source: skill.scope,
        url: "",
      });
    });

  return rows;
}

function mergeSkillStorePages(currentItems, nextItems) {
  const merged = [...currentItems];
  const seen = new Set(currentItems.map((item) => skillKey(item.slug || item.id)));

  nextItems.forEach((item) => {
    const key = skillKey(item.slug || item.id);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  });

  return merged;
}

function renderSkillInstallModal() {
  const options = buildWorkspaceOptions();

  if (!state.skills.installModal.workspace && options[0]) {
    state.skills.installModal.workspace = options[0].path;
  }

  dom.skillInstallName.textContent = state.skills.installModal.name
    ? `准备安装 ${state.skills.installModal.name}`
    : "选择安装位置后确认。";
  dom.skillInstallScope.value = state.skills.installModal.scope;
  dom.skillInstallWorkspace.innerHTML = options
    .map((option) => {
      const selected = option.path === state.skills.installModal.workspace ? " selected" : "";
      const label = option.labels.length
        ? `${option.path} (${option.labels.join(" / ")})`
        : option.path;
      return `<option value="${escapeHtml(option.path)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  setHidden(dom.skillInstallWorkspaceWrap, state.skills.installModal.scope !== "workspace");
  setHidden(dom.skillInstallModal, !state.skills.installModal.open);
}

export function renderSkills(data) {
  const rows = buildSkillRows(data);
  const search = state.skills.search.trim().toLowerCase();
  const filter = state.skills.filter;

  dom.skillsSearchInput.value = state.skills.search;
  dom.skillsFilterInput.value = state.skills.filter;
  dom.skillsSummaryChip.textContent = `${rows.length} 个技能`;

  if (data.store.error) {
    dom.skillsStoreHint.textContent = `商店读取失败: ${data.store.error}`;
  } else {
    dom.skillsStoreHint.textContent = "已按下载量读取 ClawHub 技能，可继续下滑自动加载。";
  }

  const filteredRows = rows.filter((skill) => {
    if (filter === "installed" && !skill.installed) {
      return false;
    }
    if (filter === "uninstalled" && skill.installed) {
      return false;
    }
    if (!search) {
      return true;
    }

    const haystack = [skill.name, skill.slug, skill.owner, skill.summary, skill.source]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });

  dom.skillsTableBody.innerHTML = filteredRows.length
    ? filteredRows
        .map(
          (skill) => `
            <tr>
              <td>
                <div class="skills-cell-main">
                  <strong>${escapeHtml(skill.name)}</strong>
                  <p>${escapeHtml(skill.summary || "暂无摘要")}</p>
                </div>
              </td>
              <td>${escapeHtml(skill.owner)}</td>
              <td>${escapeHtml(skill.version)}</td>
              <td>${escapeHtml(skill.downloads)}</td>
              <td>
                <span class="chip chip-quiet">${skill.installed ? "已安装" : "未安装"}</span>
              </td>
              <td>${escapeHtml(skill.source)}</td>
              <td>
                ${
                  skill.installed
                    ? '<span class="chip chip-quiet">已安装</span>'
                    : skill.slug
                      ? `<button class="ghost" data-skill-install="${escapeHtml(skill.slug)}" data-skill-name="${escapeHtml(skill.name)}" type="button">安装</button>`
                      : '<span class="panel-note">本地</span>'
                }
              </td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="7"><p class="empty-note">当前筛选条件下没有技能。</p></td></tr>';

  if (data.store.error) {
    dom.skillsLoadState.textContent = "商店分页加载不可用";
  } else if (state.skills.loadingMore) {
    dom.skillsLoadState.textContent = "正在加载更多技能…";
  } else if (data.store.hasMore) {
    dom.skillsLoadState.textContent = "滚动到底继续加载";
  } else {
    dom.skillsLoadState.textContent = "已经到底了";
  }

  renderSkillInstallModal();
}

export { mergeSkillStorePages };

export function renderStatus(status) {
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
    ["管理页面", status.manager.url],
    ["Web 配置", status.manager.configPath],
    ["Web 登录", boolLabel(status.manager.authEnabled, "已启用", "未启用")],
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

  dom.statusList.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="status-row"><dt>${label}</dt><dd>${String(value)}</dd></div>`
    )
    .join("");

  document.title = status.manager.title;
  dom.appTitle.textContent = status.manager.title;
  dom.appSubtitle.textContent = status.manager.subtitle;
  dom.platformChip.textContent = `${status.system.platform} ${status.system.arch}`;
  dom.logoutButton.hidden = !status.manager.authEnabled;

  dom.heroInstallState.textContent = boolLabel(status.openclaw.installed, "已安装", "未安装");
  dom.heroInstallDetail.textContent = !status.openclaw.installed
    ? "还没检测到本地安装。先执行安装。"
    : status.openclaw.updateAvailable
      ? `当前 ${status.openclaw.version || "已安装"}，可更新到 ${latestVersionText}。`
      : status.openclaw.version || "已检测到本地安装。";
  setSurfaceTone(
    dom.installSummaryCard,
    !status.openclaw.installed
      ? "warning"
      : status.openclaw.updateAvailable
        ? "warning"
        : "success"
  );

  dom.heroGatewayState.textContent = boolLabel(status.openclaw.serviceLoaded, "已加载", "未加载");
  dom.heroGatewayDetail.textContent = status.openclaw.serviceLoaded
    ? status.openclaw.dashboardUrl
    : status.openclaw.serviceInstalled
      ? "服务已安装，等待启动。"
      : "服务尚未安装。";
  setSurfaceTone(
    dom.gatewaySummaryCard,
    status.openclaw.serviceLoaded ? "success" : status.openclaw.serviceInstalled ? "warning" : "danger"
  );

  dom.heroConfigState.textContent = boolLabel(status.openclaw.configExists, "已检测", "未创建");
  dom.heroConfigDetail.textContent = status.openclaw.configPath;
  setSurfaceTone(dom.configSummaryCard, status.openclaw.configExists ? "success" : "warning");

  dom.gatewayServiceInstalled.textContent = boolLabel(
    status.openclaw.serviceInstalled,
    "已安装",
    "未安装"
  );
  setSurfaceTone(dom.gatewayInstalledCard, statusTone(status.openclaw.serviceInstalled, "danger"));

  dom.gatewayServiceLoaded.textContent = boolLabel(
    status.openclaw.serviceLoaded,
    "已加载",
    "未加载"
  );
  setSurfaceTone(
    dom.gatewayLoadedCard,
    status.openclaw.serviceLoaded ? "success" : status.openclaw.serviceInstalled ? "warning" : "danger"
  );

  dom.dashboardLink.href = status.openclaw.dashboardUrl;
  dom.configPath.textContent = status.openclaw.configPath;
  dom.configPath.title = status.openclaw.configPath;

  if (!status.openclaw.installed) {
    dom.installButton.textContent = "安装 OpenClaw";
    state.installLocked = false;
  } else if (status.openclaw.upToDate) {
    dom.installButton.textContent = "已是最新版本";
    state.installLocked = true;
  } else if (status.openclaw.updateAvailable) {
    dom.installButton.textContent = "更新 OpenClaw";
    state.installLocked = false;
  } else {
    dom.installButton.textContent = "安装 / 更新 OpenClaw";
    state.installLocked = false;
  }

  if (!status.openclaw.installed) {
    dom.wizardChip.textContent = "先安装";
    setChipTone(dom.wizardChip, "warning");
    state.onboardingLocked = true;
  } else if (!status.openclaw.configExists) {
    dom.wizardChip.textContent = "可初始化";
    setChipTone(dom.wizardChip, "success");
    state.onboardingLocked = false;
  } else {
    dom.wizardChip.textContent = "已配置";
    setChipTone(dom.wizardChip, "success");
    state.onboardingLocked = false;
  }

  applyBusyState();
}

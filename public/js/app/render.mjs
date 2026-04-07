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

function statusRowMarkup(label, value, tone = "neutral") {
  const toneAttribute = tone === "neutral" ? "" : ` data-tone="${escapeHtml(tone)}"`;
  return `<div class="status-row"${toneAttribute}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
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

    if (button === dom.uninstallButton) {
      button.disabled = state.busy || state.uninstallLocked;
      return;
    }

    button.disabled = state.busy;
  });

  dom.refreshStatusButton.disabled = state.busy;
  dom.logoutButton.disabled = state.busy;
  dom.runOnboardButton.disabled = state.busy || state.onboardingLocked;
}

export function renderOnboardDefaults(values = {}) {
  dom.onboardDefaultWorkspace.textContent = values.workspace || "~/.openclaw/workspace";
  dom.onboardDefaultBind.textContent = values.gatewayBind || "loopback";
  dom.onboardDefaultPort.textContent = String(values.gatewayPort || 18789);
  dom.onboardDefaultAuth.textContent = values.gatewayAuth || "token";
  dom.onboardDefaultDaemon.textContent = values.installDaemon === false ? "不安装 daemon" : "安装并托管 daemon";
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
  setChipTone(dom.skillsSummaryChip, "accent");

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
                <span class="chip chip-quiet"${skill.installed ? ' data-tone="success"' : ""}>${skill.installed ? "已安装" : "未安装"}</span>
              </td>
              <td>${escapeHtml(skill.source)}</td>
              <td>
                ${
                  skill.installed
                    ? '<span class="chip chip-quiet" data-tone="success">已安装</span>'
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

  const items = [
    { label: "平台", value: `${status.system.platform} / ${status.system.arch}` },
    { label: "系统版本", value: status.system.release },
    { label: "Node", value: status.system.nodeVersion },
    { label: "包管理器", value: status.system.packageManager },
    { label: "curl", value: boolLabel(status.system.commands.curl, "可用", "缺失") },
    { label: "git", value: boolLabel(status.system.commands.git, "可用", "缺失") },
    { label: "OpenClaw 已安装", value: boolLabel(status.openclaw.installed, "已安装", "未安装") },
    { label: "OpenClaw 路径", value: status.openclaw.binary || "未找到" },
    { label: "OpenClaw 版本", value: status.openclaw.version || "未知" },
    { label: "最新版本", value: latestVersionText },
    { label: "配置文件", value: status.openclaw.configPath },
    { label: "本地前缀", value: status.openclaw.localPrefix },
  ];

  dom.statusList.innerHTML = items
    .map(({ label, value }) => statusRowMarkup(label, value))
    .join("");

  document.title = status.manager.title;
  dom.appTitle.textContent = status.manager.title;
  dom.appSubtitle.textContent = status.manager.subtitle;
  dom.platformChip.textContent = `${status.system.platform} ${status.system.arch}`;
  setChipTone(dom.platformChip, "accent");
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

  dom.dashboardLink.href = status.openclaw.dashboardUrl;
  dom.configPath.textContent = status.openclaw.configPath;
  dom.configPath.title = status.openclaw.configPath;

  if (!status.openclaw.installed) {
    dom.installButton.textContent = "安装 OpenClaw";
    state.installLocked = false;
    state.uninstallLocked = true;
  } else if (status.openclaw.upToDate) {
    dom.installButton.textContent = "已是最新版本";
    state.installLocked = true;
    state.uninstallLocked = false;
  } else if (status.openclaw.updateAvailable) {
    dom.installButton.textContent = "更新 OpenClaw";
    state.installLocked = false;
    state.uninstallLocked = false;
  } else {
    dom.installButton.textContent = "安装 / 更新 OpenClaw";
    state.installLocked = false;
    state.uninstallLocked = false;
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

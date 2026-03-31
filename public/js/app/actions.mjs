import {
  createAction,
  installSkill,
  loadActionJob,
  loadConfig,
  loadOnboardDefaults,
  loadSkills,
  loadSkillsPage,
  loadStatus,
  logout,
  runOnboard,
  saveConfig,
} from "./api.mjs";
import { dom } from "./dom.mjs";
import {
  addAgent,
  addBinding,
  buildStructuredConfig,
  changeChannelModalType,
  closeChannelModal,
  commitChannelModal,
  disableChannel,
  hydrateDesignerFromConfigRaw,
  openChannelModal,
  renderDesigner,
  seedDesigner,
  updateChannelDraft,
} from "./designer.mjs";
import {
  applyBusyState,
  fillOnboardForm,
  getViewIdFromLocation,
  mergeSkillStorePages,
  printConsole,
  renderConfig,
  renderSkills,
  renderStatus,
  setActiveView,
  setChipTone,
  syncActiveViewFromLocation,
  syncSkillsQueryToLocation,
  syncSkillsStateFromLocation,
  syncOnboardFieldVisibility,
  updateSyncStamp,
  validateOnboardForm,
} from "./render.mjs";
import { state } from "./state.mjs";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function statusLabel(job) {
  if (job.status === "running") return "执行中";
  if (job.ok) return "已完成";
  return "失败";
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let current = target;

  while (parts.length > 1) {
    current = current[parts.shift()];
  }

  current[parts[0]] = value;
}

function readDesignerInputValue(input) {
  if (input.dataset.designerBoolean === "true") {
    return input.checked;
  }

  if (input.type === "number") {
    return Number(input.value || 0);
  }

  return input.value;
}

async function pollActionJob(jobId, action) {
  while (true) {
    const job = await loadActionJob(jobId);
    printConsole(`动作: ${action} (${statusLabel(job)})`, job);

    if (job.status !== "running") {
      return job;
    }

    await sleep(1200);
  }
}

function readOnboardPayload() {
  return {
    authChoice: dom.authChoiceInput.value,
    modelApiKey: dom.modelApiKeyInput.value,
    workspace: dom.workspaceInput.value,
    gatewayBind: dom.gatewayBindInput.value,
    gatewayPort: dom.gatewayPortInput.value,
    gatewayAuth: dom.gatewayAuthInput.value,
    gatewayToken: dom.gatewayTokenInput.value,
    gatewayPassword: dom.gatewayPasswordInput.value,
    installDaemon: dom.installDaemonInput.checked,
    riskAccepted: dom.riskAcceptedInput.checked,
  };
}

async function withBusy(task) {
  state.busy = true;
  applyBusyState();

  try {
    return await task();
  } finally {
    state.busy = false;
    applyBusyState();
  }
}

export async function hydrateApp() {
  syncSkillsStateFromLocation();

  const [status, config, onboard, skills] = await Promise.all([
    loadStatus(),
    loadConfig(),
    loadOnboardDefaults(),
    loadSkills().catch((error) => ({
      store: {
        hasMore: false,
        items: [],
        error: error.message,
      },
      installed: [],
      workspaceRoot: "-",
      sharedRoot: "-",
    })),
  ]);

  renderStatus(status);
  renderConfig(config);
  renderSkills(skills);
  state.skills.data = skills;
  fillOnboardForm(onboard.values);

  if (!state.designerInitialized) {
    seedDesigner(onboard.values);
    state.designerInitialized = true;
  }

  hydrateDesignerFromConfigRaw(config.raw);
  renderDesigner();

  if (!onboard.installed) {
    dom.wizardChip.textContent = "先安装";
    setChipTone(dom.wizardChip, "warning");
    state.onboardingLocked = true;
    applyBusyState();
  }

  updateSyncStamp();
}

async function refreshStatusOnly() {
  const status = await loadStatus();
  renderStatus(status);
  updateSyncStamp();
}

async function refreshConfigOnly() {
  const config = await loadConfig();
  renderConfig(config);
  updateSyncStamp();
}

async function refreshOnboardOnly() {
  const onboard = await loadOnboardDefaults();
  fillOnboardForm(onboard.values);
  updateSyncStamp();
}

async function refreshSkillsOnly() {
  const skills = await loadSkills();
  state.skills.loadingMore = false;
  state.skills.data = skills;
  renderSkills(skills);
  updateSyncStamp();
}

async function loadMoreSkills() {
  if (
    state.skills.loadingMore ||
    !state.skills.data ||
    !state.skills.data.store.hasMore ||
    !state.skills.data.store.nextCursor
  ) {
    return;
  }

  state.skills.loadingMore = true;
  renderSkills(state.skills.data);

  try {
    const page = await loadSkillsPage(state.skills.data.store.nextCursor);
    state.skills.data = {
      ...state.skills.data,
      store: {
        ...state.skills.data.store,
        hasMore: page.store.hasMore,
        nextCursor: page.store.nextCursor,
        error: page.store.error,
        items: mergeSkillStorePages(state.skills.data.store.items, page.store.items),
      },
    };
    renderSkills(state.skills.data);
    updateSyncStamp();
  } finally {
    state.skills.loadingMore = false;
    if (state.skills.data) {
      renderSkills(state.skills.data);
    }
  }
}

async function runAction(action) {
  if (
    action === "uninstall" &&
    !window.confirm("这会卸载 OpenClaw 服务并删除本地状态、配置和安装目录。确认继续？")
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

  const job = await createAction(action);
  const result = await pollActionJob(job.id, action);
  await hydrateApp();
  return result;
}

async function runOnboardingFlow() {
  printConsole("执行 onboard...", {
    stdout:
      "正在调用 openclaw onboard --non-interactive。这个流程会跳过 channels / skills / search，只完成本地 Gateway 初始化。",
  });

  const job = await runOnboard(readOnboardPayload());
  const result = await pollActionJob(job.id, "onboard");
  await hydrateApp();
  return result;
}

async function saveStructuredConfigPreview() {
  const raw = JSON.stringify(buildStructuredConfig(), null, 2);
  await saveConfig(raw);
  dom.configEditor.value = raw;
  printConsole("配置中心已保存", {
    stdout: "结构化配置已写入 openclaw.json。需要时可继续在原始配置编辑器中补充高级字段。",
  });
  await Promise.all([refreshStatusOnly(), refreshOnboardOnly(), refreshConfigOnly()]);
}

function bindViewNavigation() {
  setActiveView(getViewIdFromLocation(), {
    updateHash: false,
  });

  dom.sidebarNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-target]");
    if (!button) return;

    event.preventDefault();
    setActiveView(button.dataset.viewTarget);
  });

  window.addEventListener("hashchange", () => {
    syncActiveViewFromLocation();
  });
}

function availableWorkspaces() {
  const values = new Set();
  const defaultWorkspace = String(state.designer.workspace || "").trim();
  if (defaultWorkspace) {
    values.add(defaultWorkspace);
  }

  state.designer.agents.forEach((agent) => {
    const workspace = String(agent.workspace || "").trim();
    if (workspace) {
      values.add(workspace);
    }
  });

  return Array.from(values);
}

function openSkillInstallModal(slug, name) {
  state.skills.installModal.open = true;
  state.skills.installModal.slug = slug;
  state.skills.installModal.name = name || slug;
  state.skills.installModal.scope = "workspace";
  state.skills.installModal.workspace = availableWorkspaces()[0] || "";
}

function closeSkillInstallModal() {
  state.skills.installModal.open = false;
}

function bindSkillsInteractions() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && state.activeViewId === "skills-view") {
        loadMoreSkills().catch((error) => {
          printConsole("加载更多技能失败", { stderr: error.message });
        });
      }
    });
  });
  observer.observe(dom.skillsLoadTrigger);

  dom.skillsSearchInput.addEventListener("input", () => {
    state.skills.search = dom.skillsSearchInput.value;
    syncSkillsQueryToLocation();
    if (state.skills.data) {
      renderSkills(state.skills.data);
    }
  });

  dom.skillsFilterInput.addEventListener("change", () => {
    state.skills.filter = dom.skillsFilterInput.value;
    syncSkillsQueryToLocation();
    if (state.skills.data) {
      renderSkills(state.skills.data);
    }
  });

  dom.skillsTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-skill-install]");
    if (!button) return;

    openSkillInstallModal(button.dataset.skillInstall, button.dataset.skillName);
    renderSkills(state.skills.data);
  });

  dom.skillInstallScope.addEventListener("change", () => {
    state.skills.installModal.scope = dom.skillInstallScope.value;
    renderSkills(state.skills.data);
  });

  dom.skillInstallWorkspace.addEventListener("change", () => {
    state.skills.installModal.workspace = dom.skillInstallWorkspace.value;
  });

  dom.skillInstallCancelButton.addEventListener("click", () => {
    closeSkillInstallModal();
    renderSkills(state.skills.data);
  });

  dom.skillInstallModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-skill-install-close]")) {
      closeSkillInstallModal();
      renderSkills(state.skills.data);
    }
  });

  dom.skillInstallForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (
      state.skills.installModal.scope === "workspace" &&
      !state.skills.installModal.workspace.trim()
    ) {
      printConsole("安装技能失败", { stderr: "请选择要安装到哪个 workspace。" });
      return;
    }

    withBusy(async () => {
      const payload = {
        slug: state.skills.installModal.slug,
        scope: state.skills.installModal.scope,
      };

      if (state.skills.installModal.scope === "workspace") {
        payload.workspace = state.skills.installModal.workspace;
      }

      const result = await installSkill(payload);
      closeSkillInstallModal();
      printConsole("技能已安装", {
        stdout: `已安装 ${payload.slug}\n${result.installedPath || ""}`.trim(),
      });
      await refreshSkillsOnly();
      renderSkills(state.skills.data);
    }).catch((error) => {
      printConsole("安装技能失败", { stderr: error.message });
    });
  });
}

function bindDesignerInteractions() {
  dom.designerInputs.forEach((input) => {
    const eventName = input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, () => {
      setByPath(state.designer, input.dataset.designerKey, readDesignerInputValue(input));
      renderDesigner();
    });
  });

  dom.addChannelButton.addEventListener("click", () => {
    openChannelModal();
    renderDesigner();
  });

  dom.channelModalTypeSelect.addEventListener("change", () => {
    changeChannelModalType(dom.channelModalTypeSelect.value);
    renderDesigner();
  });

  dom.channelDraftInputs.forEach((input) => {
    const eventName = input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, () => {
      updateChannelDraft(input.dataset.channelDraftKey, readDesignerInputValue(input));
      renderDesigner();
    });
  });

  dom.channelModalCancelButton.addEventListener("click", () => {
    closeChannelModal();
    renderDesigner();
  });

  dom.channelModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-channel-modal-close]")) {
      closeChannelModal();
      renderDesigner();
    }
  });

  dom.channelModalForm.addEventListener("submit", (event) => {
    event.preventDefault();

    withBusy(async () => {
      commitChannelModal();
      renderDesigner();
      await saveStructuredConfigPreview();
      closeChannelModal();
      renderDesigner();
    }).catch((error) => {
      printConsole("保存频道失败", { stderr: error.message });
    });
  });

  dom.channelsView.addEventListener("click", (event) => {
    const button = event.target.closest("[data-channel-remove]");
    const editButton = event.target.closest("[data-channel-edit]");

    if (editButton) {
      openChannelModal(editButton.dataset.channelEdit);
      renderDesigner();
      return;
    }

    if (!button) return;

    withBusy(async () => {
      disableChannel(button.dataset.channelRemove);
      renderDesigner();
      await saveStructuredConfigPreview();
      printConsole("频道已删除", {
        stdout: `已移除 ${button.dataset.channelRemove} 频道配置。`,
      });
    }).catch((error) => {
      printConsole("删除频道失败", { stderr: error.message });
    });
  });

  dom.addAgentButton.addEventListener("click", () => {
    addAgent();
    renderDesigner();
  });

  dom.addBindingButton.addEventListener("click", () => {
    addBinding();
    renderDesigner();
  });

  dom.agentList.addEventListener("input", (event) => {
    const target = event.target;
    const key = target.dataset.agentKey;
    const field = target.dataset.agentField;
    if (!key || !field) return;

    const agent = state.designer.agents.find((item) => item.key === key);
    if (!agent) return;

    agent[field] = target.type === "checkbox" ? target.checked : target.value;

    if (field === "default" && target.checked) {
      state.designer.agents.forEach((item) => {
        item.default = item.key === key;
      });
    }

    renderDesigner();
  });

  dom.agentList.addEventListener("click", (event) => {
    const key = event.target.dataset.agentRemove;
    if (!key) return;

    const removedAgent = state.designer.agents.find((agent) => agent.key === key);
    state.designer.agents = state.designer.agents.filter((agent) => agent.key !== key);
    if (removedAgent?.id) {
      state.designer.bindings = state.designer.bindings.filter(
        (binding) => binding.agentId !== removedAgent.id
      );
    }
    renderDesigner();
  });

  dom.bindingList.addEventListener("input", (event) => {
    const target = event.target;
    const key = target.dataset.bindingKey;
    const field = target.dataset.bindingField;
    if (!key || !field) return;

    const binding = state.designer.bindings.find((item) => item.key === key);
    if (!binding) return;

    binding[field] = target.value;
    renderDesigner();
  });

  dom.bindingList.addEventListener("change", (event) => {
    const target = event.target;
    const key = target.dataset.bindingKey;
    const field = target.dataset.bindingField;
    if (!key || !field) return;

    const binding = state.designer.bindings.find((item) => item.key === key);
    if (!binding) return;

    binding[field] = target.value;
    renderDesigner();
  });

  dom.bindingList.addEventListener("click", (event) => {
    const key = event.target.dataset.bindingRemove;
    if (!key) return;

    state.designer.bindings = state.designer.bindings.filter((binding) => binding.key !== key);
    renderDesigner();
  });

  dom.designerApplyButton.addEventListener("click", () => {
    dom.configEditor.value = dom.designerOutput.value;
    printConsole("结构化配置已填入原始编辑器", {
      stdout: "你可以继续手动补充高级字段，然后点击“保存当前原始配置”。",
    });
  });

  dom.designerSaveButton.addEventListener("click", () => {
    withBusy(saveStructuredConfigPreview).catch((error) => {
      printConsole("保存结构化配置失败", { stderr: error.message });
    });
  });
}

export function bindAppInteractions() {
  bindViewNavigation();
  bindSkillsInteractions();
  bindDesignerInteractions();
  syncOnboardFieldVisibility();
  applyBusyState();

  dom.refreshStatusButton.addEventListener("click", () =>
    withBusy(async () => {
      await refreshStatusOnly();
      printConsole("状态已刷新", {});
    })
  );

  dom.reloadConfigButton.addEventListener("click", () =>
    withBusy(async () => {
      await refreshConfigOnly();
      printConsole("配置已重新读取", {});
    }).catch((error) => {
      printConsole("读取配置失败", { stderr: error.message });
    })
  );

  dom.saveConfigButton.addEventListener("click", () =>
    withBusy(async () => {
      const result = await saveConfig(dom.configEditor.value);
      printConsole("配置已保存", {
        stdout: `saved: ${result.configPath}`,
      });
      await Promise.all([refreshStatusOnly(), refreshOnboardOnly()]);
    }).catch((error) => {
      printConsole("保存原始配置失败", { stderr: error.message });
    })
  );

  dom.reloadOnboardButton.addEventListener("click", () =>
    withBusy(async () => {
      await refreshOnboardOnly();
      printConsole("初始化向导默认值已刷新", {});
    }).catch((error) => {
      printConsole("加载向导默认值失败", { stderr: error.message });
    })
  );

  dom.logoutButton.addEventListener("click", () =>
    withBusy(async () => {
      await logout();
      window.location.replace("/login");
    }).catch((error) => {
      printConsole("退出登录失败", { stderr: error.message });
    })
  );

  dom.authChoiceInput.addEventListener("change", syncOnboardFieldVisibility);
  dom.gatewayAuthInput.addEventListener("change", syncOnboardFieldVisibility);

  dom.onboardForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const validationError = validateOnboardForm();
    if (validationError) {
      printConsole("初始化向导未开始", { stderr: validationError });
      return;
    }

    withBusy(runOnboardingFlow).catch((error) => {
      printConsole("初始化向导失败", { stderr: error.message });
    });
  });

  dom.actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      withBusy(async () => {
        await runAction(button.dataset.action);
      }).catch((error) => {
        printConsole(`动作失败: ${button.dataset.action}`, {
          stderr: error.message,
        });
      });
    });
  });
}

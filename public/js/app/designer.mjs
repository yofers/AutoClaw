import {
  CHANNEL_LABELS,
  CHANNEL_METADATA,
  CHANNEL_TYPE_ORDER,
  MODEL_PROVIDER_METADATA,
  createAgent,
  createBinding,
  createDefaultChannelState,
} from "./constants.mjs";
import { dom } from "./dom.mjs";
import { state } from "./state.mjs";
import { setHidden } from "./render.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function listValues(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function lineValues(raw) {
  return String(raw || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildAllowFrom(policy, raw) {
  const allowFrom = listValues(raw);

  if (policy === "open" && allowFrom.length === 0) {
    allowFrom.push("*");
  }

  return allowFrom.length > 0 ? allowFrom : undefined;
}

function buildScopeMap(raw, requireMention, groupPolicy, wildcardForOpen = true) {
  const ids = listValues(raw);

  if (ids.length > 0) {
    return Object.fromEntries(
      ids.map((id) => [id, requireMention ? { requireMention: true } : { allow: true }])
    );
  }

  if (wildcardForOpen && groupPolicy === "open" && requireMention) {
    return {
      "*": { requireMention: true },
    };
  }

  return undefined;
}

function joinArray(values) {
  return Array.isArray(values) ? values.join("\n") : "";
}

function joinScopeKeys(map) {
  return map ? Object.keys(map).filter((key) => key !== "*").join("\n") : "";
}

function hasRequireMention(map) {
  return Boolean(map?.["*"]?.requireMention) || Object.values(map || {}).some((item) => item?.requireMention);
}

function splitModelRef(modelRef) {
  const value = String(modelRef || "").trim();
  if (!value || !value.includes("/")) {
    return {
      provider: "",
      modelId: value,
    };
  }

  const separatorIndex = value.indexOf("/");
  return {
    provider: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function buildModelRef(provider, modelId) {
  const safeProvider = String(provider || "").trim();
  const safeModelId = String(modelId || "").trim();

  if (!safeProvider || !safeModelId) {
    return "";
  }

  return `${safeProvider}/${safeModelId}`;
}

function parseModelCatalog(raw) {
  return lineValues(raw).reduce((catalog, line) => {
    const [modelRefPart, aliasPart] = String(line).split("|");
    const modelRef = String(modelRefPart || "").trim();
    const meta = String(aliasPart || "").trim();

    if (!modelRef) {
      return catalog;
    }

    if (!meta) {
      catalog[modelRef] = {};
      return catalog;
    }

    if (meta.startsWith("{")) {
      try {
        const parsed = JSON.parse(meta);
        catalog[modelRef] =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        return catalog;
      } catch {
        catalog[modelRef] = { alias: meta };
        return catalog;
      }
    }

    catalog[modelRef] = { alias: meta };
    return catalog;
  }, {});
}

function serializeModelCatalog(models) {
  if (!models || typeof models !== "object") {
    return "";
  }

  return Object.entries(models)
    .map(([modelRef, config]) => {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return modelRef;
      }

      const keys = Object.keys(config);
      if (keys.length === 0) {
        return modelRef;
      }

      if (keys.length === 1 && keys[0] === "alias") {
        return `${modelRef} | ${config.alias || ""}`;
      }

      return `${modelRef} | ${JSON.stringify(config)}`;
    })
    .join("\n");
}

function providerExamples(providerId) {
  return MODEL_PROVIDER_METADATA.find((item) => item.id === providerId)?.examples || [];
}

function summarizeList(raw) {
  const values = listValues(raw);
  return values.length ? `${values.length} 项` : "未设置";
}

function isChannelEnabled(channelType) {
  return Boolean(state.designer[channelType]?.enabled);
}

function cloneChannelState(channelType, value) {
  return {
    ...createDefaultChannelState(channelType),
    ...JSON.parse(JSON.stringify(value || {})),
  };
}

function firstEnabledChannel() {
  return CHANNEL_TYPE_ORDER.find((channelType) => isChannelEnabled(channelType)) || "telegram";
}

function normalizeAgents() {
  if (state.designer.agents.length === 0) {
    state.designer.agents = [createAgent(1, state.designer.workspace)];
    state.nextAgentSequence = Math.max(state.nextAgentSequence, 2);
    return;
  }

  if (!state.designer.agents.some((agent) => agent.default)) {
    state.designer.agents[0].default = true;
  }
}

function normalizeBindings() {
  const validAgentIds = new Set(
    state.designer.agents.map((agent) => agent.id.trim()).filter(Boolean)
  );
  const defaultAgentId =
    state.designer.agents.find((agent) => agent.id.trim())?.id.trim() || "main";
  const enabledChannels = CHANNEL_TYPE_ORDER.filter((channelType) => isChannelEnabled(channelType));
  const fallbackChannel = enabledChannels[0] || "telegram";

  state.designer.bindings = state.designer.bindings.map((binding) => ({
    ...binding,
    agentId: validAgentIds.has(binding.agentId) ? binding.agentId : defaultAgentId,
    channel:
      enabledChannels.length === 0 || enabledChannels.includes(binding.channel)
        ? binding.channel
        : fallbackChannel,
  }));
}

function buildTelegramChannel() {
  if (!state.designer.telegram.enabled) {
    return undefined;
  }

  const channel = {
    enabled: true,
    botToken: state.designer.telegram.botToken.trim(),
    dmPolicy: state.designer.telegram.dmPolicy,
    groupPolicy: state.designer.telegram.groupPolicy,
  };

  const allowFrom = buildAllowFrom(
    state.designer.telegram.dmPolicy,
    state.designer.telegram.allowFrom
  );
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const groups = buildScopeMap(
    state.designer.telegram.groups,
    state.designer.telegram.requireMention,
    state.designer.telegram.groupPolicy
  );
  if (groups) {
    channel.groups = groups;
  }

  return channel;
}

function buildFeishuChannel() {
  if (!state.designer.feishu.enabled) {
    return undefined;
  }

  const accountId = state.designer.feishu.accountId.trim() || "main";
  const channel = {
    enabled: true,
    dmPolicy: state.designer.feishu.dmPolicy,
    groupPolicy: state.designer.feishu.groupPolicy,
    defaultAccount: accountId,
    accounts: {
      [accountId]: {
        appId: state.designer.feishu.appId.trim(),
        appSecret: state.designer.feishu.appSecret.trim(),
      },
    },
  };

  if (state.designer.feishu.botName.trim()) {
    channel.accounts[accountId].botName = state.designer.feishu.botName.trim();
  }

  const allowFrom = buildAllowFrom(
    state.designer.feishu.dmPolicy,
    state.designer.feishu.allowFrom
  );
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const groups = buildScopeMap(
    state.designer.feishu.groups,
    state.designer.feishu.requireMention,
    state.designer.feishu.groupPolicy
  );
  if (groups) {
    channel.groups = groups;
  }

  return channel;
}

function buildSlackChannel() {
  if (!state.designer.slack.enabled) {
    return undefined;
  }

  const channel = {
    enabled: true,
    mode: state.designer.slack.mode,
    dmPolicy: state.designer.slack.dmPolicy,
    groupPolicy: state.designer.slack.groupPolicy,
  };

  if (state.designer.slack.botToken.trim()) {
    channel.botToken = state.designer.slack.botToken.trim();
  }
  if (state.designer.slack.mode === "socket" && state.designer.slack.appToken.trim()) {
    channel.appToken = state.designer.slack.appToken.trim();
  }
  if (
    state.designer.slack.mode === "http" &&
    state.designer.slack.signingSecret.trim()
  ) {
    channel.signingSecret = state.designer.slack.signingSecret.trim();
  }

  const allowFrom = buildAllowFrom(state.designer.slack.dmPolicy, state.designer.slack.allowFrom);
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const channels = buildScopeMap(
    state.designer.slack.channels,
    state.designer.slack.requireMention,
    state.designer.slack.groupPolicy,
    false
  );
  if (channels) {
    channel.channels = channels;
  }

  return channel;
}

function buildDiscordChannel() {
  if (!state.designer.discord.enabled) {
    return undefined;
  }

  const channel = {
    enabled: true,
    dmPolicy: state.designer.discord.dmPolicy,
    groupPolicy: state.designer.discord.groupPolicy,
  };

  if (state.designer.discord.botToken.trim()) {
    channel.botToken = state.designer.discord.botToken.trim();
  }

  const allowFrom = buildAllowFrom(
    state.designer.discord.dmPolicy,
    state.designer.discord.allowFrom
  );
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const guilds = buildScopeMap(
    state.designer.discord.guilds,
    state.designer.discord.requireMention,
    state.designer.discord.groupPolicy,
    false
  );
  if (guilds) {
    channel.guilds = guilds;
  }

  return channel;
}

function buildWhatsAppChannel() {
  if (!state.designer.whatsapp.enabled) {
    return undefined;
  }

  const accountId = state.designer.whatsapp.accountId.trim() || "main";
  const channel = {
    enabled: true,
    dmPolicy: state.designer.whatsapp.dmPolicy,
    groupPolicy: state.designer.whatsapp.groupPolicy,
  };

  if (accountId !== "main") {
    channel.defaultAccount = accountId;
    channel.accounts = {
      [accountId]: {},
    };
  }

  const allowFrom = buildAllowFrom(
    state.designer.whatsapp.dmPolicy,
    state.designer.whatsapp.allowFrom
  );
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const groupAllowFrom = listValues(state.designer.whatsapp.groupAllowFrom);
  if (groupAllowFrom.length > 0) {
    channel.groupAllowFrom = groupAllowFrom;
  }

  const groups = buildScopeMap(
    state.designer.whatsapp.groups,
    state.designer.whatsapp.requireMention,
    state.designer.whatsapp.groupPolicy
  );
  if (groups) {
    channel.groups = groups;
  }

  if (state.designer.whatsapp.selfChatMode) {
    channel.selfChatMode = true;
  }

  return channel;
}

function buildSignalChannel() {
  if (!state.designer.signal.enabled) {
    return undefined;
  }

  const channel = {
    enabled: true,
    dmPolicy: state.designer.signal.dmPolicy,
    groupPolicy: state.designer.signal.groupPolicy,
  };

  if (state.designer.signal.account.trim()) {
    channel.account = state.designer.signal.account.trim();
  }
  if (state.designer.signal.cliPath.trim()) {
    channel.cliPath = state.designer.signal.cliPath.trim();
  }

  const allowFrom = buildAllowFrom(state.designer.signal.dmPolicy, state.designer.signal.allowFrom);
  if (allowFrom) {
    channel.allowFrom = allowFrom;
  }

  const groupAllowFrom = listValues(state.designer.signal.groupAllowFrom);
  if (groupAllowFrom.length > 0) {
    channel.groupAllowFrom = groupAllowFrom;
  }

  const groups = buildScopeMap(
    state.designer.signal.groups,
    state.designer.signal.requireMention,
    state.designer.signal.groupPolicy
  );
  if (groups) {
    channel.groups = groups;
  }

  return channel;
}

function renderSummaryCard(channelType, title, rows) {
  return `
    <article class="list-card">
      <div class="list-card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="panel-note">已启用</p>
        </div>
        <div class="channel-card-actions">
          <button class="ghost" data-channel-edit="${escapeHtml(channelType)}" type="button">编辑</button>
          <button class="ghost destructive-link" data-channel-remove="${escapeHtml(channelType)}" type="button">删除</button>
        </div>
      </div>
      <div class="stack-list compact-stack">
        ${rows
          .map(
            ([label, value]) => `
              <div class="stack-item">
                <strong>${escapeHtml(label)}</strong>
                <p>${escapeHtml(value)}</p>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderChannelSummaryList() {
  const items = [];

  if (state.designer.telegram.enabled) {
    items.push(
      renderSummaryCard("telegram", "Telegram", [
        ["私聊策略", state.designer.telegram.dmPolicy],
        ["群组策略", state.designer.telegram.groupPolicy],
        ["allowFrom", summarizeList(state.designer.telegram.allowFrom)],
        ["群组", summarizeList(state.designer.telegram.groups)],
      ])
    );
  }

  if (state.designer.feishu.enabled) {
    items.push(
      renderSummaryCard("feishu", "飞书", [
        ["账号 ID", state.designer.feishu.accountId || "main"],
        ["私聊策略", state.designer.feishu.dmPolicy],
        ["群组策略", state.designer.feishu.groupPolicy],
        ["群组", summarizeList(state.designer.feishu.groups)],
      ])
    );
  }

  if (state.designer.slack.enabled) {
    items.push(
      renderSummaryCard("slack", "Slack", [
        ["接入模式", state.designer.slack.mode],
        ["私聊策略", state.designer.slack.dmPolicy],
        ["频道策略", state.designer.slack.groupPolicy],
        ["频道", summarizeList(state.designer.slack.channels)],
      ])
    );
  }

  if (state.designer.discord.enabled) {
    items.push(
      renderSummaryCard("discord", "Discord", [
        ["私聊策略", state.designer.discord.dmPolicy],
        ["Guild 策略", state.designer.discord.groupPolicy],
        ["allowFrom", summarizeList(state.designer.discord.allowFrom)],
        ["Guild", summarizeList(state.designer.discord.guilds)],
      ])
    );
  }

  if (state.designer.whatsapp.enabled) {
    items.push(
      renderSummaryCard("whatsapp", "WhatsApp", [
        ["账号 ID", state.designer.whatsapp.accountId || "main"],
        ["私聊策略", state.designer.whatsapp.dmPolicy],
        ["群组策略", state.designer.whatsapp.groupPolicy],
        ["群组", summarizeList(state.designer.whatsapp.groups)],
      ])
    );
  }

  if (state.designer.signal.enabled) {
    items.push(
      renderSummaryCard("signal", "Signal", [
        ["账号", state.designer.signal.account || "未设置"],
        ["CLI", state.designer.signal.cliPath || "signal-cli"],
        ["私聊策略", state.designer.signal.dmPolicy],
        ["群组", summarizeList(state.designer.signal.groups)],
      ])
    );
  }

  dom.channelSummaryList.innerHTML = items.length
    ? items.join("")
    : '<p class="empty-note">当前还没有已启用频道。先选择类型，再点击“添加频道”。</p>';
}

function hydrateTelegramChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("telegram");
  }

  return {
    enabled: true,
    botToken: channel.botToken || "",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    groups: joinScopeKeys(channel.groups),
    requireMention: hasRequireMention(channel.groups),
  };
}

function hydrateFeishuChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("feishu");
  }

  const defaultAccount = channel.defaultAccount || "main";
  const accountConfig = channel.accounts?.[defaultAccount] || {};

  return {
    enabled: true,
    accountId: defaultAccount,
    botName: accountConfig.botName || "",
    appId: accountConfig.appId || "",
    appSecret: accountConfig.appSecret || "",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    groups: joinScopeKeys(channel.groups),
    requireMention: hasRequireMention(channel.groups),
  };
}

function hydrateSlackChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("slack");
  }

  const defaultAccount = channel.defaultAccount || "default";
  const accountConfig = channel.accounts?.[defaultAccount] || {};

  return {
    enabled: true,
    mode: channel.mode || "socket",
    botToken: channel.botToken || accountConfig.botToken || "",
    appToken: channel.appToken || accountConfig.appToken || "",
    signingSecret: channel.signingSecret || accountConfig.signingSecret || "",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    channels: joinScopeKeys(channel.channels),
    requireMention: hasRequireMention(channel.channels),
  };
}

function hydrateDiscordChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("discord");
  }

  return {
    enabled: true,
    botToken: channel.botToken || "",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    guilds: joinScopeKeys(channel.guilds),
    requireMention: hasRequireMention(channel.guilds),
  };
}

function hydrateWhatsAppChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("whatsapp");
  }

  return {
    enabled: true,
    accountId: channel.defaultAccount || "main",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    groups: joinScopeKeys(channel.groups),
    groupAllowFrom: joinArray(channel.groupAllowFrom),
    selfChatMode: Boolean(channel.selfChatMode),
    requireMention: hasRequireMention(channel.groups),
  };
}

function hydrateSignalChannel(channel) {
  if (!channel?.enabled) {
    return createDefaultChannelState("signal");
  }

  return {
    enabled: true,
    account: channel.account || "",
    cliPath: channel.cliPath || "signal-cli",
    dmPolicy: channel.dmPolicy || "pairing",
    allowFrom: joinArray(channel.allowFrom),
    groupPolicy: channel.groupPolicy || "allowlist",
    groups: joinScopeKeys(channel.groups),
    groupAllowFrom: joinArray(channel.groupAllowFrom),
    requireMention: hasRequireMention(channel.groups),
  };
}

export function hydrateDesignerFromConfigRaw(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object") {
    return;
  }

  const gateway = parsed.gateway || {};
  const auth = gateway.auth || {};
  const agents = parsed.agents || {};
  const defaults = agents.defaults || {};
  const defaultModel =
    typeof defaults.model === "string"
      ? { primary: defaults.model }
      : defaults.model && typeof defaults.model === "object"
        ? defaults.model
        : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const bindings = Array.isArray(parsed.bindings) ? parsed.bindings : [];
  const channels = parsed.channels || {};
  const primaryModel = splitModelRef(defaultModel.primary || "");

  state.designer.workspace = defaults.workspace || state.designer.workspace;
  state.designer.gatewayBind = gateway.bind || state.designer.gatewayBind;
  state.designer.gatewayPort = gateway.port || state.designer.gatewayPort;
  state.designer.gatewayAuth = auth.mode === "password" ? "password" : "token";
  state.designer.gatewayToken = auth.token || "";
  state.designer.gatewayPassword = auth.password || "";
  state.designer.modelProvider = primaryModel.provider || state.designer.modelProvider;
  state.designer.modelId = primaryModel.modelId || "";
  state.designer.modelFallbacks = joinArray(defaultModel.fallbacks);
  state.designer.modelAllowlist = serializeModelCatalog(defaults.models);

  state.designer.telegram = hydrateTelegramChannel(channels.telegram);
  state.designer.feishu = hydrateFeishuChannel(channels.feishu);
  state.designer.slack = hydrateSlackChannel(channels.slack);
  state.designer.discord = hydrateDiscordChannel(channels.discord);
  state.designer.whatsapp = hydrateWhatsAppChannel(channels.whatsapp);
  state.designer.signal = hydrateSignalChannel(channels.signal);

  if (list.length > 0) {
    state.designer.agents = list.map((agent, index) => ({
      key: `agent-${index + 1}`,
      id: agent.id || "",
      name: agent.name || "",
      workspace: agent.workspace || state.designer.workspace,
      default: Boolean(agent.default),
    }));
    state.nextAgentSequence = list.length + 1;
  }

  state.designer.bindings = bindings.map((binding, index) => ({
    key: `binding-${index + 1}`,
    agentId: binding.agentId || state.designer.agents[0]?.id || "main",
    channel: binding.match?.channel || "telegram",
    accountId: binding.match?.accountId || "",
    peerKind: binding.match?.peer?.kind || "direct",
    peerId: binding.match?.peer?.id || "",
  }));
  state.nextBindingSequence = bindings.length + 1;
  state.designer.channelDraftType =
    CHANNEL_TYPE_ORDER.find((channelType) => state.designer[channelType]?.enabled) ||
    state.designer.channelDraftType;
}

export function buildStructuredConfig() {
  normalizeAgents();
  normalizeBindings();

  const primaryModelRef = buildModelRef(
    state.designer.modelProvider,
    state.designer.modelId
  );
  const fallbackModels = listValues(state.designer.modelFallbacks);
  const allowedModels = parseModelCatalog(state.designer.modelAllowlist);

  const serializedAgents = state.designer.agents
    .filter((agent) => agent.id.trim().length > 0)
    .map((agent) => {
      const output = {
        id: agent.id.trim(),
        workspace:
          agent.workspace.trim() ||
          state.designer.workspace.trim() ||
          "~/.openclaw/workspace",
      };
      if (agent.name.trim()) {
        output.name = agent.name.trim();
      }
      if (agent.default) {
        output.default = true;
      }
      return output;
    });

  if (serializedAgents.length === 0) {
    serializedAgents.push({
      id: "main",
      workspace: state.designer.workspace.trim() || "~/.openclaw/workspace",
      default: true,
    });
  }

  const config = {
    gateway: {
      mode: "local",
      port: Number(state.designer.gatewayPort) || 18789,
      bind: state.designer.gatewayBind || "loopback",
      auth:
        state.designer.gatewayAuth === "password"
          ? {
              mode: "password",
              password: state.designer.gatewayPassword.trim() || "change-me",
            }
          : {
              mode: "token",
              token: state.designer.gatewayToken.trim() || "replace-me",
            },
    },
    agents: {
      defaults: {
        workspace: state.designer.workspace.trim() || "~/.openclaw/workspace",
      },
      list: serializedAgents,
    },
  };

  if (primaryModelRef || fallbackModels.length > 0) {
    config.agents.defaults.model = {};

    if (primaryModelRef) {
      config.agents.defaults.model.primary = primaryModelRef;
    }

    if (fallbackModels.length > 0) {
      config.agents.defaults.model.fallbacks = fallbackModels;
    }
  }

  if (Object.keys(allowedModels).length > 0) {
    config.agents.defaults.models = allowedModels;
  }

  const channelEntries = Object.entries({
    telegram: buildTelegramChannel(),
    feishu: buildFeishuChannel(),
    slack: buildSlackChannel(),
    discord: buildDiscordChannel(),
    whatsapp: buildWhatsAppChannel(),
    signal: buildSignalChannel(),
  }).filter(([, value]) => value);

  if (channelEntries.length > 0) {
    config.channels = Object.fromEntries(channelEntries);
  }

  const bindings = state.designer.bindings
    .filter((binding) => binding.agentId && binding.channel)
    .map((binding) => {
      const match = {
        channel: binding.channel,
      };

      if (binding.accountId.trim()) {
        match.accountId = binding.accountId.trim();
      }

      if (binding.peerId.trim()) {
        match.peer = {
          kind: binding.peerKind || "direct",
          id: binding.peerId.trim(),
        };
      }

      return {
        agentId: binding.agentId,
        match,
      };
    });

  if (bindings.length > 0) {
    config.bindings = bindings;
  }

  return config;
}

function agentOptionsMarkup(selectedAgentId) {
  return state.designer.agents
    .map((agent) => {
      const selected = agent.id === selectedAgentId ? " selected" : "";
      return `<option value="${escapeHtml(agent.id)}"${selected}>${escapeHtml(agent.id || "未命名 agent")}</option>`;
    })
    .join("");
}

function channelOptionsMarkup(selectedChannel) {
  const options = CHANNEL_TYPE_ORDER.filter((channelType) => isChannelEnabled(channelType));
  if (options.length === 0) {
    options.push(firstEnabledChannel());
  }

  return options
    .map((channelType) => {
      const selected = channelType === selectedChannel ? " selected" : "";
      return `<option value="${channelType}"${selected}>${escapeHtml(
        CHANNEL_LABELS[channelType] || channelType
      )}</option>`;
    })
    .join("");
}

function modelProviderOptionsMarkup(selectedProvider) {
  return MODEL_PROVIDER_METADATA.map((provider) => {
    const selected = provider.id === selectedProvider ? " selected" : "";
    return `<option value="${escapeHtml(provider.id)}"${selected}>${escapeHtml(provider.label)} (${escapeHtml(provider.id)})</option>`;
  }).join("");
}

function renderModelProviderCatalog(selectedProvider) {
  dom.modelProviderList.innerHTML = MODEL_PROVIDER_METADATA.map((provider) => {
    const selected = provider.id === selectedProvider;
    const examples = provider.examples.length
      ? provider.examples
          .map((example) => `<code>${escapeHtml(`${provider.id}/${example}`)}</code>`)
          .join("")
      : '<span class="panel-note">支持任意官方目录中的模型 ID</span>';

    return `
      <article class="provider-card"${selected ? ' data-tone="accent"' : ""}>
        <div class="provider-card-head">
          <div>
            <h3>${escapeHtml(provider.label)}</h3>
            <p class="panel-note">${escapeHtml(provider.id)}</p>
          </div>
          ${selected ? '<span class="chip" data-tone="accent">当前 Provider</span>' : ""}
        </div>
        <div class="stack-list compact-stack">
          <div class="stack-item">
            <strong>认证</strong>
            <p>${escapeHtml(provider.auth)}</p>
          </div>
          <div class="stack-item">
            <strong>示例</strong>
            <div class="provider-example-list">${examples}</div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderAgentList() {
  if (state.designer.agents.length === 0) {
    dom.agentList.innerHTML = '<p class="empty-note">还没有 agent。至少保留一个默认 agent。</p>';
    return;
  }

  dom.agentList.innerHTML = state.designer.agents
    .map(
      (agent) => `
        <article class="list-card" data-agent-key="${escapeHtml(agent.key)}">
          <div class="list-card-head">
            <div>
              <h3>${escapeHtml(agent.id || "未命名 Agent")}</h3>
              <p class="panel-note">每个 agent 可以有独立 workspace，并通过 bindings 绑定到不同频道或会话。</p>
            </div>
            <button class="ghost destructive-link" data-agent-remove="${escapeHtml(agent.key)}" type="button">移除</button>
          </div>
          <div class="list-grid">
            <label class="field">
              <span>Agent ID</span>
              <input data-agent-key="${escapeHtml(agent.key)}" data-agent-field="id" type="text" value="${escapeHtml(agent.id)}" />
            </label>
            <label class="field">
              <span>显示名</span>
              <input data-agent-key="${escapeHtml(agent.key)}" data-agent-field="name" type="text" value="${escapeHtml(agent.name)}" />
            </label>
            <label class="field field-span-2">
              <span>Workspace</span>
              <input data-agent-key="${escapeHtml(agent.key)}" data-agent-field="workspace" type="text" value="${escapeHtml(agent.workspace)}" />
            </label>
            <label class="switch-row field-span-2">
              <input data-agent-key="${escapeHtml(agent.key)}" data-agent-field="default" type="checkbox"${agent.default ? " checked" : ""} />
              <span>设为默认 agent</span>
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function renderBindingList() {
  if (state.designer.bindings.length === 0) {
    dom.bindingList.innerHTML =
      '<p class="empty-note">还没有绑定规则。你可以把不同频道入口路由到不同 agent。</p>';
    return;
  }

  dom.bindingList.innerHTML = state.designer.bindings
    .map(
      (binding) => `
        <article class="list-card" data-binding-key="${escapeHtml(binding.key)}">
          <div class="list-card-head">
            <div>
              <h3>${escapeHtml(CHANNEL_LABELS[binding.channel] || binding.channel)} 路由</h3>
              <p class="panel-note">match.channel 必填；accountId 和 peer 规则可以继续缩小命中范围。</p>
            </div>
            <button class="ghost destructive-link" data-binding-remove="${escapeHtml(binding.key)}" type="button">移除</button>
          </div>
          <div class="list-grid">
            <label class="field">
              <span>目标 Agent</span>
              <select class="select-field" data-binding-key="${escapeHtml(binding.key)}" data-binding-field="agentId">
                ${agentOptionsMarkup(binding.agentId)}
              </select>
            </label>
            <label class="field">
              <span>频道</span>
              <select class="select-field" data-binding-key="${escapeHtml(binding.key)}" data-binding-field="channel">
                ${channelOptionsMarkup(binding.channel)}
              </select>
            </label>
            <label class="field">
              <span>accountId</span>
              <input data-binding-key="${escapeHtml(binding.key)}" data-binding-field="accountId" type="text" value="${escapeHtml(binding.accountId)}" />
            </label>
            <label class="field">
              <span>peer.kind</span>
              <select class="select-field" data-binding-key="${escapeHtml(binding.key)}" data-binding-field="peerKind">
                <option value="direct"${binding.peerKind === "direct" ? " selected" : ""}>direct</option>
                <option value="group"${binding.peerKind === "group" ? " selected" : ""}>group</option>
                <option value="channel"${binding.peerKind === "channel" ? " selected" : ""}>channel</option>
              </select>
            </label>
            <label class="field field-span-2">
              <span>peer.id</span>
              <input data-binding-key="${escapeHtml(binding.key)}" data-binding-field="peerId" type="text" value="${escapeHtml(binding.peerId)}" placeholder="可选；用于把特定 peer 路由到目标 agent" />
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

export function seedDesigner(values) {
  state.designer.workspace = values.workspace || state.designer.workspace;
  state.designer.gatewayBind = values.gatewayBind || state.designer.gatewayBind;
  state.designer.gatewayPort = values.gatewayPort || state.designer.gatewayPort;
  state.designer.gatewayAuth = values.gatewayAuth || state.designer.gatewayAuth;
  state.designer.gatewayToken = values.gatewayToken || state.designer.gatewayToken;
  state.designer.gatewayPassword = values.gatewayPassword || state.designer.gatewayPassword;

  if (state.designer.agents.length === 1) {
    state.designer.agents[0].workspace = state.designer.workspace;
  }
}

export function openChannelModal(channelType = state.designer.channelDraftType || "telegram") {
  if (!state.designer[channelType]) {
    return;
  }

  state.channelModal.open = true;
  state.channelModal.type = channelType;
  state.channelModal.mode = state.designer[channelType].enabled ? "edit" : "create";
  state.channelModal.draft = cloneChannelState(channelType, state.designer[channelType]);
  state.channelModal.draft.enabled = true;
  state.designer.channelDraftType = channelType;
}

export function closeChannelModal() {
  state.channelModal.open = false;
}

export function changeChannelModalType(channelType) {
  if (!state.designer[channelType]) {
    return;
  }

  state.channelModal.type = channelType;
  state.channelModal.mode = state.designer[channelType].enabled ? "edit" : "create";
  state.channelModal.draft = cloneChannelState(channelType, state.designer[channelType]);
  state.channelModal.draft.enabled = true;
  state.designer.channelDraftType = channelType;
}

export function updateChannelDraft(field, value) {
  if (!state.channelModal.draft) {
    return;
  }

  state.channelModal.draft[field] = value;
}

export function commitChannelModal() {
  const channelType = state.channelModal.type;
  if (!state.designer[channelType] || !state.channelModal.draft) {
    return;
  }

  state.designer[channelType] = cloneChannelState(channelType, state.channelModal.draft);
  state.designer[channelType].enabled = true;
  state.designer.channelDraftType = channelType;
}

export function disableChannel(channelType) {
  if (!state.designer[channelType]) {
    return;
  }

  state.designer[channelType] = createDefaultChannelState(channelType);
  if (state.channelModal.type === channelType && state.channelModal.open) {
    changeChannelModalType(state.designer.channelDraftType || firstEnabledChannel());
  }
}

export function addAgent() {
  state.designer.agents.push(createAgent(state.nextAgentSequence, state.designer.workspace));
  state.nextAgentSequence += 1;
}

export function addBinding() {
  state.designer.bindings.push(
    createBinding(
      state.nextBindingSequence,
      state.designer.agents[0]?.id || "main",
      firstEnabledChannel()
    )
  );
  state.nextBindingSequence += 1;
}

export function renderDesigner() {
  normalizeAgents();
  normalizeBindings();

  const primaryModelRef = buildModelRef(
    state.designer.modelProvider,
    state.designer.modelId
  );
  const fallbackModels = listValues(state.designer.modelFallbacks);
  const allowedModelLines = lineValues(state.designer.modelAllowlist);
  const selectedProvider =
    MODEL_PROVIDER_METADATA.find((provider) => provider.id === state.designer.modelProvider) ||
    MODEL_PROVIDER_METADATA[0];

  const fieldValues = {
    workspace: state.designer.workspace,
    gatewayBind: state.designer.gatewayBind,
    gatewayPort: String(state.designer.gatewayPort),
    gatewayAuth: state.designer.gatewayAuth,
    gatewayToken: state.designer.gatewayToken,
    gatewayPassword: state.designer.gatewayPassword,
    modelProvider: state.designer.modelProvider,
    modelId: state.designer.modelId,
    modelFallbacks: state.designer.modelFallbacks,
    modelAllowlist: state.designer.modelAllowlist,
  };

  dom.designerInputs.forEach((input) => {
    const value = fieldValues[input.dataset.designerKey];
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
      return;
    }

    input.value = value ?? "";
  });

  setHidden(dom.designerGatewayTokenWrap, state.designer.gatewayAuth !== "token");
  setHidden(dom.designerGatewayPasswordWrap, state.designer.gatewayAuth !== "password");
  dom.modelProviderSelect.innerHTML = modelProviderOptionsMarkup(selectedProvider.id);
  dom.modelExampleList.innerHTML = providerExamples(selectedProvider.id)
    .map((example) => `<option value="${escapeHtml(example)}"></option>`)
    .join("");
  dom.modelPrimaryPreview.textContent = primaryModelRef || "未设置";
  dom.modelProviderHint.textContent = `${selectedProvider.label} 使用 ${selectedProvider.auth} 认证。主模型请输入 model ID，最终会写成 ${selectedProvider.id}/<model>。`;
  dom.modelSummaryPrimary.textContent = primaryModelRef || "未设置";
  dom.modelSummaryFallbacks.textContent = fallbackModels.length
    ? `${fallbackModels.length} 个回退模型`
    : "未设置";
  dom.modelSummaryAllowlist.textContent = allowedModelLines.length
    ? `${allowedModelLines.length} 个允许项`
    : "未设置";
  renderModelProviderCatalog(selectedProvider.id);

  const modalChannel =
    CHANNEL_METADATA.find((item) => item.id === state.channelModal.type) || CHANNEL_METADATA[0];
  const draftValues = state.channelModal.draft || createDefaultChannelState(modalChannel.id);

  dom.channelDraftInputs.forEach((input) => {
    const value = draftValues[input.dataset.channelDraftKey];
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
      return;
    }

    input.value = value ?? "";
  });

  dom.channelModalTypeSelect.value = modalChannel.id;
  dom.channelModalTitle.textContent =
    state.channelModal.mode === "edit" ? `编辑 ${modalChannel.label}` : "添加频道";
  dom.channelModalHint.textContent = `${modalChannel.label}: ${modalChannel.description}`;
  dom.channelModalSaveButton.textContent =
    state.channelModal.mode === "edit" ? "确定并保存" : "添加并保存";

  setHidden(dom.channelModal, !state.channelModal.open);
  setHidden(dom.telegramConfigBlock, modalChannel.id !== "telegram");
  setHidden(dom.feishuConfigBlock, modalChannel.id !== "feishu");
  setHidden(dom.slackConfigBlock, modalChannel.id !== "slack");
  setHidden(dom.discordConfigBlock, modalChannel.id !== "discord");
  setHidden(dom.whatsappConfigBlock, modalChannel.id !== "whatsapp");
  setHidden(dom.signalConfigBlock, modalChannel.id !== "signal");
  setHidden(dom.slackAppTokenWrap, draftValues.mode !== "socket");
  setHidden(dom.slackSigningSecretWrap, draftValues.mode !== "http");

  renderChannelSummaryList();
  renderAgentList();
  renderBindingList();
  dom.designerOutput.value = JSON.stringify(buildStructuredConfig(), null, 2);
}

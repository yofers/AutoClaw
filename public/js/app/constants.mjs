export const CHANNEL_METADATA = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Bot Token、私聊策略与群组 allowlist。",
  },
  {
    id: "feishu",
    label: "飞书",
    description: "App ID / Secret、账号 ID 与群聊规则。",
  },
  {
    id: "slack",
    label: "Slack",
    description: "Socket 或 HTTP 模式、Token 与频道策略。",
  },
  {
    id: "discord",
    label: "Discord",
    description: "Bot Token、Guild allowlist 与 DM 控制。",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "账号、多群访问规则与 QR 登录后的路由控制。",
  },
  {
    id: "signal",
    label: "Signal",
    description: "signal-cli 账号、allowFrom 与群聊规则。",
  },
];

export const CHANNEL_TYPE_ORDER = CHANNEL_METADATA.map((item) => item.id);
export const CHANNEL_LABELS = Object.fromEntries(
  CHANNEL_METADATA.map((item) => [item.id, item.label])
);

export function defaultTelegramChannel() {
  return {
    enabled: false,
    botToken: "",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    groups: "",
    requireMention: true,
  };
}

export function defaultFeishuChannel() {
  return {
    enabled: false,
    accountId: "main",
    botName: "",
    appId: "",
    appSecret: "",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    groups: "",
    requireMention: true,
  };
}

export function defaultSlackChannel() {
  return {
    enabled: false,
    mode: "socket",
    botToken: "",
    appToken: "",
    signingSecret: "",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    channels: "",
    requireMention: true,
  };
}

export function defaultDiscordChannel() {
  return {
    enabled: false,
    botToken: "",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    guilds: "",
    requireMention: true,
  };
}

export function defaultWhatsAppChannel() {
  return {
    enabled: false,
    accountId: "main",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    groups: "",
    groupAllowFrom: "",
    selfChatMode: false,
    requireMention: true,
  };
}

export function defaultSignalChannel() {
  return {
    enabled: false,
    account: "",
    cliPath: "signal-cli",
    dmPolicy: "pairing",
    allowFrom: "",
    groupPolicy: "allowlist",
    groups: "",
    groupAllowFrom: "",
    requireMention: true,
  };
}

export function createDefaultChannelState(channelType) {
  switch (channelType) {
    case "telegram":
      return defaultTelegramChannel();
    case "feishu":
      return defaultFeishuChannel();
    case "slack":
      return defaultSlackChannel();
    case "discord":
      return defaultDiscordChannel();
    case "whatsapp":
      return defaultWhatsAppChannel();
    case "signal":
      return defaultSignalChannel();
    default:
      return { enabled: false };
  }
}

export function createAgent(sequence, workspace = "~/.openclaw/workspace") {
  return {
    key: `agent-${sequence}`,
    id: sequence === 1 ? "main" : `agent-${sequence}`,
    name: sequence === 1 ? "主 Agent" : "",
    workspace,
    default: sequence === 1,
  };
}

export function createBinding(sequence, fallbackAgentId = "main", fallbackChannel = "telegram") {
  return {
    key: `binding-${sequence}`,
    agentId: fallbackAgentId,
    channel: fallbackChannel,
    accountId: "",
    peerKind: "direct",
    peerId: "",
  };
}

export function createDesignerState(workspace = "~/.openclaw/workspace") {
  return {
    workspace,
    gatewayBind: "loopback",
    gatewayPort: 18789,
    gatewayAuth: "token",
    gatewayToken: "",
    gatewayPassword: "",
    channelDraftType: "telegram",
    telegram: defaultTelegramChannel(),
    feishu: defaultFeishuChannel(),
    slack: defaultSlackChannel(),
    discord: defaultDiscordChannel(),
    whatsapp: defaultWhatsAppChannel(),
    signal: defaultSignalChannel(),
    agents: [createAgent(1, workspace)],
    bindings: [],
  };
}

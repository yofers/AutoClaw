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

export const MODEL_PROVIDER_METADATA = [
  {
    id: "openai",
    label: "OpenAI",
    auth: "OPENAI_API_KEY",
    examples: ["gpt-5.4", "gpt-5.4-pro"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    auth: "ANTHROPIC_API_KEY / claude setup-token",
    examples: ["claude-opus-4-6"],
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    auth: "OAuth (ChatGPT)",
    examples: ["gpt-5.4"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    auth: "OPENCODE_API_KEY",
    examples: ["claude-opus-4-6"],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    auth: "OPENCODE_API_KEY",
    examples: ["kimi-k2.5"],
  },
  {
    id: "google",
    label: "Google Gemini",
    auth: "GEMINI_API_KEY",
    examples: ["gemini-3.1-pro-preview", "gemini-3-flash-preview"],
  },
  {
    id: "google-vertex",
    label: "Google Vertex",
    auth: "gcloud ADC",
    examples: [],
  },
  {
    id: "google-gemini-cli",
    label: "Gemini CLI",
    auth: "OAuth",
    examples: [],
  },
  {
    id: "zai",
    label: "Z.AI (GLM)",
    auth: "ZAI_API_KEY",
    examples: ["glm-5"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    auth: "OPENROUTER_API_KEY",
    examples: ["anthropic/claude-sonnet-4-5"],
  },
  {
    id: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    auth: "AI_GATEWAY_API_KEY",
    examples: ["anthropic/claude-opus-4.6"],
  },
  {
    id: "kilocode",
    label: "Kilo Gateway",
    auth: "KILOCODE_API_KEY",
    examples: ["anthropic/claude-opus-4.6"],
  },
  {
    id: "moonshot",
    label: "Moonshot AI",
    auth: "MOONSHOT_API_KEY",
    examples: [],
  },
  {
    id: "kimi-coding",
    label: "Kimi Coding",
    auth: "KIMI_API_KEY / KIMICODE_API_KEY",
    examples: [],
  },
  {
    id: "minimax",
    label: "MiniMax",
    auth: "MINIMAX_API_KEY",
    examples: [],
  },
  {
    id: "modelstudio",
    label: "Model Studio",
    auth: "MODELSTUDIO_API_KEY",
    examples: [],
  },
  {
    id: "qianfan",
    label: "Qianfan",
    auth: "QIANFAN_API_KEY",
    examples: [],
  },
  {
    id: "qwen",
    label: "Qwen",
    auth: "参考官方文档",
    examples: [],
  },
  {
    id: "mistral",
    label: "Mistral",
    auth: "MISTRAL_API_KEY",
    examples: ["mistral-large-latest"],
  },
  {
    id: "xai",
    label: "xAI",
    auth: "XAI_API_KEY",
    examples: [],
  },
  {
    id: "together",
    label: "Together AI",
    auth: "TOGETHER_API_KEY",
    examples: [],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    auth: "NVIDIA_API_KEY",
    examples: [],
  },
  {
    id: "synthetic",
    label: "Synthetic",
    auth: "参考官方文档",
    examples: [],
  },
  {
    id: "venice",
    label: "Venice AI",
    auth: "VENICE_API_KEY",
    examples: [],
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    auth: "HUGGINGFACE_HUB_TOKEN / HF_TOKEN",
    examples: ["deepseek-ai/DeepSeek-R1"],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    auth: "COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN",
    examples: [],
  },
  {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    auth: "XIAOMI_API_KEY",
    examples: [],
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway",
    auth: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    examples: [],
  },
  {
    id: "volcengine",
    label: "Volcengine",
    auth: "VOLCANO_ENGINE_API_KEY",
    examples: [],
  },
  {
    id: "byteplus",
    label: "BytePlus",
    auth: "BYTEPLUS_API_KEY",
    examples: [],
  },
  {
    id: "ollama",
    label: "Ollama",
    auth: "本地运行时",
    examples: [],
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
    modelProvider: "openai",
    modelId: "",
    modelFallbacks: "",
    modelAllowlist: "",
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

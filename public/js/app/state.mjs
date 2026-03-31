import { createDefaultChannelState, createDesignerState } from "./constants.mjs";

export const state = {
  busy: false,
  installLocked: false,
  onboardingLocked: false,
  lastSyncAt: 0,
  activeViewId: "dashboard-view",
  designer: createDesignerState(),
  designerInitialized: false,
  nextAgentSequence: 2,
  nextBindingSequence: 1,
  channelModal: {
    open: false,
    mode: "create",
    type: "telegram",
    draft: createDefaultChannelState("telegram"),
  },
  skills: {
    data: null,
    search: "",
    filter: "installed",
    loadingMore: false,
    installModal: {
      open: false,
      slug: "",
      name: "",
      scope: "workspace",
      workspace: "",
    },
  },
};

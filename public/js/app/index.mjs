import { bindAppInteractions, hydrateApp } from "./actions.mjs";
import { applyBusyState, printConsole } from "./render.mjs";

bindAppInteractions();

hydrateApp()
  .then(() => {
    applyBusyState();
  })
  .catch((error) => {
    printConsole("初始化失败", { stderr: error.message });
  });

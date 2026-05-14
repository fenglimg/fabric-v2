export const allCommands = {
  install: () => import("./install.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  serve: () => import("./serve.js").then((module) => module.default),
  uninstall: () => import("./uninstall.js").then((module) => module.default),
  config: () => import("./config.js").then((module) => module.default),
  "plan-context-hint": () =>
    import("./plan-context-hint.js").then((module) => module.default),
};

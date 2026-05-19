export const allCommands = {
  install: () => import("./install.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  serve: () => import("./serve.js").then((module) => module.default),
  uninstall: () => import("./uninstall.js").then((module) => module.default),
  config: () => import("./config.js").then((module) => module.default),
  "plan-context-hint": () =>
    import("./plan-context-hint.js").then((module) => module.default),
  // v2.0.0-rc.23 TASK-014 (F8c): S5 onboard-slot coverage. Used by the
  // fabric-archive Skill's first-run phase to detect unclaimed slots.
  "onboard-coverage": () =>
    import("./onboard-coverage.js").then((module) => module.default),
};

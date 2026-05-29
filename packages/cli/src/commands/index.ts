// v2.0.0-rc.37 Wave A2: `serve` subcommand quarantined to
// packages/server-http-experimental/ per KB decision
// [[fabric-serve-quarantine-not-delete]]. The HTTP-server entry point is no
// longer wired into the main CLI; restore via the package README's restoration
// recipe if a future web UI surface re-introduces it.
export const allCommands = {
  install: () => import("./install.js").then((module) => module.default),
  // v2.1.0-rc.1 P3: multi-store lifecycle command group (list/add/remove/explain).
  store: () => import("./store.js").then((module) => module.default),
  // v2.1.0-rc.1 P3 (F5): read-only identity/status info commands.
  whoami: () => import("./whoami.js").then((module) => module.default),
  status: () => import("./status.js").then((module) => module.default),
  "scope-explain": () => import("./scope-explain.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  uninstall: () => import("./uninstall.js").then((module) => module.default),
  config: () => import("./config.js").then((module) => module.default),
  "plan-context-hint": () =>
    import("./plan-context-hint.js").then((module) => module.default),
  // v2.0.0-rc.23 TASK-014 (F8c): S5 onboard-slot coverage. Used by the
  // fabric-archive Skill's first-run phase to detect unclaimed slots.
  "onboard-coverage": () =>
    import("./onboard-coverage.js").then((module) => module.default),
  // v2.0.0-rc.37 NEW-34: text dashboard over .fabric/metrics.jsonl.
  metrics: () => import("./metrics.js").then((module) => module.default),
};

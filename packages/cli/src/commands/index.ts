// v2.0.0-rc.37 Wave A2: `serve` subcommand quarantined to
// packages/server-http-experimental/ per KB decision
// [[fabric-serve-quarantine-not-delete]]. The HTTP-server entry point is no
// longer wired into the main CLI; restore via the package README's restoration
// recipe if a future web UI surface re-introduces it.
export const allCommands = {
  // v2.2.0-rc.5: pipeline-based install with TUI renderer (EPIC-005/006/007/008)
  install: () => import("./install-v2.js").then((module) => module.installCommand),
  // v2.1.0-rc.1 P3: multi-store lifecycle command group (list/add/remove/explain).
  store: () => import("./store.js").then((module) => module.default),
  // v2.1.0-rc.1 P3 (S9/S17/S37): multi-store pull --rebase + push, conflict resume.
  sync: () => import("./sync.js").then((module) => module.default),
  // EPIC-010: Unified info command (replaces whoami/status/scope-explain).
  info: () => import("./info.js").then((module) => module.default),
  // v2.1.0-rc.1 P3 (F5): read-only identity/status info commands.
  // DEPRECATED: Use `fabric info` instead. These will be removed in v3.
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
  // Block 5 (Option X): show what SessionStart injects (shared renderer with the
  // hook → byte-identical). --explain for per-entry provenance.
  context: () => import("./context.js").then((module) => module.default),
};

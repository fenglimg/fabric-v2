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
  // EPIC-010: Unified info command (replaces the retired whoami/status aliases).
  // W3-F: `info scope <coord>` is now a real subcommand (was the retired
  // top-level `scope-explain` command); skills call `fabric info scope`.
  info: () => import("./info.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  uninstall: () => import("./uninstall.js").then((module) => module.default),
  config: () => import("./config.js").then((module) => module.default),
  "plan-context-hint": () =>
    import("./plan-context-hint.js").then((module) => module.default),
  // v2.0.0-rc.23 TASK-014 (F8c): S5 onboard-slot coverage. Used by the
  // fabric-archive Skill's first-run phase to detect unclaimed slots.
  "onboard-coverage": () =>
    import("./onboard-coverage.js").then((module) => module.default),
  // W3-D (UX northstar): knowledge & telemetry audit group — the surfaces that
  // used to ride on `fabric doctor --<flag>` (cite / conflicts / history /
  // descriptions / metrics / retired). doctor now keeps only health + fix.
  // W3-F: the metrics dashboard is reachable ONLY as `fabric audit metrics`
  // (top-level `metrics` alias retired — metrics.ts lives on as that subcommand).
  audit: () => import("./audit.js").then((module) => module.default),
  // Block 5 (Option X) / W3-F: show what SessionStart injects (shared renderer
  // with the hook → byte-identical). Renamed from `context`. --explain for
  // per-entry provenance.
  inspect: () => import("./inspect.js").then((module) => module.default),
  // Read-only knowledge preview: a loopback-only HTTP server serving a web UI
  // that groups store knowledge by semantic_scope. This is the "future web UI"
  // whose restart door KT-DEC-0016 deliberately kept open — a minimal
  // read-only surface, NOT a revival of the quarantined `serve`.
  preview: () => import("./preview.js").then((module) => module.default),
  // M-first-value-loop: deterministic first-hit oracle + surface summary.
  "first-hit": () => import("./first-hit.js").then((module) => module.default),
};

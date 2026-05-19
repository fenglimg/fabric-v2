import type { Messages } from "../types.js";

export const enMessages: Messages = {
  "cli.main.description":
    "Fabric CLI - AI agent collaboration framework.\n" +
    "\n" +
    "Three-step mental model:\n" +
    "  Install (装) - fab install   one-shot project setup\n" +
    "  Configure (配) - fab config  interactive configuration panel\n" +
    "  Run (跑) - fab serve         launch the local MCP HTTP service\n" +
    "             fab doctor        run target-state diagnostics\n" +
    "\n" +
    "Examples:\n" +
    "  fab install                  install Fabric in the current project\n" +
    "  fab config                   open the interactive configuration panel\n" +
    "  fab serve --port 7373        start the MCP HTTP service\n" +
    "  fab doctor --fix             repair derived Fabric state\n" +
    "  fab uninstall --dry-run      preview uninstall without removing files",
  "cli.shared.created": "Created",
  "cli.shared.skipped": "Skipped",
  "cli.shared.next": "Next",
  "cli.shared.reason": "Reason",
  "cli.shared.updated": "Updated",
  "cli.shared.missing": "missing",
  "cli.shared.present": "present",
  "cli.shared.absent": "missing",
  "cli.shared.yes": "yes",
  "cli.shared.no": "no",
  "cli.shared.none": "none",
  "cli.shared.loading": "loading",
  "cli.shared.refresh": "Refresh",
  "cli.shared.target-invalid": "Target must be an existing directory: {target}",
  "cli.shared.template-not-found": "Template not found: {path}",
  "cli.shared.invalid-host-empty": "Invalid host: <empty>",
  "cli.shared.invalid-port": "Invalid port: {value}",
  "cli.shared.error": "Error",

  "cli.approve.description": "Approve drifted human-lock entries from the command line.",
  "cli.approve.args.all.description": "Approve all drifted human-lock entries without prompting.",
  "cli.approve.args.interactive.description": "Prompt before approving each drifted human-lock entry.",
  "cli.approve.args.target.description": "Target project path, default is the current working directory.",
  "cli.approve.no-drift": "No drift entries found.",
  "cli.approve.prompt": "Approve this entry? [y/N] ",
  "cli.approve.approved-one": "Approved {location}",
  "cli.approve.skipped-one": "Skipped {location}",
  "cli.approve.summary": "Approved {approved}/{total} drift entries. Skipped {skipped}.",
  "cli.approve.table.expected": "Expected",
  "cli.approve.table.current": "Current",

  "cli.bootstrap.description": "Install Fabric bootstrap prompts for supported AI clients.",
  "cli.bootstrap.install.description": "Copy Fabric bootstrap templates into native client locations.",
  "cli.bootstrap.install.args.clients.description":
    "Optional comma-separated client filter, for example claude,cursor,codex.",
  "cli.bootstrap.install.no-targets":
    "No bootstrap targets detected. Pass --clients claude,cursor,codex to install explicitly.",
  "cli.bootstrap.install.installed": "Installed {path}",
  "cli.bootstrap.install.skipped-header": "Skipped {path}: Fabric Bootstrap header already present.",
  "cli.bootstrap.install.prepended": "Prepended {path}",
  "cli.bootstrap.errors.unknown-client":
    "Unknown client \"{client}\". Use a comma-separated list such as claude,cursor,codex.",

  "cli.config.description":
    "Open the interactive Fabric configuration panel (language, knowledge layer, audit mode, hint windows, MCP client wiring, etc.).\n" +
    "\n" +
    "Examples:\n" +
    "  fab config                   open the interactive panel\n" +
    "  fab config --target /path    edit configuration for a specific project",
  "cli.config.args.target.description": "Target project directory (defaults to cwd).",
  "cli.config.clients.claude": "Claude Code CLI",
  "cli.config.install.description": "Install Fabric MCP server entries into detected client configs.",
  "cli.config.install.args.clients.description":
    "Optional comma-separated client filter, for example cursor,codex.",
  "cli.config.install.args.dry-run.description": "Preview detected write operations without modifying files.",
  "cli.config.errors.unknown-client":
    "Unknown client \"{client}\". Use a comma-separated list such as cursor,codex.",
  "cli.config.errors.expected-object": "Expected object in {path}",
  "cli.config.install.no-configs":
    "No Fabric MCP client config detected. Create the client directory or set clientPaths in fabric.config.json.",
  "cli.config.install.no-config-path": "Skipping {client}: no config path detected.",
  "cli.config.install.dry-run": "[dry-run] {client}: would write {path}",
  "cli.config.install.wrote": "{client}: wrote {path}",

  // rc.16 TASK-006 (F1-panel): clack-driven `fab config` interactive panel.
  // Keys consumed by packages/cli/src/commands/config.ts (menu loop +
  // per-field prompts) and by getPanelFields() (label_i18n_key references).
  "cli.config.intro": "Fabric Configuration",
  "cli.config.outro": "Configuration saved.",
  "cli.config.outro-no-changes": "No changes made.",
  "cli.config.cancel": "Cancelled.",
  "cli.config.non-tty-notice":
    "fab config requires an interactive terminal. Run it from a TTY to edit configuration fields.",
  "cli.config.menu.field-select": "Select a field to edit:",
  "cli.config.menu.exit": "Exit",
  "cli.config.value.current": "current: {value}",
  "cli.config.value.default-marker": "(default)",
  "cli.config.prompt.select": "Choose a new value for {key} (current: {current}):",
  "cli.config.prompt.text": "Enter a new value for {key} (current: {current}):",
  "cli.config.write.success": "Saved {key} = {value}",
  "cli.config.write.failure": "Failed to write fabric-config.json: {message}",
  "cli.config.errors.uninit-workspace.message":
    "Workspace not initialized. Run `fab install` first.",
  "cli.config.errors.invalid-int": "Must be a positive integer.",
  "cli.config.errors.unknown-field": "Unknown field selection — skipping.",
  "cli.config.errors.no-enum-options": "No enum options available for this field — skipping.",
  // Per-field labels (11 total: 2 Group A + 8 Group B + 1 Group C).
  "cli.config.fields.fabric_language.label": "Language",
  "cli.config.fields.fabric_language.description":
    "Language used by Fabric hooks and Skills output.",
  "cli.config.fields.default_layer_filter.label": "Default knowledge layer",
  "cli.config.fields.default_layer_filter.description":
    "Default layer scope for knowledge listings (team / personal / both).",
  "cli.config.fields.archive_hint_hours.label": "Archive hint window (hours)",
  "cli.config.fields.archive_hint_hours.description":
    "Window (in hours) used by Signal A to detect frequent edits worth archiving.",
  "cli.config.fields.archive_hint_cooldown_hours.label": "Archive hint cooldown (hours)",
  "cli.config.fields.archive_hint_cooldown_hours.description":
    "Cooldown (in hours) before the same archive hint can fire again.",
  "cli.config.fields.archive_edit_threshold.label": "Archive edit threshold",
  "cli.config.fields.archive_edit_threshold.description":
    "Edit-count cutoff that triggers the Signal A archive hint.",
  "cli.config.fields.underseed_node_threshold.label": "Underseed node threshold",
  "cli.config.fields.underseed_node_threshold.description":
    "Minimum knowledge-node count below which Fabric flags the workspace as underseeded.",
  "cli.config.fields.review_hint_pending_count.label": "Review pending count",
  "cli.config.fields.review_hint_pending_count.description":
    "Pending-review count above which the review hint fires.",
  "cli.config.fields.review_hint_pending_age_days.label": "Review pending age (days)",
  "cli.config.fields.review_hint_pending_age_days.description":
    "Pending-review age (in days) above which the review hint fires.",
  "cli.config.fields.maintenance_hint_days.label": "Maintenance hint window (days)",
  "cli.config.fields.maintenance_hint_days.description":
    "Day window for Fabric to surface a knowledge-maintenance hint.",
  "cli.config.fields.maintenance_hint_cooldown_days.label": "Maintenance hint cooldown (days)",
  "cli.config.fields.maintenance_hint_cooldown_days.description":
    "Cooldown (in days) before the maintenance hint can fire again.",
  "cli.config.fields.audit_mode.label": "Audit mode",
  "cli.config.fields.audit_mode.description":
    "Audit verbosity for human-lock + drift detection (strict / warn / off).",

  "cli.doctor.description":
    "Run Fabric target-state diagnostics (meta sync, knowledge index, bootstrap, events ledger, human-lock drift).\n" +
    "\n" +
    "Examples:\n" +
    "  fab doctor                   read-only diagnostics report\n" +
    "  fab doctor --fix             repair derived state (meta + indexes)\n" +
    "  fab doctor --fix-knowledge   apply lint mutations (demote / archive)\n" +
    "  fab doctor --json --strict   machine-readable output, warnings as errors",
  "doctor.section.fixable": "Fixable errors:",
  "doctor.section.manual": "Manual errors:",
  "doctor.section.warnings": "Warnings:",
  "doctor.section.fix-knowledge-mutations": "Fix-knowledge mutations:",
  // rc.20 TASK-07: cite-coverage human-readable formatter keys.
  "doctor.section.cite-coverage": "Cite coverage:",
  "doctor.cite.header": "Since {since} via marker {marker}",
  "doctor.cite.warning.justActivated":
    "Cite policy activated on this run; no historical data yet.",
  "doctor.cite.metric.editsTouched": "Edits touched",
  "doctor.cite.metric.qualifyingCites": "Qualifying cites",
  "doctor.cite.metric.recalledUnverified": "Recalled but not verified",
  "doctor.cite.metric.expectedButMissed": "Expected cite missing",
  "doctor.cite.metric.totalTurns": "Total turns",
  "doctor.cite.section.perClient": "Per-client",
  "doctor.cite.section.dismissedReasons": "Dismissed reasons",
  "doctor.cite.dismissed.scope-mismatch": "Scope mismatch",
  "doctor.cite.dismissed.outdated": "Outdated",
  "doctor.cite.dismissed.not-applicable": "Not applicable",
  "doctor.cite.dismissed.other": "Other",
  "doctor.cite.dismissed.unspecified": "Unspecified",
  "doctor.cite.section.noneReasons": "KB: none reasons",
  "doctor.cite.none.no-relevant": "No relevant entry",
  "doctor.cite.none.not-applicable": "Not applicable",
  "doctor.cite.none.unspecified": "Unspecified",
  "doctor.cite.status.skipped":
    "Cite policy not yet activated for this workspace.",
  // v2.0.0-rc.24 TASK-09: cite-coverage contract-policy renderer keys.
  // Companion schema: packages/shared/src/schemas/api-contracts.ts
  // citeCoverageReportSchema. Consumer: TASK-10 CLI doctor --cite-coverage.
  "cite-coverage.contract.header": "Contract check",
  "cite-coverage.contract.decisions_cited": "Decisions cited",
  "cite-coverage.contract.pitfalls_cited": "Pitfalls cited",
  "cite-coverage.contract.with": "With contract",
  "cite-coverage.contract.missing": "Missing contract",
  "cite-coverage.contract.hard_violated":
    "Hard violations (operator did not match session edits)",
  "cite-coverage.contract.cite_id_unresolved": "Unresolved cite IDs",
  "cite-coverage.contract.skip_count": "Skip bucket",
  "cite-coverage.contract.status.ok": "ok",
  "cite-coverage.contract.status.skipped_bootstrap_drift":
    "skipped (bootstrap drift — run `fab install`)",
  "cite-coverage.contract.status.awaiting_marker": "awaiting first marker emit",
  // Singular knowledge-type labels (verbatim alignment with KnowledgeTypeSchema)
  // plus the sixth "unresolved" bucket.
  "cite-coverage.contract.type.decision": "decision",
  "cite-coverage.contract.type.pitfall": "pitfall",
  "cite-coverage.contract.type.model": "model",
  "cite-coverage.contract.type.guideline": "guideline",
  "cite-coverage.contract.type.process": "process",
  "cite-coverage.contract.type.unresolved": "unresolved",
  // Layer labels (per_layer_type headers + layer_filter banner).
  "cite-coverage.layer.team": "team",
  "cite-coverage.layer.personal": "personal",
  "cite-coverage.layer.team_review": "[team — review]",
  "cite-coverage.layer.personal_fyi": "[personal — fyi]",
  // skip_reason vocabulary (bootstrap-docs canonical; renderer falls back to
  // the raw key for unknown buckets — operators data-drive extensions).
  "cite-coverage.skip.sequencing": "sequencing constraint",
  "cite-coverage.skip.conditional": "conditional branch",
  "cite-coverage.skip.semantic": "semantic rule",
  "cite-coverage.skip.aesthetic": "style / aesthetic",
  "cite-coverage.skip.architectural": "architectural layer",
  "cite-coverage.skip.other": "other",
  "cli.doctor.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.doctor.args.fix.description": "Repair derived Fabric state (meta + indexes).",
  "cli.doctor.args.json.description": "Print the doctor report as JSON.",
  "cli.doctor.args.strict.description": "Treat warnings as failures.",
  "cli.doctor.args.fix-knowledge.description":
    "Apply knowledge lint mutations: demote orphaned canonical entries, archive stale drafts, and bump drifted index counters. Default doctor run remains report-only.",
  "cli.doctor.args.yes.description":
    "Skip the --fix-knowledge safety confirm. Required for non-tty invocations unless FABRIC_NONINTERACTIVE=1 is set in the environment.",
  "cli.doctor.errors.fix-knowledge-fix-mutually-exclusive":
    "--fix-knowledge and --fix cannot be combined. --fix-knowledge mutates user knowledge state (demote/archive); --fix repairs derived state (meta/index). Run them separately.",
  // rc.20 TASK-05: --cite-coverage report flags. Read-only; mutually exclusive with --fix/--fix-knowledge.
  "cli.doctor.args.cite-coverage.description":
    "Generate cite policy adherence report (read-only; skips standard inspections)",
  "cli.doctor.args.since.description":
    "Time window for cite coverage (e.g. 7d, 24h, 30m)",
  "cli.doctor.args.client.description":
    "Filter cite coverage by client (cc|codex|cursor|all)",
  // v2.0.0-rc.24 TASK-10: --layer filters cite contract audit by KB layer (team|personal|all).
  "cli.doctor.args.layer.description":
    "Filter cite contract audit by KB layer (team|personal|all)",
  "cli.doctor.errors.cite-coverage-mutex":
    "--cite-coverage cannot be combined with --fix or --fix-knowledge",
  "cli.doctor.errors.invalid-since":
    "Invalid --since value: {input}. Expected duration like 7d, 24h, 30m or epoch ms.",
  "cli.doctor.errors.invalid-client":
    "Invalid --client value: {input}. Expected cc, codex, cursor, or all.",
  "cli.doctor.errors.invalid-layer":
    "Invalid --layer value: {input}. Expected team, personal, or all.",
  // rc.23 TASK-007 (a-C2): --enrich-descriptions flag set. Back-fills the
  // four description-grade frontmatter fields on canonical knowledge entries.
  "cli.doctor.args.enrich-descriptions.description":
    "Back-fill missing intent_clues / tech_stack / impact / must_read_if on canonical knowledge entries (read-only by default; pair with --auto to write stubs).",
  "cli.doctor.args.auto.description":
    "With --enrich-descriptions: write deterministic stub values for missing fields. Without --auto, the run is read-only.",
  "cli.doctor.args.dry-run.description":
    "With --enrich-descriptions --auto: preview the would-be changes without writing to disk.",
  "cli.doctor.errors.enrich-descriptions-mutex":
    "--enrich-descriptions cannot be combined with --fix, --fix-knowledge, or --cite-coverage. Run them separately.",
  "doctor.enrich.allComplete":
    "All canonical knowledge entries already declare intent_clues / tech_stack / impact / must_read_if.",
  // v2.0.0-rc.25 TASK-10: --archive-history flag set. Read-only audit of
  // session_archive_attempted events; mutually exclusive with the other
  // mutation/report surfaces.
  "cli.doctor.args.archive-history.description":
    "Render per-session archive attempt history (read-only; reads session_archive_attempted events).",
  "cli.doctor.errors.archive-history-mutex":
    "--archive-history cannot be combined with --fix, --fix-knowledge, --cite-coverage, or --enrich-descriptions. Run them separately.",
  "doctor.archive-history.header": "Archive history (last {sinceLabel}, {count} session{plural})",
  "doctor.archive-history.empty": "No archive history yet within the --since={sinceLabel} window.",
  "doctor.archive-history.table.session": "Session",
  "doctor.archive-history.table.lastAttempt": "Last attempt",
  "doctor.archive-history.table.outcome": "Outcome",
  "doctor.archive-history.table.candidates": "Candidates",
  "doctor.archive-history.table.coveredGap": "Covered gap",

  "cli.hooks.description": "Manage Fabric Git hook templates.",
  "cli.hooks.install.description": "Install the Fabric Husky pre-commit hook template.",
  "cli.hooks.install.args.target.description": "Target project path, default is the current working directory.",
  "cli.hooks.errors.package-json-required": "package.json is required to install hooks: {path}",
  "cli.hooks.install.hook-skipped": "Fabric hook already present in {path}, skipped.",
  "cli.hooks.install.hook-appended": "Appended Fabric hook to existing {path}",
  "cli.hooks.install.hook-created": "Created {path}",
  "cli.hooks.install.prepare-left": "Left existing prepare script unchanged in {path}",
  "cli.hooks.install.prepare-added": "Added prepare script to {path}",

  "cli.human-lint.description": "Validate locked human-edit regions.",
  "cli.human-lint.args.target.description": "Target project path, default is the current working directory.",
  "cli.human-lint.drift-detected":
    "Human-locked content drift detected. Revert the edit or update approved hashes before committing.",
  "cli.human-lint.table.location": "Location",
  "cli.human-lint.table.expected": "Expected",
  "cli.human-lint.table.got": "Got",

  "cli.install.description":
    "Install Fabric in the target project (scaffold .fabric/, bootstrap templates, MCP client wiring, git hooks).\n" +
    "\n" +
    "Examples:\n" +
    "  fab install                  interactive install in the current project\n" +
    "  fab install --yes            accept defaults, skip the TTY wizard\n" +
    "  fab install --dry-run        preview the install plan without writing files",
  "cli.install.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.install.args.debug.description": "Print target resolution details to stderr.",
  "cli.install.args.yes.description": "Accept the current install plan and run without the TTY wizard",
  "cli.install.args.dry-run.description": "Print the install plan without writing files or running follow-up stages",
  "cli.install.mcp.install.global": "Using globally-installed @fenglimg/fabric-server",
  "cli.install.mcp.install.local": "Installing @fenglimg/fabric-server to project devDependencies",
  "cli.install.mcp.local.installing": "Running {manager} add -D @fenglimg/fabric-server...",
  "cli.install.mcp.local.installed": "Installed to devDependencies",
  "cli.install.mcp.scope.project": "Writes .mcp.json in project root (per Claude Code spec)",
  "cli.install.mcp.scope.user": "Writes ~/.claude.json (user-scoped, applies to all projects)",
  "cli.install.wizard.mcp-scope": "Claude MCP config scope (project/.mcp.json or user/~/.claude.json) [{defaultValue}]",
  "cli.install.created-path": "{label} {path}",
  "cli.install.skipped-existing-path": "{label} {path}: already exists.",
  "cli.install.label.overwritten": "Overwritten",
  "cli.install.stages.bootstrap": "Installing bootstrap templates...",
  "cli.install.stages.bootstrap.snapshot.written": "Wrote .fabric/AGENTS.md snapshot",
  "cli.install.stages.bootstrap.snapshot.skipped": "Skipped .fabric/AGENTS.md — already current",
  "cli.install.steps.bootstrap-claude": "Updated CLAUDE.md with @-import directives",
  "cli.install.steps.bootstrap-codex": "Updated AGENTS.md with fabric:bootstrap managed block",
  "cli.install.steps.bootstrap-cursor": "Updated .cursor/rules/fabric-bootstrap.mdc",
  "cli.install.stages.mcp": "Configuring MCP clients...",
  "cli.install.stages.hooks": "Installing git hooks...",
  "cli.install.stages.skipped": "skipped",
  "cli.install.stages.completed": "completed",
  "cli.install.stages.failed": "failed",
  "cli.install.stages.summary.ran": "ran",
  "cli.install.stages.summary.skipped": "skipped",
  "cli.install.stages.summary.failed": "failed",
  "cli.install.next-step": "{label} {message}",
  "cli.install.reason-message": "{label} {message}",
  "cli.install.language_preference_hint":
    "Fabric language preference: {value}. To change, edit `fabric_language` in `.fabric/fabric-config.json` (values: match-existing | zh-CN | en | zh-CN-hybrid).",
  "cli.install.plan.title": "Fabric install plan",
  "cli.install.plan.mode-banner.default": "[mode: apply] Standard install execution",
  "cli.install.plan.mode-banner.plan": "[mode: plan] Dry run only, no files will be written",
  "cli.install.plan.target": "Target: {target}",
  "cli.install.plan.actions": "Plan: bootstrap={bootstrap} mcp={mcp} hooks={hooks} mcp-install={mcpInstall}",
  "cli.install.plan.detected": "Detected clients: {clients}",
  "cli.install.plan.writes": "Core writes:",
  "cli.install.plan.preview-title": "Fabric install dry run",
  "cli.install.plan.preview-result": "Mode={mode} bootstrap={bootstrap} mcp={mcp} hooks={hooks}",
  "cli.install.mode.default": "default",
  "cli.install.mode.badge.default": "APPLY",
  "cli.install.mode.badge.plan": "PLAN",
  "cli.install.wizard.title": "Fabric install wizard",
  "cli.install.wizard.intro": "Fabric install",
  "cli.install.wizard.overview.title": "Install overview",
  "cli.install.wizard.overview.body": "Target: {target}\nMode: {mode}\nThis wizard only reshapes the install plan; execution still runs through the existing Fabric install stages.",
  "cli.install.wizard.step.target": "Confirm target",
  "cli.install.wizard.step.plan": "Shape install plan",
  "cli.install.wizard.step.review": "Review final plan",
  "cli.install.wizard.target.confirm": "Continue installing Fabric in {target}? [Y/n]",
  "cli.install.wizard.stage.bootstrap": "Install bootstrap templates? [{defaultValue}]",
  "cli.install.wizard.stage.mcp": "Configure MCP clients? [{defaultValue}]",
  "cli.install.wizard.stage.hooks": "Install git hooks? [{defaultValue}]",
  "cli.install.wizard.mcp-install": "MCP server install scope (global/local) [{defaultValue}]",
  "cli.install.wizard.execute.confirm": "Execute this install plan now? [Y/n]",
  "cli.install.wizard.outro": "Install plan accepted. Running Fabric install...",
  "cli.install.wizard.invalid-yes-no": "Please answer yes or no.",
  "cli.install.wizard.invalid-select": "Invalid value. Use one of: {options}.",
  "cli.install.wizard.cancelled": "Fabric install cancelled before execution.",
  "cli.install.capabilities.title": "Client capability summary",
  "cli.install.capabilities.none": "No supported client was detected for bootstrap or MCP follow-up.",
  "cli.install.capabilities.header.client": "Client",
  "cli.install.capabilities.header.bootstrap": "Bootstrap",
  "cli.install.capabilities.header.mcp": "MCP",
  "cli.install.capabilities.header.hook": "Hook",
  "cli.install.capabilities.header.skill": "Skill",
  "cli.install.capabilities.header.follow-up": "Follow-up",
  "cli.install.capabilities.status.ready": "ready",
  "cli.install.capabilities.status.installed": "installed",
  "cli.install.capabilities.status.supported": "supported",
  "cli.install.capabilities.status.manual": "manual",
  "cli.install.capabilities.status.skipped": "skipped",
  "cli.install.capabilities.status.failed": "failed",
  "cli.install.capabilities.status.na": "n/a",
  "cli.install.capabilities.follow-up.ready": "continue in client",
  "cli.install.capabilities.follow-up.install": "install client assets",
  "cli.install.capabilities.follow-up.manual": "manual step required",
  "cli.install.next-step.message": "run fab hooks install to add the Day 4 pre-commit pipeline.",
  "cli.install.reason-message.installable-body":
    ".fabric/forensic.json is ready; some detected clients support Fabric follow-up but still need client assets installed.",
  "cli.install.reason-message.manual-body":
    ".fabric/forensic.json is ready; some detected clients still need manual follow-up because no Fabric skill is installed for them yet.",
  "cli.install.codex-hooks.created": "{label} {path} with Codex hooks config (requires features.codex_hooks = true).",
  "cli.install.codex-hooks.updated": "{label} {path} with Codex hooks config (requires features.codex_hooks = true).",
  "cli.install.codex-hooks.skipped": "{label} {path}: Codex hooks config already present.",
  "cli.install.claude-settings.created": "{label} {path} with Claude Stop hook.",
  "cli.install.claude-settings.updated": "{label} {path} with Claude Stop hook.",
  "cli.install.claude-settings.skipped": "{label} {path}: Claude Stop hook already present.",
  "cli.install.claude-settings.skipped-invalid": "{label} {path}: unable to merge Claude Stop hook.",
  "cli.install.claude-settings.invalid-object": "{label} {path}: expected a JSON object.",
  "cli.install.claude-settings.invalid-json": "{label} {path}: invalid JSON ({reason}).",
  "cli.install.claude-settings.invalid-hooks": "{label} {path}: \"hooks\" must be a JSON object.",
  "cli.install.claude-settings.invalid-stop-array": "{label} {path}: \"hooks.Stop\" must be an array.",
  "cli.install.errors.abort-existing": "ABORT: {path} already exists. fab install is non-destructive.",
  "cli.install.diff.canonical": "Workspace already canonical ({count} files verified).",
  "cli.install.diff.applying-missing": "Applying {count} missing pieces: {files}",
  "cli.install.diff.drift-abort":
    "Drift detected in {path}. Run `fab doctor` to inspect, or `fab uninstall && fab install` to reset.",
  "cli.install.diff.state.missing": "missing",
  "cli.install.diff.state.present-canonical": "canonical",
  "cli.install.diff.state.drifted": "drifted",
  "cli.install.diff.state.user-modified": "user-modified",

  "cli.uninstall.description":
    "Uninstall Fabric from the target project. .fabric/knowledge/ is always preserved; ~/.fabric/knowledge/ is never touched.\n" +
    "\n" +
    "Examples:\n" +
    "  fab uninstall                interactive uninstall in the current project\n" +
    "  fab uninstall --yes          accept defaults, skip the TTY wizard\n" +
    "  fab uninstall --dry-run      preview the uninstall plan without removing files",
  "cli.uninstall.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.uninstall.args.debug.description": "Print target resolution details to stderr.",
  "cli.uninstall.args.yes.description": "Accept the current uninstall plan and run without the TTY wizard.",
  "cli.uninstall.args.dry-run.description":
    "Print the uninstall plan without removing files or running follow-up stages.",
  "cli.uninstall.plan.title": "Fabric uninstall plan",
  "cli.uninstall.plan.target": "Target: {target}",
  "cli.uninstall.plan.actions":
    "Plan: scaffold={scaffold} bootstrap={bootstrap} mcp={mcp}",
  "cli.uninstall.plan.detected": "Detected clients: {clients}",
  "cli.uninstall.plan.preserves": "Preserves:",
  "cli.uninstall.plan.preserves.knowledge": "team knowledge tree (always preserved)",
  "cli.uninstall.plan.preserves.personal": "personal root, never touched",
  "cli.uninstall.plan.preview-title": "Fabric uninstall dry run",
  "cli.uninstall.plan.preview-result":
    "scaffold={scaffold} bootstrap={bootstrap} mcp={mcp}",
  "cli.uninstall.plan.scaffold-entries.title": "Scaffold entries:",
  "cli.uninstall.stages.scaffold": "Removing scaffold artifacts...",
  "cli.uninstall.stages.bootstrap": "Removing bootstrap (Skills + hooks)...",
  "cli.uninstall.stages.mcp": "Un-registering MCP clients...",
  "cli.uninstall.stages.completed": "completed",
  "cli.uninstall.stages.completed-with-errors": "completed with errors",
  "cli.uninstall.stages.failed": "failed",
  "cli.uninstall.summary.title": "Uninstall summary",
  "cli.uninstall.summary.body": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.wizard.intro": "Fabric uninstall",
  "cli.uninstall.wizard.overview.title": "Uninstall overview",
  "cli.uninstall.wizard.overview.body":
    "Target: {target}\nThis wizard only reshapes the uninstall plan; execution still runs through the existing Fabric uninstall stages.\n.fabric/knowledge/ is always preserved. ~/.fabric/knowledge/ is never touched.",
  "cli.uninstall.wizard.step.target": "Confirm target",
  "cli.uninstall.wizard.step.plan": "Shape uninstall plan",
  "cli.uninstall.wizard.step.review": "Review final plan",
  "cli.uninstall.wizard.target.confirm": "Continue uninstalling Fabric from {target}? [Y/n]",
  "cli.uninstall.wizard.stage.scaffold": "Remove scaffold artifacts? [{defaultValue}]",
  "cli.uninstall.wizard.stage.bootstrap": "Remove bootstrap (Skills + hooks)? [{defaultValue}]",
  "cli.uninstall.wizard.stage.mcp": "Un-register MCP clients? [{defaultValue}]",
  "cli.uninstall.wizard.execute.confirm": "Execute this uninstall plan now? [Y/n]",
  "cli.uninstall.wizard.outro": "Uninstall plan accepted. Running Fabric uninstall...",
  "cli.uninstall.wizard.cancelled": "Fabric uninstall cancelled before execution.",
  "cli.uninstall.confirm.proceed": "Proceed with uninstalling Fabric from {target}? [y/N]",
  "cli.uninstall.errors.target-not-directory": "Target must be an existing directory: {path}",

  "cli.ledger-append.description": "Append an entry to the Fabric intent ledger.",
  "cli.ledger-append.args.target.description": "Target project path, default is the current working directory.",
  "cli.ledger-append.args.staged.description": "Derive the entry from staged changes (used during pre-commit).",
  "cli.ledger-append.requires-staged": "requires --staged in pre-commit context",
  "cli.ledger-append.intent.auto": "auto: {head}{suffix}",
  "cli.ledger-append.intent.auto-more": " +{count} more",

  "cli.pre-commit.description":
    "Composite pre-commit hook: runs sync-meta --check-only, human-lint, and ledger-append --staged in one Node process.",
  "cli.pre-commit.args.target.description": "Project root directory, defaults to cwd or EXTERNAL_FIXTURE_PATH.",
  "cli.pre-commit.run-failed": "fabric pre-commit: {name} failed - {message}",

  "cli.scan.description": "Scan the project to detect Fabric bootstrap candidates.",
  "cli.scan.args.target.description":
    "Target absolute path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.scan.args.debug.description": "Print detection evidence in formatted output.",
  "cli.scan.args.json.description": "Print the diagnostic report as JSON.",
  "cli.scan.error.missing-forensic":
    "forensic.json not found at {path}; run `fabric install` first to produce the deterministic project snapshot.",
  "cli.scan.summary.created": "Wrote {count} knowledge entries to .fabric/knowledge/.",
  "cli.scan.summary.skipped": "No changes detected; {count} entries already up-to-date.",
  "cli.scan.report.title": "Fabric scan report",
  "cli.scan.report.target": "Target",
  "cli.scan.report.framework": "Framework",
  "cli.scan.report.evidence": "Evidence",
  "cli.scan.report.readme-quality": "README quality",
  "cli.scan.report.contributing": "CONTRIBUTING.md",
  "cli.scan.report.files-counted": "Files counted",
  "cli.scan.report.ignored-entries": "Ignored entries",
  "cli.scan.report.existing-fabric": "Existing Fabric files",
  "cli.scan.report.recommendations": "Recommendations:",
  "cli.scan.readme-quality.ok": "ok",
  "cli.scan.readme-quality.stub": "stub",
  "cli.scan.recommendation.init": "L0: Run fab install to scaffold `.fabric/AGENTS.md` with the canonical Fabric bootstrap content.",
  "cli.scan.recommendation.readme":
    "L0: Expand README.md before promoting project facts into Fabric references.",
  "cli.scan.recommendation.contributing":
    "L0: Add CONTRIBUTING.md or leave a bootstrap TODO reference for contribution flow.",
  "cli.scan.recommendation.unknown-framework":
    "L1: Add tech-stack TODOs manually because no framework marker was detected.",
  "cli.scan.recommendation.framework-dirs": "L1: Review {framework} directories for future scoped Fabric rule files.",

  "cli.serve.description":
    "Start the local Fabric MCP HTTP service.\n" +
    "\n" +
    "Examples:\n" +
    "  fab serve                              bind 127.0.0.1:7373 (default)\n" +
    "  fab serve --port 8787                  use a custom port\n" +
    "  FABRIC_AUTH_TOKEN=<token> fab serve --host 0.0.0.0   bind non-loopback with Bearer auth",
  "cli.serve.args.port.description": "Listen port, default 7373.",
  "cli.serve.args.host.description":
    "Listen host, default 127.0.0.1. Non-loopback hosts (e.g. 0.0.0.0) require FABRIC_AUTH_TOKEN to enable Bearer auth, otherwise serve falls back to 127.0.0.1.",
  "cli.serve.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.serve.args.debug.description": "Print target resolution details to stderr.",
  "cli.serve.ready.title": "Fabric Dashboard",
  "cli.serve.lock-held.action-hint":
    "A `fab serve` instance (PID {pid}) is holding the workspace lock. Stop it (Ctrl-C in that terminal or `kill {pid}`) before running this command.",
  "cli.serve.warning.host-fallback":
    "--host {host} requires FABRIC_AUTH_TOKEN for non-loopback exposure; falling back to 127.0.0.1. To bind {host}, run: FABRIC_AUTH_TOKEN=<token> fab serve --host {host}",
  "cli.serve.error.port-in-use": "Port {port} in use - try --port {nextPort}",

  "cli.update.description": "Refresh MCP host configuration and git hooks without re-creating Fabric files.",
  "cli.update.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.update.args.no-mcp.description": "Skip re-configuring MCP clients",
  "cli.update.args.no-hooks.description": "Skip re-installing git hooks",

  "cli.sync-meta.description": "Sync Fabric metadata from internal rule files.",
  "cli.sync-meta.args.target.description": "Target project path, default is the current working directory.",
  "cli.sync-meta.args.check-only.description":
    "Exit with code 1 when .fabric/agents.meta.json is out of date.",
  "cli.sync-meta.drift-detected": "Fabric metadata drift detected. Run fab sync-meta to update.",
  "cli.sync-meta.updated": "{label} {path}",

  "dashboard.app.nav.aria-label": "Dashboard views",
  "dashboard.app.nav.readiness.label": "Readiness",
  "dashboard.app.nav.readiness.label-bilingual": "准备情况 Readiness",
  "dashboard.app.nav.readiness.subtitle": "project status",
  "dashboard.app.nav.rules-explain.label": "Rules Explain",
  "dashboard.app.nav.rules-explain.label-bilingual": "规则解析 Rules Explain",
  "dashboard.app.nav.rules-explain.subtitle": "topology & context",
  "dashboard.app.nav.timeline.label": "Timeline",
  "dashboard.app.nav.timeline.label-bilingual": "时间线 Timeline",
  "dashboard.app.nav.timeline.subtitle": "audit & history",
  "dashboard.app.nav.health.label": "Health",
  "dashboard.app.nav.health.label-bilingual": "系统健康 Health",
  "dashboard.app.nav.health.subtitle": "doctor & diagnostics",
  "dashboard.app.nav.section.insights": "Insights",
  "dashboard.app.nav.drift-check": "Drift Check",
  "dashboard.app.nav.modules.read-only": "read-only dashboard",
  "dashboard.app.header.connected": "CONNECTED",
  "dashboard.app.header.connecting": "CONNECTING",
  "dashboard.app.live-region.received": "Received {type}",
  "dashboard.app.breadcrumb.readiness": "readiness",
  "dashboard.app.breadcrumb.rules-explain": "rules-explain",
  "dashboard.app.breadcrumb.timeline": "timeline",
  "dashboard.app.breadcrumb.health": "health",

  "dashboard.rule-topology.title": "Rule Topology",
  "dashboard.rule-topology.subtitle": "See which rules match the current path and why",
  "dashboard.rule-topology.path.placeholder": "Sample path for rules context",
  "dashboard.rule-topology.path.aria-label": "Rules context sample path",
  "dashboard.rule-topology.status.sample": "current path {path}",
  "dashboard.rule-topology.status.hits": "{count} hits",
  "dashboard.rule-topology.status.revision": "version {revision}",
  "dashboard.rule-topology.heatmap.title": "Coverage Heatmap",
  "dashboard.rule-topology.heatmap.subtitle": "Heuristic directory coverage derived from scope_glob patterns",
  "dashboard.rule-topology.heatmap.aria-label": "Directory coverage heatmap",
  "dashboard.rule-topology.heatmap.count": "{count} directories",
  "dashboard.rule-topology.heatmap.rules": "{count} rules",
  "dashboard.rule-topology.heatmap.uncovered": "no matching scope",
  "dashboard.rule-topology.heatmap.empty": "No rule directories available.",
  "dashboard.rule-topology.heatmap.density.full": "covered",
  "dashboard.rule-topology.heatmap.density.partial": "partial",
  "dashboard.rule-topology.heatmap.density.none": "uncovered",
  "dashboard.rule-topology.hit-reason.title": "Hit Reasons",
  "dashboard.rule-topology.hit-reason.subtitle": "Why each rule was loaded for the current sample path",
  "dashboard.rule-topology.hit-reason.aria-label": "Rule hit reasons",
  "dashboard.rule-topology.hit-reason.count": "{count} reasons",
  "dashboard.rule-topology.hit-reason.empty": "No rules loaded for this sample path.",
  "dashboard.rule-topology.hit-reason.global": "Global",
  "dashboard.rule-topology.hit-reason.tier.always": "Always-on",
  "dashboard.rule-topology.hit-reason.tier.path": "Glob",
  "dashboard.rule-topology.hit-reason.tier.description": "Description",

  "dashboard.module-placeholder.coming-soon": "Reserved",
  "dashboard.module-placeholder.read-only": "Reserved for future read-only dashboard capabilities.",
  "dashboard.module-placeholder.forensic.title": "Cognitive Forensic",
  "dashboard.module-placeholder.forensic.subtitle": "Coming later",
  "dashboard.module-placeholder.semantic.title": "Semantic Timeline",
  "dashboard.module-placeholder.semantic.subtitle": "Coming later",
  "dashboard.module-placeholder.ledger.title": "Historical Ledger",
  "dashboard.module-placeholder.ledger.subtitle": "Coming later",

  "dashboard.rules-tree.title": "Rules Tree",
  "dashboard.rules-tree.subtitle": "Browse the rule structure, hierarchy, and sync state from .fabric/agents.meta.json",
  "dashboard.rules-tree.filter.placeholder": "Filter by file, glob, priority, hash...",
  "dashboard.rules-tree.filter.aria-label": "Filter rules tree",
  "dashboard.rules-tree.status.loading": "loading rules",
  "dashboard.rules-tree.status.nodes": "{count} nodes · version {revision}",
  "dashboard.rules-tree.status.locks": "{count} protected regions",
  "dashboard.rules-tree.empty": "No matching rules found.",
  "dashboard.rules-tree.tree.aria-label": "Fabric rules tree",
  "dashboard.rules-tree.detail.title": "Node Detail",
  "dashboard.rules-tree.detail.empty": "Select a rule node to inspect scope, dependencies, priority and hash.",
  "dashboard.rules-tree.detail.file": "file",
  "dashboard.rules-tree.detail.scope": "scope",
  "dashboard.rules-tree.detail.priority": "priority",
  "dashboard.rules-tree.detail.hash": "hash",
  "dashboard.rules-tree.detail.no-deps": "no deps",

  "dashboard.human-lock.title": "Human Protection",
  "dashboard.human-lock.subtitle": "Review protected regions that require human confirmation",
  "dashboard.human-lock.filters.aria-label": "Human lock filters",
  "dashboard.human-lock.filters.all": "all",
  "dashboard.human-lock.filters.drift": "drift",
  "dashboard.human-lock.filters.approved": "approved",
  "dashboard.human-lock.summary": "{drift} drift · {approved} confirmed",
  "dashboard.human-lock.empty": "No human lock entries for this filter.",

  "dashboard.intent-timeline.title": "Intent Timeline",
  "dashboard.intent-timeline.subtitle": "Review AI and human change records in reverse chronological order",
  "dashboard.intent-timeline.filter.label": "Source",
  "dashboard.intent-timeline.filter.all": "All",
  "dashboard.intent-timeline.summary": "AI {aiCount} · Human {humanCount}",
  "dashboard.intent-timeline.columns.ai.title": "AI",
  "dashboard.intent-timeline.columns.ai.entries": "{count} entries",
  "dashboard.intent-timeline.columns.human.title": "Human",
  "dashboard.intent-timeline.columns.human.entries": "{count} entries",
  "dashboard.intent-timeline.empty": "No ledger entries found.",
  "dashboard.intent-timeline.annotate.missing-id": "Cannot annotate a ledger entry without an id.",

  "dashboard.history-replay.title": "History Replay",
  "dashboard.history-replay.subtitle":
    "Review the rules tree state at any recorded point in history",
  "dashboard.history-replay.toolbar.scrub": "Scrub",
  "dashboard.history-replay.toolbar.latest": "Latest",
  "dashboard.history-replay.selected.none": "No historical entry selected",
  "dashboard.history-replay.status.replay-points": "{count} replay points",
  "dashboard.history-replay.status.entries-applied": "{count} entries applied",
  "dashboard.history-replay.empty.entries": "No ledger entries found for replay.",
  "dashboard.history-replay.state.title": "Viewing state as of {label}",
  "dashboard.history-replay.state.meta": "record {ledgerId} · commit {commit} · {mode}",
  "dashboard.history-replay.status.loading": "loading snapshot",
  "dashboard.history-replay.status.nodes": "{count} nodes",
  "dashboard.history-replay.status.unknown-revision": "unknown version",
  "dashboard.history-replay.tree.aria-label": "Historical Fabric rules tree",
  "dashboard.history-replay.empty.loading": "Loading historical snapshot...",
  "dashboard.history-replay.empty.select": "Select a timeline entry to replay its state.",
  "dashboard.history-replay.meta.not-available": "unavailable",
  "dashboard.history-replay.meta.pending": "pending",
  "dashboard.history-replay.meta.na": "n/a",

  "dashboard.doctor.title": "Doctor Console",
  "dashboard.doctor.subtitle": "Check framework, entry points, version drift, and protected paths",
  "dashboard.doctor.toolbar.overall": "Overall",
  "dashboard.doctor.toolbar.no-summary": "No summary yet",
  "dashboard.doctor.toolbar.entry-points-summary": "{framework} · {count} entry points",
  "dashboard.doctor.toolbar.entry-point-summary": "{framework} · {count} entry point",
  "dashboard.doctor.empty.loading": "Loading doctor report...",
  "dashboard.doctor.summary.framework": "Framework",
  "dashboard.doctor.summary.protected-paths": "Protected paths",
  "dashboard.doctor.summary.intent-ledger": "Intent ledger",
  "dashboard.doctor.summary.no-meta-revision": "No metadata version yet",
  "dashboard.doctor.summary.tracked-paths.none": "No tracked paths",
  "dashboard.doctor.summary.tracked-paths.some": "{count} tracked",
  "dashboard.doctor.summary.hashes-intact": "All approved hashes intact",
  "dashboard.doctor.summary.drifted": "{count} drifted",
  "dashboard.doctor.summary.no-ledger-entries": "No ledger entries yet",
  "dashboard.doctor.card.entry-points": "Entry points",
  "dashboard.doctor.card.checks": "Checks",
  "dashboard.doctor.empty.entry-points": "No current entry points detected.",
  "dashboard.doctor.framework.unknown": "unknown",
  "dashboard.doctor.age.none": "No entries",
  "dashboard.doctor.age.seconds": "{count}s ago",
  "dashboard.doctor.age.minutes": "{count}m ago",
  "dashboard.doctor.age.hours": "{count}h ago",
  "dashboard.doctor.age.days": "{count}d ago",
  "dashboard.doctor.age.weeks": "{count}w ago",

  "dashboard.shared.refresh": "Refresh",
  "dashboard.shared.loading": "loading",
  "dashboard.shared.status.ok": "ok",
  "dashboard.shared.status.warn": "warn",
  "dashboard.shared.status.error": "error",
  "dashboard.shared.status.confirmed": "confirmed",
  "dashboard.shared.status.hash-drift": "hash drift",
  "dashboard.shared.status.stale": "stale",
  "dashboard.shared.status.orphan": "orphan",
  "dashboard.shared.status.attention": "attention",

  "dashboard.source.ai": "AI",
  "dashboard.source.human": "Human",

  "dashboard.timeline-entry.aria-label": "{source} intent {intent}",
  "dashboard.timeline-entry.working-tree": "working tree",
  "dashboard.timeline-entry.parent": "parent {parent}",
  "dashboard.timeline-entry.paths": "paths",
  "dashboard.timeline-entry.annotate": "Annotate",
  "dashboard.timeline-entry.annotation-label": "Human annotation",
  "dashboard.timeline-entry.annotation-placeholder": "Explain review outcome or approval context...",
  "dashboard.timeline-entry.annotation-save": "Save annotation",

  "dashboard.tree-node.locked": "locked",
  "dashboard.tree-node.stale.hash-mismatch": "hash mismatch",
  "dashboard.tree-node.stale.orphan": "orphan",

  "dashboard.lock-card.aria-label": "{file} {lineRange} {status}",
  "dashboard.lock-card.status.drift": "hash drift",
  "dashboard.lock-card.status.confirmed": "confirmed",
  "dashboard.lock-card.hash.locked": "locked hash",
  "dashboard.lock-card.hash.current": "current hash",
  "dashboard.lock-card.hash.diff": "diff",
  "dashboard.lock-card.preview.drift": "DRIFT",
  "dashboard.lock-card.preview.sync": "SYNC",
  "dashboard.lock-card.preview.drift-detail": "Hash differs from protected region.",
  "dashboard.lock-card.preview.sync-detail": "Protected region is in sync.",
  "dashboard.lock-card.footer.region": "protected region · {count} lines",
  "dashboard.lock-card.button.approve": "Approve new hash",
  "dashboard.lock-card.button.confirmed": "Confirmed",
  "dashboard.lock-card.diff.hash-mismatch": "hash mismatch",
  "dashboard.lock-card.diff.no-changes": "no changes",
  "dashboard.lock-card.diff.with-bytes": "+{added} / -{removed} · {bytes} bytes",
  "dashboard.lock-card.diff.without-bytes": "+{added} / -{removed}",

  "dashboard.approve-button.retry": "Retry",

  "dashboard.readiness.filter.analysis": "Project Analysis",
  "dashboard.readiness.loading": "Loading scan data...",
  "dashboard.readiness.summary.framework": "Framework",
  "dashboard.readiness.summary.files": "Files",
  "dashboard.readiness.summary.status": "Fabric Status",
  "dashboard.readiness.card.evidence": "Readiness Evidence",
  "dashboard.readiness.card.recommendations": "Recommendations & Next Steps",
  "dashboard.readiness.readme.description": "Quality of project documentation",
  "dashboard.readiness.contributing.description": "Contribution guidelines for AI/Human",
  "dashboard.readiness.fully-ready": "Project is fully ready.",
  "dashboard.readiness.init-prompt": "Run this command to initialize:",

  "dashboard.rules-explain.analyze": "Analyze Path",
  "dashboard.rules-explain.detail.topology-type": "Topology Type",

  "dashboard.timeline.history-replay.title": "History Replay",
  "dashboard.timeline.close": "Close",

  "dashboard.health.ledger-path.label": "Event Ledger Path",
  "dashboard.health.ledger-path.detail": "Append-only timeline source",
  "dashboard.health.boundary.title": "Control Plane Boundaries",
  "dashboard.health.boundary.description": "The Web Dashboard operates as a Viewer. All rules, metadata, and fixes must be managed via the CLI.",
  "dashboard.health.boundary.cli-action": "CLI Action Required:",
  "dashboard.health.boundary.cli-prompt": "You have {count} fixable issues. Run the following command in your terminal to repair metadata automatically.",
  "dashboard.health.runtime.connected": "MCP Runtime Connected",
  "dashboard.health.runtime.disconnected": "MCP Runtime Disconnected",
};

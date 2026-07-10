import type { Messages } from "../types.js";

export const enMessages: Messages = {
  "cli.main.description":
    "Fabric CLI — feeds your project's decisions, pitfalls & conventions to your AI assistant automatically. First time? Run: fabric install",
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

  // flat-design-system Wave4 (TASK-004): gutter-free ✓/x receipt printed after a
  // clack control (select/multiselect/confirm/text) resolves. The clack control
  // stays native (C-006); the receipt is a separate flat line.
  "cli.prompt.receipt.selected": "Selected",
  "cli.prompt.receipt.set": "Set",
  "cli.prompt.receipt.cancelled": "Cancelled",
  "cli.shared.target-invalid": "Target must be an existing directory: {target}",
  "cli.shared.target-invalid.action-hint":
    "Choose an existing project directory, or create it before running the command again.",
  "cli.shared.template-not-found": "Template not found: {path}",
  "cli.shared.invalid-host-empty": "Invalid host: <empty>",
  "cli.shared.invalid-port": "Invalid port: {value}",
  "cli.shared.error": "Error",

  // Top-level command summaries (one concise line each — citty renders these in
  // the root `fabric --help` COMMANDS table AND as the header of each command's
  // own `--help`, so they MUST stay single-line; verbose example blocks were
  // removed when the bespoke grouped help retired in favour of citty's renderer).
  "cli.store.description": "Manage mounted knowledge stores (setup via fabric install)",
  "cli.sync.description": "Sync mounted knowledge stores (pull --rebase + push)",
  "cli.info.description": "Show Fabric identity, project status & recall health",
  "cli.inspect.description": "Show what Fabric injects at SessionStart",
  // `fabric inspect` arg descriptions + --explain provenance overlay + error.
  "cli.inspect.arg.render": "Which sink to show: 'human' (systemMessage) or 'ai' (additionalContext). Default: both.",
  "cli.inspect.arg.explain": "Append a per-entry provenance section (id · type · maturity · scope · why-surfaced).",
  "cli.inspect.arg.target": "Override the project root (defaults to cwd / dev-mode resolution).",
  "cli.inspect.explain.title": "explain · provenance (not injected)",
  "cli.inspect.explain.always": "always-active · body injected",
  "cli.inspect.explain.reference": "reference · read on demand",
  "cli.inspect.explain.census": "census",
  "cli.inspect.explain.census-total": "total {total}",
  "cli.inspect.error": "inspect failed: {message}",
  "cli.audit.description": "Knowledge & telemetry audit (cite/conflicts/history/metrics)",

  // `fabric audit cite` — 0%-recall-coverage self-diagnosis hints.
  "cli.audit.cite.recall-mismatch-hint":
    "recall coverage is 0 despite {recalls} recall(s) across {sessions} session(s) — none shared a session with an edit. The recall caller is likely passing a non-client session_id (correlation is session-scoped). See AGENTS.md: pass the real client session_id to fab_recall.",
  "cli.audit.cite.recall-none-hint":
    "recall coverage is 0 — no in-session fab_recall preceded these edits. Recall before editing, and pass the real client session_id (correlation is session-scoped). See AGENTS.md.",

  // `fabric audit --help` — filtered help (i18n'd subcommand listing).
  "cli.audit.help.tagline": "Knowledge & telemetry audit surfaces (read-only)",
  "cli.audit.help.sub.cite": "Cite-policy adherence report",
  "cli.audit.help.sub.conflicts": "Knowledge-conflict lint",
  "cli.audit.help.sub.history": "Maintenance history rollup (archive | fix | all)",
  "cli.audit.help.sub.descriptions": "Back-fill description-grade frontmatter fields",
  "cli.audit.help.sub.retired": "Scan agent surfaces for retired tool/field references",
  "cli.audit.help.sub.why": "Diagnose why a knowledge entry isn't surfacing",
  "cli.audit.help.example.cite": "cite-coverage over the last 7 days",
  "cli.audit.help.example.conflicts": "scan for conflicting / duplicate entries",
  "cli.audit.help.footer": "Run `fabric audit <subcommand> --help` for per-command flags.",

  // `fabric audit retired` — flat renderer copy.
  "cli.audit.retired.skipped": "Retired-reference scan skipped — no agent-consumed surfaces found.",
  "cli.audit.retired.clean": "No retired references — scanned {count} agent surface(s).",
  "cli.audit.retired.found": "{hits} retired reference(s) across {files} scanned file(s)",
  "cli.audit.retired.removed": "(removed)",

  // `fabric audit why-not-surfaced <id>` — three-axis diagnosis (store / scope / timing).
  "cli.audit.why.not-found": "'{id}' not found in any mounted store. Check the id (try `fabric store list`).",
  "cli.audit.why.store-unbound": "'{id}' lives in store '{store}', which is NOT bound to this project.",
  "cli.audit.why.store-unbound.hint": "bind it: fabric store bind {store}",
  "cli.audit.why.project-mismatch": "'{id}' is scoped to '{scope}', but this repo is bound to 'project:{project}'.",
  "cli.audit.why.project-mismatch.hint": "it surfaces only in repos bound to '{scope}' (semantic_scope axis).",
  "cli.audit.why.narrow-timing": "'{id}' is relevance_scope=narrow — it surfaces via the PreToolUse hint when you EDIT a matching file, not at SessionStart.",
  "cli.audit.why.narrow-timing.hint": "broad entries are the always-on spine; narrow ones are edit-time only (timing axis).",
  "cli.audit.why.should-surface": "'{id}' should be surfacing — store '{store}' bound, scope matches, relevance_scope=broad.",
  "cli.audit.why.should-surface.hint": "if it isn't, the SessionStart snapshot may be stale: start a fresh session or re-run `fabric install`.",

  // `fabric info --help` — flag + scope-subcommand descriptions.
  "cli.info.args.global.description": "Show global identity (whoami) instead of project status",
  "cli.info.args.recall.description": "Show recall-engine detail (fusion strategy + embedding state)",
  "cli.info.args.warm.description":
    "With --recall: load the embedder now (downloads the model to ~/.fabric/cache/embed on first run)",
  "cli.info.args.json.description": "Emit machine-readable JSON instead of text",
  "cli.info.scope.description":
    "(advanced/skill) Resolve a scope coordinate's read-set + write target as JSON",
  "cli.info.scope.args.coord.description": "Scope coordinate (e.g. team, project:x, personal)",
  "cli.info.scope.args.json.description": "Emit machine-readable JSON (scope always emits JSON)",

  // v2.1 hidden-command i18n keys cleanup: approve/bootstrap/hooks/human-lint/
  // ledger-append/pre-commit/scan/sync-meta/update commands removed from CLI
  // surface in v2.0.0-rc.18. Keys intentionally retained for backward compat
  // with external tooling that may still reference them. Remove in v2.2
  // if no external consumers surface.

  "cli.config.description":
    "Open the interactive Fabric configuration panel (language, knowledge layer, audit mode, MCP client wiring, etc.)",
  "cli.config.args.target.description": "Target project directory (defaults to cwd).",
  "cli.config.clients.claude": "Claude Code CLI",
  "cli.config.install.description": "Install Fabric MCP server entries into detected client configs.",
  "cli.config.install.args.clients.description":
    "Optional comma-separated client filter, for example cc,codex.",
  "cli.config.install.args.dry-run.description": "Preview detected write operations without modifying files.",
  "cli.config.errors.unknown-client":
    "Unknown client \"{client}\". Use a comma-separated list such as cc,codex.",
  "cli.config.errors.expected-object": "Expected object in {path}",
  "cli.config.install.no-configs":
    "No Fabric MCP client config detected. Create the client directory or set clientPaths in fabric.config.json.",
  "cli.config.install.no-config-path": "Skipping {client}: no config path detected.",
  "cli.config.install.dry-run": "[dry-run] {client}: would write {path}",
  "cli.config.install.wrote": "{client}: wrote {path}",

  // rc.16 TASK-006 (F1-panel): clack-driven `fabric config` interactive panel.
  // Keys consumed by packages/cli/src/commands/config.ts (menu loop +
  // per-field prompts) and by getPanelFields() (label_i18n_key references).
  "cli.config.intro": "Fabric Configuration",
  // flat-design-system Wave5 (TASK-005): B-横线 title above the flat key/value
  // panel printed before the clack edit menu.
  "cli.config.panel.title": "Current configuration",
  "cli.config.outro": "Configuration saved.",
  "cli.config.outro-no-changes": "No changes made.",
  "cli.config.cancel": "Cancelled.",
  "cli.config.non-tty-notice":
    "fabric config requires an interactive terminal. Run it from a TTY to edit configuration fields.",
  "cli.config.menu.field-select": "Select a field to edit:",
  "cli.config.menu.exit": "Exit",
  "cli.config.value.current": "current: {value}",
  "cli.config.value.default-marker": "(default)",
  "cli.config.prompt.select": "Choose a new value for {key} (current: {current}):",
  "cli.config.prompt.text": "Enter a new value for {key} (current: {current}):",
  "cli.config.write.success": "{key} = {value}",
  "cli.config.panel.edited": "Edited this session ({count}): {keys}",
  "cli.config.write.failure": "Failed to write fabric-config.json: {message}",
  "cli.config.slot.errors.missing": "Missing required <slot> argument. Valid slots: {slots}.",
  "cli.config.slot.errors.unknown": "Unknown slot \"{slot}\". Valid slots: {slots}.",
  "cli.config.slot.dismiss.already": "Slot \"{slot}\" already opted out; no-op.",
  "cli.config.slot.dismiss.done": "Dismissed onboard slot \"{slot}\". Run `fabric config onboard-reset {slot}` to re-open.",
  "cli.config.slot.dismiss.failed": "dismiss-slot failed: {message}",
  "cli.config.slot.reset.not-opted": "Slot \"{slot}\" not opted out; no-op.",
  "cli.config.slot.reset.done": "Reset onboard slot \"{slot}\"; it will appear in `fabric onboard-coverage` as missing again.",
  "cli.config.slot.reset.failed": "onboard-reset failed: {message}",
  "cli.config.errors.uninit-workspace.message":
    "Workspace not initialized. Run `fabric install` first.",
  "cli.config.errors.invalid-int": "Must be a positive integer.",
  "cli.config.errors.unknown-field": "Unknown field selection — skipping.",
  "cli.config.errors.no-enum-options": "No enum options available for this field — skipping.",
  // Per-field labels (11 total: 2 Group A + 8 Group B + 1 Group C).
  "cli.config.fields.fabric_language.label": "Language",
  "cli.config.fields.fabric_language.description":
    "Fabric's global language base tone (UI + knowledge), saved to ~/.fabric/fabric-global.json.",
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
  "cli.config.fields.nudge_mode.label": "Nudge level",
  "cli.config.fields.nudge_mode.description":
    "Preset for human-visible nudges (silent / minimal / normal / verbose). Governs only the human channel — never the knowledge injected to the AI.",
  "cli.config.fields.embed_enabled.label": "Vector semantic search",
  "cli.config.fields.embed_enabled.description":
    "Enable vector semantic recall (true / false). Note: true is just intent — it only takes effect when the running server can resolve the fastembed package AND the model is downloaded (auto-fetched to ~/.fabric/cache/embed on first recall). Check actual state with `fabric info recall`.",
  "cli.config.fields.fusion.label": "Recall fusion strategy",
  "cli.config.fields.fusion.description":
    "How the signals combine into one score: additive = weighted sum (BM25-led, small vector weight) / rrf = Reciprocal Rank Fusion (BM25 and vector on equal footing, so semantics actually count) / auto = adaptive (default: rrf when the vector channel is scoring, else additive — avoids degenerate single-channel rrf being worse).",

  "cli.doctor.description":
    "Run Fabric target-state diagnostics (meta sync, knowledge index, bootstrap, events ledger, human-lock drift)",
  "doctor.section.fixable": "Fixable errors:",
  "doctor.section.manual": "Manual errors:",
  "doctor.section.warnings": "Warnings:",
  "doctor.section.fix-knowledge-mutations": "Fix-knowledge mutations:",
  // flat-design follow-up: the remaining doctor UI-shell strings (TL;DR header,
  // --fix mutation plan, filtered --help) move off hardcoded English into i18n so
  // the whole `fabric doctor` surface honours the machine locale. USAGE/OPTIONS/
  // EXAMPLES labels stay English to match citty's own renderUsage in the other
  // commands' --help.
  "doctor.digest.todo": "To fix ({count})",
  "doctor.digest.clean": "all {count} checks passed — nothing to fix",
  "doctor.digest.summary": "{todo} to fix · {ok} passed · contributor diagnostics → --verbose",
  "doctor.digest.more-verbose": "{count} contributor finding(s) hidden — see --verbose",
  // store diagnostics (multi-store health, the `● 存储健康` group) — i18n parity
  // with doctor.check.*; messages carry store alias / counts via interpolation.
  "doctor.store.no-global-config": "no global Fabric config — run `fabric install --global <url>`",
  "doctor.store.missing-required": "required store '{id}' is not mounted; run `fabric store mount`",
  "doctor.store.unbound": "store '{alias}' is mounted but not bound to this project; run `fabric store bind {alias}` to read its knowledge here (then `fabric store switch-write {alias}` to write team knowledge into it)",
  "doctor.store.alias-drift": "by-alias readability link(s) out of sync for {refs}; run `fabric doctor --fix` to repair ~/.fabric/stores/by-alias/",
  "doctor.store.local-only": "store '{alias}' is local-only; add a git remote to back it up",
  "doctor.store.executable": "store '{alias}' contains executable/script files ({files}) — stores are data-only; Fabric never runs them (S65)",
  "doctor.store.active-personal-invalid": "active personal store '{store}' is not a mounted personal store; run `fabric store switch-personal <alias>` or `fabric doctor --fix`",
  "doctor.store.active-personal-unset": "{count} personal stores are mounted but none is active; run `fabric store switch-personal <alias>` to pick one (or `fabric doctor --fix` to default to the first)",
  "doctor.store.related-broken": "{count} broken `related` link(s) point at ids absent from the corpus: {samples}{overflow} — fix the related edges via `fab_review` (modify) or edit the entry frontmatter",
  "doctor.store.related-hub": "related graph hubs (top {shown} of {total} referenced): {top}",
  "doctor.store.unreachable": "store '{alias}' is in the read-set but unreachable on disk ({reason}); run `fabric store mount` / re-clone it, then `fabric doctor`",
  "doctor.store.consumption-heatmap": "top consumed (last {days}d, {consumed}/{total} entries read across {windows} window(s)): {top}",
  "doctor.store.consumption-zero": "{count} entries never consumed in the last {days}d: {sample}{overflow} — review for retirement via `fab_review` (consumption is one signal, not proof of rot)",
  "doctor.store.overflow-more": ", …(+{count} more)",
  "doctor.fix-plan.header": "fix-knowledge mutation plan ({count} total)",
  "doctor.fix-plan.preview": "preview:",
  "doctor.fix-plan.more": "... and {count} more",
  "doctor.help.tagline": "Diagnose and fix Fabric workspace issues",
  "doctor.help.flag.target": "Override project root (defaults to cwd)",
  "doctor.help.flag.fix": "Auto-fix issues (derived-state + knowledge frontmatter/git mv)",
  "doctor.help.flag.json": "Output as JSON for programmatic consumption",
  "doctor.help.flag.verbose": "Show maintainer-audience action hints",
  "doctor.help.example.run": "Run diagnostics",
  "doctor.help.example.fix": "Fix derived-state + knowledge issues",
  "doctor.help.footer": "Run `fabric doctor` to see a full diagnostic report. Audits → `fabric audit`.",
  // flat-design-system Wave5 (TASK-005): C-圆点 group headers for the reskinned
  // doctor surface (`● Store Health` / `● Checks`), replacing the old hardcoded
  // sectionBar literals so the wording is localized in both locales.
  "doctor.group.store-health": "Store Health",
  "doctor.group.checks": "Checks",
  // v2.0.0-rc.29 REVIEW (codex LOW-2): F2's payload-limit defaults reach the JSON
  // envelope but never surfaced in the human renderer, so operators tuning
  // `mcpPayloadLimits` had no fast `fabric doctor` confirmation that their config
  // override took effect. Two strings: a section header + a one-liner row.
  "doctor.section.payload-limits": "MCP payload limits:",
  "doctor.payload-limits.line": "warn={warnKb} KB, hard={hardKb} KB (source: {source})",
  // rc.20 TASK-07: cite-coverage human-readable formatter keys.
  "doctor.section.cite-coverage": "Cite coverage:",
  "doctor.cite.header": "Since {since} via marker {marker}",
  "doctor.cite.warning.justActivated":
    "Cite policy activated on this run; no historical data yet.",
  "doctor.cite.metric.editsTouched": "Edits touched",
  "doctor.cite.metric.qualifyingCites": "Qualifying cites",
  "doctor.cite.metric.recalledUnverified": "Applied but not verified",
  "doctor.cite.metric.expectedButMissed": "Expected cite missing",
  "doctor.cite.metric.totalTurns": "Total turns",
  "doctor.cite.metric.complianceRate": "cite compliance rate (incl. KB:none[reason])",
  "doctor.cite.metric.complianceNA": "N/A (no cite-expected turns)",
  "doctor.cite.metric.uncorrelatableEdits": "Uncorrelatable edits (no session_id — stale hook? run `fabric install`)",
  "doctor.cite.metric.recallCoverage": "recall coverage (edits preceded by a relevant fab_recall)",
  "doctor.cite.metric.recallCoverageNA": "N/A (no correlatable edits)",
  // v2.2.0-rc.1 W1-T3 (cite 诚实拆分): WEAK auxiliary signal, rendered separately
  // from the compliance rate. The parenthetical MUST state it is not counted
  // toward true adherence (honesty 铁律).
  "doctor.cite.metric.exposedAndMutated":
    "exposed & mutated (weak auxiliary signal — NOT counted toward true adherence)",
  // lifecycle-refactor W2-T4 (§5 row7/row2): PostToolUse mutation funnel +
  // SessionEnd boundary. Observability markers, NOT folded into adherence.
  "doctor.cite.metric.mutationsObserved":
    "mutations observed (PostToolUse file_mutated — authoritative, NOT counted toward adherence)",
  "doctor.cite.metric.mutationPool":
    "mutation pool (low-confidence attribution via source_event_id)",
  "doctor.cite.metric.sessionsClosed":
    "sessions closed (SessionEnd markers — funnel boundary)",
  "doctor.cite.metric.byStore":
    "qualifying cites by store (diagnostic split — NOT counted toward adherence; 'local' = project)",
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
    "skipped (bootstrap drift — run `fabric install`)",
  "cite-coverage.contract.status.awaiting_marker": "awaiting first marker emit",
  // Plural knowledge-type labels (rc.29 BUG-C1: verbatim alignment with
  // canonical KnowledgeTypeSchema) plus the sixth "unresolved" bucket.
  "cite-coverage.contract.type.decisions": "decisions",
  "cite-coverage.contract.type.pitfalls": "pitfalls",
  "cite-coverage.contract.type.models": "models",
  "cite-coverage.contract.type.guidelines": "guidelines",
  "cite-coverage.contract.type.processes": "processes",
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
    "Apply knowledge lint mutations: archive overdue pending drafts, floor drifted per-store id counters, and prune stale session-hint caches. Decay lints (orphan demote / stale archive) are report-only — remediate those via the fab_review flow. Default doctor run remains report-only.",
  "cli.doctor.args.yes.description":
    "Skip the --fix-knowledge safety confirm. Required for non-tty invocations unless FABRIC_NONINTERACTIVE=1 is set in the environment.",
  // rc.35 TASK-12 (P0-11): --verbose unfolds maintainer-audience hints.
  "cli.doctor.args.verbose.description":
    "Show all action hints including maintainer-audience ones (Fabric contributors editing the source tree). By default these are folded for npm end users.",
  "doctor.maintainer-hint-folded":
    "(maintainer-only remediation — re-run with `fabric doctor --verbose` to see)",
  "cli.doctor.errors.fix-knowledge-fix-mutually-exclusive":
    "--fix-knowledge and --fix cannot be combined. --fix-knowledge mutates user knowledge state (archive/counter/cache); --fix repairs derived state (meta/index). Run them separately.",
  // rc.20 TASK-05: --cite-coverage report flags. Read-only; mutually exclusive with --fix/--fix-knowledge.
  "cli.doctor.args.cite-coverage.description":
    "Generate cite policy adherence report (read-only; skips standard inspections)",
  "cli.doctor.args.since.description":
    "Time window for cite coverage (e.g. 7d, 24h, 30m)",
  "cli.doctor.args.client.description":
    "Filter cite coverage by client (cc|codex|all)",
  // v2.0.0-rc.24 TASK-10: --layer filters cite contract audit by KB layer (team|personal|all).
  "cli.doctor.args.layer.description":
    "Filter cite contract audit by KB layer (team|personal|all)",
  "cli.doctor.errors.cite-coverage-mutex":
    "--cite-coverage cannot be combined with --fix or --fix-knowledge",
  "cli.doctor.errors.lint-conflicts-mutex":
    "--lint-conflicts cannot be combined with --fix, --fix-knowledge or --cite-coverage",
  "cli.doctor.args.lint-conflicts.description":
    "Lint the knowledge base for conflicting/duplicate entry pairs (bm25 candidates)",
  "cli.doctor.args.deep.description":
    "With --lint-conflicts: run the LLM judge over candidates (cold-eval seam)",
  "doctor.conflict.header": "Knowledge conflict lint",
  "doctor.conflict.none": "No candidate conflicting/duplicate pairs found",
  "doctor.conflict.summary":
    "{candidates} candidate pair(s), {conflicts} judged conflict(s) (similarity ≥ {threshold})",
  "doctor.conflict.deep_no_judge":
    "--deep requested but no LLM judge is wired (run the cold-eval review manually); showing cheap candidates",
  "doctor.conflict.verdict.conflict": "conflict",
  "doctor.conflict.verdict.similar": "similar (possible duplicate)",
  "doctor.conflict.verdict.unknown": "review (possible duplicate or conflict)",
  "cli.doctor.errors.invalid-since":
    "Invalid --since value: {input}. Expected duration like 7d, 24h, 30m or epoch ms.",
  "cli.doctor.errors.invalid-client":
    "Invalid --client value: {input}. Expected cc, codex, or all.",
  "cli.doctor.errors.invalid-layer":
    "Invalid --layer value: {input}. Expected team, personal, or all.",
  // rc.23 TASK-007 (a-C2): --enrich-descriptions flag set. Back-fills the
  // four description-grade frontmatter fields on canonical knowledge entries.
  "cli.doctor.args.enrich-descriptions.description":
    "Back-fill missing intent_clues / tech_stack / impact / must_read_if on canonical knowledge entries (read-only by default; pair with --auto to write stubs).",
  "cli.doctor.args.auto.description":
    "With --enrich-descriptions: write deterministic stub values for missing fields. Without --auto, the run is read-only.",
  "cli.doctor.args.dry-run.description":
    "With --enrich-descriptions --auto or --fix: preview the planned changes without writing to disk. The fix-dry-run output mirrors --fix's fixable_errors list but executes no mutations.",
  // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run banner — printed before the standard report so users see no mutations were applied.
  "cli.doctor.fix-dry-run-banner":
    "[dry-run] No mutations were applied. The fixable_errors list below shows what `fabric doctor --fix` would address; rerun without --dry-run to actually fix.",
  "cli.doctor.unbound-project-backfilled":
    "Backfilled project-scope binding for store '{alias}' → project '{project}' (minted project_id + active_project).",
  "cli.doctor.errors.enrich-descriptions-mutex":
    "--enrich-descriptions cannot be combined with --fix, --fix-knowledge, or --cite-coverage. Run them separately.",
  "doctor.enrich.allComplete":
    "All canonical knowledge entries already declare intent_clues / tech_stack / impact / must_read_if.",
  // rc.26 TASK-02a: doctor foundation-batch check messages.
  "doctor.check.bootstrap_snapshot_drift.name": "Bootstrap snapshot drift",
  "doctor.check.bootstrap_snapshot_drift.message.drift":
    ".fabric/AGENTS.md content diverges byte-for-byte from BOOTSTRAP_CANONICAL.",
  "doctor.check.bootstrap_snapshot_drift.remediation.drift":
    "Run `fabric doctor --fix` to restore canonical bootstrap snapshot",
  "doctor.check.bootstrap_snapshot_drift.ok.ok":
    ".fabric/AGENTS.md byte-equals BOOTSTRAP_CANONICAL.",
  "doctor.check.bootstrap_snapshot_drift.ok.missing_delegated":
    ".fabric/AGENTS.md absent — delegated to bootstrap_anchor_missing.",
  "doctor.check.managed_block_drift.name": "Managed block drift",
  "doctor.check.managed_block_drift.message.singular":
    "{count} three-end managed block diverge from expected body (snapshot + optional project-rules concat): {list}.",
  "doctor.check.managed_block_drift.message.plural":
    "{count} three-end managed blocks diverge from expected body (snapshot + optional project-rules concat): {list}.",
  "doctor.check.managed_block_drift.remediation":
    "Run `fabric doctor --fix` to restore three-end managed blocks from canonical",
  "doctor.check.managed_block_drift.ok.ok":
    "Three-end managed blocks byte-equal expectedBody.",
  "doctor.check.managed_block_drift.ok.no_managed_block":
    "No three-end managed blocks detected — propagation pending or legacy-marker state.",
  "doctor.check.bootstrap_anchor.name": "Bootstrap anchor",
  "doctor.check.bootstrap_anchor.message.missing":
    "Neither AGENTS.md nor CLAUDE.md exists at the repo root. Fabric requires a bootstrap anchor file at the project root.",
  "doctor.check.bootstrap_anchor.remediation.missing":
    "Run `fabric install` to generate the AGENTS.md / CLAUDE.md bootstrap anchor at the repo root.",
  "doctor.check.bootstrap_anchor.ok": "Bootstrap anchor present at repo root: {present}.",
  // v2.0.0-rc.33 W3-2 (T6 #5): reference the file names from the message so users can copy-paste rm targets rather than grep for them.
  "doctor.check.forensic.name": "Scan evidence",
  "doctor.check.forensic.message.missing.singular":
    "{error} Live scan detects {frameworkKind} with {count} entry point.",
  "doctor.check.forensic.message.missing.plural":
    "{error} Live scan detects {frameworkKind} with {count} entry points.",
  "doctor.check.forensic.message.missing-default": ".fabric/forensic.json is missing.",
  "doctor.check.forensic.message.invalid-default": ".fabric/forensic.json is invalid.",
  "doctor.check.forensic.remediation": "Run `fabric install` to regenerate .fabric/forensic.json.",
  "doctor.check.forensic.ok": ".fabric/forensic.json is valid for {frameworkKind}.",
  "doctor.check.agents_meta.name": "Agents metadata",
  "doctor.check.agents_meta.message.missing": ".fabric/agents.meta.json is missing.",
  "doctor.check.agents_meta.remediation.missing":
    "No action needed for store-backed knowledge. Project-local agents.meta rebuilds are retired.",
  "doctor.check.agents_meta.message.invalid-default": ".fabric/agents.meta.json is invalid.",
  // rc.35 TASK-09 (P0-14): humanised parse-failure messages.
  "doctor.check.agents_meta.message.invalid-zod":
    ".fabric/agents.meta.json fails schema validation — {issues}. The file was likely written by an incompatible fabric CLI version, or hand-edited.",
  "doctor.check.agents_meta.message.invalid-from-old-cli":
    ".fabric/agents.meta.json fails schema validation because the GLOBAL `fabric` CLI on PATH ({version}) is older than the minimum-supported {minVersion}. The schema gained backward-compatible singular→plural normalisation in rc.31; older CLIs cannot parse the result they themselves write back.",
  "doctor.check.agents_meta.remediation.invalid":
    "Project-local agents.meta is retired. Run `fabric install` to refresh client bootstrap, and keep knowledge in mounted stores under ~/.fabric/stores/.",
  "doctor.check.agents_meta.message.stale":
    ".fabric/agents.meta.json revision {revision} does not match the retired local derived revision {computedRevision}.",
  "doctor.check.agents_meta.message.stale_hash_equal":
    ".fabric/agents.meta.json content is aligned with the retired local derived revision {revision}; this check is legacy-only.",
  "doctor.check.agents_meta.remediation.stale":
    "No project-local reconciliation is performed anymore; mounted stores are read directly.",
  "doctor.check.agents_meta.ok":
    "Legacy agents.meta revision {revision} is present; store-backed knowledge does not depend on it.",
  "doctor.check.rule_content_refs.name": "Rule content refs",
  "doctor.check.rule_content_refs.message.unavailable":
    "Cannot inspect content_ref entries until agents.meta.json is valid.",
  "doctor.check.rule_content_refs.remediation.unavailable":
    "Fix agents.meta.json first: run `fabric doctor --fix`.",
  "doctor.check.rule_content_refs.message.outside.singular":
    "{count} legacy content_ref entry is outside the retired local knowledge root.",
  "doctor.check.rule_content_refs.message.outside.plural":
    "{count} legacy content_ref entries are outside the retired local knowledge root.",
  // v2.0.0-rc.33 W3-2 (T6 #12): project rules forbid hand-editing agents.meta.json (see .fabric/AGENTS.md). Direct users through doctor --fix reconcile path instead.
  "doctor.check.rule_content_refs.remediation.outside":
    "Run `fabric doctor --fix` to let reconcile auto-prune external content_refs (rc.31+ compatible). Do NOT hand-edit agents.meta.json — the engine reconciles automatically.",
  "doctor.check.rule_content_refs.message.missing.singular":
    "{count} content_ref target is missing. Run `fabric doctor --fix` to reconcile.",
  "doctor.check.rule_content_refs.message.missing.plural":
    "{count} content_ref targets are missing. Run `fabric doctor --fix` to reconcile.",
  "doctor.check.rule_content_refs.remediation.missing":
    "Project-local content_ref reconciliation is retired; bind/read mounted stores instead.",
  "doctor.check.rule_content_refs.ok":
    "All legacy content_ref entries resolve; store-backed knowledge is read from mounted stores.",
  "doctor.check.knowledge_test_index.name": "Knowledge-test index",
  "doctor.check.knowledge_test_index.remediation.missing":
    "Run `fabric doctor --fix` to rebuild .fabric/.cache/knowledge-test.index.json.",
  "doctor.check.knowledge_test_index.remediation.invalid":
    "Delete .fabric/.cache/knowledge-test.index.json and run `fabric doctor --fix` to regenerate it.",
  "doctor.check.knowledge_test_index.message.stale":
    ".fabric/.cache/knowledge-test.index.json is stale.",
  "doctor.check.knowledge_test_index.remediation.stale":
    "Run `fabric doctor --fix` to rebuild the knowledge-test index.",
  "doctor.check.knowledge_test_index.ok.link_singular.orphan_singular":
    "{linkCount} link and {orphanCount} orphan annotation indexed.",
  "doctor.check.knowledge_test_index.ok.link_singular.orphan_plural":
    "{linkCount} link and {orphanCount} orphan annotations indexed.",
  "doctor.check.knowledge_test_index.ok.link_plural.orphan_singular":
    "{linkCount} links and {orphanCount} orphan annotation indexed.",
  "doctor.check.knowledge_test_index.ok.link_plural.orphan_plural":
    "{linkCount} links and {orphanCount} orphan annotations indexed.",
  "doctor.check.event_ledger.name": "Event ledger",
  "doctor.check.event_ledger.message.missing": ".fabric/events.jsonl is missing.",
  "doctor.check.event_ledger.remediation.missing":
    "Run `fabric doctor --fix` to create .fabric/events.jsonl.",
  "doctor.check.event_ledger.message.not_writable-default":
    ".fabric/events.jsonl is not writable.",
  "doctor.check.event_ledger.remediation.not_writable":
    "Check file permissions on .fabric/events.jsonl and ensure no other process holds a write lock.",
  "doctor.check.event_ledger.message.invalid-default": ".fabric/events.jsonl is invalid.",
  // v2.0.0-rc.33 W3-1 (P0-6): archive-history mode — direct users to mv the broken ledger into events.archive/ before recreating, preserving history rather than rm'ing it. Mirrors rotateEventLedgerIfNeeded's events-rotated-YYYY-MM-DD.jsonl naming convention (events-corrupted-YYYY-MM-DD.jsonl distinguishes this archive cause from sliding-window rotation).
  "doctor.check.event_ledger.remediation.invalid":
    "Archive history first (`mkdir -p .fabric/events.archive && mv .fabric/events.jsonl .fabric/events.archive/events-corrupted-$(date +%Y-%m-%d).jsonl`), then run `fabric doctor --fix` to create a new empty ledger. Historical events are preserved under events.archive/.",
  "doctor.check.event_ledger.ok":
    ".fabric/events.jsonl exists, is writable, and is parseable.",
  // v2.0.0-rc.37 Wave B (B5): composite hard-gate check for events.jsonl /
  // metrics.jsonl health (G7 size / G8 metric_leak / G9 metrics_stale /
  // G10 rotation_overdue).
  "doctor.check.events_jsonl_health.name": "Events ledger health (rc.37 Plan B 5 hard gate)",
  "doctor.check.events_jsonl_health.ok":
    ".fabric/events.jsonl size, freshness, and metric isolation all healthy.",
  "doctor.check.events_jsonl_health.message.size":
    ".fabric/events.jsonl is {sizeMb} MB, above the 10 MB threshold.",
  "doctor.check.events_jsonl_health.message.metric_leak":
    ".fabric/events.jsonl contains {count} rows with metric-counter event_types ({samples}). Those events should be aggregated in metrics.jsonl, not in the audit ledger.",
  "doctor.check.events_jsonl_health.message.metrics_stale":
    ".fabric/metrics.jsonl hasn't been updated for {minutes} minutes; the server-side 60s flush may be stalled.",
  "doctor.check.events_jsonl_health.message.rotation_overdue":
    ".fabric/events.jsonl hasn't rotated for {days} days; the 6h rotation tick may not be running.",
  "doctor.check.events_jsonl_health.remediation":
    "Run `fabric doctor --fix` — it triggers a rotation AND flushes metrics.jsonl (rc.2 F16: clears idle-buffered metric counters without a server restart). If the warning persists, restart the MCP server so startMetricsFlush + startRotationTick reschedule. If metric_leak fires, audit recent code changes for direct appendEventLedgerEvent calls bypassing bumpCounter for one of the 4 metric-managed event_types.",
  "doctor.check.event_ledger_partial_write.name": "Event ledger partial write",
  "doctor.check.event_ledger_partial_write.ok.skipped":
    "No partial-write check needed (ledger missing or not writable).",
  "doctor.check.event_ledger_partial_write.message":
    "events.jsonl has a partial write at byte offset {byteOffset} ({byteLength} corrupted bytes). Run --fix to truncate and preserve corrupted bytes.",
  "doctor.check.event_ledger_partial_write.remediation":
    "Run `fabric doctor --fix` to truncate the partial write and restore events.jsonl to a valid state.",
  "doctor.check.event_ledger_partial_write.ok.clean":
    "events.jsonl has no partial trailing write.",
  // v2.0.0-rc.27 TASK-010 (audit §2.24): schema-compat forward-warn category.
  "doctor.check.event_ledger_schema_compat.name": "Event ledger schema compat",
  "doctor.check.event_ledger_schema_compat.ok.skipped":
    "No schema-compat check needed (ledger missing or not writable).",
  "doctor.check.event_ledger_schema_compat.ok.clean":
    "events.jsonl rows all parse against the current schema.",
  "doctor.check.event_ledger_schema_compat.message.schema_version":
    "events.jsonl has {count} row(s) with unsupported `schema_version` (samples: {samples}).",
  "doctor.check.event_ledger_schema_compat.message.event_type":
    "events.jsonl has {count} row(s) with unknown `event_type` (samples: {samples}).",
  // v2.0.0-rc.33 W3-1 (P0-6): archive-history mode — same as event_ledger.invalid above. Explicit "archive" wording (rather than "back up") makes it clear the old ledger is preserved under events.archive/, not discarded.
  "doctor.check.event_ledger_schema_compat.remediation":
    "Preferred: upgrade the fabric CLI to a server-compatible version. Otherwise archive history first (`mkdir -p .fabric/events.archive && mv .fabric/events.jsonl .fabric/events.archive/events-schema-mismatch-$(date +%Y-%m-%d).jsonl`), then run `fabric doctor --fix` to create a new empty ledger. Historical events stay under events.archive/ for later manual migration.",
  // v2.0.0-rc.28 TASK-04 (audit §3.1): SKILL ref/ mirror parity check.
  "doctor.check.skill_ref_mirror.name": "Skill ref mirror parity",
  "doctor.check.skill_ref_mirror.ok":
    "All `.claude/skills/<slug>/ref/` and `.codex/skills/<slug>/ref/` files are byte-identical.",
  "doctor.check.skill_ref_mirror.message":
    "{count} skill ref file(s) differ between `.claude/skills/` and `.codex/skills/` (paths: {list}). One client was hand-edited or partially installed.",
  "doctor.check.skill_ref_mirror.remediation":
    "Run `fabric install` to rewrite both client subtrees from the canonical templates and restore parity.",
  // ux-w2-2: retired-reference (stale-pointer) lint.
  "doctor.check.retired_reference.name": "Retired reference",
  "doctor.check.retired_reference.ok":
    "No retired tool/field names linger in the bootstrap, SKILL.md, or installed hooks.",
  "doctor.check.retired_reference.message":
    "{count} stale pointer(s) to retired tool/field names in agent-facing text: {sample}",
  "doctor.check.retired_reference.remediation":
    "Update the flagged text to the replacement token (or remove it), then re-run `fabric install` to resync the dogfood mirrors.",
  // v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget lint. warn > 5K / error > 10K tokens (chars/3 estimate). Anthropic recommends SKILL.md hot path stay ~3K; over 5K hurts progressive disclosure; over 10K is blocking (wasted model context + load latency).
  "doctor.check.skill_token_budget.name": "Skill token budget",
  "doctor.check.skill_token_budget.ok":
    "All .claude/skills/<slug>/SKILL.md files are within token budget (warn 5K / error 10K).",
  "doctor.check.skill_token_budget.message.singular":
    "{count} SKILL.md exceeds the token budget: {list}. Sink detail into ref/ for progressive disclosure.",
  "doctor.check.skill_token_budget.message.plural":
    "{count} SKILL.md files exceed the token budget: {list}. Sink detail into ref/ for progressive disclosure.",
  "doctor.check.skill_token_budget.remediation":
    "Move detailed phase / worked-examples / decision tables out of the SKILL.md hot path into `templates/skills/<slug>/ref/*.md`. Keep SKILL.md focused on trigger-gate + key-phase summaries; see W1 progressive disclosure split. Re-run `fabric install` to sync both client subtrees.",
  // v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description structural lint. Proxy for trigger-recall (a live-LLM recall test requires a model — W1 ran gemini for that). This lint catches regression: missing description / >60 tokens / no Chinese trigger / no English trigger / no anti-trigger boundary.
  "doctor.check.skill_description.name": "Skill description quality",
  "doctor.check.skill_description.ok":
    "All SKILL.md description fields are well-structured (non-empty, <60 tokens, bilingual triggers, explicit anti-trigger boundary).",
  "doctor.check.skill_description.message.singular":
    "{count} SKILL.md description structural issue: {list}. The description field is the host's primary auto-invoke matching signal.",
  "doctor.check.skill_description.message.plural":
    "{count} SKILL.md description structural issues: {list}. The description field is the host's primary auto-invoke matching signal.",
  "doctor.check.skill_description.remediation":
    "Edit the `description:` field in `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter: (1) non-empty; (2) <60 tokens (chars/3 estimate, ~180 chars); (3) at least one Chinese trigger phrase; (4) at least one English trigger phrase; (5) an explicit anti-trigger such as `NOT PR review` / `NOT code review` / `不是...`. See W1 description rewrite style. Re-run `fabric install` to sync both client subtrees. For recall verification, run the W1 gemini delegate (see .workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md).",
  "doctor.check.skill_contract.name": "Skill contract integrity",
  "doctor.check.skill_contract.ok":
    "Fabric SKILL.md contracts are intact: hard-rule anchors, MCP-only write paths, thin shims, and ref entry points are present.",
  "doctor.check.skill_contract.message.singular":
    "{count} Fabric skill contract issue: {list}.",
  "doctor.check.skill_contract.message.plural":
    "{count} Fabric skill contract issues: {list}.",
  "doctor.check.skill_contract.remediation":
    "Restore the missing contract text in `packages/cli/templates/skills/<slug>/SKILL.md` and referenced `ref/*.md` files, then run `fabric install` to resync `.claude/skills` and `.codex/skills`. Archive/review must keep DISPLAY/WRITE hard rules and MCP-only mutation paths; store/sync must remain thin CLI shims.",
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart pattern detection. Scans 7d of assistant_turn_observed events for 3 anti-patterns (G1 ritual / G2 dismissal abuse / G5 placeholder cite). Warning severity — heuristics can false-positive; advisory only.
  "doctor.check.cite_goodhart.name": "Cite-policy Goodhart",
  "doctor.check.cite_goodhart.ok":
    "No cite-policy Goodhart patterns detected over the last 7 days.",
  "doctor.check.cite_goodhart.message.singular":
    "Detected {count} cite-policy Goodhart pattern: {list}.",
  "doctor.check.cite_goodhart.message.plural":
    "Detected {count} cite-policy Goodhart patterns: {list}.",
  "doctor.check.cite_goodhart.remediation":
    "Review the fired patterns: G1 ritual → the same id repeated as [applied] suggests the KB should land into a contract instead; G2 dismissal abuse → > 60% of applied cites used skip: bypasses contract enforcement, audit skip-reason validity; G5 placeholder cite → too many bare 'KB: none' / [unspecified], prefer specific sentinels like [no-relevant] / [not-applicable]. For raw data, run `fabric doctor --cite-coverage --since=7d`.",
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog lint. rc.32 baseline showed 92% of entries stuck at draft, signaling a broken promote loop. Warns when > 50% draft (workspace must have >= 10 entries to compute the ratio — small corpora are noisy).
  "doctor.check.draft_backlog.name": "Knowledge draft backlog",
  "doctor.check.draft_backlog.ok":
    "draft-maturity entry ratio is healthy (< 50%, or workspace too small to compute).",
  "doctor.check.draft_backlog.message":
    "{draftCount}/{totalCount} ({pct}%) canonical knowledge entries are stuck at draft maturity — promote loop is broken (rc.32 baseline was 92%).",
  "doctor.check.draft_backlog.remediation":
    "Run `/fabric-review` to triage drafts: approve to promote to verified/proven, reject to drop, modify to fix. A long-standing draft backlog usually means archive produces drafts faster than review can promote them.",
  // rc.37 NEW-38: knowledge auto-promote (info surface; --fix applies).
  // rc.36 TASK-05 (P0-8): empty-tags ratio warn.
  "doctor.check.knowledge_tags_empty.name": "Knowledge tags coverage",
  "doctor.check.knowledge_tags_empty.ok":
    "empty-tag ratio is healthy (≤ 50%, or workspace too small to compute).",
  "doctor.check.knowledge_tags_empty.message":
    "{emptyCount}/{totalCount} ({pct}%) canonical knowledge entries have empty `tags:` — topical clustering and cross-entry retrieval degrade. The fabric-archive skill should produce 2-4 tags per entry.",
  "doctor.check.knowledge_tags_empty.remediation":
    "On the next archive/import run, populate `tags:` in the frontmatter with 2-4 kebab-case keywords. To backfill existing entries in bulk, use `/fabric-review` with the modify flow.",
  // rc.36 TASK-09 (P1-NEW1): drift_detected events unconsumed by demote.
  "doctor.check.drift_unconsumed.name": "Knowledge drift unconsumed",
  "doctor.check.drift_unconsumed.ok":
    "knowledge_drift_detected events in the last 30 days have been consumed by paired knowledge_demoted, or event volume is too low to compute.",
  "doctor.check.drift_unconsumed.message":
    "{driftCount} knowledge_drift_detected events in the last 30 days, but only {demoteCount} knowledge_demoted. Drift > demote by ≥ 5 means part of the drift is going unconsumed — KB slowly stales.",
  "doctor.check.drift_unconsumed.remediation":
    "Invoke `/fabric-review` to triage drift-flagged entries — demote or archive them via the store-write review flow. (The doctor `orphan_demote` / `stale_archive` lints surface decay; they do not auto-heal store-backed knowledge.)",
  "doctor.check.meta_manually_diverged.name": "Meta manual divergence",
  "doctor.check.meta_manually_diverged.ok.unreadable":
    "agents.meta.json not readable; skipping divergence check.",
  "doctor.check.meta_manually_diverged.message.extra.singular":
    "agents.meta.json has {count} entry with no backing file on disk. Run --fix to reconcile.",
  "doctor.check.meta_manually_diverged.message.extra.plural":
    "agents.meta.json has {count} entries with no backing file on disk. Run --fix to reconcile.",
  "doctor.check.meta_manually_diverged.remediation.extra":
    "Project-local agents.meta reconciliation is retired; mounted stores are the source of truth.",
  "doctor.check.meta_manually_diverged.message.hash.singular":
    "agents.meta.json has {count} entry whose hash does not match the file on disk. Run --fix to reconcile.",
  "doctor.check.meta_manually_diverged.message.hash.plural":
    "agents.meta.json has {count} entries whose hash does not match the file on disk. Run --fix to reconcile.",
  "doctor.check.meta_manually_diverged.remediation.hash":
    "Project-local agents.meta reconciliation is retired; mounted stores are the source of truth.",
  "doctor.check.meta_manually_diverged.ok.consistent":
    "agents.meta.json is consistent with rule files on disk.",
  "doctor.check.knowledge_dir_unindexed.name": "Knowledge dir unindexed",
  "doctor.check.knowledge_dir_unindexed.message.singular":
    "{count} legacy local knowledge .md file is not indexed. Move it into a mounted store; non-store knowledge roots are retired.",
  "doctor.check.knowledge_dir_unindexed.message.plural":
    "{count} legacy local knowledge .md files are not indexed. Move them into a mounted store; non-store knowledge roots are retired.",
  "doctor.check.knowledge_dir_unindexed.remediation":
    "Use `fabric store bind` / `fabric store switch-write`, then migrate knowledge into the store's knowledge/ tree.",
  "doctor.check.knowledge_dir_unindexed.ok":
    "No legacy local knowledge indexing action is needed.",
  // v2.0.0-rc.33 W3-2 (T6 #27): route through fabric-review modify so the canonical id allocator picks a fresh id (avoids hand-counter math).
  "doctor.check.counter_desync.name": "Knowledge counter desync",
  "doctor.check.counter_desync.message.singular":
    "{count} knowledge counter desynced from observed stable_ids. {counterPath} = {current} but observed {observedId}. Run `fabric doctor --fix` to bump counters.",
  "doctor.check.counter_desync.message.plural":
    "{count} knowledge counters desynced from observed stable_ids. {counterPath} = {current} but observed {observedId}. Run `fabric doctor --fix` to bump counters.",
  "doctor.check.counter_desync.remediation":
    "Run `fabric doctor --fix` to bump agents.meta.json counters to the maximum observed counter value.",
  "doctor.check.counter_desync.ok":
    "agents.meta.json counters envelope is consistent with observed stable_ids.",
  "doctor.check.store_counter_drift.name": "Store counter drift",
  "doctor.check.store_counter_drift.message.singular":
    "{count} store counter is below its on-disk max stable_id ({detail}). The next allocation in that store would re-mint an existing id. Run `fabric doctor --fix` to floor the store counters.json.",
  "doctor.check.store_counter_drift.message.plural":
    "{count} store counters are below their on-disk max stable_id ({detail}). The next allocation in those stores would re-mint an existing id. Run `fabric doctor --fix` to floor the store counters.json.",
  "doctor.check.store_counter_drift.remediation":
    "Run `fabric doctor --fix` to floor each store's counters.json at the highest stable_id observed on disk (the floor never lowers — KT-DEC-0004 monotonic invariant).",
  "doctor.check.store_counter_drift.ok":
    "Every read-set store's counters.json is floored at its on-disk max stable_id.",
  "doctor.check.store_orphan.name": "Store orphan",
  "doctor.check.store_orphan.message.singular":
    "{count} store exists on disk but is not registered in the global registry ({detail}); recall / bind cannot see it. Run `fabric doctor --fix` to adopt it (re-register — never deletes the on-disk tree).",
  "doctor.check.store_orphan.message.plural":
    "{count} stores exist on disk but are not registered in the global registry (first: {detail}); recall / bind cannot see them. Run `fabric doctor --fix` to adopt them (re-register — never deletes the on-disk tree).",
  "doctor.check.store_orphan.remediation":
    "Run `fabric doctor --fix` to adopt the orphan store(s) into the registry (re-register by store_uuid, alias auto-disambiguated on clash; rescue-before-delete — registers, never deletes on disk).",
  "doctor.check.store_orphan.ok":
    "No unregistered orphan stores under ~/.fabric/stores.",
  // W2 (F-003): project-registry drift — projects.json ↔ projects/ folder tree.
  "doctor.check.project_registry_drift.name": "Project registry drift",
  "doctor.check.project_registry_drift.ok":
    "Every knowledge/projects/<id>/ folder is registered in projects.json and no registered folder is empty.",
  "doctor.check.project_registry_drift.message.unregistered":
    "{total} project registry drift issue(s): {breakdown}. e.g. projects/{projectId}/ in store '{storeAlias}' holds knowledge but is not registered in projects.json (unrouted). Run `fabric doctor --fix` to register it (rescue-before-delete — never deletes the folder).",
  "doctor.check.project_registry_drift.message.orphan":
    "{total} project registry drift issue(s): {breakdown}. e.g. projects/{projectId}/ in store '{storeAlias}' exists on disk but is not registered in projects.json. Run `fabric doctor --fix` to register it (rescue — never deletes the folder).",
  "doctor.check.project_registry_drift.message.empty":
    "{total} project registry drift issue(s): {breakdown}. e.g. registered project '{projectId}' in store '{storeAlias}' has an empty projects/{projectId}/ folder (zero entries). Run `fabric doctor --fix` to prune the empty folder.",
  "doctor.check.project_registry_drift.remediation":
    "Run `fabric doctor --fix` to reconcile: orphan / unregistered-write folders are rescue-registered into projects.json (never deleted, even when non-empty); only genuinely-empty registered folders are pruned. A ghost registration (registered id with no folder) is legal (lazy creation) and needs no action.",
  "doctor.check.preexisting_root_files.name": "Preexisting root markdown",
  "doctor.check.preexisting_root_files.ok": "No CLAUDE.md or AGENTS.md detected at project root.",
  "doctor.check.preexisting_root_files.message":
    "{files} detected at project root. These root files are not auto-loaded by Fabric MCP.",
  "doctor.check.preexisting_root_files.remediation":
    "Move knowledge content into a mounted store's `knowledge/{type}/` tree if you want it available in MCP responses.",
  // v2.0.0-rc.33 W3-2 (T6 #34): same as stable_id_collision — route through fabric-review modify so allocator handles the new id.
  // v2.0.0-rc.33 W3-2 (T6 #35): make the skill entry point explicit so users know how to invoke fabric-review.
  "doctor.check.index_drift.name": "Knowledge index drift",
  "doctor.check.index_drift.ok":
    "agents.meta.json counters envelope is at or above the highest existing canonical counter for every (layer, type) pair.",
  "doctor.check.index_drift.message.singular":
    "{count} (layer, type) counter slot have drifted below the observed canonical maximum (next allocate would collide). First: {detail}.",
  "doctor.check.index_drift.message.plural":
    "{count} (layer, type) counter slots have drifted below the observed canonical maximum (next allocate would collide). First: {detail}.",
  "doctor.check.index_drift.remediation":
    "Run `fabric doctor --fix-knowledge` to bump agents.meta.json counters to max_observed + 1.",
  "doctor.check.underseeded.name": "Knowledge underseeded",
  "doctor.check.underseeded.ok":
    "Knowledge corpus has {count} canonical entries (>= {threshold}).",
  "doctor.check.underseeded.message.singular":
    "Knowledge corpus has only {count} canonical entry (< {threshold} threshold). The plan_context retrieval surface is below its useful floor.",
  "doctor.check.underseeded.message.plural":
    "Knowledge corpus has only {count} canonical entries (< {threshold} threshold). The plan_context retrieval surface is below its useful floor.",
  "doctor.check.underseeded.remediation":
    "Run the fabric-archive skill's source mode (`/fabric-archive`) to backfill knowledge from git history and existing docs.",
  "doctor.check.session_hints_stale.name": "Knowledge session-hints stale",
  "doctor.check.session_hints_stale.ok":
    "No session-hints cache files older than {days} days under .fabric/.cache/.",
  "doctor.check.session_hints_stale.message.singular":
    "{count} session-hints cache file under .fabric/.cache/ is older than {days} days. First: {detail}.",
  "doctor.check.session_hints_stale.message.plural":
    "{count} session-hints cache files under .fabric/.cache/ are older than {days} days. First: {detail}.",
  "doctor.check.session_hints_stale.remediation":
    "Run `fabric doctor --fix-knowledge` to delete stale session-hints cache files.",
  "doctor.check.hook_cache_writable.name": "Hook cache writable",
  "doctor.check.hook_cache_writable.ok":
    "Hook sidecar cache path {path} accepts write probes.",
  "doctor.check.hook_cache_writable.message":
    "Hook sidecar cache path {path} is not writable; hook state updates will silently fail. Error: {error}.",
  "doctor.check.hook_cache_writable.remediation":
    "Restore write permissions for {path}, remove a blocking file at that path, or rerun `fabric install` after fixing the filesystem state.",
  "doctor.check.stale_serve_lock.name": "Serve lock",
  "doctor.check.stale_serve_lock.ok.no_lock": "No .fabric/.serve.lock present.",
  "doctor.check.stale_serve_lock.ok.live_pid":
    ".fabric/.serve.lock held by live PID {pid}.",
  "doctor.check.stale_serve_lock.age.day.singular": "{count} day ago",
  "doctor.check.stale_serve_lock.age.day.plural": "{count} days ago",
  "doctor.check.stale_serve_lock.age.hour.singular": "{count} hour ago",
  "doctor.check.stale_serve_lock.age.hour.plural": "{count} hours ago",
  "doctor.check.stale_serve_lock.message.dead_pid":
    "[advisory] .fabric/.serve.lock holds dead PID {pid} (acquired {acquiredAgo}). Run `fabric doctor --fix` to remove.",
  "doctor.check.stale_serve_lock.remediation.dead_pid":
    "Run `fabric doctor --fix` to remove the stale .fabric/.serve.lock.",
  // rc.31 BUG-M3/NEW-4: hooks_wired observability.
  "doctor.check.hooks_wired.name": "Claude Code hooks wired",
  "doctor.check.hooks_wired.ok.skipped": "Project does not use Claude Code (no .claude/ directory); hooks_wired check skipped.",
  "doctor.check.hooks_wired.ok.wired":
    ".claude/settings.json has the three fabric hooks wired: Stop:fabric-hint / SessionStart:knowledge-hint-broad / PreToolUse:knowledge-hint-narrow.",
  "doctor.check.hooks_wired.message.missing_settings":
    ".claude/ exists but .claude/settings.json is absent or unparseable; fabric install may have never run successfully, or the file was wiped externally.",
  "doctor.check.hooks_wired.message.incomplete":
    ".claude/settings.json is missing fabric hook injections: {missing}. fabric install dry-run report does not match actual state (rc.30 audit BUG-M3 / NEW-4).",
  "doctor.check.hooks_wired.remediation":
    "Run `fabric install` to re-inject hooks (idempotent; only fills missing slots). If hooks config was accidentally wiped, back up .claude/settings.json before running.",
  // v2.0.0-rc.37 NEW-20: hooks_runtime — shebang + Node.js syntax validity
  // of installed *.cjs hook files (one layer below hooks_wired).
  "doctor.check.hooks_runtime.name": "Hooks runtime health",
  "doctor.check.hooks_runtime.ok.skipped": "No installed hook files found under .claude/hooks/ / .codex/hooks/; skipping hooks_runtime check.",
  "doctor.check.hooks_runtime.ok.healthy":
    "Scanned {count} hook .cjs file(s); shebang and Node.js syntax parse all pass.",
  "doctor.check.hooks_runtime.message.singular":
    "{count} hook file is unhealthy at runtime; first: {first_path} ({first_detail}).",
  "doctor.check.hooks_runtime.message.plural":
    "{count} hook files are unhealthy at runtime; first: {first_path} ({first_detail}).",
  "doctor.check.hooks_runtime.remediation":
    "Run `fabric install` to overwrite broken hook files (idempotent). If a hook was corrupted by an external process, confirm the cause before re-running install.",
  // v2.0.0-rc.37 NEW-27: hooks_content_drift — cross-client sha256 parity.
  "doctor.check.hooks_content_drift.name": "Hooks cross-client content parity",
  "doctor.check.hooks_content_drift.ok.skipped": "No hook files co-exist across multiple clients (single-client install or no hooks present); skipping hooks_content_drift check.",
  "doctor.check.hooks_content_drift.ok.aligned":
    "Scanned {count} hook copies; sha256 of every basename matches across .claude / .codex.",
  "doctor.check.hooks_content_drift.message":
    "{count} hook basename(s) drift across clients; first: {first_basename} (involves {first_clients}). `fabric install` copies the same template to both clients — drift usually comes from manual edits.",
  "doctor.check.hooks_content_drift.remediation":
    "Run `fabric install` to restore each client's hook copy to the canonical template. If you actually need client-specific behavior, modify a shared lib/ helper or templates/hooks/configs/ wiring instead of editing the installed .cjs in place.",
  // rc.31 BUG-G2/G5: promote-ledger invariant check.
  "doctor.check.promote_ledger_invariant.name": "Promote ledger invariant",
  "doctor.check.promote_ledger_invariant.ok":
    "knowledge_proposed={proposed} >= knowledge_promote_started={started} >= knowledge_promoted={promoted}; ledger invariant holds.",
  "doctor.check.promote_ledger_invariant.message.proposed-lt-started":
    "knowledge_proposed={proposed} is less than knowledge_promote_started={started} (ledger invariant violated; some pending entries were approved without going through fab_propose, so no propose event was emitted for them).",
  "doctor.check.promote_ledger_invariant.message.started-lt-promoted":
    "knowledge_promote_started={started} is less than knowledge_promoted={promoted} (ledger invariant violated; unpaired promoted events exist, possibly from doctor filesystem-edit fallback or external writers).",
  "doctor.check.promote_ledger_invariant.remediation":
    "Starting in rc.31, review.approve synthesizes a knowledge_proposed event to keep the invariant; re-run fabric doctor after the next approve to settle. Historical imbalance is observability-only and does not affect KB function.",
  // rc.35 TASK-04 (P0-9.b): global_cli_outdated.
  "doctor.check.global_cli_outdated.name": "Global fabric CLI version",
  "doctor.check.global_cli_outdated.ok":
    "Global `fabric` on PATH is {version}; compatible with the rc.31+ project schema.",
  "doctor.check.global_cli_outdated.message.outdated":
    "Global `fabric` on PATH is {version}, older than the minimum-supported {minVersion}. rc.31 introduced an agents.meta.json schema fix; hooks installed by an outdated binary silently fail. Upgrade the global CLI to match the project.",
  "doctor.check.global_cli_outdated.message.not_found":
    "No `fabric` binary on PATH. The CLI is required for `fabric install` / `fabric doctor`; install it globally.",
  "doctor.check.global_cli_outdated.message.unparseable":
    "Could not parse `fabric -v` output ({detail}). Skipping outdated-version check.",
  "doctor.check.global_cli_outdated.remediation":
    "Run `npm install -g @fenglimg/fabric-cli@latest`, then re-run `fabric install` in each fabric-managed project to resync hooks + SKILL.md.",
  // rc.35 TASK-05 (P0-10.a): knowledge_summary_opaque.
  "doctor.check.knowledge_summary_opaque.name": "Knowledge summary opacity",
  "doctor.check.knowledge_summary_opaque.ok.skipped":
    "agents.meta.json is absent or invalid; summary-opacity check skipped.",
  "doctor.check.knowledge_summary_opaque.ok":
    "{opaque}/{total} entries have summary == stable_id; opacity ratio is within the healthy band.",
  "doctor.check.knowledge_summary_opaque.message.warn":
    "{opaque}/{total} entries ({pct}%) have description.summary equal to their stable_id, exceeding the {threshold}% threshold. Narrow-hint output renders as `<id> · <id>`, signaling nothing useful, and AI clients skip the fetch. First opaque: {sample}.",
  "doctor.check.knowledge_summary_opaque.remediation":
    "Run the fabric-review skill to rewrite opaque summaries with one short human-readable phrase. The rc.35 hint renderer fallback (TASK-06) will also synthesize a temporary summary from the entry's `## Summary` section.",
  // v2.2 W4 (G-GUARD / A6): store scope lint.
  "doctor.check.store_scope_lint.name": "Store scope lint",
  "doctor.check.store_scope_lint.ok":
    "All read-set store entries carry valid scope metadata (semantic_scope + visibility_store, no personal leak, no dangling project).",
  "doctor.check.store_scope_lint.message":
    "{total} store scope issue(s): {breakdown}. e.g. {sample}.",
  "doctor.check.store_scope_lint.remediation":
    "Run `fabric store migrate backfill` to add missing semantic_scope/visibility_store; `fabric store migrate scope` to fix a dangling project: coordinate; move any personal-scope entry out of a shared store (personal knowledge lives only in your personal store, R5#3).",
  // v2.2 Goal B (G-INTEGRITY): store stable_id collision + layer mismatch lints.
  "doctor.check.stable_id_collision.name": "Stable ID collision",
  "doctor.check.stable_id_collision.message.singular":
    "stable_id \"{stableId}\" is declared in {fileCount} files: {files}. Edit one of the knowledge files to use a unique stable_id.",
  "doctor.check.stable_id_collision.message.plural":
    "{count} stable_id collisions detected. First: \"{stableId}\" in {files}. Edit one of the knowledge files to use a unique stable_id.",
  "doctor.check.stable_id_collision.remediation":
    "Run `/fabric-review modify <one of the colliding ids from the message>` to let the canonical id allocator reassign it (updates frontmatter + counters + historical cross-refs atomically). Do NOT hand-edit id frontmatter — it will desync counters.",
  "doctor.check.stable_id_collision.ok":
    "No declared stable_id collisions found in mounted store knowledge.",
  "doctor.check.layer_mismatch.name": "Knowledge layer mismatch",
  "doctor.check.layer_mismatch.ok":
    "All canonical knowledge files are physically located under the layer their stable_id prefix declares.",
  "doctor.check.layer_mismatch.message.singular":
    "{count} canonical knowledge file is physically misaligned with its stable_id layer prefix (KT-* must live under team/, KP-* under personal/). First: {detail}.",
  "doctor.check.layer_mismatch.message.plural":
    "{count} canonical knowledge files are physically misaligned with their stable_id layer prefix (KT-* must live under team/, KP-* under personal/). First: {detail}.",
  "doctor.check.layer_mismatch.remediation":
    "Move the file to the correct write-target store or run `/fabric-review modify <id from the message>` to flip its layer (which renames the stable_id prefix accordingly).",
  // v2.2 Goal B (G-RELEVANCE): store relevance_paths hygiene (dangling + drift).
  "doctor.check.relevance_paths_dangling.name": "Knowledge relevance_paths dangling",
  "doctor.check.relevance_paths_dangling.ok":
    "All relevance_paths globs resolve to at least one file under the workspace root.",
  "doctor.check.relevance_paths_dangling.message.singular":
    "{count} relevance_paths glob resolves to zero files in the current workspace. First: {detail}.",
  "doctor.check.relevance_paths_dangling.message.plural":
    "{count} relevance_paths globs resolve to zero files in the current workspace. First: {detail}.",
  "doctor.check.relevance_paths_dangling.remediation":
    "Update the entry's relevance_paths to remove globs that no longer match any files, or use `fab_review.modify` to rewrite the anchor set.",
  "doctor.check.relevance_paths_drift.name": "Knowledge relevance_paths drift",
  "doctor.check.relevance_paths_drift.ok.skipped":
    "Skipped (git history unavailable; cannot evaluate {windowDays}d drift window).",
  "doctor.check.relevance_paths_drift.ok.fresh":
    "All narrow-scope canonical entries have at least one relevance_path touched in the last {windowDays}d.",
  "doctor.check.relevance_paths_drift.message.singular":
    "{count} narrow-scope canonical entry has relevance_paths whose globs match no file touched in the last {windowDays}d of git history. First: {detail}.",
  "doctor.check.relevance_paths_drift.message.plural":
    "{count} narrow-scope canonical entries have relevance_paths whose globs match no file touched in the last {windowDays}d of git history. First: {detail}.",
  "doctor.check.relevance_paths_drift.remediation":
    "Review whether the entry is still relevant — use `fab_review.modify` to refresh the anchors or `fab_review.reject` to archive.",
  // W4-3 (KT-MOD-0001): narrow-scope entry with an empty relevance_paths set.
  "doctor.check.narrow_no_paths.name": "Knowledge narrow scope without paths",
  "doctor.check.narrow_no_paths.ok":
    "Every narrow-scope canonical entry carries at least one relevance_path.",
  "doctor.check.narrow_no_paths.message.singular":
    "{count} narrow-scope entry has an empty relevance_paths set — it can never path-match, so it will never surface (permanently dead). First: {detail}.",
  "doctor.check.narrow_no_paths.message.plural":
    "{count} narrow-scope entries have an empty relevance_paths set — they can never path-match, so they will never surface (permanently dead). First: {detail}.",
  "doctor.check.narrow_no_paths.remediation":
    "Use `fab_review.modify` to add relevance_paths globs anchoring the entry, or switch its relevance_scope to `broad` if it is meant to be always-on.",
  // W4-2 (KT-DEC-0028): per-store broad index nearing the backstop.
  "doctor.check.broad_index_drift.name": "Knowledge broad index drift",
  "doctor.check.broad_index_drift.ok":
    "No store's broad-scope entry count reaches the drift threshold ({threshold} of backstop {backstop}).",
  "doctor.check.broad_index_drift.message.singular":
    "{count} store's broad-scope index has reached {threshold} (80% of backstop {backstop}) — the SessionStart banner is close to truncating broad entries. First: {detail}.",
  "doctor.check.broad_index_drift.message.plural":
    "{count} stores' broad-scope indexes have reached {threshold} (80% of backstop {backstop}) — the SessionStart banner is close to truncating broad entries. First: {detail}.",
  "doctor.check.broad_index_drift.remediation":
    "Run the `fabric-review` skill's retire sub-flow to prune or demote stale broad-scope entries in the flagged store, or raise `broad_index_backstop` in .fabric/fabric-config.json if the corpus is legitimately large.",
  // v2.2 Goal B (G-AGE): knowledge decay lints (orphan_demote + stale_archive).
  "doctor.check.orphan_demote.name": "Knowledge orphan demote",
  "doctor.check.orphan_demote.ok":
    "No canonical knowledge entries exceed their maturity-keyed inactivity threshold.",
  "doctor.check.orphan_demote.message.singular":
    "{count} canonical knowledge entry exceeds its maturity-keyed inactivity threshold (proven={provenDays}d / verified={verifiedDays}d / draft={draftDays}d). First: {detail}.",
  "doctor.check.orphan_demote.message.plural":
    "{count} canonical knowledge entries exceed their maturity-keyed inactivity threshold (proven={provenDays}d / verified={verifiedDays}d / draft={draftDays}d). First: {detail}.",
  "doctor.check.orphan_demote.remediation":
    "Demote the entry one maturity tier via `/fabric-review modify <id>`, or re-engage it so it logs fresh activity. (Rewriting store-backed knowledge is the store-write flow's job — this read-side lint only surfaces the decay.)",
  "doctor.check.stale_archive.name": "Knowledge stale archive",
  "doctor.check.stale_archive.ok":
    "No draft knowledge entries exceed the additional stale-archive quiet window.",
  "doctor.check.stale_archive.message.singular":
    "{count} draft knowledge entry is stale beyond the demote+{additionalDays}d additional quiet window. First: {detail}.",
  "doctor.check.stale_archive.message.plural":
    "{count} draft knowledge entries are stale beyond the demote+{additionalDays}d additional quiet window. First: {detail}.",
  "doctor.check.stale_archive.remediation":
    "Archive the stale draft via `/fabric-review reject <id>`, or revive it if still relevant. (Moving store-backed files is the store-write flow's job — this read-side lint only surfaces the staleness.)",
  // v2.2 C1: knowledge promotion lint (promotion_candidate, info kind).
  "doctor.check.promotion_candidate.name": "Knowledge promotion candidate",
  "doctor.check.promotion_candidate.ok":
    "No verified knowledge entries reach the related in-degree threshold for proven promotion.",
  "doctor.check.promotion_candidate.message.singular":
    "{count} verified knowledge entry has related in-degree ≥{threshold} (structurally central) and is worth reviewing for promotion to proven. First: {detail}.",
  "doctor.check.promotion_candidate.message.plural":
    "{count} verified knowledge entries have related in-degree ≥{threshold} (structurally central) and are worth reviewing for promotion to proven. First: {detail}.",
  "doctor.check.promotion_candidate.remediation":
    "Review these entries via `/fabric-review` and (after confirming 0 dismissals, cold-eval self-sufficiency, and foundational value) `modify <id>` to proven. (The promotion judgment is the store-write review's job — this read-side lint only surfaces the structurally-central candidates.)",
  // v2.2 C1: broad review-recheck lint (broad_review_recheck, info kind).
  "doctor.check.broad_review_recheck.name": "Knowledge broad review recheck",
  "doctor.check.broad_review_recheck.ok":
    "No broad-scope knowledge entries are overdue for a review re-confirmation.",
  "doctor.check.broad_review_recheck.message.singular":
    "{count} broad-scope knowledge entry has gone {thresholdDays}d+ without a fab-review re-confirmation and is worth a recheck (broad is exempt from usage-age decay, so this is its review clock). First: {detail}.",
  "doctor.check.broad_review_recheck.message.plural":
    "{count} broad-scope knowledge entries have gone {thresholdDays}d+ without a fab-review re-confirmation and are worth a recheck (broad is exempt from usage-age decay, so this is its review clock). First: {detail}.",
  "doctor.check.broad_review_recheck.remediation":
    "Re-confirm each entry via `/fabric-review` (approve/modify stamps a fresh review timestamp), or demote/reject it if it no longer holds. This is a non-blocking nudge, never an auto-demote — broad knowledge stays surfaced until a reviewer acts.",
  // project-scope binding backfill lint (unbound_project).
  "doctor.check.unbound_project.name": "Project-scope binding",
  "doctor.check.unbound_project.ok":
    "The bound write store carries a project coordinate (project_id + active_project), so project-scope recall/writes route correctly.",
  "doctor.check.unbound_project.message":
    "Store '{alias}' is bound as the write target but the project coordinate is incomplete (missing {missing}); project-scope recall/writes fall back to team scope.",
  "doctor.check.unbound_project.remediation":
    "Run `fabric doctor --fix` to backfill the project binding (mints project_id, registers the project in the store, sets active_project). Idempotent — a second run is a no-op.",
  // write_route_target_unbound — static check that write_routes survived the single-team-slot migration.
  "doctor.check.write_route_target_unbound.name": "Write route target",
  "doctor.check.write_route_target_unbound.ok":
    "Every write_routes[*].store is present in required_stores; the scope→store routing is statically consistent.",
  "doctor.check.write_route_target_unbound.message":
    "{count} write_route(s) point at an unbound store ({routes}); fab_propose on those scopes will report \"no write-target store resolved\".",
  "doctor.check.write_route_target_unbound.remediation":
    "Either ① `fabric store bind <store>` to add the target to required_stores (under the single team slot rule this replaces the current one), or ② edit `.fabric/fabric-config.json` to remove the stale write_route.",
  // stray_fabric_dir_detected — rc.11 root-cause fix: server-side resolveProjectRoot used cwd,
  // so a subprocess launched from a subdirectory created .fabric/ in the wrong place. This
  // lint walks the project tree and reports every .fabric/ other than <root>/.fabric.
  "doctor.check.stray_fabric_dir_detected.name": "Stray .fabric directories",
  "doctor.check.stray_fabric_dir_detected.ok":
    "No stray .fabric directories under the project root — the only authoritative anchor is <projectRoot>/.fabric.",
  "doctor.check.stray_fabric_dir_detected.message":
    "Found {count} stray .fabric director(ies) ({dirs}) left by subprocesses that mistook a subdirectory for the project root (pre-rc.10 hooks / pre-rc.11 server-side). These scatter events.jsonl / metrics.jsonl / .cache across the source tree.",
  "doctor.check.stray_fabric_dir_detected.remediation":
    "Run `fabric doctor --fix` to rename each stray dir to `.fabric.stale-<timestamp>` (rescue-before-delete — never a hard delete). Review the renamed dirs before merging events. Also upgrade global fabric-cli to rc.11+ so the server-side git-anchor resolver is active.",
  "doctor.check.skill_md_yaml_invalid.name": "Skill markdown YAML",
  "doctor.check.skill_md_yaml_invalid.ok":
    "All .claude/.codex SKILL.md frontmatter values parse as strict YAML.",
  "doctor.check.skill_md_yaml_invalid.message.singular":
    "{count} SKILL.md frontmatter value contains an unquoted ': ' that strict YAML parsers reject (Claude Code tolerates it; Codex CLI drops the skill at load). First: {detail}.",
  "doctor.check.skill_md_yaml_invalid.message.plural":
    "{count} SKILL.md frontmatter values contain an unquoted ': ' that strict YAML parsers reject (Claude Code tolerates it; Codex CLI drops the skill at load). First: {detail}.",
  "doctor.check.skill_md_yaml_invalid.remediation":
    "Quote the value with double quotes (`description: \"…\"`) or rewrite the inner `key: value` token to `key=value`.",
  "doctor.check.onboard_coverage.name": "Onboard coverage",
  "doctor.check.onboard_coverage.ok.complete":
    "Onboard coverage: {filledCount}/{total} ✓ (opted-out: {optedOutCount}).",
  "doctor.check.onboard_coverage.message.incomplete":
    "Onboard slots not yet covered: [{missingSlots}]. {filledCount}/{total} filled; {optedOutCount} opted-out.",
  "doctor.check.onboard_coverage.remediation.incomplete":
    "Run /fabric-archive to onboard — the Skill's first-run phase will tour the project and propose pending entries for each unclaimed slot.",
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
  // rc.37 NEW-33: unified --history <mode> view (archive | fix | all).
  "cli.doctor.args.history.description":
    "Render unified per-day history (mode: archive | fix | all). Read-only; mutex with --fix / --fix-knowledge / --cite-coverage / --enrich-descriptions / --archive-history.",
  "cli.doctor.errors.history-mutex":
    "--history cannot be combined with --fix, --fix-knowledge, --cite-coverage, --enrich-descriptions, or --archive-history. Run them separately.",
  "cli.doctor.errors.invalid-history-mode":
    "Invalid --history mode '{input}'. Use archive | fix | all.",
  "doctor.history.header": "Doctor history (mode={mode}, last {sinceLabel}, {days} day(s))",
  "doctor.history.empty": "No doctor or archive activity within the --since={sinceLabel} window (mode={mode}).",

  "cli.install.description":
    "Install Fabric in the target project (scaffold .fabric/, bootstrap templates, MCP client wiring, git hooks)",
  "cli.install.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.install.args.debug.description": "Print target resolution details to stderr.",
  "cli.install.args.yes.description": "Accept the current install plan and run without the TTY wizard",
  "cli.install.args.dry-run.description": "Print the install plan without writing files or running follow-up stages",
  "cli.install.args.enable-embed.description":
    "Opt in to vector semantic search (sets embed_enabled + embed_model; prints fastembed install steps)",
  "cli.install.args.embed-model.description":
    "With --enable-embed: override the pinned embed model (default fast-bge-small-zh-v1.5)",
  "cli.install.args.global.description":
    "Set up global Fabric (~/.fabric: uid + personal store + config)",
  "cli.install.args.url.description":
    "Clone + mount a shared store remote. In a project install: also binds it to this project and sets it as the write target. With --global: mounts it machine-wide only.",
  // TASK-004: --verbose expands the per-phase detail a collapsed re-install would
  // fold, and prints the full per-client capability table.
  "cli.install.args.verbose.description":
    "Show full detail: don't collapse an idempotent re-install into a health-check card, and print the per-client capability table",
  // rc.35 TASK-08 (P0-5/6): --force-skills-only.
  "cli.install.args.force-skills-only.description":
    "Skip bootstrap / MCP / hooks / settings; refresh ONLY the fabric Skill template copies (.claude/.codex/skills/*).",
  "cli.install.force-skills-only.banner": "Refreshing fabric Skill templates only",
  "cli.install.force-skills-only.uninitialised.message":
    "fabric install --force-skills-only: project is not initialised (.fabric/agents.meta.json is missing).",
  "cli.install.force-skills-only.uninitialised.hint":
    "Run `fabric install` (without --force-skills-only) first to lay down the base scaffold, then re-run with --force-skills-only for subsequent Skill refreshes.",
  "cli.install.force-skills-only.summary": "Skills refresh complete — written: {written}, skipped: {skipped}, errors: {errors}",
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only.
  "cli.install.args.force-hooks-only.description":
    "Skip bootstrap / MCP / skills / settings; only refresh fabric hook scripts + per-client hook config merges (.claude/.codex/hooks/*).",
  "cli.install.force-hooks-only.banner": "Refreshing fabric hooks only",
  "cli.install.force-hooks-only.uninitialised.message":
    "fabric install --force-hooks-only: project not initialised (.fabric/agents.meta.json missing).",
  "cli.install.force-hooks-only.uninitialised.hint":
    "Run `fabric install` (without --force-hooks-only) first to lay down the base scaffold; then re-run with --force-hooks-only to refresh hooks.",
  "cli.install.force-hooks-only.summary": "Hooks refresh complete — written: {written}, skipped: {skipped}, errors: {errors}",
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
  "cli.install.stages.mcp": "Configuring MCP clients...",
  "cli.install.stages.hooks": "Installing hooks & skills...",
  "cli.install.preflight.error.no-home": "Cannot determine home directory for global root",
  "cli.install.preflight.error.not-dir": "Global Fabric root is not a directory: {path}",
  "cli.install.preflight.error.parent-not-dir": "Global Fabric root parent is not a directory: {path}",
  "cli.install.preflight.error.not-writable": "{label} is not writable: {path} ({reason})",
  "cli.install.preflight.error.git-required": "git is required for --url installs but was not available: {reason}",
  "cli.install.preflight.label.target": "Target",
  "cli.install.preflight.label.global-root": "Global Fabric root",
  "cli.install.preflight.label.global-root-parent": "Global Fabric root parent",
  "cli.install.guidance.more": "More: docs/surfaces.md explains when to use CLI vs Skill vs MCP.",
  "cli.install.validate.passed": "Validation passed ✓ (config / hook paths / events all ready)",
  "cli.install.validate.failed": "Validation failed: {count} error(s)",
  "cli.install.validate.failed-item": "  - {error}",
  "cli.install.hooks.uptodate": "hooks & skills already up to date ({count} items)",
  "cli.install.hooks.installed": "installed skill×{skills} + hook×{hooks}",
  "cli.install.mcp.configured": "MCP configured: {clients}",
  "cli.install.mcp.none": "no MCP clients to configure",
  "cli.install.scan.finding.framework": "Detected: {framework} project",
  "cli.install.scan.finding.scale": "Scale: {files} files · {entries} entry points",
  // flat-design: scan result folded into ONE human line (framework + scale); the
  // version is suppressed when it resolved to "unknown"; falls back to plain when
  // no framework was detected.
  "cli.install.scan.summary.framework": "Detected {framework} project · {files} files · {entries} entry points",
  "cli.install.scan.summary.plain": "Scan complete · {files} files · {entries} entry points",
  "cli.install.rollback.feedback": "Rolled back {count} change(s); project left unchanged.",
  "cli.install.stages.skipped": "skipped",
  "cli.install.stages.completed": "completed",
  "cli.install.stages.failed": "failed",
  "cli.install.stages.summary.ran": "ran",
  "cli.install.stages.summary.skipped": "skipped",
  "cli.install.stages.summary.failed": "failed",
  "cli.install.pipeline.title": "Fabric Install",
  "cli.install.pipeline.complete": "Fabric Install Complete",
  "cli.install.pipeline.running": "Running {count} stages...",
  // TASK-002 (G1): summary-card completion + count words. Formerly hardcoded
  // English in ConsoleOutputRenderer (Done! / succeeded / skipped / failed /
  // "All steps completed successfully"); routed through t() + dual-locale tables
  // so locale-parity.test.ts guards both en + zh-CN carry every key.
  "cli.summary.done": "Done!",
  "cli.summary.all-ok": "All steps completed successfully",
  "cli.summary.n-failed": "{count} step(s) failed",
  "cli.summary.all-resolved": "all resolved · {done} done / {skipped} skipped",
  "cli.summary.count.succeeded": "succeeded",
  "cli.summary.count.skipped": "skipped",
  "cli.summary.count.failed": "failed",
  // TASK-004: a first-ever install gets an onboarding-tone intro; a re-install
  // keeps the terse "Running N stages" line. {count} = total stages.
  "cli.install.pipeline.intro.firstRun":
    "Welcome to Fabric — this is your first install. I'll walk you through a one-time setup ({count} stages); later runs skip anything already in place.",
  // TASK-004: the single collapsed health-check card title for a fully-idempotent
  // re-install. {count} = total stages. Detail is behind --verbose.
  "cli.install.healthcheck.title": "✓ Fabric is up to date · {count} stages ready · no changes",
  // TASK-003 (G2 root a): the per-stage summary-detail status word now branches on
  // r.changed (not installed.length) — a no-change re-ensure says "up to date"
  // instead of misreporting "N installed". installed-count is used only when the
  // stage actually changed something.
  "cli.install.stage.uptodate": "up to date",
  "cli.install.stage.installed-count": "{count} installed",
  "cli.install.pipeline.label.preflight": "Preflight check",
  "cli.install.pipeline.label.env": "Environment setup",
  "cli.install.pipeline.label.store": "Store configuration",
  "cli.install.pipeline.label.hooks": "Hooks & skills",
  "cli.install.pipeline.label.mcp": "MCP server",
  "cli.install.pipeline.label.validate": "Validation",
  "cli.install.pipeline.label.guidance": "Next steps",
  "cli.install.pipeline.desc.store":
    "Bind the current project's read/write store; refresh the resolved-bindings snapshot.",
  "cli.install.next-step": "{label} {message}",
  // TASK-002 (G6): a single golden-action anchor that closes the summary card.
  // The verbose capability table is gated behind --verbose; this one line is the
  // honest "what to do next" footer. {action} = the concrete next command.
  "cli.install.next-step.anchor": "Next → {action}",
  // flat-design (G6): the real next action after install is restarting the client
  // so its MCP server loads — that is the default anchor; the --reapply maintenance
  // hint moves to --verbose.
  "cli.install.next-step.restart": "restart any open Claude Code / Codex session to load Fabric (new sessions pick it up automatically).",
  "cli.install.reason-message": "{label} {message}",
  "cli.install.language.prompt": "Choose the Fabric language (used for both UI and knowledge; change later via `fabric config`):",
  "cli.install.language.option.zh-CN": "简体中文 (zh-CN)",
  "cli.install.language.option.en": "English (en)",
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
  // flat-design-system Wave4 (TASK-004): short stage labels for the post-group ✓ receipt.
  "cli.install.wizard.stage.bootstrap.short": "bootstrap templates",
  "cli.install.wizard.stage.mcp.short": "MCP clients",
  "cli.install.wizard.stage.hooks.short": "git hooks",
  "cli.install.wizard.mcp-install": "MCP server install scope (global/local) [{defaultValue}]",
  "cli.install.wizard.execute.confirm": "Execute this install plan now? [Y/n]",
  "cli.install.wizard.outro": "Install plan accepted. Running Fabric install...",
  "cli.install.wizard.invalid-yes-no": "Please answer yes or no.",
  "cli.install.wizard.invalid-select": "Invalid value. Use one of: {options}.",
  "cli.install.wizard.cancelled": "Fabric install cancelled before execution.",
  "cli.install.capabilities.title": "Client capability summary",
  // C-006 (TASK-004): print a single one-line capability summary by default and
  // let the summary card lead the closing impression; the full 4×6 per-client
  // table only renders under --verbose. {count} = detected client count.
  "cli.install.capabilities.summaryLine": "Detected {count} client(s) and configured their capabilities (run with --verbose for the per-client table).",
  // v2.0.0-rc.37 NEW-22: post-install restart banner. The MCP server is
  // spawned by the client; already-running Claude Code / Codex
  // sessions won't pick up the new mcp config until they restart.
  "cli.install.restart-banner":
    "Restart hint: any already-running Claude Code / Codex CLI session must restart to pick up the new MCP server config; new sessions will autoload the Fabric tools.",
  "cli.install.next-steps":
    "Next steps — get your first value:\n" +
    "  1. Restart your AI client (Claude Code / Codex). It now auto-surfaces this project's knowledge to the assistant.\n" +
    "  2. Seed knowledge: just work normally — when you make a decision or hit a pitfall, the fabric-archive skill proposes an entry. Or run the fabric-archive skill's source mode to backfill from git history.\n" +
    "  3. Verify it works: ask your AI \"what does Fabric know about this repo?\", or run `fabric doctor` to check health.",
  "cli.install.store-bind-nudge":
    "💡 Mounted store(s) not bound to this project: {aliases}. Run `fabric store bind {first}` to read their knowledge here, then `fabric store switch-write {first}` to write team knowledge into it.",
  // C1/C5: semantic-search interactive copy routed through t().
  "cli.install.semantic.prompt": "Enable vector semantic search? (the first recall downloads an embedding model)",
  "cli.install.semantic.enabled": "Semantic search enabled (embed_enabled=true, embed_model={model}).",
  "cli.install.semantic.already-enabled": "Semantic search already enabled (embed_model={model}); {path} unchanged.",
  "cli.install.semantic.offer-install": "Install the optional embedder now? Runs `npm i -g fastembed` (a no-op if already installed).",
  "cli.install.semantic.installing": "Running `npm i -g fastembed` …",
  "cli.install.semantic.installed": "fastembed installed. The embedding model downloads automatically on the first recall (~tens–hundreds of MB; no KB data is uploaded).",
  "cli.install.semantic.install-failed": "Auto-install failed ({reason}). Run the steps manually:",
  "cli.install.semantic.manual-steps":
    "  1. Install the optional embedder where the MCP server resolves modules (a global install is global):\n" +
    "       npm i -g fastembed\n" +
    "  2. Warm the model cache (the first run downloads the weights, ~tens–hundreds of MB; no KB data is uploaded):\n" +
    "       export FABRIC_EMBED_CACHE_DIR=~/.cache/fabric-embed   # strict-offline: pre-place the weights here\n" +
    "  Note: after switching embed_model the existing vector dim/semantics change; the next recall re-embeds with the new model (doc vectors are cached by text and auto-recompute on mismatch).\n" +
    "  Disable: set embed_enabled=false in fabric.config.json.",
  // C5: store onboarding interactive copy routed through t().
  "cli.install.store.local-store": "local store",
  "cli.install.store.bind-mounted.prompt": "Bind an already-mounted knowledge store to this project?",
  "cli.install.store.setup.prompt": "Set up a knowledge store for this project?",
  "cli.install.store.setup.bind-label": "bind mounted: {alias}",
  "cli.install.store.setup.already-bound": "already bound to this project: {aliases} ✓",
  // W2 dual-slot (TASK-002): personal slot + team slot status / prompt copy. The
  // team slot is named by CATEGORY (team-class), and rows show the store's REAL
  // alias — the copy MUST NOT imply the store has to be aliased literally `team`
  // (KT-MOD-0001 naming-axis trap).
  "cli.install.store.slot.personal.status": "Personal store (machine-wide): '{alias}' ✓",
  "cli.install.store.slot.personal.absent": "Personal store (machine-wide): not set up yet",
  "cli.install.store.slot.personal.multi-none": "Personal store (machine-wide): {count} mounted, none active yet",
  "cli.install.store.slot.personal.multi-prompt": "Pick this machine's active personal store:",
  "cli.install.store.slot.personal.multi-active-label": "'{alias}' (current active)",
  "cli.install.store.slot.personal.multi-switch-label": "switch to '{alias}'",
  "cli.install.store.slot.personal.multi-new-label": "create a new local personal store",
  "cli.install.store.slot.personal.multi-new-hint": "a fresh empty personal store, set as active",
  "cli.install.store.slot.personal.new-alias": "alias for the new personal store:",
  "cli.install.store.slot.personal.switched": "active personal store switched to '{alias}'",
  "cli.install.store.slot.team.status": "Team store (team-class): '{alias}'{source} ✓",
  "cli.install.store.slot.team.empty": "Team store (team-class): none bound yet",
  "cli.install.store.slot.team.prompt": "Choose the team knowledge store (team-class) for this project:",
  "cli.install.store.slot.team.bound-label": "keep current: {alias}",
  "cli.install.store.slot.team.switch-label": "switch to mounted: {alias}",
  // flat-design store menu: "keep current" and "skip" are merged — when a team is
  // bound the SKIP row renders as keep-label (no change), otherwise as plain skip.
  "cli.install.store.slot.team.keep-label": "keep current: {alias} · no change",
  "cli.install.store.slot.team.keep-hint": "{source}stay on this team store; leave the binding unchanged",
  "cli.install.store.skip-label": "skip",
  "cli.install.store.bind-mounted.skip-hint": "leave mounted stores unbound for now",
  "cli.install.store.project-coordinate": "Project coordinate in store '{store}':",
  "cli.install.store.project-pick.prompt": "store '{store}' already serves other projects and none match this repo's git name — join an existing project or create a new one?",
  "cli.install.store.project-pick.join": "Join existing: {name} ({id})",
  "cli.install.store.project-pick.new": "➕ New project {id}",
  "cli.install.store.project-pick.new-name": "New project id (project coordinate):",
  "cli.install.store.bound-success": "bound store '{alias}' to this project and set it as the write target.",
  "cli.install.store.created-success": "created store '{alias}', bound it to this project, and set it as the write target.",
  "cli.install.store.onboard.prompt": "Set up a team / shared knowledge store for this project?",
  "cli.install.store.onboard.skip-hint": "personal store only (default)",
  "cli.install.store.onboard.join-label": "join existing",
  "cli.install.store.onboard.join-hint": "clone + bind a shared store from a git remote",
  "cli.install.store.onboard.create-label": "create new",
  "cli.install.store.onboard.create-hint": "start a fresh local store (optionally remote-backed)",
  "cli.install.store.onboard.join-url": "Shared store git remote (url):",
  "cli.install.store.onboard.alias": "Local alias for the new store:",
  "cli.install.store.onboard.remote": "Git remote to back it (optional - leave blank to skip):",
  "cli.install.store.unbound-note": "Note: The following stores are mounted but not bound to this project: {aliases}.",
  "cli.install.store.unbound-hint": "  Run 'fabric store bind {first}' to bind one.",
  // C4: personal store clone-or-new.
  // TASK-004: prefixed onto a first-install one-time prompt (language / personal
  // store onboarding) so the user knows these questions only appear at first setup.
  "cli.install.store.firstRunContext": "First-time setup — the following are one-time choices that appear only on first install:",
  "cli.install.store.personal.prompt": "No personal store on this machine yet. Create a fresh one, or clone your existing one from a remote?",
  "cli.install.store.personal.new-label": "create local (default)",
  "cli.install.store.personal.new-hint": "a fresh empty personal store",
  "cli.install.store.personal.clone-label": "clone existing",
  "cli.install.store.personal.clone-hint": "clone your backed-up personal store from a git remote",
  "cli.install.store.personal.clone-url": "Your personal store git remote (url):",
  "cli.install.store.personal.cloned-success": "cloned personal store from remote ({uuid}).",
  "cli.install.store.personal.clone-failed": "cloning the personal store failed ({reason}); falling back to a fresh local store.",
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
  "cli.install.next-step.message": "run fabric install --reapply --yes to refresh Fabric-managed hooks and client config.",
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
  "cli.install.errors.abort-existing": "ABORT: {path} already exists. fabric install is non-destructive.",
  "cli.install.diff.canonical": "Workspace already canonical ({count} files verified).",
  "cli.install.diff.applying-missing": "Applying {count} missing pieces: {files}",
  "cli.install.diff.drift-abort":
    "Drift detected in {path}. Run `fabric doctor` to inspect, or `fabric uninstall && fabric install` to reset.",
  "cli.install.diff.drift-abort.action-hint":
    "Inspect the drift with `fabric doctor`; if the managed files should be reset, run `fabric uninstall && fabric install`.",
  "cli.install.diff.state.missing": "missing",
  "cli.install.diff.state.present-canonical": "canonical",
  "cli.install.diff.state.drifted": "drifted",
  "cli.install.diff.state.user-modified": "user-modified",

  "cli.uninstall.description":
    "Uninstall Fabric from the target project (global stores under ~/.fabric/stores/ are never deleted)",
  "cli.uninstall.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.uninstall.args.debug.description": "Print target resolution details to stderr.",
  "cli.uninstall.args.yes.description": "Accept the current uninstall plan and run without the TTY wizard.",
  "cli.uninstall.args.verbose.description":
    "Show per-path detail counts for each stage instead of the condensed result line.",
  "cli.uninstall.args.unbind-store.description":
    "Also unbind this project from its team store (clears the binding in .fabric/fabric-config.json). The global store under ~/.fabric/stores/ is never deleted.",
  "cli.uninstall.args.dry-run.description":
    "Print the uninstall plan without removing files or running follow-up stages.",
  "cli.uninstall.plan.title": "Fabric uninstall plan",
  // C3: mirror install's phase banner ("Fabric install 将按 N 个阶段执行").
  "cli.uninstall.plan.phase-banner": "Fabric uninstall runs in {total} phases",
  "cli.uninstall.plan.target": "Target: {target}",
  // flat-design-system Wave5 (TASK-004 G3): the plan preview speaks human action
  // sentences, one per ENABLED stage, instead of the `key=yes/no` jargon line.
  "cli.uninstall.plan.will-remove": "Will remove:",
  "cli.uninstall.plan.will-keep": "Will keep:",
  "cli.uninstall.plan.action.bootstrap": "client skills & hook scripts",
  "cli.uninstall.plan.action.mcp": "MCP server registration",
  "cli.uninstall.plan.action.scaffold": "project scaffold files",
  "cli.uninstall.plan.action.store": "team store binding (this project)",
  "cli.uninstall.plan.detected": "Detected clients: {clients}",
  "cli.uninstall.plan.preserves": "Preserves:",
  "cli.uninstall.plan.preserves.stores": "global knowledge stores, never deleted by project uninstall",
  "cli.uninstall.plan.preview-title": "Fabric uninstall dry run",
  "cli.uninstall.plan.scaffold-entries.title": "Scaffold entries:",
  // W4: shared OutputRenderer pipeline — section bar title + per-stage labels,
  // the symmetric inverse of cli.install.pipeline.*.
  "cli.uninstall.pipeline.title": "Fabric Uninstall",
  "cli.uninstall.pipeline.label.bootstrap": "Skills & hooks",
  "cli.uninstall.pipeline.label.mcp": "MCP server",
  "cli.uninstall.pipeline.label.store": "Store unbind",
  "cli.uninstall.pipeline.label.scaffold": "Scaffold cleanup",
  "cli.uninstall.pipeline.label.validate": "Verify cleared",
  "cli.uninstall.stages.completed": "completed",
  "cli.uninstall.stages.completed-with-errors": "completed with errors",
  "cli.uninstall.stages.failed": "failed",
  "cli.uninstall.stages.failed-hint": "Check the error details above. Run with --debug for more information.",
  "cli.uninstall.stages.uptodate": "nothing to remove ({count} already absent)",
  "cli.uninstall.stages.summary": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.stages.removed-count": "{count} removed",
  // flat-design-system Wave5 (TASK-006 G3): human result words for the summary
  // card detail rows, symmetric with install's `{count} installed` / `up to date`.
  "cli.uninstall.stage.cleaned-count": "{count} cleaned",
  "cli.uninstall.summary.title": "Uninstall summary",
  "cli.uninstall.summary.body": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.healthcheck.title": "✓ Fabric already absent · nothing to remove",
  "cli.uninstall.wizard.intro": "Fabric uninstall",
  "cli.uninstall.wizard.select.prompt":
    "What should be removed from {target}? (space to toggle / enter to confirm; global knowledge stores under ~/.fabric/stores/ are never deleted)",
  "cli.uninstall.wizard.select.scaffold.label": "Scaffold artifacts",
  "cli.uninstall.wizard.select.scaffold.hint": "Scaffolded files under .fabric/",
  "cli.uninstall.wizard.select.bootstrap.label": "Skills & hooks",
  "cli.uninstall.wizard.select.bootstrap.hint": "Per-client skills and hook scripts + config",
  "cli.uninstall.wizard.select.mcp.label": "MCP client registration",
  "cli.uninstall.wizard.select.mcp.hint": "Un-register the fabric MCP server from clients",
  "cli.uninstall.wizard.select.store.label": "Unbind team store (this project)",
  "cli.uninstall.wizard.select.store.hint": "Clears this project's store binding; the global store is never deleted",
  "cli.uninstall.wizard.execute.confirm": "Execute this uninstall plan now? [Y/n]",
  "cli.uninstall.wizard.outro": "Uninstall plan accepted. Running Fabric uninstall...",
  "cli.uninstall.wizard.cancelled": "Fabric uninstall cancelled before execution.",
  "cli.uninstall.confirm.proceed": "Proceed with uninstalling Fabric from {target}? [y/N]",
  "cli.uninstall.errors.target-not-directory": "Target must be an existing directory: {path}",

  // v2.0.0-rc.37 Wave A2 Part 2: cli.serve.* + FABRIC_AUTH_TOKEN keys removed
  // alongside `fabric serve` quarantine to packages/server-http-experimental/
  // per [[fabric-serve-quarantine-not-delete]]. Restore from git history when
  // the web UI surface is re-enabled.

  // v2.0.0-rc.29 TASK-008 (BUG-L2): onboard-coverage i18n keys.
  "cli.onboard-coverage.description":
    "Report S5 onboard-slot coverage for the workspace. Used by the fabric-archive Skill's first-run phase to detect unclaimed project-tone slots.",
  "cli.onboard-coverage.args.json.description":
    "Emit machine-readable JSON to stdout instead of the human table.",
  "cli.onboard-coverage.args.target.description":
    "Override the project root (defaults to cwd).",

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

  // W3-05 (ISS-033): project-scoped command output (whoami / store /
  // scope-explain / sync / metrics) — previously hardcoded English, now
  // resolved via the project's fabric_language.
  "cli.cmd.no-global-config": "no global Fabric config — run `fabric install --global <url>` first",
  "cli.whoami.uid": "uid: {uid}",
  "cli.whoami.stores-none": "stores: (none mounted)",
  "cli.whoami.stores-label": "stores:",
  "cli.shared.local-only": "(local-only)",
  // `fabric info` (flat-design) — identity / status / recall titles + field labels.
  "cli.info.field.uid": "uid",
  "cli.info.identity.title": "Fabric Identity",
  "cli.info.status.title": "Project Status",
  "cli.info.status.group.machine": "This machine",
  "cli.info.status.group.project": "Current project",
  "cli.info.status.field.project": "project",
  "cli.info.status.field.mounted": "mounted stores",
  "cli.info.status.field.bound": "bound stores",
  "cli.info.status.value.unset": "(unset)",
  "cli.info.status.value.not-project": "(not a Fabric project)",
  "cli.info.status.value.no-global": "(no global config)",
  "cli.info.recall.title": "Recall Engine",
  "cli.info.recall.summary.on": "semantic search on — details: fabric info --recall",
  "cli.info.recall.summary.off": "keyword mode · semantic search off — details: fabric info --recall",
  "cli.info.recall.mode.additive": "additive (keyword mode)",
  "cli.info.recall.mode.rrf": "rrf (keyword + semantic)",
  "cli.info.recall.reason.forced-additive": "fixed to keyword mode (additive) by config",
  "cli.info.recall.reason.auto-additive": "vector channel not ready — auto-falls back to keyword mode",
  "cli.info.recall.reason.auto-rrf": "vector channel ready — blending keyword + semantic (rrf)",
  "cli.info.recall.reason.rrf-ready": "fixed to rrf by config; vector channel ready",
  "cli.info.recall.reason.rrf-warn":
    "fixed to rrf by config, but the vector channel is not ready — single-channel rrf is worse than keyword mode",
  "cli.info.recall.install-hint": "install it to enable semantic search: npm i -g fastembed",
  "cli.info.recall.field.fusion-config": "fusion (config)",
  "cli.info.recall.field.fusion-effective": "fusion (in use)",
  "cli.info.recall.field.embed-enabled": "embed enabled",
  "cli.info.recall.field.embed-model": "embed model",
  "cli.info.recall.field.fastembed": "fastembed pkg",
  "cli.info.recall.field.cache-dir": "model cache",
  "cli.info.recall.field.model-cached": "model cached",
  "cli.info.recall.field.vector": "vector channel",
  "cli.info.recall.fastembed.yes": "resolvable",
  "cli.info.recall.fastembed.no": "not installed (optional dep)",
  "cli.info.recall.cached.no": "not cached — downloads on first recall (or `fabric info --recall --warm`)",
  "cli.info.recall.vector.ready": "READY",
  "cli.info.recall.vector.not-ready": "not ready — recall falls back to keyword mode (BM25 / additive)",
  "cli.info.recall.warm.ok": "embedder warm: model '{model}' loaded (vector dim {dim}), cached at {dir}",
  "cli.info.recall.warm.fail":
    "embedder unavailable — the optional 'fastembed' package is not resolvable or the model failed to load.\n  Recall falls back to keyword mode (BM25 / additive). Install fastembed where the server resolves modules, then retry.",
  "cli.store.list.description": "List mounted knowledge stores",
  // Footer note appended to `fabric store --help` — explains where the advanced
  // (meta.hidden) operations went so the list-only listing isn't a dead end.
  "cli.store.help.folded-note":
    "Advanced operations (create / bind / switch-write / migrate, etc.) are folded — they're driven by fabric install and the fabric-store skill. Run `fabric store <command> --help` directly when you need one.",
  "cli.store.list.title": "Mounted stores",
  "cli.store.project.list.title": "Projects in store '{store}'",
  "cli.store.project.list.empty": "(no registered projects)",
  "cli.store.project.created": "registered project '{id}' in store '{store}'",
  "cli.store.migrate.title": "Knowledge scope migration",
  "cli.store.backfill.noop": "scope backfill: nothing to do ({count} already consistent)",
  "cli.store.backfill.summary": "scope backfill: {changed} updated, {unchanged} unchanged",
  "cli.store.backfill.scope-note":
    "{count} entries defaulted to semantic_scope: team. Demote project-specific ones with `fabric store migrate scope <store> --to project:<id> --id <id>`.",
  "cli.store.rescope.noop": "re-scope: nothing to do ({count} already at '{scope}')",
  "cli.store.rescope.summary": "re-scope → {scope}: {changed} updated, {unchanged} unchanged",
  "cli.store.rescope.refused": "{count} entries refused",
  "cli.store.reroot.noop": "reroot: nothing to relocate ({skipped} entries stay flat)",
  "cli.store.reroot.summary": "reroot: {moved} project entries relocated into knowledge/projects/<id>/",
  "cli.store.reroot.provenance-gap":
    "{count} moved via fs rename (untracked / non-git) — git blame history was NOT preserved for these",
  "cli.store.none-mounted": "(no stores mounted)",
  "cli.store.mounted": "mounted '{alias}' ({count} store(s) total)",
  "cli.store.created": "created store '{alias}' ({uuid}) at {dir}",
  "cli.store.created-local-hint":
    "(local-only — add a remote later with `git -C <storeDir> remote add origin <url>`)",
  "cli.store.no-alias": "no store aliased '{alias}'",
  "cli.store.detached": "detached '{alias}' — on-disk store tree left intact (detach ≠ delete)",
  "cli.store.bound": "bound required store '{id}' ({count} required)",
  "cli.store.switch-write": "active write store set to '{alias}' for this project",
  "cli.store.switch-personal": "active personal store set to '{alias}' for this machine",
  "cli.store.routed": "write route: scope '{scope}' → store '{alias}'",
  "cli.sync.deferred": "{count} store(s) offline — push deferred; re-run `fabric sync` when online",
  "cli.sync.paused":
    "sync paused on a conflict — resolve it, then run `fabric sync --continue` (or `--abort`)",
  // flat-design (spec §0.4): `fabric sync` command-level title + per-store rows +
  // aggregate summary. State labels are shared between the per-store rows and the
  // summary count cells.
  "cli.sync.args.continue.description": "Resume after resolving a rebase conflict",
  "cli.sync.args.abort.description": "Abort the conflicted store's rebase",
  "cli.sync.title": "Sync stores",
  "cli.sync.summary.title": "Sync summary",
  "cli.sync.none": "no remote-backed stores to sync",
  "cli.sync.all-synced": "all stores synced",
  "cli.sync.state.synced": "synced",
  "cli.sync.state.offline": "offline",
  "cli.sync.state.conflict": "conflict",
  "cli.sync.state.aborted": "aborted",
  "cli.sync.state.pending": "pending",
  "cli.metrics.invalid-since": '--since: invalid duration "{raw}" (expected e.g. 24h, 7d, 30m)',
  "cli.metrics.window": "Fabric metrics — window: {window}",
  "cli.metrics.window-all-time": "all-time",
  "cli.metrics.rows-range": "  rows: {count} ({start} → {end})",
  "cli.metrics.rows": "  rows: {count}",
  "cli.metrics.no-activity": "  (no counter activity in window — server may be idle or just started)",
  "cli.metrics.col.counter": "counter",
  "cli.metrics.col.total": "total",
  "cli.metrics.col.entry": "entry",
  "cli.metrics.section.perEntry": "Top per-entry consumed (knowledge_consumed:<id>)",

  // W3-09 (ISS-035): forensic project scan progress (stderr, TTY-only).
  "cli.install.scanning": "scanning project for client/framework signals…",
  "cli.install.scan-complete": "  project scan complete",

  // W4-11 (ISS-021): unified project-scan recommendations (cli forensic +
  // http scan share this single i18n-keyed set).
  "scan.rec.install":
    "Run `fabric install`, then bind/select a mounted knowledge store for decisions, pitfalls, guidelines, models, and processes.",
  "scan.rec.readme":
    "Expand README.md (project goal, run steps, no-touch zones) before promoting facts into Fabric knowledge.",
  "scan.rec.contributing":
    "Add CONTRIBUTING.md or capture contribution-flow guidance in a mounted store under knowledge/processes/.",
  "scan.rec.cocos.lifecycle":
    "Confirm the Cocos Creator Component lifecycle (onLoad/onEnable/start) ordering with the user.",
  "scan.rec.cocos.human-protect":
    "Ask whether assets/prefabs and assets/scenes are @HUMAN-protected zones.",
  "scan.rec.cocos.meta-lock":
    "`.meta` files detected — consider @HUMAN-locking them so the AI does not modify them.",
  "scan.rec.next": "Confirm app/pages routing boundaries and server-component constraints.",
  "scan.rec.vite":
    "Confirm the src/main entry, component directories, and build-script maintenance boundaries.",
  "scan.rec.unknown":
    "No framework marker detected — confirm the tech stack and main entry with the user first.",
  "scan.rec.generic":
    "Confirm the AGENTS.md layering boundaries around {kind}'s main entry and generated directories.",
};

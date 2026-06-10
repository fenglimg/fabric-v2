import type { Messages } from "../types.js";

export const enMessages: Messages = {
  "cli.main.description":
    "Fabric CLI — feeds your project's decisions, pitfalls & conventions to your AI assistant automatically, so it stops re-learning them every session.\n" +
    "\n" +
    "Three-step mental model:\n" +
    "  Install (装) - fabric install   one-shot project setup\n" +
    "  Configure (配) - fabric config  interactive configuration panel\n" +
    "  Maintain (跑) - fabric doctor   run target-state diagnostics\n" +
    "                 fabric sync      sync mounted knowledge stores\n" +
    "\n" +
    "Examples:\n" +
    "  fabric install                  install Fabric in the current project\n" +
    "  fabric config                   open the interactive configuration panel\n" +
    "  fabric doctor --fix             repair derived Fabric state\n" +
    "  fabric doctor --fix-knowledge   repair knowledge entry state\n" +
    "  fabric sync                     pull/rebase and push mounted stores\n" +
    "  fabric uninstall --dry-run      preview uninstall without removing files",
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
  "cli.shared.target-invalid.action-hint":
    "Choose an existing project directory, or create it before running the command again.",
  "cli.shared.template-not-found": "Template not found: {path}",
  "cli.shared.invalid-host-empty": "Invalid host: <empty>",
  "cli.shared.invalid-port": "Invalid port: {value}",
  "cli.shared.error": "Error",

  // EPIC-011: Grouped help display i18n keys
  "cli.help.group.setup.install": "Initialize Fabric in this repository",
  "cli.help.group.setup.config": "Configure Fabric settings",
  "cli.help.group.daily.sync": "Sync team knowledge with remote stores",
  "cli.help.group.daily.info": "Show project status",
  "cli.help.group.diagnostic.doctor": "Check Fabric health and repair issues",
  "cli.help.group.advanced.store": "Manage knowledge stores (see: fabric store --help)",
  "cli.help.group.advanced.whoami": "Show machine identity",
  "cli.help.group.advanced.whoami.deprecated": "deprecated → info --global",
  "cli.help.group.advanced.status": "Show project status",
  "cli.help.group.advanced.status.deprecated": "deprecated → info",
  "cli.help.group.advanced.scope-explain": "Explain scope",
  "cli.help.group.advanced.scope-explain.deprecated": "deprecated → info scope",

  // v2.1 hidden-command i18n keys cleanup: approve/bootstrap/hooks/human-lint/
  // ledger-append/pre-commit/scan/sync-meta/update commands removed from CLI
  // surface in v2.0.0-rc.18. Keys intentionally retained for backward compat
  // with external tooling that may still reference them. Remove in v2.2
  // if no external consumers surface.

  "cli.config.description":
    "Open the interactive Fabric configuration panel (language, knowledge layer, audit mode, hint windows, MCP client wiring, etc.).\n" +
    "\n" +
    "Examples:\n" +
    "  fabric config                   open the interactive panel\n" +
    "  fabric config --target /path    edit configuration for a specific project",
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

  // rc.16 TASK-006 (F1-panel): clack-driven `fabric config` interactive panel.
  // Keys consumed by packages/cli/src/commands/config.ts (menu loop +
  // per-field prompts) and by getPanelFields() (label_i18n_key references).
  "cli.config.intro": "Fabric Configuration",
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
  "cli.config.write.success": "Saved {key} = {value}",
  "cli.config.write.failure": "Failed to write fabric-config.json: {message}",
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

  "cli.doctor.description":
    "Run Fabric target-state diagnostics (meta sync, knowledge index, bootstrap, events ledger, human-lock drift).\n" +
    "\n" +
    "Examples:\n" +
    "  fabric doctor                   read-only diagnostics report\n" +
    "  fabric doctor --fix             repair derived state (meta + indexes)\n" +
    "  fabric doctor --fix-knowledge   apply lint mutations (demote / archive)\n" +
    "  fabric doctor --json            machine-readable output",
  "doctor.section.fixable": "Fixable errors:",
  "doctor.section.manual": "Manual errors:",
  "doctor.section.warnings": "Warnings:",
  "doctor.section.fix-knowledge-mutations": "Fix-knowledge mutations:",
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
    "Apply knowledge lint mutations: demote orphaned canonical entries, archive stale drafts, and bump drifted index counters. Default doctor run remains report-only.",
  "cli.doctor.args.yes.description":
    "Skip the --fix-knowledge safety confirm. Required for non-tty invocations unless FABRIC_NONINTERACTIVE=1 is set in the environment.",
  // rc.35 TASK-12 (P0-11): --verbose unfolds maintainer-audience hints.
  "cli.doctor.args.verbose.description":
    "Show all action hints including maintainer-audience ones (Fabric contributors editing the source tree). By default these are folded for npm end users.",
  "doctor.maintainer-hint-folded":
    "(maintainer-only remediation — re-run with `fabric doctor --verbose` to see)",
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
  "doctor.check.bootstrap_marker_migration.name": "Bootstrap marker migration",
  "doctor.check.bootstrap_marker_migration.ok":
    "No legacy fabric:knowledge-base markers detected in bootstrap target files.",
  "doctor.check.bootstrap_marker_migration.message.singular":
    "{count} file still carry the legacy fabric:knowledge-base bootstrap marker: {list}.",
  "doctor.check.bootstrap_marker_migration.message.plural":
    "{count} files still carry the legacy fabric:knowledge-base bootstrap marker: {list}.",
  "doctor.check.bootstrap_marker_migration.remediation":
    "Run `fabric doctor --fix` to migrate to fabric:bootstrap marker",
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
  "doctor.check.baseline_filename_format.name": "Baseline filename format",
  "doctor.check.baseline_filename_format.ok":
    "All baseline knowledge files use the canonical `${id}--${slug}.md` filename format.",
  "doctor.check.baseline_filename_format.message.singular":
    "{count} baseline knowledge file uses the deprecated bare-slug filename format and must be migrated to `${id}--${slug}.md`. First: {detail}.",
  "doctor.check.baseline_filename_format.message.plural":
    "{count} baseline knowledge files use the deprecated bare-slug filename format and must be migrated to `${id}--${slug}.md`. First: {detail}.",
  // v2.0.0-rc.33 W3-2 (T6 #5): reference the file names from the message so users can copy-paste rm targets rather than grep for them.
  "doctor.check.baseline_filename_format.remediation":
    "Manually rm the bare-slug baseline file(s) listed in the message (e.g. `rm <file from message>`). The baseline pipeline was removed in rc.23 and is no longer an auto-fix path.",
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
  "doctor.check.mcp_config_in_wrong_file.name": "Claude MCP config location",
  "doctor.check.mcp_config_in_wrong_file.message":
    ".claude/settings.json contains mcpServers.fabric — this file is for hooks/permissions only. Run --fix to remove it, then re-run fabric install to write .mcp.json.",
  "doctor.check.mcp_config_in_wrong_file.remediation":
    "Run `fabric doctor --fix` to remove mcpServers.fabric from .claude/settings.json, then run `fabric install` to write .mcp.json.",
  "doctor.check.mcp_config_in_wrong_file.ok":
    "mcpServers.fabric is not in .claude/settings.json.",
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
  // v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description structural lint. Proxy for trigger-recall (a live-LLM recall test requires a model — W1 ran gemini for that). This lint catches regression: missing description / >60 tokens / no Chinese trigger / no English trigger.
  "doctor.check.skill_description.name": "Skill description quality",
  "doctor.check.skill_description.ok":
    "All SKILL.md description fields are well-structured (non-empty, <60 tokens, bilingual triggers).",
  "doctor.check.skill_description.message.singular":
    "{count} SKILL.md description structural issue: {list}. The description field is the host's primary auto-invoke matching signal.",
  "doctor.check.skill_description.message.plural":
    "{count} SKILL.md description structural issues: {list}. The description field is the host's primary auto-invoke matching signal.",
  "doctor.check.skill_description.remediation":
    "Edit the `description:` field in `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter: (1) non-empty; (2) <60 tokens (chars/3 estimate, ~180 chars); (3) at least one Chinese trigger phrase; (4) at least one English trigger phrase. See W1 description rewrite style. Re-run `fabric install` to sync both client subtrees. For recall verification, run the W1 gemini delegate (see .workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md).",
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart pattern detection. Scans 7d of assistant_turn_observed events for 4 anti-patterns (G1 ritual / G2 dismissal abuse / G3 chained-from misuse / G5 placeholder cite). Warning severity — heuristics can false-positive; advisory only.
  "doctor.check.cite_goodhart.name": "Cite-policy Goodhart",
  "doctor.check.cite_goodhart.ok":
    "No cite-policy Goodhart patterns detected over the last 7 days.",
  "doctor.check.cite_goodhart.message.singular":
    "Detected {count} cite-policy Goodhart pattern: {list}.",
  "doctor.check.cite_goodhart.message.plural":
    "Detected {count} cite-policy Goodhart patterns: {list}.",
  "doctor.check.cite_goodhart.remediation":
    "Review the fired patterns: G1 ritual → the same id repeated as [recalled] suggests the KB should land into a contract instead; G2 dismissal abuse → > 60% of recalled cites used skip: bypasses contract enforcement, audit skip-reason validity; G3 chained-from misuse → chained-from tag with no commitment (operators=[] + skip_reason=null), add operators or use a different tag; G5 placeholder cite → too many bare 'KB: none' / [unspecified], prefer specific sentinels like [no-relevant] / [not-applicable]. For raw data, run `fabric doctor --cite-coverage --since=7d`.",
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog lint. rc.32 baseline showed 92% of entries stuck at draft, signaling a broken promote loop. Warns when > 50% draft (workspace must have >= 10 entries to compute the ratio — small corpora are noisy).
  "doctor.check.draft_backlog.name": "Knowledge draft backlog",
  "doctor.check.draft_backlog.ok":
    "draft-maturity entry ratio is healthy (< 50%, or workspace too small to compute).",
  "doctor.check.draft_backlog.message":
    "{draftCount}/{totalCount} ({pct}%) canonical knowledge entries are stuck at draft maturity — promote loop is broken (rc.32 baseline was 92%).",
  "doctor.check.draft_backlog.remediation":
    "Run `/fabric-review` to triage drafts: approve to promote to verified/proven, reject to drop, modify to fix. A long-standing draft backlog usually means archive produces drafts faster than review can promote them.",
  // rc.37 NEW-38: knowledge auto-promote (info surface; --fix applies).
  "doctor.check.draft_auto_promote.name": "Knowledge auto-promote",
  "doctor.check.draft_auto_promote.ok":
    "No settled drafts awaiting auto-promote (drafts are younger than 14 days or flagged drifted).",
  "doctor.check.draft_auto_promote.message":
    "{count} draft entries have settled for ≥14 days with no drift ({sample}{suffix}) — eligible for auto-promote to verified. Run `fabric doctor --fix` to apply.",
  "doctor.check.draft_auto_promote.remediation":
    "Run `fabric doctor --fix` to auto-promote these settled drafts to verified (drains draft_backlog); or run `/fabric-review` to triage each manually.",
  "doctor.check.draft_auto_promote.fixed":
    "Auto-promoted {count} settled draft entries → verified.",
  // rc.36 TASK-05 (P0-8): empty-tags ratio warn.
  "doctor.check.knowledge_tags_empty.name": "Knowledge tags coverage",
  "doctor.check.knowledge_tags_empty.ok":
    "empty-tag ratio is healthy (≤ 50%, or workspace too small to compute).",
  "doctor.check.knowledge_tags_empty.message":
    "{emptyCount}/{totalCount} ({pct}%) canonical knowledge entries have empty `tags:` — topical clustering and cross-entry retrieval degrade. The fabric-archive / fabric-import skills should produce 2-4 tags per entry.",
  "doctor.check.knowledge_tags_empty.remediation":
    "On the next archive/import run, populate `tags:` in the frontmatter with 2-4 kebab-case keywords. To backfill existing entries in bulk, use `/fabric-review` with the modify flow.",
  // rc.36 TASK-09 (P1-NEW1): drift_detected events unconsumed by demote.
  "doctor.check.drift_unconsumed.name": "Knowledge drift unconsumed",
  "doctor.check.drift_unconsumed.ok":
    "knowledge_drift_detected events in the last 30 days have been consumed by paired knowledge_demoted, or event volume is too low to compute.",
  "doctor.check.drift_unconsumed.message":
    "{driftCount} knowledge_drift_detected events in the last 30 days, but only {demoteCount} knowledge_demoted. Drift > demote by ≥ 5 means part of the drift is going unconsumed — KB slowly stales.",
  "doctor.check.drift_unconsumed.remediation":
    "Run `fabric doctor --fix` to trigger orphan-demote / stale-archive auto-heal, or invoke `/fabric-review` to manually triage drift-flagged entries.",
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
  "doctor.check.stable_id_collision.name": "Stable ID collision",
  "doctor.check.stable_id_collision.message.singular":
    "stable_id \"{stableId}\" is declared in {fileCount} files: {files}. Edit one of the knowledge files to use a unique stable_id.",
  "doctor.check.stable_id_collision.message.plural":
    "{count} stable_id collisions detected. First: \"{stableId}\" in {files}. Edit one of the knowledge files to use a unique stable_id.",
  // v2.0.0-rc.33 W3-2 (T6 #27): route through fabric-review modify so the canonical id allocator picks a fresh id (avoids hand-counter math).
  "doctor.check.stable_id_collision.remediation":
    "Run `/fabric-review modify <one of the colliding ids from the message>` to let the canonical id allocator reassign it (updates frontmatter + counters + historical cross-refs atomically). Do NOT hand-edit id frontmatter — it will desync counters.",
  "doctor.check.stable_id_collision.ok":
    "No declared stable_id collisions found in mounted store knowledge.",
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
  "doctor.check.preexisting_root_files.name": "Preexisting root markdown",
  "doctor.check.preexisting_root_files.ok": "No CLAUDE.md or AGENTS.md detected at project root.",
  "doctor.check.preexisting_root_files.message":
    "{files} detected at project root. These root files are not auto-loaded by Fabric MCP.",
  "doctor.check.preexisting_root_files.remediation":
    "Move knowledge content into a mounted store's `knowledge/{type}/` tree if you want it available in MCP responses.",
  "doctor.check.filesystem_edit_fallback.name": "Filesystem-edit fallback",
  "doctor.check.filesystem_edit_fallback.ok":
    "No orphan canonical knowledge entries detected; events.jsonl promotion trail is complete.",
  "doctor.check.filesystem_edit_fallback.message.synthesized.singular":
    "Synthesized {count} knowledge_promoted event for orphan canonical entries ({sample}{suffix}). Reason='{reason}'.",
  "doctor.check.filesystem_edit_fallback.message.synthesized.plural":
    "Synthesized {count} knowledge_promoted events for orphan canonical entries ({sample}{suffix}). Reason='{reason}'.",
  "doctor.check.filesystem_edit_fallback.remediation.synthesized":
    "These entries were moved into store knowledge/<type>/ outside fab_review.approve. The synthesized events restore audit-trail completeness.",
  "doctor.check.orphan_demote.name": "Knowledge orphan demote",
  "doctor.check.orphan_demote.ok":
    "No canonical knowledge entries exceed their maturity-keyed inactivity threshold.",
  "doctor.check.orphan_demote.message.singular":
    "{count} canonical knowledge entry exceeds their maturity-keyed inactivity threshold (proven={stableDays}d / verified={endorsedDays}d / draft={draftDays}d). First: {detail}.",
  "doctor.check.orphan_demote.message.plural":
    "{count} canonical knowledge entries exceed their maturity-keyed inactivity threshold (proven={stableDays}d / verified={endorsedDays}d / draft={draftDays}d). First: {detail}.",
  "doctor.check.orphan_demote.remediation":
    "Run `fabric doctor --fix-knowledge` to demote orphan entries one maturity tier.",
  "doctor.check.stale_archive.name": "Knowledge stale archive",
  "doctor.check.stale_archive.ok":
    "No draft knowledge entries exceed the additional stale-archive quiet window.",
  "doctor.check.stale_archive.message.singular":
    "{count} draft knowledge entry is stale beyond the demote+{additionalDays}d additional quiet window. First: {detail}.",
  "doctor.check.stale_archive.message.plural":
    "{count} draft knowledge entries are stale beyond the demote+{additionalDays}d additional quiet window. First: {detail}.",
  "doctor.check.stale_archive.remediation":
    "Run `fabric doctor --fix-knowledge` to move stale entries into `.fabric/.archive/<type>/`.",
  "doctor.check.pending_overdue.name": "Knowledge pending overdue",
  "doctor.check.pending_overdue.ok":
    "No pending knowledge entries exceed the 14-day review threshold.",
  "doctor.check.pending_overdue.message.singular":
    "{count} pending knowledge entry has been awaiting review for more than {thresholdDays} days. First: {detail}.",
  "doctor.check.pending_overdue.message.plural":
    "{count} pending knowledge entries have been awaiting review for more than {thresholdDays} days. First: {detail}.",
  "doctor.check.pending_overdue.remediation":
    "Review pending entries via the fabric-review Skill (`/fabric-review`) and approve, reject, defer, or modify.",
  "doctor.check.stable_id_duplicate.name": "Knowledge stable_id duplicate",
  "doctor.check.stable_id_duplicate.ok":
    "No canonical knowledge files share a stable_id across team / personal trees.",
  "doctor.check.stable_id_duplicate.message.singular":
    "{count} stable_id duplicated across canonical knowledge files (path-decoupled identity invariant). First: {detail}.",
  "doctor.check.stable_id_duplicate.message.plural":
    "{count} stable_ids duplicated across canonical knowledge files (path-decoupled identity invariant). First: {detail}.",
  // v2.0.0-rc.33 W3-2 (T6 #34): same as stable_id_collision — route through fabric-review modify so allocator handles the new id.
  "doctor.check.stable_id_duplicate.remediation":
    "Run `/fabric-review modify <one of the duplicate ids from the message>` to let the canonical id allocator assign a fresh `<prefix>-<type>-<counter>--<slug>.md` (renames the file + updates frontmatter + corrects counters in one shot).",
  "doctor.check.layer_mismatch.name": "Knowledge layer mismatch",
  "doctor.check.layer_mismatch.ok":
    "All canonical knowledge files are physically located under the layer their stable_id prefix declares.",
  "doctor.check.layer_mismatch.message.singular":
    "{count} canonical knowledge file are physically misaligned with their stable_id layer prefix (KT-* must live under team/, KP-* under personal/). First: {detail}.",
  "doctor.check.layer_mismatch.message.plural":
    "{count} canonical knowledge files are physically misaligned with their stable_id layer prefix (KT-* must live under team/, KP-* under personal/). First: {detail}.",
  // v2.0.0-rc.33 W3-2 (T6 #35): make the skill entry point explicit so users know how to invoke fabric-review.
  "doctor.check.layer_mismatch.remediation":
    "Move the file to the correct write-target store or run `/fabric-review modify <id from the message>` to flip its layer (which renames the stable_id prefix accordingly).",
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
    "Run the fabric-import Skill (`/fabric-import`) to backfill knowledge from git history and existing docs.",
  "doctor.check.narrow_no_paths.name": "Knowledge narrow without paths",
  "doctor.check.narrow_no_paths.ok":
    "No narrow-scope canonical entries have an empty relevance_paths array.",
  "doctor.check.narrow_no_paths.message.singular":
    "{count} narrow-scope canonical entry has an empty relevance_paths array (silent recall risk — narrow without anchors can never match a target path). First: {detail}.",
  "doctor.check.narrow_no_paths.message.plural":
    "{count} narrow-scope canonical entries have an empty relevance_paths array (silent recall risk — narrow without anchors can never match a target path). First: {detail}.",
  "doctor.check.narrow_no_paths.remediation":
    "Run `/fabric-review`, select the entry → modify to add path anchors to relevance_paths or widen relevance_scope to broad; or edit the entry frontmatter directly.",
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
  "doctor.check.personal_layer_path_misclassify.name": "Personal-layer path misclassify",
  "doctor.check.personal_layer_path_misclassify.ok":
    "No personal-layer entries declare relevance_paths that resolve against the current project.",
  "doctor.check.personal_layer_path_misclassify.message.singular":
    "{count} personal-layer entry declares relevance_paths that match files in the current project (personal layer should be project-agnostic). First: {detail}.",
  "doctor.check.personal_layer_path_misclassify.message.plural":
    "{count} personal-layer entries declare relevance_paths that match files in the current project (personal layer should be project-agnostic). First: {detail}.",
  "doctor.check.personal_layer_path_misclassify.remediation":
    "Use `fab_review.modify` with `layer: \"team\"` to flip the entry, or rewrite the relevance_paths so the anchors are project-agnostic (e.g. drop project-specific globs).",
  "doctor.check.suspicious_kb.name": "Suspicious KB injection",
  "doctor.check.suspicious_kb.ok":
    "No canonical knowledge bodies match known prompt-injection patterns.",
  "doctor.check.suspicious_kb.message.singular":
    "{count} canonical entry body contains tokens matching prompt-injection patterns (likely legacy pre-NEW-31 archive). First: {detail}.",
  "doctor.check.suspicious_kb.message.plural":
    "{count} canonical entry bodies contain tokens matching prompt-injection patterns (likely legacy pre-NEW-31 archive). First: {detail}.",
  "doctor.check.suspicious_kb.remediation":
    "Review the flagged entries — use `fab_review.modify` to scrub the injection tokens from the body, or `fab_review.reject` to archive entries that should not have been canonicalised.",
  "doctor.check.narrow_too_few.name": "Knowledge narrow too few",
  "doctor.check.narrow_too_few.ok":
    "Narrow-with-paths ratio {ratioPct}% ({narrowCount}/{totalCount}); {teleNote}.",
  "doctor.check.narrow_too_few.message.telemetry_skipped":
    "telemetry skipped (no edit-counter fires in window)",
  "doctor.check.narrow_too_few.message.telemetry_window":
    "silence rate {silencePct}% over {windowDays}d",
  "doctor.check.narrow_too_few.message.structural":
    "narrow-with-paths share {ratioPct}% ({narrowCount}/{totalCount}) below {thresholdPct}% threshold",
  "doctor.check.narrow_too_few.message.telemetry":
    "narrow-hook silence rate {silencePct}% ({silenceFires}/{totalFires}) over {windowDays}d above {thresholdPct}% threshold",
  "doctor.check.narrow_too_few.message.summary":
    "Narrow-scope KB coverage is below the useful floor: {parts}.",
  "doctor.check.narrow_too_few.remediation":
    "Run the fabric-import Skill (`/fabric-import`) to re-seed narrow anchors against the current codebase.",
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
  "doctor.check.relevance_fields_missing.name": "Knowledge relevance fields missing",
  "doctor.check.relevance_fields_missing.ok":
    "All pending entries declare both relevance_scope and relevance_paths.",
  "doctor.check.relevance_fields_missing.message.singular":
    "{count} pending entry is missing relevance_scope and/or relevance_paths in frontmatter. First: {detail}.",
  "doctor.check.relevance_fields_missing.message.plural":
    "{count} pending entries are missing relevance_scope and/or relevance_paths in frontmatter. First: {detail}.",
  "doctor.check.relevance_fields_missing.remediation":
    "Run `fabric doctor --fix-knowledge` to back-fill the schema defaults (relevance_scope: broad, relevance_paths: []).",
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
  "doctor.check.hooks_runtime.ok.skipped": "No installed hook files found under .claude/hooks/ / .codex/hooks/ / .cursor/hooks/; skipping hooks_runtime check.",
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
    "Scanned {count} hook copies; sha256 of every basename matches across .claude / .codex / .cursor.",
  "doctor.check.hooks_content_drift.message":
    "{count} hook basename(s) drift across clients; first: {first_basename} (involves {first_clients}). `fabric install` copies the same template to all three clients — drift usually comes from manual edits.",
  "doctor.check.hooks_content_drift.remediation":
    "Run `fabric install` to restore each client's hook copy to the canonical template. If you actually need client-specific behavior, modify a shared lib/ helper or templates/hooks/configs/ wiring instead of editing the installed .cjs in place.",
  // rc.31 BUG-G2/G5: promote-ledger invariant check.
  "doctor.check.promote_ledger_invariant.name": "Promote ledger invariant",
  "doctor.check.promote_ledger_invariant.ok":
    "knowledge_proposed={proposed} >= knowledge_promote_started={started} >= knowledge_promoted={promoted}; ledger invariant holds.",
  "doctor.check.promote_ledger_invariant.message.proposed-lt-started":
    "knowledge_proposed={proposed} is less than knowledge_promote_started={started} (ledger invariant violated; some pending entries were approved without going through fab_extract_knowledge, so no propose event was emitted for them).",
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
    "Run `fabric store backfill-scope` to add missing semantic_scope/visibility_store; `fabric store re-scope` to fix a dangling project: coordinate; move any personal-scope entry out of a shared store (personal knowledge lives only in your personal store, R5#3).",
  // project-scope binding backfill lint (unbound_project).
  "doctor.check.unbound_project.name": "Project-scope binding",
  "doctor.check.unbound_project.ok":
    "The bound write store carries a project coordinate (project_id + active_project), so project-scope recall/writes route correctly.",
  "doctor.check.unbound_project.message":
    "Store '{alias}' is bound as the write target but the project coordinate is incomplete (missing {missing}); project-scope recall/writes fall back to team scope.",
  "doctor.check.unbound_project.remediation":
    "Run `fabric doctor --fix` to backfill the project binding (mints project_id, registers the project in the store, sets active_project). Idempotent — a second run is a no-op.",
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
    "Install Fabric in the target project (scaffold .fabric/, bootstrap templates, MCP client wiring, git hooks).\n" +
    "\n" +
    "Examples:\n" +
    "  fabric install                  interactive install in the current project\n" +
    "  fabric install --yes            accept defaults, skip the TTY wizard\n" +
    "  fabric install --dry-run        preview the install plan without writing files",
  "cli.install.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.install.args.debug.description": "Print target resolution details to stderr.",
  "cli.install.args.yes.description": "Accept the current install plan and run without the TTY wizard",
  "cli.install.args.dry-run.description": "Print the install plan without writing files or running follow-up stages",
  "cli.install.args.enable-embed.description":
    "Opt in to vector semantic search (sets embed_enabled + embed_model; prints fastembed install steps)",
  "cli.install.args.embed-model.description":
    "With --enable-embed: override the pinned embed model (default fast-bge-small-zh-v1.5)",
  // rc.35 TASK-08 (P0-5/6): --force-skills-only.
  "cli.install.args.force-skills-only.description":
    "Skip bootstrap / MCP / hooks / settings; refresh ONLY the fabric Skill template copies (.claude/.codex/.cursor/skills/*).",
  "cli.install.force-skills-only.banner": "Refreshing fabric Skill templates only",
  "cli.install.force-skills-only.uninitialised.message":
    "fabric install --force-skills-only: project is not initialised (.fabric/agents.meta.json is missing).",
  "cli.install.force-skills-only.uninitialised.hint":
    "Run `fabric install` (without --force-skills-only) first to lay down the base scaffold, then re-run with --force-skills-only for subsequent Skill refreshes.",
  "cli.install.force-skills-only.summary": "Skills refresh complete — written: {written}, skipped: {skipped}, errors: {errors}",
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only.
  "cli.install.args.force-hooks-only.description":
    "Skip bootstrap / MCP / skills / settings; only refresh fabric hook scripts + per-client hook config merges (.claude/.codex/.cursor/hooks/*).",
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
  "cli.install.wizard.mcp-install": "MCP server install scope (global/local) [{defaultValue}]",
  "cli.install.wizard.execute.confirm": "Execute this install plan now? [Y/n]",
  "cli.install.wizard.outro": "Install plan accepted. Running Fabric install...",
  "cli.install.wizard.invalid-yes-no": "Please answer yes or no.",
  "cli.install.wizard.invalid-select": "Invalid value. Use one of: {options}.",
  "cli.install.wizard.cancelled": "Fabric install cancelled before execution.",
  "cli.install.capabilities.title": "Client capability summary",
  // v2.0.0-rc.37 NEW-22: post-install restart banner. The MCP server is
  // spawned by the client; already-running Claude Code / Cursor / Codex
  // sessions won't pick up the new mcp config until they restart.
  "cli.install.restart-banner":
    "Restart hint: any already-running Claude Code / Cursor / Codex CLI session must restart to pick up the new MCP server config; new sessions will autoload the Fabric tools.",
  "cli.install.next-steps":
    "Next steps — get your first value:\n" +
    "  1. Restart your AI client (Claude Code / Cursor / Codex). It now auto-surfaces this project's knowledge to the assistant.\n" +
    "  2. Seed knowledge: just work normally — when you make a decision or hit a pitfall, the fabric-archive skill proposes an entry. Or run the fabric-import skill to backfill from git history.\n" +
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
    "Uninstall Fabric from the target project. Global knowledge stores under ~/.fabric/stores/ are never deleted by project uninstall.\n" +
    "\n" +
    "Examples:\n" +
    "  fabric uninstall                interactive uninstall in the current project\n" +
    "  fabric uninstall --yes          accept defaults, skip the TTY wizard\n" +
    "  fabric uninstall --dry-run      preview the uninstall plan without removing files",
  "cli.uninstall.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.uninstall.args.debug.description": "Print target resolution details to stderr.",
  "cli.uninstall.args.yes.description": "Accept the current uninstall plan and run without the TTY wizard.",
  "cli.uninstall.args.dry-run.description":
    "Print the uninstall plan without removing files or running follow-up stages.",
  "cli.uninstall.plan.title": "Fabric uninstall plan",
  // C3: mirror install's phase banner ("Fabric install 将按 N 个阶段执行").
  "cli.uninstall.plan.phase-banner": "Fabric uninstall runs in {total} phases",
  "cli.uninstall.plan.target": "Target: {target}",
  "cli.uninstall.plan.actions":
    "Plan: scaffold={scaffold} bootstrap={bootstrap} mcp={mcp}",
  "cli.uninstall.plan.detected": "Detected clients: {clients}",
  "cli.uninstall.plan.preserves": "Preserves:",
  "cli.uninstall.plan.preserves.stores": "global knowledge stores, never deleted by project uninstall",
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
  "cli.uninstall.wizard.select.prompt":
    "What should be removed from {target}? (space to toggle / enter to confirm; global knowledge stores under ~/.fabric/stores/ are never deleted)",
  "cli.uninstall.wizard.select.scaffold.label": "Scaffold artifacts",
  "cli.uninstall.wizard.select.scaffold.hint": "Scaffolded files under .fabric/",
  "cli.uninstall.wizard.select.bootstrap.label": "Bootstrap (Skills + hooks)",
  "cli.uninstall.wizard.select.bootstrap.hint": "Per-client skills and git hooks",
  "cli.uninstall.wizard.select.mcp.label": "MCP client registration",
  "cli.uninstall.wizard.select.mcp.hint": "Un-register the fabric MCP server from clients",
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
  "cli.store.none-mounted": "(no stores mounted)",
  "cli.store.mounted": "mounted '{alias}' ({count} store(s) total)",
  "cli.store.created": "created store '{alias}' ({uuid}) at {dir}",
  "cli.store.created-local-hint":
    "(local-only — add a remote later with `git -C <storeDir> remote add origin <url>`)",
  "cli.store.no-alias": "no store aliased '{alias}'",
  "cli.store.detached": "detached '{alias}' — on-disk store tree left intact (detach ≠ delete)",
  "cli.store.bound": "bound required store '{id}' ({count} required)",
  "cli.store.switch-write": "active write store set to '{alias}' for this project",
  "cli.sync.deferred": "{count} store(s) offline — push deferred; re-run `fabric sync` when online",
  "cli.sync.paused":
    "sync paused on a conflict — resolve it, then run `fabric sync --continue` (or `--abort`)",
  "cli.metrics.invalid-since": '--since: invalid duration "{raw}" (expected e.g. 24h, 7d, 30m)',
  "cli.metrics.window": "Fabric metrics — window: {window}",
  "cli.metrics.window-all-time": "all-time",
  "cli.metrics.rows-range": "  rows: {count} ({start} → {end})",
  "cli.metrics.rows": "  rows: {count}",
  "cli.metrics.no-activity": "  (no counter activity in window — server may be idle or just started)",

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

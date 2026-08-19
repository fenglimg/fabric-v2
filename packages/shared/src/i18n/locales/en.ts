import type { Messages } from "../types.js";

export const enMessages: Messages = {
  "cli.signpost.retired":
    "Command `{retired}` was removed. Use `{successor}` instead.",
  "cli.doctor.args.probe.description":
    "Emit a machine-readable JSON readiness snapshot (first-hit + store/hooks) without running --fix Prefer --probe in CI for a cheap readiness snapshot; full cite-coverage scans remain on-demand.",
  "cli.main.description":
    "Fabric CLI — feeds your project's decisions, pitfalls & conventions to your AI assistant automatically. First time? Run: fabric install",
  "cli.shared.skipped": "Skipped",
  "cli.shared.yes": "yes",
  "cli.shared.no": "no",
  "cli.shared.none": "none",

  // flat-design-system Wave4 (TASK-004): gutter-free ✓/x receipt printed after a
  // clack control (select/multiselect/confirm/text) resolves. The clack control
  // stays native (C-006); the receipt is a separate flat line.
  "cli.prompt.receipt.selected": "Selected",
  "cli.prompt.receipt.set": "Set",
  "cli.prompt.receipt.cancelled": "Cancelled",
  "cli.shared.target-invalid": "Target must be an existing directory: {target}",
  "cli.shared.error": "Error",

  // Top-level command summaries (one concise line each — citty renders these in
  // the root `fabric --help` COMMANDS table AND as the header of each command's
  // own `--help`, so they MUST stay single-line; verbose example blocks were
  // removed when the bespoke grouped help retired in favour of citty's renderer).
  "cli.store.description":
    "Manage mounted knowledge stores (setup via fabric install)",
  "cli.sync.description":
    "Sync mounted knowledge stores (pull --rebase + push)",
  "cli.info.description":
    "Show Fabric identity, project status & recall health",
  "cli.inspect.description": "Show what Fabric injects at SessionStart",
  // `fabric inspect` arg descriptions + --explain provenance overlay + error.
  "cli.inspect.arg.render":
    "Which sink to show: 'human' (systemMessage) or 'ai' (additionalContext). Default: both.",
  "cli.inspect.arg.explain":
    "Append a per-entry provenance section (id · type · maturity · scope · why-surfaced).",
  "cli.inspect.arg.target":
    "Override the project root (defaults to cwd / dev-mode resolution).",
  "cli.inspect.explain.title": "explain · provenance (not injected)",
  "cli.inspect.explain.always": "always-active · body injected",
  "cli.inspect.explain.reference": "reference · read on demand",
  "cli.inspect.explain.census": "census",
  "cli.inspect.explain.census-total": "total {total}",
  "cli.inspect.error": "inspect failed: {message}",

  // `fabric preview` — local read-only knowledge preview web server (loopback-only).
  "cli.preview.description":
    "Start a local read-only knowledge preview (browse in your browser, grouped by scope)",
  "cli.preview.arg.port": "Port to listen on (default 7777).",
  "cli.preview.arg.open":
    "Open the browser on start (default on; use --no-open to disable).",
  "cli.preview.arg.target": "Override the project root (defaults to cwd).",
  "cli.preview.arg.all":
    "Show knowledge from every mounted store (bypass this project's read-set; default shows only this project).",
  // Console config page chrome. Delivered through `/api/config` rather than
  // hard-coded in the template so the page follows the machine-wide `language`
  // the same way the CLI does.
  "cli.console.config.title": "Configuration",
  "cli.console.config.intro":
    "How Fabric is configured on this machine. Settings live in ~/.fabric and do not depend on which directory you opened the console from.",
  "cli.console.config.machine.title": "Machine defaults",
  "cli.console.config.machine.intro": "Every project that has no setting of its own uses these.",
  "cli.console.config.projects.title": "Per-project settings",
  "cli.console.config.projects.intro":
    "Only the values that DIFFER from the defaults are listed; everything else is inherited from above.",
  "cli.console.config.projects.empty": "No projects are registered on this machine yet.",
  "cli.console.config.projects.empty-hint":
    "Registration happens during fabric install. Repos installed before that feature will not appear on their own — re-run fabric install in each one.",
  "cli.console.config.projects.current": "current",
  "cli.console.config.projects.no-overrides": "all defaults inherited",
  "cli.console.config.projects.override-count": "{count} differ from the defaults",
  "cli.console.config.projects.add": "Set one value for this project",
  "cli.console.config.projects.add-placeholder": "Pick a setting…",
  "cli.console.config.projects.unbound":
    "No knowledge base bound, so this project has no id — a per-project value cannot be stored. Run fabric store bind first.",
  "cli.console.config.projects.unregistered":
    "not registered (installed by an older version, or the repo has moved)",
  "cli.console.config.projects.stale": "the registered path no longer exists",
  "cli.console.config.projects.inherited": "inherited",
  "cli.console.config.stores.title": "Per knowledge base",
  "cli.console.config.stores.intro":
    "Properties of a knowledge base itself. They travel with the store and are shared by the whole team, so they belong to no single project.",
  "cli.console.config.stores.empty": "No knowledge bases are mounted.",
  "cli.console.config.stores.personal": "personal",
  "cli.console.config.group.A_locale": "Language and scope",
  "cli.console.config.group.B_hint_threshold": "Reminder thresholds",
  "cli.console.config.group.C_audit": "Audit",
  "cli.console.config.group.D_behavior": "Behaviour",
  "cli.console.config.search": "Search settings",
  "cli.console.config.search-empty": "No setting matches \u201c{q}\u201d.",
  "cli.console.config.advanced.title": "Advanced",
  "cli.console.config.advanced.intro":
    "Settings whose consequences you need to know before changing them. The defaults suit most cases.",
  "cli.console.config.advanced.count": "{count} settings",
  "cli.console.config.modified": "Set here; no longer follows the layer below",
  "cli.console.config.reset": "Reset to default",
  "cli.console.config.reset-done": "Removed from {target}; the layer below decides again.",
  "cli.console.config.preset.title": "Reminder frequency",
  "cli.console.config.preset.intro":
    "Sets eight reminder thresholds together. The active option is derived from those eight values; no option name is stored.",
  "cli.console.config.preset.custom": "Custom",
  "cli.console.config.preset.custom-hint":
    "These eight values do not match any option exactly. Each one is listed under Advanced below.",
  "cli.console.config.preset.relaxed": "Relaxed",
  "cli.console.config.preset.standard": "Standard",
  "cli.console.config.preset.attentive": "Attentive",
  "cli.console.config.preset.applied": "Applied {count} settings from \u201c{name}\u201d.",
  "cli.console.config.preset.partial": "{count} settings could not be written: {keys}. The rest took effect.",
  "cli.console.config.save": "Save",
  "cli.console.config.saved": "Saved to {target}.",
  "cli.console.config.save-failed": "Could not save: {reason}",
  // The strong claim is reserved for the launch directory's own project — the one
  // process environment the console actually observes. Other projects read these
  // variables in their own hook / MCP processes, which we cannot see.
  "cli.console.config.env-locked":
    "This console process sees {name} set; a client carrying the same variable reads that value, and editing a config file will not change it.",
  "cli.console.config.env-available": "can be overridden by {name}",
  "cli.console.config.loading": "Reading configuration…",
  "cli.console.config.load-failed": "Could not read configuration",
  "cli.console.config.remote.title": "Remote embedding",
  "cli.console.config.remote.off": "Off — recall ranks locally.",
  "cli.console.config.remote.on": "On — embeddings are computed at {host}.",
  "cli.console.config.remote.key-set": "API key set (never shown here)",
  "cli.console.config.remote.key-missing":
    "No API key — recall falls back to text-only ranking",
  "cli.preview.port-fallback":
    "Port {requested} was busy — using {actual} instead.",
  "cli.preview.started": "Knowledge preview started: {url}",
  "cli.preview.opening": "Opening browser…",
  "cli.preview.stop-hint": "Press Ctrl-C to stop.",
  "cli.preview.stopped": "Preview stopped.",
  "cli.preview.error": "preview failed: {message}",
  "cli.audit.description":
    "Knowledge & telemetry audit (cite/conflicts/history/metrics)",

  // `fabric audit cite` — 0%-recall-coverage self-diagnosis hints.
  "cli.audit.cite.recall-mismatch-hint":
    "recall coverage is 0 despite {recalls} recall(s) across {sessions} session(s) — none shared a session with an edit. Likely causes: (1) fab_recall omitted/wrong session_id (must be real client session_id; empty planned events never join edits); (2) recall paths do not path-overlap the edited file (auto-cite only counts overlapping planned.target_paths). Fix: pass session_id, reinstall hooks for active-session sidecar, or fab_recall paths that cover the edit. See AGENTS.md + docs/UPGRADE.md.",
  "cli.audit.cite.recall-none-hint":
    "recall coverage is 0 — no in-session fab_recall preceded these edits (or planned events had empty session_id so they could not join). Recall before editing with the real client session_id; after install, SessionStart stamps .fabric/.cache/active-session.json as server fallback. Path-overlap still required: recall the files you will edit, not only unrelated .fabric paths. See AGENTS.md + docs/UPGRADE.md.",

  // `fabric audit --help` — filtered help (i18n'd subcommand listing).
  "cli.audit.help.tagline": "Knowledge & telemetry audit surfaces (read-only)",
  "cli.audit.help.sub.cite": "Cite-policy adherence report",
  "cli.audit.help.sub.conflicts": "Knowledge-conflict lint",
  "cli.audit.help.sub.history":
    "Maintenance history rollup (archive | fix | all)",
  "cli.audit.help.sub.descriptions":
    "Back-fill description-grade frontmatter fields",
  "cli.audit.help.sub.retired":
    "Scan agent surfaces for retired tool/field references",
  "cli.audit.help.sub.why": "Diagnose why a knowledge entry isn't surfacing",
  "cli.audit.help.example.cite": "cite-coverage over the last 7 days",
  "cli.audit.help.example.conflicts":
    "scan for conflicting / duplicate entries",
  "cli.audit.help.footer":
    "Run `fabric audit <subcommand> --help` for per-command flags.",

  // `fabric audit retired` — flat renderer copy.
  "cli.audit.retired.skipped":
    "Retired-reference scan skipped — no agent-consumed surfaces found.",
  "cli.audit.retired.clean":
    "No retired references — scanned {count} agent surface(s).",
  "cli.audit.retired.found":
    "{hits} retired reference(s) across {files} scanned file(s)",
  "cli.audit.retired.removed": "(removed)",

  // `fabric audit why-not-surfaced <id>` — three-axis diagnosis (store / scope / timing).
  "cli.audit.why.not-found":
    "'{id}' not found in any mounted store. Check the id (try `fabric store list`).",
  "cli.audit.why.deprecated":
    "'{id}' is retired (deprecated: true), so it no longer surfaces — recall filters it out of every surfacing channel.",
  "cli.audit.why.deprecated.superseded":
    "'{id}' is retired (deprecated: true, superseded_by: {superseded}), so it no longer surfaces — recall filters it out of every surfacing channel.",
  "cli.audit.why.deprecated.hint":
    "retirement is a soft delete: the entry stays on disk and audit tooling still sees it. To restore it, remove the deprecated key from frontmatter.",
  "cli.audit.why.store-unbound":
    "'{id}' lives in store '{store}', which is NOT bound to this project.",
  "cli.audit.why.store-unbound.hint": "bind it: fabric store bind {store}",
  "cli.audit.why.project-mismatch":
    "'{id}' is scoped to '{scope}', but this repo is bound to 'project:{project}'.",
  "cli.audit.why.project-mismatch.hint":
    "it surfaces only in repos bound to '{scope}' (semantic_scope axis).",
  "cli.audit.why.narrow-timing":
    "'{id}' is relevance_scope=narrow — it surfaces via the PreToolUse hint when you EDIT a matching file, not at SessionStart.",
  "cli.audit.why.narrow-timing.hint":
    "broad entries are the always-on spine; narrow ones are edit-time only (timing axis).",
  "cli.audit.why.maturity-draft":
    "'{id}' is maturity={maturity} — a draft guideline/model is a PROPOSAL, so it is kept out of the always-active SessionStart rules.",
  "cli.audit.why.maturity-draft.hint":
    "it is still reachable via fab_recall and the edit-time hint; promote it (fab_review modify maturity: verified) to make it resident.",
  "cli.audit.why.should-surface":
    "'{id}' should be surfacing — store '{store}' bound, scope matches, relevance_scope=broad.",
  "cli.audit.why.should-surface.hint":
    "if it isn't, the SessionStart snapshot may be stale: start a fresh session or re-run `fabric install`.",

  // `fabric info --help` — flag + scope-subcommand descriptions.
  "cli.info.args.global.description":
    "Show global identity (whoami) instead of project status",
  "cli.info.args.recall.description":
    "Show recall-engine detail (fusion strategy + embedding state)",
  "cli.info.args.warm.description":
    "With --recall: load the embedder now (downloads the model to ~/.fabric/cache/embed on first run)",
  "cli.info.args.json.description":
    "Emit machine-readable JSON instead of text",
  "cli.info.scope.description":
    "(advanced/skill) Resolve a scope coordinate's read-set + write target as JSON",
  "cli.info.scope.args.coord.description":
    "Scope coordinate (e.g. team, project:x, personal)",
  "cli.info.scope.args.json.description":
    "Emit machine-readable JSON (scope always emits JSON)",
  "cli.info.projects.description":
    "List every project on this machine that has Fabric installed, with its version",
  "cli.info.projects.args.json.description":
    "Emit machine-readable JSON instead of text",
  "cli.info.projects.empty":
    "No projects registered yet. Run `fabric install` inside a project to register it.",
  "cli.info.projects.title": "Registered projects",
  "cli.info.projects.stale": "path missing",
  "cli.info.projects.stale-note":
    "Projects marked as having a missing path were moved or deleted; re-run `fabric install` at the new location to update the entry.",

  // v2.1 hidden-command i18n keys cleanup: approve/bootstrap/hooks/human-lint/
  // ledger-append/pre-commit/scan/sync-meta/update commands removed from CLI
  // surface in v2.0.0-rc.18. Keys intentionally retained for backward compat
  // with external tooling that may still reference them. Remove in v2.2
  // if no external consumers surface.

  "cli.config.description":
    "Open the interactive Fabric configuration panel (language, knowledge layer, audit mode, MCP client wiring, etc.)",
  "cli.config.args.target.description":
    "Target project directory (defaults to cwd).",
  "cli.config.errors.expected-object": "Expected object in {path}",

  // rc.16 TASK-006 (F1-panel): clack-driven `fabric config` interactive panel.
  // Keys consumed by packages/cli/src/commands/config.ts (menu loop +
  // per-field prompts) and by getPanelFields() (label_i18n_key references).
  "cli.config.intro": "Fabric Configuration",
  // flat-design-system Wave5 (TASK-005): B-横线 title above the flat key/value
  // panel printed before the clack edit menu.
  "cli.config.outro": "Configuration saved.",
  "cli.config.outro-no-changes": "No changes made.",
  "cli.config.cancel": "Cancelled.",
  "cli.config.non-tty-notice":
    "fabric config requires an interactive terminal. Run it from a TTY to edit configuration fields.",
  "cli.config.menu.field-select": "Select a field to edit:",
  "cli.config.menu.exit": "Exit",
  "cli.config.value.current": "current: {value}",
  "cli.config.value.default-marker": "(default)",
  // config-single-home W6: which layer supplied the value. The same key can be
  // set machine-wide, per-project, or by the team store — naming the source is
  // what explains "why does this repo resolve a different value".
  // The env layer only exists for the keys in PANEL_ENV_OVERRIDES; a field
  // tagged with it cannot be changed by editing a config file, which is the
  // whole reason the source is worth naming.
  "cli.config.source.env": "environment",
  "cli.config.source.project": "this project",
  "cli.config.source.defaults": "machine-wide",
  "cli.config.source.store": "team store",
  "cli.config.source.global": "global",
  "cli.config.source.default": "built-in",
  // config-single-home W8: a cadence profile settles "how loud + how eagerly it
  // asks to archive + how long a review backlog may sit" in one choice — those
  // four keys always move together.
  "cli.config.profile.label": "Cadence profile",
  "cli.config.profile.prompt": "Pick a cadence profile (sets 4 keys at once)",
  "cli.config.profile.custom": "custom",
  "cli.config.profile.quiet": "quiet",
  "cli.config.profile.quiet.description":
    "stays out of the way; you decide when to archive",
  "cli.config.profile.standard": "standard",
  "cli.config.profile.standard.description":
    "the shipped cadence: one status line per session, archive prompts in batches",
  "cli.config.profile.coach": "coach",
  "cli.config.profile.coach.description":
    "asks often — for a young knowledge base you don't want leaking experience",
  "cli.config.prompt.select":
    "Choose a new value for {key} (current: {current}):",
  "cli.config.prompt.text": "Enter a new value for {key} (current: {current}):",
  "cli.config.panel.edited": "Edited this session ({count}): {keys}",
  "cli.config.write.failure": "Failed to write fabric-config.json: {message}",
  "cli.config.slot.errors.missing":
    "Missing required <slot> argument. Valid slots: {slots}.",
  "cli.config.slot.errors.unknown":
    'Unknown slot "{slot}". Valid slots: {slots}.',
  "cli.config.slot.dismiss.already": 'Slot "{slot}" already opted out; no-op.',
  "cli.config.slot.dismiss.done":
    'Dismissed onboard slot "{slot}". Run `fabric config onboard-reset {slot}` to re-open.',
  "cli.config.slot.dismiss.failed": "dismiss-slot failed: {message}",
  "cli.config.slot.reset.not-opted": 'Slot "{slot}" not opted out; no-op.',
  "cli.config.slot.reset.done":
    'Reset onboard slot "{slot}"; it will appear in `fabric onboard-coverage` as missing again.',
  "cli.config.slot.reset.failed": "onboard-reset failed: {message}",
  "cli.config.errors.uninit-workspace.message":
    "Workspace not initialized. Run `fabric install` first.",
  "cli.config.errors.unknown-field": "Unknown field selection — skipping.",
  "cli.config.errors.no-store-target":
    "no writable team store is bound to this repo — run `fabric store bind <alias>` before setting a knowledge-base-level key.",
  "cli.config.errors.no-project-id":
    "this repo has no project_id — run `fabric install` first, or use --scope defaults to write the machine-wide default.",
  "cli.config.errors.no-enum-options":
    "No enum options available for this field — skipping.",
  // Per-field labels (11 total: 2 Group A + 8 Group B + 1 Group C).
  "cli.config.fields.fabric_language.label": "Language",
  "cli.config.fields.fabric_language.description":
    "Language used for interface text and knowledge rendering. Saved to ~/.fabric/fabric-global.json and applies to every project on this machine.",
  "cli.config.fields.default_layer_filter.label": "Default search scope",
  "cli.config.fields.default_layer_filter.description":
    "Which layers the AI searches by default: team is the team store only, personal the personal store only, both covers each. Changes the default only; an individual search can still specify.",
  "cli.config.fields.archive_hint_hours.label": "Archive reminder interval",
  "cli.config.fields.archive_hint_hours.description":
    "Once this many hours have passed since the last archive, the end of a session notes that there is something to archive. Higher values mean fewer reminders.",
  "cli.config.fields.archive_hint_cooldown_hours.label":
    "Archive reminder cooldown",
  "cli.config.fields.archive_hint_cooldown_hours.description":
    "After an archive reminder goes unacted on, the same subject is not raised again for this many hours.",
  "cli.config.fields.archive_edit_threshold.label":
    "Archive reminder edit threshold",
  "cli.config.fields.archive_edit_threshold.description":
    "Reaching this many accumulated edits prompts an archive, whichever comes first with the archive reminder interval. Lower values prompt sooner.",
  "cli.config.fields.underseed_node_threshold.label":
    "Knowledge base seeding threshold",
  "cli.config.fields.underseed_node_threshold.description":
    "Below this many entries, Fabric treats the knowledge base as not yet established and suggests seeding it. The value belongs to the knowledge base itself: it is written to the team store and applies to everyone using that store.",
  "cli.config.fields.review_hint_pending_count.label":
    "Review reminder backlog threshold",
  "cli.config.fields.review_hint_pending_count.description":
    "Prompts a review once this many drafts are pending. Entries the AI archives enter the knowledge base only after review.",
  "cli.config.fields.review_hint_pending_age_days.label":
    "Review reminder age threshold (days)",
  "cli.config.fields.review_hint_pending_age_days.description":
    "Prompts a review once the oldest pending draft has waited this many days, whichever comes first with the backlog threshold.",
  "cli.config.fields.review_stale_pending_days.label":
    "Pending draft expiry (days)",
  "cli.config.fields.review_stale_pending_days.description":
    "During review, drafts older than this are listed separately for an explicit resolve-or-drop decision.",
  "cli.config.fields.maintenance_hint_days.label":
    "Checkup reminder interval (days)",
  "cli.config.fields.maintenance_hint_days.description":
    "Once this many days have passed since the last fabric doctor run, prompts a checkup.",
  "cli.config.fields.maintenance_hint_cooldown_days.label":
    "Checkup reminder cooldown (days)",
  "cli.config.fields.maintenance_hint_cooldown_days.description":
    "After a checkup reminder goes unacted on, it is not raised again for this many days.",
  "cli.config.fields.audit_mode.label": "Human-lock audit strength",
  "cli.config.fields.audit_mode.description":
    "What happens when human-locked knowledge is found edited: strict blocks the operation, warn records a warning and continues, off does not check.",
  "cli.config.fields.nudge_mode.label": "Notice verbosity",
  "cli.config.fields.nudge_mode.description":
    "How many Fabric notices appear on the command line: silent shows none, minimal only critical ones, normal is standard, verbose shows all. Affects display only; the knowledge the AI retrieves is unchanged.",
  "cli.config.fields.cite_policy_enabled.label":
    "Pre-edit recall prompt",
  "cli.config.fields.cite_policy_enabled.description":
    "When on, the AI is prompted to look up relevant knowledge before editing a file. A prompt, not a block on the edit.",
  "cli.config.fields.self_archive_policy_enabled.label":
    "AI-initiated archive proposals",
  "cli.config.fields.self_archive_policy_enabled.description":
    "When on, the AI starts an archive itself once it judges a decision worth keeping. The result goes to pending and enters the knowledge base only after your review.",
  "cli.config.fields.cite_recall_nudge.label":
    "Notice on editing without recall",
  "cli.config.fields.cite_recall_nudge.description":
    "Adds a notice when the AI edits a file without having searched the knowledge base. Turning it off does not affect retrieval or archiving themselves.",
  "cli.config.fields.fabric_event_retention_days.label":
    "Activity log retention period (days)",
  "cli.config.fields.fabric_event_retention_days.description":
    "How many days this machine's activity record is kept: 7 is leanest, 30 balanced, 90 good for tracing back. Older lines move to an adjacent archive file rather than being deleted.",
  "cli.config.fields.embed_enabled.label":
    "Semantic search",
  "cli.config.fields.embed_enabled.description":
    "When on, a question worded differently from the entry still finds it (the difference is most pronounced in Chinese). This is an intent switch: it takes effect only once the server can load fastembed and the model is downloaded (fetched to ~/.fabric/cache/embed on first search). Check the actual state with fabric info recall.",
  "cli.config.fields.fusion.label": "Result ranking strategy",
  "cli.config.fields.fusion.description":
    "How keyword hits and semantic similarity combine into one ranking: auto selects based on whether the semantic channel is scoring, rrf weights them equally, additive is keyword-led.",

  "cli.doctor.description":
    "Run Fabric target-state diagnostics (meta sync, knowledge index, bootstrap, events ledger, human-lock drift)",
  "doctor.section.fixable": "Fixable errors:",
  "doctor.section.fix-knowledge-mutations": "Knowledge mutations (via --fix):",
  // flat-design follow-up: the remaining doctor UI-shell strings (TL;DR header,
  // --fix mutation plan, filtered --help) move off hardcoded English into i18n so
  // the whole `fabric doctor` surface honours the machine locale. USAGE/OPTIONS/
  // EXAMPLES labels stay English to match citty's own renderUsage in the other
  // commands' --help.
  "doctor.digest.todo": "To fix ({count})",
  "doctor.digest.clean": "all {count} checks passed — nothing to fix",
  "doctor.digest.summary":
    "{todo} to fix · {ok} passed · contributor diagnostics → --verbose",
  "doctor.digest.more-verbose":
    "{count} contributor finding(s) hidden — see --verbose",
  // store diagnostics (multi-store health, the `● 存储健康` group) — i18n parity
  // with doctor.check.*; messages carry store alias / counts via interpolation.
  "doctor.store.no-global-config":
    "no global Fabric config — run `fabric install --global <url>`",
  "doctor.store.missing-required":
    "required store '{id}' is not mounted; run `fabric store mount`",
  "doctor.store.unbound":
    "store '{alias}' is mounted but not bound to this project — paste: `fabric store bind {alias}` then `fabric store switch-write {alias}`",
  "doctor.store.empty":
    "bound store(s) have 0 knowledge entries ({stores}) — first-hit cannot succeed until you seed or clone knowledge; run `fabric first-hit --seed` (empty local store) or bind a remote team store with content",
  "doctor.store.write-target-mismatch":
    "active write store '{alias}' is not a valid team write target for this project — run `fabric store switch-write <mounted-team-alias>`",
  "doctor.store.hooks-missing":
    "knowledge present but SessionStart/PreToolUse hooks missing — re-run `fabric install`",
  "doctor.store.alias-drift":
    "by-alias readability link(s) out of sync for {refs}; run `fabric doctor --fix` to repair ~/.fabric/stores/by-alias/",
  "doctor.store.local-only":
    "store '{alias}' is local-only; add a git remote to back it up",
  "doctor.store.executable":
    "store '{alias}' contains executable/script files ({files}) — stores are data-only; Fabric never runs them (S65)",
  "doctor.store.active-personal-invalid":
    "active personal store '{store}' is not a mounted personal store; run `fabric store switch-personal <alias>` or `fabric doctor --fix`",
  "doctor.store.active-personal-unset":
    "{count} personal stores are mounted but none is active; run `fabric store switch-personal <alias>` to pick one (or `fabric doctor --fix` to default to the first)",
  "doctor.store.related-broken":
    "{count} broken `related` link(s) point at ids absent from the corpus: {samples}{overflow} — fix the related edges via `fab_review` (modify) or edit the entry frontmatter",
  "doctor.store.related-hub":
    "related graph hubs (top {shown} of {total} referenced): {top}",
  "doctor.store.config-key-relocated":
    "repo config still carries relocated key '{key}' — policy moved to ~/.fabric/fabric-global.json (preference knobs) or the store's store-config.json (corpus knobs); the value here is inert and can be deleted",
  "doctor.store.unreachable":
    "store '{alias}' is in the read-set but unreachable on disk ({reason}); run `fabric store mount` / re-clone it, then `fabric doctor`",
  "doctor.store.unreachable-bound":
    "bound store dir missing on disk: {stores} — re-clone or remount, then fabric doctor",
  "doctor.store.consumption-heatmap":
    "top consumed (last {days}d, {consumed}/{total} entries read across {windows} window(s)): {top}",
  "doctor.store.consumption-zero":
    "{count} entries never consumed in the last {days}d: {sample}{overflow} — review for retirement via `fab_review` (consumption is one signal, not proof of rot)",
  "doctor.store.overflow-more": ", …(+{count} more)",

  "doctor.check.knowledge_body_altitude_dump.name": "Knowledge body altitude",
  "doctor.check.knowledge_body_altitude_dump.ok":
    "No dump-shaped knowledge bodies detected.",
  "doctor.check.knowledge_body_altitude_dump.message.singular":
    "1 dump-shaped knowledge body: {detail}",
  "doctor.check.knowledge_body_altitude_dump.message.plural":
    "{count} dump-shaped knowledge bodies (e.g. {detail})",
  "doctor.check.knowledge_body_altitude_dump.remediation":
    "Rewrite as reusable decision/pitfall/guideline altitude (## structure), not a session transcript; re-archive via fabric-archive / fab_propose",
  "doctor.check.knowledge_body_altitude_dump.scan_error":
    "Body-altitude scan failed ({detail}); doctor cannot confirm corpus is clean.",
  "doctor.check.knowledge_summary_session_voice.name": "Knowledge summary voice",
  "doctor.check.knowledge_summary_session_voice.ok":
    "No session-minute summaries found.",
  "doctor.check.knowledge_summary_session_voice.message.singular":
    "1 summary reads as a session minute: {detail}",
  "doctor.check.knowledge_summary_session_voice.message.plural":
    "{count} summaries read as session minutes (e.g. {detail})",
  "doctor.check.knowledge_summary_session_voice.remediation":
    "summary is the only field fab_recall puts on the wire — write it as a standalone declarative conclusion (what to do + why) with no session pronouns; rewrite via fabric-review modify-content",
  "doctor.check.knowledge_summary_session_voice.scan_error":
    "Summary voice scan failed ({detail}); doctor cannot confirm the corpus is clean.",
  "doctor.check.knowledge_body_dedup.name": "Knowledge body dedup (v-next)",
  "doctor.check.knowledge_body_dedup.ok":
    "No legacy body sections or deprecated frontmatter detected (## Summary / ## Evidence / ## Why proposed / ## Session context / tech_stack all clean).",
  "doctor.check.knowledge_body_dedup.message.singular":
    "1 entry has legacy body sections or deprecated frontmatter: {detail}",
  "doctor.check.knowledge_body_dedup.message.plural":
    "{count} entries have legacy body sections or deprecated frontmatter (e.g. {detail})",
  "doctor.check.knowledge_body_dedup.remediation":
    "Run `fabric doctor --fix` to strip redundant body sections, rename ## Session context → ## Context, and merge tech_stack into tags.",
  "doctor.check.knowledge_body_dedup.scan_error":
    "Body-dedup scan failed ({detail}); doctor cannot confirm corpus is clean.",
  "doctor.fix-plan.header": "knowledge mutation plan ({count} total)",
  "doctor.fix-plan.preview": "preview:",
  "doctor.fix-plan.more": "... and {count} more",
  "doctor.help.tagline": "Diagnose and fix Fabric workspace issues",
  "doctor.help.flag.target": "Override project root (defaults to cwd)",
  "doctor.help.flag.fix":
    "Auto-fix derived state + auto-safe knowledge lint mutations",
  "doctor.help.flag.json": "Output as JSON for programmatic consumption",
  "doctor.help.flag.verbose": "Show maintainer-audience action hints",
  "doctor.help.example.run": "Run diagnostics",
  "doctor.help.example.fix": "Fix derived-state + knowledge issues",
  "doctor.help.footer":
    "Run `fabric doctor` to see a full diagnostic report. Audits → `fabric audit`.",
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
  "doctor.payload-limits.line":
    "warn={warnKb} KB, hard={hardKb} KB (source: {source})",
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
  "doctor.cite.metric.complianceRate":
    "cite compliance rate (incl. KB:none[reason])",
  "doctor.cite.metric.complianceNA": "N/A (no cite-expected turns)",
  "doctor.cite.metric.uncorrelatableEdits":
    "Uncorrelatable edits (no session_id — stale hook? run `fabric install`)",
  "doctor.cite.metric.recallCoverage":
    "recall coverage (edits preceded by a relevant fab_recall)",
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
  "cli.doctor.args.fix.description":
    "Repair derived Fabric state (meta + indexes) and apply auto-safe knowledge lint mutations (store counter floor, stale session-hints cleanup). Decay/frontmatter lints stay report-only — remediate those via fabric-review.",
  "cli.doctor.args.json.description": "Print the doctor report as JSON.",
  "cli.doctor.args.strict.description": "Treat warnings as failures.",
  "cli.doctor.args.yes.description":
    "Skip the knowledge-mutation safety confirm inside `fabric doctor --fix`. Required for non-tty invocations unless FABRIC_NONINTERACTIVE=1 is set in the environment.",
  // rc.35 TASK-12 (P0-11): --verbose unfolds maintainer-audience hints.
  "cli.doctor.args.verbose.description":
    "Show all action hints including maintainer-audience ones (Fabric contributors editing the source tree). By default these are folded for npm end users.",
  // rc.20 TASK-05: --cite-coverage report flags. Read-only; mutually exclusive with --fix/--fix-knowledge.
  // v2.0.0-rc.24 TASK-10: --layer filters cite contract audit by KB layer (team|personal|all).
  "cli.doctor.args.layer.description":
    "Filter cite contract audit by KB layer (team|personal|all)",
  "doctor.conflict.header": "Knowledge conflict lint",
  "doctor.conflict.none": "No candidate conflicting/duplicate pairs found",
  "doctor.conflict.summary":
    "{candidates} candidate pair(s), {conflicts} judged conflict(s) (similarity ≥ {threshold})",
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
  "cli.doctor.args.dry-run.description":
    "With --enrich-descriptions --auto or --fix: preview the planned changes without writing to disk. The fix-dry-run output mirrors --fix's fixable_errors list but executes no mutations.",
  // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run banner — printed before the standard report so users see no mutations were applied.
  "cli.doctor.fix-dry-run-banner":
    "[dry-run] No mutations were applied. The fixable_errors list below shows what `fabric doctor --fix` would address; rerun without --dry-run to actually fix.",
  "cli.doctor.unbound-project-backfilled":
    "Backfilled project-scope binding for store '{alias}' → project '{project}' (minted project_id + active_project).",
  "doctor.enrich.allComplete":
    "All canonical knowledge entries already declare intent_clues / impact / must_read_if.",
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
  "doctor.check.bootstrap_anchor.ok":
    "Bootstrap anchor present at repo root: {present}.",
  // v2.0.0-rc.33 W3-2 (T6 #5): reference the file names from the message so users can copy-paste rm targets rather than grep for them.
  "doctor.check.forensic.name": "Scan evidence",
  "doctor.check.forensic.message.missing.singular":
    "{error} Live scan detects {frameworkKind} with {count} entry point.",
  "doctor.check.forensic.message.missing.plural":
    "{error} Live scan detects {frameworkKind} with {count} entry points.",
  "doctor.check.forensic.message.missing-default":
    ".fabric/forensic.json is missing.",
  "doctor.check.forensic.message.invalid-default":
    ".fabric/forensic.json is invalid.",
  "doctor.check.forensic.remediation":
    "Run `fabric install` to regenerate .fabric/forensic.json.",
  "doctor.check.forensic.ok":
    ".fabric/forensic.json is valid for {frameworkKind}.",
  // rc.35 TASK-09 (P0-14): humanised parse-failure messages.
  // v2.0.0-rc.33 W3-2 (T6 #12): project rules forbid hand-editing agents.meta.json (see .fabric/AGENTS.md). Direct users through doctor --fix reconcile path instead.
  "doctor.check.event_ledger.name": "Event ledger",
  "doctor.check.event_ledger.message.missing":
    ".fabric/events.jsonl is missing.",
  "doctor.check.event_ledger.remediation.missing":
    "Run `fabric doctor --fix` to create .fabric/events.jsonl.",
  "doctor.check.event_ledger.message.not_writable-default":
    ".fabric/events.jsonl is not writable.",
  "doctor.check.event_ledger.remediation.not_writable":
    "Check file permissions on .fabric/events.jsonl and ensure no other process holds a write lock.",
  "doctor.check.event_ledger.message.invalid-default":
    ".fabric/events.jsonl is invalid.",
  // v2.0.0-rc.33 W3-1 (P0-6): archive-history mode — direct users to mv the broken ledger into events.archive/ before recreating, preserving history rather than rm'ing it. Mirrors rotateEventLedgerIfNeeded's events-rotated-YYYY-MM-DD.jsonl naming convention (events-corrupted-YYYY-MM-DD.jsonl distinguishes this archive cause from sliding-window rotation).
  "doctor.check.event_ledger.remediation.invalid":
    "Archive history first (`mkdir -p .fabric/events.archive && mv .fabric/events.jsonl .fabric/events.archive/events-corrupted-$(date +%Y-%m-%d).jsonl`), then run `fabric doctor --fix` to create a new empty ledger. Historical events are preserved under events.archive/.",
  "doctor.check.event_ledger.ok":
    ".fabric/events.jsonl exists, is writable, and is parseable.",
  // v2.0.0-rc.37 Wave B (B5): composite hard-gate check for events.jsonl /
  // metrics.jsonl health (G7 size / G8 metric_leak / G9 metrics_stale /
  // G10 rotation_overdue).
  "doctor.check.events_jsonl_health.name":
    "Events ledger health (rc.37 Plan B 5 hard gate)",
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
    "Run `fabric doctor --fix` — it triggers events.jsonl rotation (honors fabric_event_retention_days: 7|30|90 in ~/.fabric/fabric-global.json under defaults) AND flushes metrics.jsonl. If the warning persists, restart the MCP server so startMetricsFlush + startRotationTick reschedule. If metric_leak fires, audit recent code changes for direct appendEventLedgerEvent calls bypassing bumpCounter for one of the 4 metric-managed event_types.",
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
  // v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget lint. warn > 8K / error > 10K tokens (chars/3 estimate). Anthropic recommends SKILL.md hot path stay ~3K, but the two watched skills (fabric-archive/review) are the richest core skills and legitimately run larger; warn sits at 8K (a 2K reaction buffer below the 10K install-abort hard cap) rather than 5K. Over 10K is blocking (wasted model context + load latency).
  "doctor.check.skill_token_budget.name": "Skill token budget",
  "doctor.check.skill_token_budget.ok":
    "All .claude/skills/<slug>/SKILL.md files are within token budget (warn 8K / error 10K).",
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
    "Edit the `description:` field in `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter: (1) non-empty; (2) <60 tokens (chars/3 estimate, ~180 chars); (3) at least one Chinese trigger phrase; (4) at least one English trigger phrase; (5) an explicit anti-trigger such as `NOT PR review` / `NOT code review` / `不是...`. Re-run `fabric install` to sync both client subtrees.",
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
  // v2.0.0-rc.33 W3-2 (T6 #27): route through fabric-review modify so the canonical id allocator picks a fresh id (avoids hand-counter math).
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
  "doctor.check.preexisting_root_files.ok":
    "No CLAUDE.md or AGENTS.md detected at project root.",
  "doctor.check.preexisting_root_files.message":
    "{files} detected at project root. These root files are not auto-loaded by Fabric MCP.",
  "doctor.check.preexisting_root_files.remediation":
    "Move knowledge content into a mounted store's `knowledge/{type}/` tree if you want it available in MCP responses.",
  // v2.0.0-rc.33 W3-2 (T6 #34): same as stable_id_collision — route through fabric-review modify so allocator handles the new id.
  // v2.0.0-rc.33 W3-2 (T6 #35): make the skill entry point explicit so users know how to invoke fabric-review.
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
    "Run `fabric doctor --fix` to delete stale session-hints cache files.",
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
  // A hook that ships to disk but is not registered in the client config is
  // completely inert, and nothing outside doctor can notice.
  "doctor.check.hooks_wired.name": "Client hooks wired",
  "doctor.check.hooks_wired.ok.skipped":
    "No client config directory found (.claude/ / .codex/); hooks_wired check skipped.",
  "doctor.check.hooks_wired.ok.wired":
    "Every fabric hook is registered in each installed client\u2019s hook config.",
  "doctor.check.hooks_wired.message.config_missing":
    "Client directory exists but its hook config is absent: {configs}. fabric install never completed here, or the file was removed externally \u2014 every fabric hook for that client is inert.",
  "doctor.check.hooks_wired.message.config_unparseable":
    "Hook config exists but is not valid JSON: {configs}. The client silently ignores an unparseable config, so ALL hooks in it \u2014 fabric\u2019s and yours \u2014 are dead.",
  "doctor.check.hooks_wired.message.incomplete":
    "Hook config is missing fabric hook registrations: {missing}. Those hooks are installed on disk but never invoked.",
  "doctor.check.hooks_wired.remediation":
    "Run `fabric doctor --fix` (or `fabric install`) to re-register the missing hooks; both are idempotent and only fill empty slots.",
  "doctor.check.hooks_wired.remediation.config_unparseable":
    "`fabric doctor --fix` preserves the unparseable file alongside it and writes a fresh config with fabric\u2019s hooks. Any of your own settings in the broken file must be merged back by hand \u2014 review the preserved copy first.",
  // v2.0.0-rc.37 NEW-20: hooks_runtime — shebang + Node.js syntax validity
  // of installed *.cjs hook files (one layer below hooks_wired).
  "doctor.check.hooks_runtime.name": "Hooks runtime health",
  "doctor.check.hooks_runtime.ok.skipped":
    "No installed hook files found under .claude/hooks/ / .codex/hooks/; skipping hooks_runtime check.",
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
  "doctor.check.hooks_content_drift.ok.skipped":
    "No hook files co-exist across multiple clients (single-client install or no hooks present); skipping hooks_content_drift check.",
  "doctor.check.hooks_content_drift.ok.aligned":
    "Scanned {count} hook copies; sha256 of every basename matches across .claude / .codex.",
  "doctor.check.hooks_content_drift.message":
    "{count} hook basename(s) drift across clients; first: {first_basename} (involves {first_clients}). `fabric install` copies the same template to both clients — drift usually comes from manual edits.",
  "doctor.check.hooks_content_drift.remediation":
    "Run `fabric install` to restore each client's hook copy to the canonical template. If you actually need client-specific behavior, modify a shared lib/ helper or templates/hooks/configs/ wiring instead of editing the installed .cjs in place.",
  // W2 #16: install_copy_drift — installed copies vs the sha256 manifest
  // `fabric install` wrote. Detection-only: the server cannot reach the CLI
  // templates, so it must not promise a --fix (KT-PIT-0016).
  "doctor.check.install_copy_drift.name": "Installed copy drift",
  "doctor.check.install_copy_drift.ok.no_manifest":
    "No install manifest recorded yet; skipping install_copy_drift check. Re-run `fabric install` to start tracking installed copies.",
  "doctor.check.install_copy_drift.ok.aligned":
    "All {count} installed files match the manifest written by fabric {version}.",
  "doctor.check.install_copy_drift.message.unreadable":
    "{path} exists but is not a readable install manifest (corrupt, or written by an incompatible version), so installed copies cannot be verified.",
  "doctor.check.install_copy_drift.message.drifted":
    "{count} of {tracked} installed files no longer match what fabric {version} wrote; first: {first_path} ({first_kind}). Both clients can drift together, so cross-client parity does not catch this.",
  "doctor.check.install_copy_drift.remediation":
    "Run `fabric install` to restore the installed copies from the canonical templates (idempotent). If you edited an installed file on purpose, move the change into packages/cli/templates/ instead — install overwrites in-place edits.",
  // W2 #9: mcp_root_pin_managed — a FABRIC_PROJECT_ROOT pin an OLD installer
  // wrote. Fixable here (removing an env key needs no CLI templates).
  "doctor.check.mcp_root_pin.name": "MCP project-root pin",
  "doctor.check.mcp_root_pin.ok.clean":
    "No MCP client config carries an installer-written FABRIC_PROJECT_ROOT pin; the server resolves the project root dynamically.",
  "doctor.check.mcp_root_pin.message.stale":
    "{count} MCP client config(s) carry a FABRIC_PROJECT_ROOT pin written by an older fabric installer, and {config} pins {pinned} — not this project. The MCP server will read and write that other project instead, silently.",
  "doctor.check.mcp_root_pin.message.aligned":
    "{count} MCP client config(s) carry a FABRIC_PROJECT_ROOT pin written by an older fabric installer ({config} pins {pinned}). It happens to name this project today, but it is frozen: move the checkout, or open another repo with a user-scoped pin, and the server silently serves the wrong project.",
  "doctor.check.mcp_root_pin.remediation":
    "Run `fabric doctor --fix` to remove the installer-written pin (a verified backup of each config is taken first) so the root resolves dynamically again. A pin you set yourself — marked `operator:v1` or `project:v1` — is never touched.",
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
    'stable_id "{stableId}" is declared in {fileCount} files: {files}. Edit one of the knowledge files to use a unique stable_id.',
  "doctor.check.stable_id_collision.message.plural":
    '{count} stable_id collisions detected. First: "{stableId}" in {files}. Edit one of the knowledge files to use a unique stable_id.',
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
  "doctor.check.relevance_paths_dangling.name":
    "Knowledge relevance_paths dangling",
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
  "doctor.check.relevance_paths_drift.remediation_with_sample":
    "Review whether the entry is still relevant — sample {sample}; refresh anchors via `fab_review.modify`, or archive via `fab_review.reject`.",
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
    '{count} write_route(s) point at an unbound store ({routes}); fab_propose on those scopes will report "no write-target store resolved".',
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
  // legacy_fabric_cache_dir_detected — the recall engine's BM25 / vector
  // caches used to live at `.fabric/cache/{bm25,vectors}`; unify-fabric-cache-dir
  // moved them into `.fabric/.cache/` next to the hook sidecar cache so one
  // .gitignore rule covers both. Old data is intact; the fix is a rename.
  "doctor.check.legacy_fabric_cache_dir_detected.name":
    "Legacy .fabric/cache/ directories",
  "doctor.check.legacy_fabric_cache_dir_detected.ok":
    "Recall caches live under .fabric/.cache/ — no legacy .fabric/cache/{bm25,vectors} remains.",
  "doctor.check.legacy_fabric_cache_dir_detected.message":
    "Found {count} legacy recall-cache dir(s) ({dirs}). These pre-date the unify-fabric-cache-dir move to .fabric/.cache/; the on-disk data (BM25 snapshots / vector embeddings) is intact — a rename preserves it.",
  "doctor.check.legacy_fabric_cache_dir_detected.remediation":
    "Run `fabric doctor --fix` to rename each legacy dir into its `.fabric/.cache/` counterpart (idempotent; skipped if the new path already holds newer data). No re-embed cost is paid; the snapshot files are moved as-is.",
  "doctor.check.skill_md_yaml_invalid.name": "Skill markdown YAML",
  "doctor.check.skill_md_yaml_invalid.ok":
    "All .claude/.codex SKILL.md frontmatter values parse as strict YAML.",
  "doctor.check.skill_md_yaml_invalid.message.singular":
    "{count} SKILL.md frontmatter value contains an unquoted ': ' that strict YAML parsers reject (Claude Code tolerates it; Codex CLI drops the skill at load). First: {detail}.",
  "doctor.check.skill_md_yaml_invalid.message.plural":
    "{count} SKILL.md frontmatter values contain an unquoted ': ' that strict YAML parsers reject (Claude Code tolerates it; Codex CLI drops the skill at load). First: {detail}.",
  "doctor.check.skill_md_yaml_invalid.remediation":
    'Quote the value with double quotes (`description: "…"`) or rewrite the inner `key: value` token to `key=value`.',
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
  "doctor.archive-history.header":
    "Archive history (last {sinceLabel}, {count} session{plural})",
  "doctor.archive-history.empty":
    "No archive history yet within the --since={sinceLabel} window.",
  "doctor.archive-history.table.session": "Session",
  "doctor.archive-history.table.lastAttempt": "Last attempt",
  "doctor.archive-history.table.outcome": "Outcome",
  "doctor.archive-history.table.candidates": "Candidates",
  "doctor.archive-history.table.coveredGap": "Covered gap",
  // rc.37 NEW-33: unified --history <mode> view (archive | fix | all).
  "cli.doctor.errors.invalid-history-mode":
    "Invalid --history mode '{input}'. Use archive | fix | all.",
  "doctor.history.header":
    "Doctor history (mode={mode}, last {sinceLabel}, {days} day(s))",
  "doctor.history.empty":
    "No doctor or archive activity within the --since={sinceLabel} window (mode={mode}).",

  "cli.install.description":
    "Install Fabric in the target project (scaffold .fabric/, bootstrap templates, MCP client wiring, git hooks)",
  "cli.install.args.target.description":
    "Target project path. Defaults to --target, then EXTERNAL_FIXTURE_PATH, then cwd.",
  "cli.install.args.debug.description":
    "Print target resolution details to stderr.",
  "cli.install.args.yes.description":
    "Accept the current install plan and run without the TTY wizard",
  "cli.install.args.dry-run.description":
    "Print the install plan without writing files or running follow-up stages",
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
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only.
  "cli.install.mcp.install.local":
    "Installing @fenglimg/fabric-server to project devDependencies",
  "cli.install.mcp.local.installing":
    "Running {manager} add -D @fenglimg/fabric-server...",
  "cli.install.mcp.local.installed": "Installed to devDependencies",
  "cli.install.preflight.error.no-home":
    "Cannot determine home directory for global root",
  "cli.install.preflight.error.not-dir":
    "Global Fabric root is not a directory: {path}",
  "cli.install.preflight.error.parent-not-dir":
    "Global Fabric root parent is not a directory: {path}",
  "cli.install.preflight.error.not-writable":
    "{label} is not writable: {path} ({reason})",
  "cli.install.preflight.error.git-required":
    "git is required for --url installs but was not available: {reason}",
  "cli.install.preflight.label.target": "Target",
  "cli.install.preflight.label.global-root": "Global Fabric root",
  "cli.install.preflight.label.global-root-parent": "Global Fabric root parent",
  "cli.install.guidance.more":
    "More: CLI = install and ops, Skills = archive and review flows, MCP = in-session recall.",
  "cli.install.validate.failed": "Validation failed: {count} error(s)",
  "cli.install.validate.failed-item": "  - {error}",
  "cli.install.hooks.installed": "installed skill×{skills} + hook×{hooks}",
  // flat-design: scan result folded into ONE human line (framework + scale); the
  // version is suppressed when it resolved to "unknown"; falls back to plain when
  // no framework was detected.
  "cli.install.scan.summary.framework":
    "Detected {framework} project · {files} files · {entries} entry points",
  "cli.install.scan.summary.plain":
    "Scan complete · {files} files · {entries} entry points",
  "cli.install.rollback.feedback":
    "Rolled back {count} change(s); project left unchanged.",
  "cli.install.rollback.feedback.none":
    "No rollback actions were registered — earlier stages may have left partial files (e.g. .fabric/). Inspect the project before re-running install.",
  "cli.install.stages.completed": "completed",
  "cli.install.stages.failed": "failed",
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
  "cli.install.healthcheck.title":
    "✓ Fabric is up to date · {count} stages ready · no changes",
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
  "cli.install.next-step.restart":
    "restart any open Claude Code / Codex session to load Fabric (new sessions pick it up automatically).",
  "cli.install.next-step.nudge-mode":
    "Human breadcrumbs default to minimal (one status line/session). Change it in ~/.fabric/fabric-global.json under defaults.nudge_mode (silent | minimal | normal | verbose), via fabric config --set nudge_mode --value silent, or FABRIC_NUDGE_MODE=silent.",
  "cli.install.language.prompt":
    "Choose the Fabric language (used for both UI and knowledge; change later via `fabric config`):",
  "cli.install.language.option.zh-CN": "简体中文 (zh-CN)",
  "cli.install.language.option.en": "English (en)",
  "cli.install.plan.mode-banner.plan":
    "[mode: plan] Dry run only, no files will be written",
  "cli.install.plan.preview-title": "Fabric install dry run",
  // flat-design-system Wave4 (TASK-004): short stage labels for the post-group ✓ receipt.
  "cli.install.capabilities.title": "Client capability summary",
  // C-006 (TASK-004): print a single one-line capability summary by default and
  // let the summary card lead the closing impression; the full 4×6 per-client
  // table only renders under --verbose. {count} = detected client count.
  "cli.install.capabilities.summaryLine":
    "Detected {count} client(s) and configured their capabilities (run with --verbose for the per-client table).",
  // v2.0.0-rc.37 NEW-22: post-install restart banner. The MCP server is
  // spawned by the client; already-running Claude Code / Codex
  // sessions won't pick up the new mcp config until they restart.
  "cli.install.restart-banner":
    "Restart hint: any already-running Claude Code / Codex CLI session must restart to pick up the new MCP server config; new sessions will autoload the Fabric tools.",
  "cli.install.next-steps":
    "Next steps — get your first value:\n" +
    "  1. Restart your AI client (Claude Code / Codex). It now auto-surfaces this project's knowledge to the assistant.\n" +
    "  2. Seed knowledge: just work normally — when you make a decision or hit a pitfall, the fabric-archive skill proposes an entry. Or run the fabric-archive skill's source mode to backfill from git history.\n" +
    '  3. Verify it works: ask your AI "what does Fabric know about this repo?", or run `fabric doctor` to check health.',
  // C1/C5: semantic-search interactive copy routed through t().
  "cli.install.semantic.prompt":
    "Enable vector semantic search? (the first recall downloads an embedding model)",
  "cli.install.semantic.enabled":
    "Semantic search enabled (embed_enabled=true, embed_model={model}).",
  "cli.install.semantic.already-enabled":
    "Semantic search already enabled (embed_model={model}); {path} unchanged.",
  "cli.install.semantic.offer-install":
    "Install the optional embedder now? Runs `npm i -g fastembed` (a no-op if already installed).",
  "cli.install.semantic.installing": "Running `npm i -g fastembed` …",
  "cli.install.semantic.installed":
    "fastembed installed. The embedding model downloads automatically on the first recall (~tens–hundreds of MB; no KB data is uploaded).",
  "cli.install.semantic.install-failed":
    "Auto-install failed ({reason}). Run the steps manually:",
  "cli.install.semantic.manual-steps":
    "  1. Install the optional embedder where the MCP server resolves modules (a global install is global):\n" +
    "       npm i -g fastembed\n" +
    "  2. Warm the model cache (the first run downloads the weights, ~tens–hundreds of MB; no KB data is uploaded):\n" +
    "       export FABRIC_EMBED_CACHE_DIR=~/.cache/fabric-embed   # strict-offline: pre-place the weights here\n" +
    "  Note: after switching embed_model the existing vector dim/semantics change; the next recall re-embeds with the new model (doc vectors are cached by text and auto-recompute on mismatch).\n" +
    "  Disable: set embed_enabled=false in .fabric/fabric-config.json.",
  // C5: store onboarding interactive copy routed through t().
  "cli.install.store.local-store": "local store",
  // W2 dual-slot (TASK-002): personal slot + team slot status / prompt copy. The
  // team slot is named by CATEGORY (team-class), and rows show the store's REAL
  // alias — the copy MUST NOT imply the store has to be aliased literally `team`
  // (KT-MOD-0001 naming-axis trap).
  "cli.install.store.slot.personal.status":
    "Personal store (machine-wide): '{alias}' ✓",
  "cli.install.store.slot.personal.absent":
    "Personal store (machine-wide): not set up yet",
  "cli.install.store.slot.personal.multi-none":
    "Personal store (machine-wide): {count} mounted, none active yet",
  "cli.install.store.slot.personal.multi-prompt":
    "Pick this machine's active personal store:",
  "cli.install.store.slot.personal.multi-active-label":
    "'{alias}' (current active)",
  "cli.install.store.slot.personal.multi-switch-label": "switch to '{alias}'",
  "cli.install.store.slot.personal.multi-new-label":
    "create a new local personal store",
  "cli.install.store.slot.personal.multi-new-hint":
    "a fresh empty personal store, set as active",
  "cli.install.store.slot.personal.new-alias":
    "alias for the new personal store:",
  "cli.install.store.slot.personal.switched":
    "active personal store switched to '{alias}'",
  "cli.install.store.slot.team.status":
    "Team store (team-class): '{alias}'{source} ✓",
  "cli.install.store.slot.team.empty":
    "Team store (team-class): none bound yet",
  "cli.install.store.slot.team.prompt":
    "Choose the team knowledge store (team-class) for this project:",
  "cli.install.store.slot.team.switch-label": "switch to mounted: {alias}",
  // flat-design store menu: "keep current" and "skip" are merged — when a team is
  // bound the SKIP row renders as keep-label (no change), otherwise as plain skip.
  "cli.install.store.slot.team.keep-label": "keep current: {alias} · no change",
  "cli.install.store.slot.team.keep-hint":
    "{source}stay on this team store; leave the binding unchanged",
  "cli.install.store.skip-label": "skip",
  "cli.install.store.project-pick.prompt":
    "store '{store}' already serves other projects and none match this repo's git name — join an existing project or create a new one?",
  "cli.install.store.project-pick.join": "Join existing: {name} ({id})",
  "cli.install.store.project-pick.new": "➕ New project {id}",
  "cli.install.store.project-pick.new-name":
    "New project id (project coordinate):",
  "cli.install.store.bound-success":
    "bound store '{alias}' to this project and set it as the write target.",
  "cli.install.store.created-success":
    "created store '{alias}', bound it to this project, and set it as the write target.",
  "cli.install.store.onboard.skip-hint": "personal store only (default)",
  "cli.install.store.onboard.join-label": "join existing",
  "cli.install.store.onboard.join-hint":
    "clone + bind a shared store from a git remote",
  "cli.install.store.onboard.create-label": "create new",
  "cli.install.store.onboard.create-hint":
    "start a fresh local store (optionally remote-backed)",
  "cli.install.store.onboard.join-url": "Shared store git remote (url):",
  "cli.install.store.onboard.alias": "Local alias for the new store:",
  "cli.install.store.onboard.remote":
    "Git remote to back it (optional - leave blank to skip):",
  "cli.install.store.unbound-note":
    "Note: The following stores are mounted but not bound to this project: {aliases}.",
  "cli.install.store.unbound-hint":
    "  Run 'fabric store bind {first}' to bind one.",
  // C4: personal store clone-or-new.
  // TASK-004: prefixed onto a first-install one-time prompt (language / personal
  // store onboarding) so the user knows these questions only appear at first setup.
  "cli.install.store.firstRunContext":
    "First-time setup — the following are one-time choices that appear only on first install:",
  "cli.install.store.personal.prompt":
    "No personal store on this machine yet. Create a fresh one, or clone your existing one from a remote?",
  "cli.install.store.personal.new-label": "create local (default)",
  "cli.install.store.personal.new-hint": "a fresh empty personal store",
  "cli.install.store.personal.clone-label": "clone existing",
  "cli.install.store.personal.clone-hint":
    "clone your backed-up personal store from a git remote",
  "cli.install.store.personal.clone-url":
    "Your personal store git remote (url):",
  "cli.install.store.personal.cloned-success":
    "cloned personal store from remote ({uuid}).",
  "cli.install.store.personal.clone-failed":
    "cloning the personal store failed ({reason}); falling back to a fresh local store.",
  "cli.install.capabilities.none":
    "No supported client was detected for bootstrap or MCP follow-up.",
  "cli.install.capabilities.header.client": "Client",
  "cli.install.capabilities.header.bootstrap": "Bootstrap",
  "cli.install.capabilities.header.mcp": "MCP",
  "cli.install.capabilities.header.hook": "Hook",
  "cli.install.capabilities.header.skill": "Skill",
  "cli.install.capabilities.header.follow-up": "Follow-up",
  "cli.install.capabilities.status.ready": "ready",
  "cli.install.capabilities.status.installed": "installed",
  "cli.install.capabilities.status.supported": "supported",
  "cli.install.capabilities.status.skipped": "skipped",
  "cli.install.capabilities.status.failed": "failed",
  "cli.install.capabilities.status.na": "n/a",
  "cli.install.capabilities.follow-up.ready": "continue in client",
  "cli.install.capabilities.follow-up.install": "install client assets",
  "cli.install.capabilities.follow-up.manual": "manual step required",
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
  "cli.uninstall.args.debug.description":
    "Print target resolution details to stderr.",
  "cli.uninstall.args.yes.description":
    "Accept the current uninstall plan and run without the TTY wizard.",
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
  "cli.uninstall.plan.preserves.stores":
    "global knowledge stores, never deleted by project uninstall",
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
  "cli.uninstall.stages.failed-hint":
    "Check the error details above. Run with --debug for more information.",
  "cli.uninstall.stages.uptodate": "nothing to remove ({count} already absent)",
  // flat-design-system Wave5 (TASK-006 G3): human result words for the summary
  // card detail rows, symmetric with install's `{count} installed` / `up to date`.
  "cli.uninstall.stage.cleaned-count": "{count} cleaned",
  "cli.uninstall.summary.title": "Uninstall summary",
  "cli.uninstall.summary.body":
    "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.healthcheck.title":
    "✓ Fabric already absent · nothing to remove",
  "cli.uninstall.wizard.intro": "Fabric uninstall",
  "cli.uninstall.wizard.select.prompt":
    "What should be removed from {target}? (space to toggle / enter to confirm; global knowledge stores under ~/.fabric/stores/ are never deleted)",
  "cli.uninstall.wizard.select.scaffold.label": "Scaffold artifacts",
  "cli.uninstall.wizard.select.scaffold.hint":
    "Scaffolded files under .fabric/",
  "cli.uninstall.wizard.select.bootstrap.label": "Skills & hooks",
  "cli.uninstall.wizard.select.bootstrap.hint":
    "Per-client skills and hook scripts + config",
  "cli.uninstall.wizard.select.mcp.label": "MCP client registration",
  "cli.uninstall.wizard.select.mcp.hint":
    "Un-register the fabric MCP server from clients",
  "cli.uninstall.wizard.select.store.label": "Unbind team store (this project)",
  "cli.uninstall.wizard.select.store.hint":
    "Clears this project's store binding; the global store is never deleted",
  "cli.uninstall.wizard.execute.confirm":
    "Execute this uninstall plan now? [Y/n]",
  "cli.uninstall.wizard.outro":
    "Uninstall plan accepted. Running Fabric uninstall...",
  "cli.uninstall.wizard.cancelled":
    "Fabric uninstall cancelled before execution.",
  "cli.uninstall.confirm.proceed":
    "Proceed with uninstalling Fabric from {target}? [y/N]",
  "cli.uninstall.errors.target-not-directory":
    "Target must be an existing directory: {path}",

  // v2.0.0-rc.37 Wave A2 Part 2: cli.serve.* + FABRIC_AUTH_TOKEN keys removed
  // alongside the `fabric serve` command. The HTTP package they belonged to was
  // deleted in W4 B7; restore from git history if a web UI surface returns.

  // v2.0.0-rc.29 TASK-008 (BUG-L2): onboard-coverage i18n keys.
  "cli.first-hit.description":
    "Prove install→first-hit readiness (bind + non-empty knowledge surface)",
  "cli.first-hit.args.json.description": "Machine-readable JSON report",
  "cli.first-hit.args.target.description": "Project root (default: cwd)",
  "cli.first-hit.args.seed.description":
    "If empty store, write minimal starter knowledge entries",
  "cli.first-hit.args.paths.description":
    "Comma-separated probe paths for surface check",
  "cli.first-hit.msg.ok":
    "first-hit ready: {total} knowledge entr{plural} across {stores} store(s); hooks present.",
  "cli.first-hit.msg.unbound":
    "unbound: no store is bound to this project's read-set — knowledge cannot surface.",
  "cli.first-hit.msg.no_write_target":
    "no_write_target: project has required stores but no active_write_store.",
  "cli.first-hit.msg.empty_store":
    "empty_store: store(s) bound but 0 canonical knowledge files — empty store is not a happy path.",
  "cli.first-hit.msg.missing_required":
    "missing_required: one or more required_stores are not mounted — multi-store bind incomplete.",
  "cli.first-hit.msg.write_target_mismatch":
    "write_target_mismatch: active_write_store is not a mounted writable store on the read-set.",
  "cli.first-hit.msg.store_unreachable":
    "store_unreachable: a bound store is registered but its directory is missing on disk.",
  "cli.first-hit.msg.project_unsealed":
    "project_unsealed: write store is bound but project_id/active_project is missing — team knowledge will land flat (semantic_scope: team), not project-partitioned.",
  "cli.first-hit.msg.no_match":
    "no_match: knowledge exists but the probe surface is empty (path/scope filter).",
  "cli.first-hit.msg.hooks_missing":
    "hooks_missing: knowledge is present but SessionStart/PreToolUse hooks are not installed.",
  "cli.first-hit.msg.no_project":
    "no_project: this directory is not a Fabric project (missing .fabric/fabric-config.json).",
  "cli.first-hit.msg.no_global":
    "no_global: fabric global config missing — run fabric install --global first.",

  "cli.onboard-coverage.description":
    "Report S5 onboard-slot coverage for the workspace. Used by the fabric-archive Skill's first-run phase to detect unclaimed project-tone slots.",
  "cli.onboard-coverage.args.json.description":
    "Emit machine-readable JSON to stdout instead of the human table.",
  "cli.onboard-coverage.args.target.description":
    "Override the project root (defaults to cwd).",

  // W3-05 (ISS-033): project-scoped command output (whoami / store /
  // scope-explain / sync / metrics) — previously hardcoded English, now
  // resolved via the project's fabric_language.
  "cli.cmd.no-global-config":
    "no global Fabric config — run `fabric install --global <url>` first",
  "cli.whoami.stores-none": "stores: (none mounted)",
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
  "cli.info.recall.summary.on":
    "semantic search on — details: fabric info --recall",
  "cli.info.recall.summary.off":
    "keyword mode · semantic search off — details: fabric info --recall",
  "cli.info.recall.mode.additive": "additive (keyword mode)",
  "cli.info.recall.mode.rrf": "rrf (keyword + semantic)",
  "cli.info.recall.reason.forced-additive":
    "fixed to keyword mode (additive) by config",
  "cli.info.recall.reason.auto-additive":
    "vector channel not ready — auto-falls back to keyword mode",
  "cli.info.recall.reason.auto-rrf":
    "vector channel ready — blending keyword + semantic (rrf)",
  "cli.info.recall.reason.rrf-ready":
    "fixed to rrf by config; vector channel ready",
  "cli.info.recall.reason.rrf-warn":
    "fixed to rrf by config, but the vector channel is not ready — single-channel rrf is worse than keyword mode",
  "cli.info.recall.install-hint":
    "install it to enable semantic search: npm i -g fastembed",
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
  "cli.info.recall.cached.no":
    "not cached — downloads on first recall (or `fabric info --recall --warm`)",
  "cli.info.recall.vector.ready": "READY",
  "cli.info.recall.vector.not-ready":
    "not ready — recall falls back to keyword mode (BM25 / additive)",
  "cli.info.recall.warm.ok":
    "embedder warm: model '{model}' loaded (vector dim {dim}), cached at {dir}",
  "cli.info.recall.warm.fail":
    "embedder unavailable — the optional 'fastembed' package is not resolvable or the model failed to load.\n  Recall falls back to keyword mode (BM25 / additive). Install fastembed where the server resolves modules, then retry.",
  "cli.store.mount.description":
    "Mount a knowledge store into the global registry",
  "cli.store.create.description":
    "Create a brand-new local knowledge store and mount it",
  "cli.store.remove.description":
    "Detach a store from the registry (does NOT delete it)",
  "cli.store.explain.description": "Explain how a store alias resolves",
  "cli.store.list.description": "List mounted knowledge stores",
  // One-shot on-disk migrations (KT-DEC-0060 folded surface). They rewrite scope
  // coordinates or move files; nobody runs them as part of daily work.
  "cli.store.backfill.description":
    "Backfill semantic_scope + visibility_store on existing knowledge (repairs dirty layer)",
  "cli.store.rescope.description":
    "Rewrite knowledge entries' semantic_scope coordinate in a store",
  "cli.store.promote.description":
    "Promote project-scoped entries to team scope (project absorption)",
  "cli.store.reroot.description":
    "Relocate flat project-scoped entries into knowledge/projects/<id>/ (git mv, blame-preserving)",
  // Footer note appended to `fabric store --help` — explains where the advanced
  // (meta.hidden) operations went so the list-only listing isn't a dead end.
  // Name the groups, not four sample verbs: the sample list drifted once already
  // (it advertised `migrate` while the one-shot migrations were the only
  // commands still VISIBLE), and a wrong example is worse than none.
  "cli.store.help.folded-note":
    "Folded, still callable: setup/routing (create / mount / bind / switch-write, driven by fabric install and the fabric-store skill) and one-shot migrations (backfill / scope / promote / reroot / migrate). Run `fabric store <command> --help` directly when you need one.",
  "cli.store.list.title": "Mounted stores",
  "cli.store.project.list.title": "Projects in store '{store}'",
  "cli.store.project.list.empty": "(no registered projects)",
  "cli.store.project.created": "registered project '{id}' in store '{store}'",
  "cli.store.migrate.title": "Knowledge scope migration",
  "cli.store.backfill.noop":
    "scope backfill: nothing to do ({count} already consistent)",
  "cli.store.backfill.summary":
    "scope backfill: {changed} updated, {unchanged} unchanged",
  "cli.store.backfill.scope-note":
    "{count} entries defaulted to semantic_scope: team. Demote project-specific ones with `fabric store migrate scope <store> --to project:<id> --id <id>`.",
  "cli.store.rescope.noop":
    "re-scope: nothing to do ({count} already at '{scope}')",
  "cli.store.rescope.summary":
    "re-scope → {scope}: {changed} updated, {unchanged} unchanged",
  "cli.store.rescope.refused": "{count} entries refused",
  "cli.store.reroot.noop":
    "reroot: nothing to relocate ({skipped} entries stay flat)",
  "cli.store.reroot.summary":
    "reroot: {moved} project entries relocated into knowledge/projects/<id>/",
  "cli.store.reroot.provenance-gap":
    "{count} moved via fs rename (untracked / non-git) — git blame history was NOT preserved for these",
  "cli.store.none-mounted": "(no stores mounted)",
  "cli.store.mounted": "mounted '{alias}' ({count} store(s) total)",
  "cli.store.created": "created store '{alias}' ({uuid}) at {dir}",
  "cli.store.created-local-hint":
    "(local-only — add a remote later with `git -C <storeDir> remote add origin <url>`)",
  "cli.store.no-alias": "no store aliased '{alias}'",
  "cli.store.detached":
    "detached '{alias}' — on-disk store tree left intact (detach ≠ delete)",
  "cli.store.bound": "bound required store '{id}' ({count} required)",
  "cli.store.switch-write":
    "active write store set to '{alias}' for this project",
  "cli.store.switch-personal":
    "active personal store set to '{alias}' for this machine",
  "cli.store.routed": "write route: scope '{scope}' → store '{alias}'",
  "cli.sync.deferred":
    "{count} store(s) offline — push deferred; re-run `fabric sync` when online",
  "cli.sync.paused":
    "sync paused on a conflict — resolve it, then run `fabric sync --continue` (or `--abort`)",
  // flat-design (spec §0.4): `fabric sync` command-level title + per-store rows +
  // aggregate summary. State labels are shared between the per-store rows and the
  // summary count cells.
  "cli.sync.args.continue.description":
    "Resume after resolving a rebase conflict",
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
  "cli.metrics.invalid-since":
    '--since: invalid duration "{raw}" (expected e.g. 24h, 7d, 30m)',
  "cli.metrics.window": "Fabric metrics — window: {window}",
  "cli.metrics.window-all-time": "all-time",
  "cli.metrics.rows-range": "  rows: {count} ({start} → {end})",
  "cli.metrics.rows": "  rows: {count}",
  "cli.metrics.no-activity":
    "  (no counter activity in window — server may be idle or just started)",
  "cli.metrics.col.counter": "counter",
  "cli.metrics.col.total": "total",
  "cli.metrics.col.entry": "entry",
  "cli.metrics.section.perEntry":
    "Top per-entry consumed (knowledge_consumed:<id>)",

  // W3-09 (ISS-035): forensic project scan progress (stderr, TTY-only).

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
  "scan.rec.next":
    "Confirm app/pages routing boundaries and server-component constraints.",
  "scan.rec.vite":
    "Confirm the src/main entry, component directories, and build-script maintenance boundaries.",
  "scan.rec.unknown":
    "No framework marker detected — confirm the tech stack and main entry with the user first.",
  "scan.rec.generic":
    "Confirm the AGENTS.md layering boundaries around {kind}'s main entry and generated directories.",
};

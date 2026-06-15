import { z } from "zod";

import { requiredStoreEntrySchema } from "./store.js";
import { SCOPE_COORDINATE_PATTERN } from "./scope.js";

export const auditModeSchema = z.enum(["strict", "warn", "off"]);

// v2.0: Fabric scope is locked to Claude Code and Codex CLI.
// Unknown clientPaths keys (e.g. windsurf, rooCode, geminiCLI from v1.x) are
// rejected at parse time via .strict() — there is no soft-deprecation path.
// Adding a new client requires extending this schema explicitly.
export const clientPathsSchema = z
  .object({
    claudeCodeCLI: z.string().optional(),
    claudeCodeDesktop: z.string().optional(),
    codexCLI: z.string().optional(),
  })
  .strict();

export const mcpPayloadLimitsSchema = z.object({
  warnBytes: z.number().int().positive().optional(),
  hardBytes: z.number().int().positive().optional(),
}).optional();

// v2.0.0-rc.29 REVIEW (codex HIGH-3): exported so the server config-loader can
// safe-parse the field independently of the full fabricConfigSchema, keeping
// plan_context's hot read path resilient to corruption in unrelated config
// fields. The range guard (30s..1h) mirrors the rationale documented at the
// fabricConfigSchema `selection_token_ttl_ms` field.
export const selectionTokenTtlMsSchema = z.number().int().min(30_000).max(3_600_000);

// v2.2 A-INFRA-3 (W1-T3-TOPK): upper bound on the number of candidates
// `fab_plan_context` returns, applied AFTER BM25 content ranking so the
// truncation drops the least-relevant entries (not an arbitrary alphabetic
// tail). Bounds the MCP payload as the KB grows to hundreds of entries — the
// rc.38 UX-1 fold already collapsed per-path duplication, this caps the single
// shared list. Exported standalone so the server config-loader validates it on
// the hot plan_context read path without re-parsing the whole config. Range
// 1..200; default 24 (generous enough for the LLM to choose from after ranking,
// small enough to stay well under the payload budget).
export const planContextTopKSchema = z.number().int().min(1).max(200);

// grill-6fixes (D1/D2): the language base tone. Narrowed to exactly the two
// concrete locales — `zh-CN` | `en`. The `match-existing` placeholder and the
// `zh-CN-hybrid` variant were removed end-to-end, along with the README/docs
// content-detection path that auto-fixated them. Language is no longer a
// per-project field; it lives once in `~/.fabric/fabric-global.json` →
// `language` (globalConfigSchema in schemas/store.ts) and governs both CLI
// display and knowledge authoring. This schema is retained because the install
// language selector and the `fabric config` language entry validate against it.
export const fabricLanguageSchema = z.enum(["zh-CN", "en"]);

// v2.0 (grill-followup Q6): Fallback for `fab_plan_context` when the caller
// omits `layer_filter`. `both` keeps team and personal knowledge in scope;
// `team` / `personal` narrow the default surface for projects that only
// curate one layer.
export const defaultLayerFilterSchema = z.enum(["team", "personal", "both"]);

// v2.2 dual-sink (Goal A / D4): nudge_mode is the human-output preset that
// replaces the "knob soup" of per-hook numeric thresholds with one coherent
// dial. CORE INVARIANT (D5): nudge_mode governs ONLY the human-facing sink
// (`systemMessage` on CC/Codex) — it NEVER touches the AI sink
// (`hookSpecificOutput.additionalContext`). Flow ⊥
// observation: the model receives the same knowledge regardless of how quiet the
// human channel is. Levels (resolved in lib/nudge-policy.cjs):
//   silent  — no human systemMessage at all (AI sink unchanged)
//   minimal — only high-value human output (SessionStart banner; PreToolUse hits;
//             value-gated Stop nudge). PreToolUse miss + low-value Stop stay quiet.
//   normal  — default; preserves pre-dual-sink human visibility
//   verbose — everything surfaces to the human channel
// The legacy numeric knobs (hint_broad_top_k, archive_edit_threshold, …) are
// retained as fine-grained OVERRIDES that win over the preset when set.
export const nudgeModeSchema = z.enum(["silent", "minimal", "normal", "verbose"]);

// v2.2 dual-sink (Goal A / D4): observe.* are per-event human-output toggles —
// each gates whether that lifecycle event emits a human-facing systemMessage.
// Same invariant as nudge_mode: the AI additionalContext sink is unaffected.
// Absent → the nudge_mode preset decides. `.strict()` rejects unknown event keys
// so a typo fails loudly rather than silently disabling observation.
export const observeConfigSchema = z
  .object({
    session_start: z.boolean().optional(),
    pre_tool_use: z.boolean().optional(),
    stop: z.boolean().optional(),
  })
  .strict();

export const writeRouteSchema = z
  .object({
    scope: z
      .string()
      .regex(
        SCOPE_COORDINATE_PATTERN,
        "write route scope must be ':'-joined lowercase [a-z0-9_-] segments",
      ),
    store: z.string().min(1),
  })
  .strict();

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  // v2.1.0-rc.1 P0 (S13-projectid): the project's stable identity. A UUID
  // bound at `fabric install` time; a remote-derived hash is only a SUGGESTED
  // default, never authoritative (so re-homing the git remote does not change
  // project identity). Optional under the zero-user clean-slate — pre-v2.1
  // fabric-config.json files simply lack it and the ProjectRootResolver mints
  // one on next install. `.fabric/fabric-config.json` carrying this field is
  // also the upward marker the ProjectRootResolver searches for (S15/S32).
  project_id: z.string().optional(),
  // Store-only runtime binding identity. Defaults to project_id when omitted,
  // but worktrees / sandboxes can set this to isolate hook/runtime state while
  // keeping the same committed project identity.
  workspace_binding_id: z.string().optional(),
  // v2.1.0-rc.1 P0 (S59/B3): the stores this repo expects mounted. Each entry
  // names a store by alias/UUID with an optional suggested_remote (or the
  // `$personal` sentinel). Drives the read-set (required_stores ∪ implicit
  // personal, S11/S54) and `clone`'s missing-store onboarding (S51). Optional
  // + absent → read-set is just the implicit personal store.
  required_stores: z.array(requiredStoreEntrySchema).optional(),
  // v2.1.0-rc.1 P3 (S60 / `store switch-write`): alias of the store that
  // non-personal-scope writes land in for this project. Set by
  // `fabric store switch-write <alias>`; consumed as the resolver's
  // activeWriteAlias. Absent → no active write store yet. Personal-scope
  // writes always target the implicit personal store regardless (R5#3).
  active_write_store: z.string().optional(),
  // v2.1 global-refactor (W1/A2 — store project registry): the project this repo
  // currently participates in, as the SINGLE scope segment forming the
  // `project:<id>` coordinate (schemas/scope.ts). Set by `store bind --project
  // <id>` (validated against the bound store's projects.json). Drives:
  //   - write: project-scoped writes get `semantic_scope: project:<active_project>`.
  //   - recall: keep `project:<active_project>` + non-project coords, drop other
  //     `project:*` entries (G-FILTER).
  // Absent → the repo has no project binding; recall does not project-filter.
  active_project: z.string().optional(),
  // Global Store Topology: scope-aware write routing for multi shared/org stores.
  // Personal scope ignores these routes and always resolves to the implicit
  // personal store. `active_write_store` remains a backward-compatible fallback.
  write_routes: z.array(writeRouteSchema).optional(),
  default_write_store: z.string().optional(),
  // rc.17 (R-cut): the dev/test fixture-path config field was removed
  // end-to-end. The `EXTERNAL_FIXTURE_PATH` env var is now the sole source
  // consumed by `resolveDevMode()`. No z.preprocess alias — pre-rc.17
  // fabric-config.json files carrying the field will be silently dropped by
  // the lenient root parser (no .strict() at root). Pre-user clean-slate per
  // memory/feedback_clean_slate.md; mirrors the rc.12 hard-rename precedent
  // documented above.
  scanIgnores: z.array(z.string()).optional(),
  audit_mode: auditModeSchema.optional(),
  mcpPayloadLimits: mcpPayloadLimitsSchema,
  // grill-6fixes (D1): `fabric_language` is no longer a per-project field —
  // language is a single machine-wide tone in `~/.fabric/fabric-global.json`.
  // The root parser is lenient (no .strict()), so any stale `fabric_language`
  // key left in an existing project config is silently dropped.
  default_layer_filter: defaultLayerFilterSchema.optional().default("both"),
  // v2.2 dual-sink (Goal A / D4): human-output preset. See nudgeModeSchema for
  // the level semantics + the flow ⊥ observation invariant (nudge_mode never
  // touches the AI additionalContext sink). Default "normal" preserves the
  // pre-dual-sink human visibility so existing dogfood repos see no regression.
  nudge_mode: nudgeModeSchema.optional().default("normal"),
  // v2.2 dual-sink (Goal A / D4): per-event human-output overrides. A set value
  // wins over the nudge_mode preset for that event; absent events fall back to
  // the preset. AI sink unaffected (same invariant as nudge_mode).
  observe: observeConfigSchema.optional(),
  // Cooldown for the fabric-hint Stop hook (formerly archive-hint, renamed in
  // rc.5 TASK-010). After ANY of the three signals (archive / review / import)
  // fires, that signal stays silent for this many hours regardless of state
  // drift — purely a reminder throttle. Default 12 means "at most twice per
  // day if the user keeps ignoring it." Set to 24 to align with the archive
  // trigger threshold. The legacy `archive_hint_` key is retained for backward
  // compat with existing user fabric-config.json files.
  archive_hint_cooldown_hours: z.number().int().positive().optional().default(12),
  // Underseed-node threshold for the fabric-hint Stop hook's import signal
  // (rc.5 TASK-010). When the canonical knowledge node count is strictly less
  // than this value AND a successful `init_scan_completed` event happened at
  // least 24h ago AND no `knowledge_proposed` event has fired in the last 24h,
  // the hook recommends running the fabric-import skill. Default 10 reflects
  // the rule-of-thumb that a workspace with fewer than ten knowledge entries
  // is below the floor for plan_context retrieval to be meaningful. Also
  // consumed by `doctor` lint #22 (knowledge_underseeded).
  underseed_node_threshold: z.number().int().positive().optional().default(10),
  // Edit-count threshold for the fabric-hint Stop hook's Signal A
  // (rc.6 TASK-022 / E5). Signal A fires when EITHER (a) >=24h have elapsed
  // since the last `knowledge_proposed` event, OR (b) >=archive_edit_threshold
  // PreToolUse fires have been recorded in `.fabric/.cache/edit-counter` since
  // the last `knowledge_proposed` event. The edit-counter sidecar is populated
  // by the rc.6 PreToolUse hook (TASK-020 / E4) — one ISO-8601 line per fire.
  // Default 20 reflects the rule-of-thumb "after ~20 Edit/Write operations
  // there is probably something worth archiving"; lowered values nag more
  // aggressively, higher values rely on the 24h fallback. Missing or absent
  // edit-counter file degrades safely to the 24h-only path.
  archive_edit_threshold: z.number().int().positive().optional().default(20),
  // rc.7 T7: hours-since-last-knowledge_proposed cutoff for Signal A's
  // time branch. Was hardcoded as 24 in fabric-hint.cjs's THRESHOLD_HOURS;
  // externalized so chatty workspaces can lower the bar and quiet ones can
  // raise it. Default 24 preserves rc.6 behavior. See docs/configuration.md.
  archive_hint_hours: z.number().int().positive().optional().default(24),
  // rc.7 T7: pending-count cutoff for Signal B (review skill). Was
  // hardcoded as 10 in fabric-hint.cjs's THRESHOLD_PENDING_COUNT.
  // Default 10 preserves rc.6 behavior. See docs/configuration.md for
  // small/medium/large repo recommendations.
  review_hint_pending_count: z.number().int().positive().optional().default(10),
  // rc.7 T7: pending-age cutoff (in days) for Signal B (review skill).
  // Was hardcoded as 7 in fabric-hint.cjs's THRESHOLD_PENDING_AGE_DAYS.
  // Default 7 preserves rc.6 behavior. See docs/configuration.md.
  review_hint_pending_age_days: z.number().int().positive().optional().default(7),
  // rc.7 T7 + T10 pre-wiring: days-since-last-doctor cutoff for the future
  // Signal D (maintenance hint). T10 will consume this to decide when the
  // fabric-hint Stop hook surfaces a "run `fabric doctor`" reminder.
  // Default 14 reflects a fortnightly cadence — long enough to avoid nag,
  // short enough to catch index drift before it compounds.
  maintenance_hint_days: z.number().int().positive().optional().default(14),
  // rc.7 T7 + T10 pre-wiring: cooldown between Signal D reminders, in
  // days. Once Signal D fires, it stays silent for this many days even if
  // the user doesn't run doctor. Default 7 keeps the reminder weekly at
  // worst — pairing 14d trigger + 7d cooldown means at most ~2 reminders
  // per month for a workspace that ignores them.
  maintenance_hint_cooldown_days: z.number().int().positive().optional().default(7),
  // rc.9+ (skill-contract-fix B1): first-run import window in months. The
  // `fabric-import` skill scans this many months of git history on the very
  // first invocation (when no prior `import_run_completed` event exists).
  // Default 60 (~5 years) captures the bulk of a mature repo's signal in
  // one pass; small / fresh repos can lower to 12-24 with no loss.
  import_window_first_run_months: z.number().int().min(1).optional().default(60),
  // rc.9+ (skill-contract-fix B1): rerun import window in months. After
  // the first successful import, subsequent runs only scan this many
  // recent months — assumed everything older has already been crystallized
  // into pending or canonical knowledge. Default 2 keeps incremental cost
  // low; raise to 6 if the workspace pauses fabric-import for long stretches.
  import_window_rerun_months: z.number().int().min(1).optional().default(2),
  // rc.9+ (skill-contract-fix B1): hard cap on pending entries produced
  // per fabric-import invocation. Prevents one run from dumping hundreds
  // of proposals when a backfill window is wide open. Default 10 matches
  // the rule-of-thumb "human can triage ~10 pending entries in one
  // review pass." Range 1-50.
  import_max_pending_per_run: z.number().int().min(1).max(50).optional().default(10),
  // rc.9+ (skill-contract-fix B1): hard cap on commits scanned per
  // fabric-import invocation. Bounds runtime on monorepos with high
  // commit velocity. Default 500 covers ~2 months of typical churn;
  // range 50-2000. Hitting the cap mid-window is logged but non-fatal.
  import_max_commits_scan: z.number().int().min(50).max(2000).optional().default(500),
  // rc.9+ (skill-contract-fix B1): canonical-node count above which
  // fabric-import's pre-flight should warn / suggest review instead of
  // proceeding. A workspace with 50+ canonical entries usually benefits
  // more from `fabric-review` to consolidate than from importing more.
  // Default 50; raise to 100+ for large polyglot repos.
  import_skip_canonical_threshold: z.number().int().positive().optional().default(50),
  // rc.9+ (skill-contract-fix B1): max candidate entries surfaced per
  // fabric-archive batch (one invocation of the skill). Pagination knob
  // for the archive UI flow. Default 8 keeps each batch reviewable in
  // one sitting; raise for large repos with high archive throughput.
  archive_max_candidates_per_batch: z.number().int().positive().optional().default(8),
  // rc.9+ (skill-contract-fix B1): max recently-touched paths included
  // in fabric-archive's "relevant context" lookup. Limits the size of
  // the path-relevance digest the skill emits when ranking candidates.
  // Default 20; large repos with deep directory fan-out can raise to
  // 50+ if archive candidates feel under-contextualized.
  archive_max_recent_paths: z.number().int().positive().optional().default(20),
  // rc.9+ (skill-contract-fix B1): max prior fabric-archive sessions
  // summarised in the digest the skill loads on start. Prevents the
  // digest from ballooning past the model context budget on workspaces
  // that have archived repeatedly. Default 10; lower if context pressure
  // bites, raise if you want longer-range archive trend visibility.
  archive_digest_max_sessions: z.number().int().positive().optional().default(10),
  // rc.9+ (skill-contract-fix B1): max review results returned per
  // topic when `fabric-review` clusters pending entries. Pagination
  // knob analogous to archive_max_candidates_per_batch but scoped to
  // each topic cluster. Default 8; raise to 15-20 for large repos
  // where each topic legitimately groups many pending entries.
  review_topic_result_cap: z.number().int().positive().optional().default(8),
  // rc.9+ (skill-contract-fix B1): age threshold (in days) above which
  // a pending entry is considered "stale" by fabric-review and surfaced
  // for explicit resolve-or-drop decision. Default 14; tighter than the
  // 7d Signal-B trigger because review specifically targets the long
  // tail. Large repos with slower cadence can raise to 30.
  review_stale_pending_days: z.number().int().positive().optional().default(14),
  // v2.0.0-rc.34 TASK-05: reverse-unarchive opt-in. When true, callers of the
  // `unarchiveKnowledge` primitive (and any future doctor auto-detect lint built
  // on top) will execute the file move + ledger emit. When false (default),
  // the same callers MUST short-circuit before any mutation — the primitive is
  // shipped but inert until explicitly enabled. Opt-in posture mirrors the
  // archive-flow precedent: destructive-ish file moves stay behind a flag.
  reverse_unarchive_enabled: z.boolean().optional().default(false),
  // v2.0.0-rc.34 TASK-05: forces `unarchiveKnowledge` into dry-run mode even
  // when called with `options.dryRun=false`. Lets operators preview a
  // restoration pass before flipping `reverse_unarchive_enabled` to true.
  reverse_unarchive_dry_run: z.boolean().optional().default(false),
  // v2.0.0-rc.34 TASK-06: long-session cite-policy evict window in user-prompt
  // turns. UserPromptSubmit hook (Claude Code only) maintains a per-session
  // counter and re-injects the cite contract reminder via
  // hookSpecificOutput.additionalContext when `turn_count % interval === 0`.
  // Default 0 = OFF (opt-in). Recommend 10-20 for active sessions; 5 for
  // high-contract-criticality projects. Other strategies (time-based,
  // token-budget) deferred to rc.35 per plan locked-decisions 2026-05-26.
  cite_evict_interval: z.number().int().min(0).optional().default(0),
  // v2.1 ⑤ cite-redesign (P5): recall-based cite-accounting hook config. The
  // rc.34 cite_evict_interval turn-counter above is superseded by the
  // PreToolUse(Edit/Write) recall-aware nudge in cite-policy-evict.cjs; the old
  // key is retained for back-compat (inert now that the hook moved off
  // UserPromptSubmit). `cite_recall_nudge` is the master switch (default true =
  // ON); set false to silence the "改前先 fab_recall" nudge entirely (mirrors
  // the cite_evict_interval=0 opt-out convention). `cite_recall_window_minutes`
  // bounds how far back an in-session fab_recall counts as "informing" the edit
  // (default 30; 0 = unbounded).
  cite_recall_nudge: z.boolean().optional().default(true),
  cite_recall_window_minutes: z.number().int().min(0).optional().default(30),
  // F2: glob exemptions for the cite nudge (cite-policy-evict.cjs). Edit paths
  // matching any glob skip the "改前先 fab_recall" nudge — meta/orchestration
  // files (e.g. `.workflow/` scratchpads) are not source the cite policy
  // governs. MERGED with the hook's built-in [".workflow/**"] default; an
  // omitted/empty value keeps just that default. `*` = within a path segment,
  // `**` = across segments.
  cite_nudge_ignore_globs: z.array(z.string()).optional(),
  // v2.1 ④ conflict-detection (P4): bm25 content-similarity threshold (0..1)
  // for the knowledge-conflict lint (`fabric doctor --lint-conflicts`). A
  // same-(type,layer) pair whose normalized bm25 similarity reaches this floor
  // is surfaced as a candidate (possible duplicate OR conflict). Conservative
  // default 0.5 — raise to reduce noise, lower to catch looser pairs.
  conflict_lint_similarity_threshold: z.number().min(0).max(1).optional().default(0.5),
  // v2.0.0-rc.22 Scope A T3: sliding-window retention (in days) for the
  // event ledger rotation primitive (`rotateEventLedgerIfNeeded`). Lines
  // whose `ts` is older than `now - fabric_event_retention_days * 86_400_000`
  // are partitioned into `.fabric/events.archive/events-rotated-YYYY-MM-DD.jsonl`.
  // Locked to 7/30/90 — three operator-friendly preset windows. Default 30
  // is applied at the consumer site (rotateEventLedgerIfNeeded), so this
  // field stays `.optional()` without a `.default()` to keep the schema
  // surface honest: absence means "use the library default", not "schema
  // default of 30 was injected." 7 = ~tight, 30 = balanced, 90 = forensic.
  // Mirrors cite-policy precedent of locking enum-style numeric tunables
  // to a small literal set (vs free `.positive()`) to prevent fat-finger
  // misconfig.
  fabric_event_retention_days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  // v2.0.0-rc.23 TASK-014 (F8c): onboard slot opt-out list. Tracks slot
  // names the user explicitly dismissed during fabric-archive's first-run
  // onboard phase (or via `fabric config dismiss-slot <slot>`). Dismissed
  // slots are excluded from `fabric onboard-coverage`'s `missing` set and the
  // doctor `Onboard coverage` advisory's recompute, so the user is never
  // re-prompted for slots they consciously declined.
  //
  // Re-opening a dismissed slot requires `fabric config onboard-reset <slot>`
  // — a deliberate two-command UX to keep the dismiss intent reversible
  // but never silently undone. Schema is intentionally `z.array(z.string())`
  // rather than `z.array(onboardSlotSchema)` so historical configs survive
  // a slot rename without a Zod parse error; downstream consumers
  // intersect against ONBOARD_SLOT_NAMES at read time.
  //
  // Default `[]` keeps the field optional on existing configs — fresh
  // installs land with no opt-outs.
  onboard_slots_opted_out: z.array(z.string()).optional().default([]),
  // v2.0.0-rc.33 W2-1 (P0-9): TopK upper bound for the broad SessionStart hint
  // banner emitted by knowledge-hint-broad.cjs. After plan-context-hint returns
  // its full broad-scoped index, the hook slices the entries to this many
  // before grouping/truncation rendering — keeps the banner from scrolling off
  // screen on well-seeded repos (Werewolf-class projects routinely surface 40+
  // broad entries which buried the actually-relevant top hits). Default 8 is
  // calibrated against the rc.32 eval baseline (cite-coverage 3.1%): the
  // banner needs to fit in ~1 screenful so the agent actually reads it.
  // Range 1..50; values above 20 effectively disable the cap because the
  // TRUNCATION_THRESHOLD=12 grouped-render kicks in. Mirrors the rc.7 T7 +
  // archive_max_* pattern of externalizing previously-hardcoded thresholds.
  hint_broad_top_k: z.number().int().min(1).max(50).optional().default(8),
  // v2.2 HK2-degrade (W2-T2): char budget for the rendered SessionStart broad-menu
  // body — the final rung of the degradation ladder after the hint_broad_top_k
  // count slice. Once the rendered entry/group lines exceed this, the tail
  // collapses to a single "N more omitted" marker so a large corpus cannot blow
  // the agent's working memory. Default 2000 (~one screenful); 0 disables the
  // budget. Read by knowledge-hint-broad.cjs via readConfigNumber. Range 0..20000.
  hint_broad_budget_chars: z.number().int().min(0).max(20000).optional().default(2000),
  // v2.0.0-rc.37 NEW-16: durable per-signal dismiss for the fabric-hint Stop
  // hook nudges. Any signal type listed here is suppressed at emit time across
  // all sessions (the session-scoped sibling lives in a .fabric/.cache sidecar
  // written on request). Mirrors the cite_evict_interval=0 opt-out convention —
  // a knob for an existing surface, not a new feature. Unknown types ignored.
  hint_dismiss_signals: z
    .array(z.enum(["archive", "review", "import", "maintenance"]))
    .optional(),
  // v2.1 ADJ-NEWN-4: user-override escape hatches for the two strong behavioral
  // policies (cite-before-edit + self-archive). The strong policies can make an
  // agent feel like a "stubborn parrot" (D2 user-in-control red line); these
  // flags let a user durably turn either off via fabric-config.json (or the
  // `fabric config` panel) without editing bootstrap/AGENTS.md. Default true
  // preserves rc.x behavior (policies ON); set false to opt a project out.
  // The bootstrap behavior layer references these so the AGENTS.md rules degrade
  // from "MUST" to "optional" when disabled — a config knob for an existing
  // surface, mirroring the cite_evict_interval=0 / hint_dismiss_signals opt-out
  // convention, NOT a new feature. Wave3 J32 will quantify the friction these
  // relieve; until then they ship as inert-safe opt-outs.
  cite_policy_enabled: z.boolean().optional().default(true),
  self_archive_policy_enabled: z.boolean().optional().default(true),
  // v2.0.0-rc.33 W2-1 (P0-9): TopK upper bound for the narrow PreToolUse hint
  // emitted by knowledge-hint-narrow.cjs. After filtering to entries whose
  // `relevance_scope === "narrow"` (rc.27 TASK-005 audit §2.5 fix), the hook
  // slices to this many before the E3 emit-gate / renderSummary pipeline.
  // Default 5 keeps each per-Edit hint terse — five lines max so the agent's
  // working memory is not displaced by an unwieldy banner. Range 1..20.
  hint_narrow_top_k: z.number().int().min(1).max(20).optional().default(5),
  // v2.0.0-rc.33 W2-1 (P0-9): per-file dedup window (in PreToolUse turns) for
  // the narrow hint. Same (file_path, stable_id) tuple stays silent for this
  // many turns even when the E3 cross-session cache would otherwise re-emit.
  // Closes the rc.32 eval finding that a single hot file (e.g. werewolf
  // GameRoom.tsx edited 30 times in a row) re-fired the same narrow hint
  // each time, training the agent to ignore it. Default 5; range 1..50.
  // Storage: .fabric/.cache/narrow-dedup-window.json — distinct from session-
  // hints cache so a window-only suppression does not poison cross-session
  // dedupe semantics.
  hint_narrow_dedup_window_turns: z.number().int().min(1).max(50).optional().default(5),
  // v2.0.0-rc.33 W2-5 (P1-8): cooldown between broad SessionStart hint emits,
  // in hours. Distinct from the archive_hint_cooldown_hours that gates the
  // fabric-hint Stop hook — knowledge-hint-broad re-fires on every
  // SessionStart by default (compact / clear / new-window), which on long
  // sessions becomes redundant noise. Setting to 1 means "emit the broad
  // menu at most once per hour"; 0 means "no cooldown, current behavior."
  // Range 0..168 (one week). Stored alongside fabric-hint's cooldown cache
  // under a distinct knowledge-hint-broad key.
  hint_broad_cooldown_hours: z.number().int().min(0).max(168).optional().default(0),
  // v2.0.0-rc.33 W2-5 (P1-8): cooldown for the narrow PreToolUse hint.
  // Same shape as hint_broad_cooldown_hours but applies to per-Edit hint
  // re-emission across the cooldown window — independent of E3 session-
  // hints dedupe. Default 0 preserves rc.32 behavior; set to e.g. 1 to
  // throttle hint frequency during rapid-fire editing sprints. Range
  // 0..168 (one week).
  hint_narrow_cooldown_hours: z.number().int().min(0).max(168).optional().default(0),
  // v2.0.0-rc.33 W4-B3 (T5 P2): per-maturity inactivity thresholds (days)
  // driving orphan_demote. Hardcoded at proven=90/verified=30/draft=14 in
  // rc.32; chatty workspaces want them tighter, slow ones want them looser.
  // Each field optional; absent → defaults inside doctor.ts apply. Ranges
  // chosen so a typo can't accidentally disable the lint (min 1).
  //
  // v2.2 W3-T5 (F-MATURITY-ENDORSED): the canonical maturity enum is
  // draft/verified/proven (KT-DEC-0005). These threshold keys use the canonical
  // vocabulary; the loader maps proven→stable / verified→endorsed onto the
  // doctor's internal orphan_demote ladder.
  orphan_demote_proven_days: z.number().int().min(1).max(3650).optional(),
  orphan_demote_verified_days: z.number().int().min(1).max(3650).optional(),
  orphan_demote_draft_days: z.number().int().min(1).max(3650).optional(),
  // v2.0.0-rc.33 W4-A3 (T4 P2): per-entry summary truncation length used by
  // knowledge-hint-{broad,narrow}.cjs. Hard-coded at 80 chars in rc.32 — too
  // short for entries with parameterized summaries (e.g. "Use bcrypt with
  // cost=12 for password hashing"), too long for terse pitfalls. Range 40..240;
  // default 80 preserves rc.32 behavior. Both hooks read the same key so the
  // banner styling stays consistent across SessionStart + PreToolUse.
  hint_summary_max_len: z.number().int().min(40).max(240).optional().default(80),
  // v2.0.0-rc.33 W2-6 (P0-7 + P0-8): when true, knowledge-hint hooks emit
  // their banners as `hookSpecificOutput.additionalContext` JSON on stdout
  // (per Claude Code PreToolUse hook contract — see
  // https://docs.claude.com/en/docs/claude-code/hooks#preToolUse), so the
  // agent receives them in-context instead of as stderr breadcrumbs the
  // user may not surface to the model. Default true reflects the rc.33 cite-
  // coverage focus (rc.32 baseline 3.1% → primary cause: reminders never
  // entered model context). Set false to revert to legacy stderr-only mode
  // for hosts that don't honor the JSON contract.
  hint_reminder_to_context: z.boolean().optional().default(true),
  // v2.0.0-rc.29 TASK-008 (BUG-F3): selection-token TTL override. The
  // `fab_plan_context` MCP tool hands clients a `selection_token` whose default
  // 5-minute lifetime (`SELECTION_TOKEN_TTL_MS` at
  // packages/server/src/services/plan-context.ts:91) was hard-coded and could
  // not be tuned for slow review cycles. Operators on long-running sessions
  // (manual paste-and-review flows, debugger pauses, etc.) reported tokens
  // expiring mid-review. Override here; absence means "use the library default
  // of 5*60*1000 ms." Range 30s..1h keeps the value useful — below 30s the
  // token expires before MCP round-trips finish; above 1h it stops being a
  // meaningful liveness signal for the plan-context cache.
  //
  // The single-field schema is exported separately (`selectionTokenTtlMsSchema`)
  // so the server-side per-field reader can validate without re-running the
  // whole fabricConfigSchema on every plan_context call — that lets a corrupt
  // unrelated field stay isolated from the hot read path.
  selection_token_ttl_ms: selectionTokenTtlMsSchema.optional(),
  // v2.2 A-INFRA-3 (W1-T3-TOPK): bound on `fab_plan_context` candidate count,
  // applied after BM25 ranking. Absent → library default (24). See
  // planContextTopKSchema for the range/calibration rationale.
  plan_context_top_k: planContextTopKSchema.optional(),
  // v2.2 C5-budget (W2-T3): layered retrieval budget profile. A single coherent
  // strategy across the injection + MCP layers — `balanced` (default) reproduces
  // the historical per-knob defaults exactly, `conservative` / `generous` scale
  // the whole truncation chain (top_k + payload bytes + injection chars) down /
  // up together. Per-field knobs (plan_context_top_k, mcpPayloadLimits.*,
  // hint_broad_budget_chars) still override the profile when set. See
  // retrieval-budget.ts (resolveRetrievalBudget) for the resolution order.
  retrieval_budget_profile: z.enum(["conservative", "balanced", "generous"]).optional(),
  // grill-report C-009 / R2-R5 mitigation knob: per-field override for the
  // fab_recall body-tier budget (bytes). Absent → derived from the profile
  // (balanced = 4096). Bump it if the lean default drops too many bodies and the
  // AI is not following up with fab_get_knowledge_sections (R2 observation).
  // Range 256B..1MB — below 256B even one body never fits; above 1MB defeats the
  // whole lean-recall purpose. Overrides the profile when set, like the other
  // per-field knobs.
  recall_body_budget_bytes: z.number().int().min(256).max(1_048_576).optional(),
  // v2.2 C2-vector (W2-T7): OPTIONAL dense-embedding semantic retrieval, layered
  // as a recall supplement after BM25. Default OFF (`--no-embed` is the baseline);
  // requires the operator to install the optional `fastembed` package — absent →
  // text-only fallback. Never grows the default install footprint.
  embed_enabled: z.boolean().optional().default(false),
  // Weight applied to the 0..1 cosine similarity before it joins the additive
  // score. Capped at 49 — strictly BELOW BM25_WEIGHT (50) — so a perfect vector
  // match (weight × 1) can never outscore a single strong BM25 term match. This
  // ENFORCES the "vectors supplement, never override lexical relevance"
  // invariant in the schema rather than leaving it to a comment (W2-REVIEW codex
  // MED-4). Range 0..49; default 30.
  embed_weight: z.number().int().min(0).max(49).optional().default(30),
  // v2.1 ③ vector-chinese-model (P3): which fastembed model to load. The prior
  // code pinned fastembed's English default (bge-small-en-v1.5) — wrong for the
  // Chinese-heavy zh-CN-hybrid KB. Values are the fastembed@2.x EmbeddingModel
  // enum strings. Default `fast-bge-small-zh-v1.5` (BGESmallZH): light, fast,
  // Chinese-capable (bm25 already covers English/code tokens; the vector term
  // supplements Chinese semantics). `fast-multilingual-e5-large` (MLE5Large) is
  // available for full multilingual recall at a ~1GB download + slower CPU cost.
  // (V1 research: fastembed@2.1.0 has NO multilingual-e5-SMALL — the originally
  // planned pin — so bge-small-zh is the light Chinese choice.)
  embed_model: z
    .enum([
      "fast-bge-small-zh-v1.5",
      "fast-multilingual-e5-large",
      "fast-bge-small-en-v1.5",
      "fast-bge-small-en",
      "fast-bge-base-en-v1.5",
      "fast-bge-base-en",
      "fast-all-MiniLM-L6-v2",
    ])
    .optional()
    .default("fast-bge-small-zh-v1.5"),
});

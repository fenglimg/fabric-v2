import { z } from "zod";

export const auditModeSchema = z.enum(["strict", "warn", "off"]);

// v2.0: Fabric scope is locked to Claude Code, Cursor, and Codex CLI.
// Unknown clientPaths keys (e.g. windsurf, rooCode, geminiCLI from v1.x) are
// rejected at parse time via .strict() — there is no soft-deprecation path.
// Adding a new client requires extending this schema explicitly.
export const clientPathsSchema = z
  .object({
    claudeCodeCLI: z.string().optional(),
    claudeCodeDesktop: z.string().optional(),
    cursor: z.string().optional(),
    codexCLI: z.string().optional(),
  })
  .strict();

export const mcpPayloadLimitsSchema = z.object({
  warnBytes: z.number().int().positive().optional(),
  hardBytes: z.number().int().positive().optional(),
}).optional();

// v2.0 (grill-followup Q3) / rc.12 broad-gate-fabric-lang: Drives init-scan
// baseline template language and the zh-CN body rewrite policy.
// `match-existing` preserves whatever language the project is already
// authoring knowledge in; explicit `zh-CN` / `en` lock the policy regardless
// of detected content; `zh-CN-hybrid` renders Chinese narrative prose with
// English technical terms preserved (MCP tool names, CLI commands, file
// paths, Skill/Fabric protected tokens).
//
// rc.12 hard rename: this used to be `knowledgeLanguageSchema` and the
// associated config field was `knowledge_language`. There is no z.preprocess
// alias — pre-rc.12 fabric-config.json files will fail parse with a clear
// "Unrecognized key" error (acceptable under the zero-user clean-slate).
export const fabricLanguageSchema = z.enum([
  "match-existing",
  "zh-CN",
  "en",
  "zh-CN-hybrid",
]);

// v2.0 (grill-followup Q6): Fallback for `fab_plan_context` when the caller
// omits `layer_filter`. `both` keeps team and personal knowledge in scope;
// `team` / `personal` narrow the default surface for projects that only
// curate one layer.
export const defaultLayerFilterSchema = z.enum(["team", "personal", "both"]);

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
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
  // Backward-compat: both fields are optional with defaults so existing
  // fabric-config.json files (pre-grill-followup) parse unchanged. The default
  // values themselves are load-bearing — see docs/data-schema.md.
  fabric_language: fabricLanguageSchema.optional().default("match-existing"),
  default_layer_filter: defaultLayerFilterSchema.optional().default("both"),
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
});

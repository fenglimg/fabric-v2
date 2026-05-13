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

// v2.0 (grill-followup Q3): Drives init-scan baseline template language and
// the zh-CN body rewrite policy. `match-existing` preserves whatever language
// the project is already authoring knowledge in; explicit `zh-CN` / `en` lock
// the policy regardless of detected content.
export const knowledgeLanguageSchema = z.enum(["match-existing", "zh-CN", "en"]);

// v2.0 (grill-followup Q6): Fallback for `fab_plan_context` when the caller
// omits `layer_filter`. `both` keeps team and personal knowledge in scope;
// `team` / `personal` narrow the default surface for projects that only
// curate one layer.
export const defaultLayerFilterSchema = z.enum(["team", "personal", "both"]);

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  externalFixturePath: z.string().optional(),
  scanIgnores: z.array(z.string()).optional(),
  auditMode: auditModeSchema.optional(),
  audit_mode: auditModeSchema.optional(),
  mcpPayloadLimits: mcpPayloadLimitsSchema,
  // Backward-compat: both fields are optional with defaults so existing
  // fabric-config.json files (pre-grill-followup) parse unchanged. The default
  // values themselves are load-bearing — see docs/data-schema.md.
  knowledge_language: knowledgeLanguageSchema.optional().default("match-existing"),
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
});

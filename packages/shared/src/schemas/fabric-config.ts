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
});

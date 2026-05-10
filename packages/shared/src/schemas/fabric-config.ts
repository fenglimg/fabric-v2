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
});

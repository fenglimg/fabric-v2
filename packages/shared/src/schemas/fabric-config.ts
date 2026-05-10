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

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  externalFixturePath: z.string().optional(),
  scanIgnores: z.array(z.string()).optional(),
  auditMode: auditModeSchema.optional(),
  audit_mode: auditModeSchema.optional(),
  mcpPayloadLimits: mcpPayloadLimitsSchema,
});

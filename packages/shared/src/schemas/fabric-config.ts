import { z } from "zod";

export const auditModeSchema = z.enum(["strict", "warn", "off"]);

// Legacy keys (windsurf, rooCode, geminiCLI) are preserved via .passthrough()
// so existing fabric.config.json files do not fail validation (TASK-012).
// Deprecation warnings for those keys are scheduled for TASK-037 (v1.7.1).
export const clientPathsSchema = z
  .object({
    claudeCodeCLI: z.string().optional(),
    claudeCodeDesktop: z.string().optional(),
    cursor: z.string().optional(),
    codexCLI: z.string().optional(),
  })
  .passthrough();

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  externalFixturePath: z.string().optional(),
  scanIgnores: z.array(z.string()).optional(),
  auditMode: auditModeSchema.optional(),
  audit_mode: auditModeSchema.optional(),
});

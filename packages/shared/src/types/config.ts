import type { z } from "zod";

import type { fabricConfigSchema } from "../schemas/fabric-config.js";

export interface ClientPaths {
  claudeCodeCLI?: string;
  claudeCodeDesktop?: string;
  cursor?: string;
  codexCLI?: string;
  codexDesktop?: string;
}

export type AuditMode = "strict" | "warn" | "off";

export interface McpPayloadLimits {
  warnBytes?: number;
  hardBytes?: number;
}

// v2.0 (grill-followup Q3) / rc.12 broad-gate-fabric-lang: drives bilingual
// init-scan templates. Mirrored from packages/shared/src/schemas/fabric-config.ts
// → keep in sync. All four values are user-facing because install/doctor can
// preserve or surface legacy-compatible `match-existing` and `zh-CN-hybrid`.
export type FabricLanguage =
  | "match-existing"
  | "zh-CN"
  | "en"
  | "zh-CN-hybrid";

// v2.0 (grill-followup Q6): default layer scope for fab_plan_context.
export type DefaultLayerFilter = "team" | "personal" | "both";

// v2.0.0-rc.30 TASK-001: replaced the hand-written interface with a z.input
// view derived from fabricConfigSchema. This roots out the rc.21/24/29 drift
// pattern (CI tsc --noEmit catching fields read at runtime but missing from
// the type) by making the schema the single source of truth — every new field
// added to fabricConfigSchema is automatically typed for every consumer.
// `z.input` (not `z.infer` / `z.output`) preserves the "raw user JSON"
// optionality semantics — fields with .default() stay optional in the type,
// matching what readFabricConfig actually returns (raw parsed JSON, not the
// post-default-resolution shape).
export type FabricConfig = z.input<typeof fabricConfigSchema>;

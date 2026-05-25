export interface ClientPaths {
  claudeCodeCLI?: string;
  claudeCodeDesktop?: string;
  cursor?: string;
  codexCLI?: string;
}

export type AuditMode = "strict" | "warn" | "off";

export interface McpPayloadLimits {
  warnBytes?: number;
  hardBytes?: number;
}

// v2.0 (grill-followup Q3) / rc.12 broad-gate-fabric-lang: drives bilingual
// init-scan templates. Mirrored from packages/shared/src/schemas/fabric-config.ts
// → keep in sync. `zh-CN-hybrid` (rc.12) renders Chinese narrative with
// English technical terms preserved.
export type FabricLanguage =
  | "match-existing"
  | "zh-CN"
  | "en"
  | "zh-CN-hybrid";

// v2.0 (grill-followup Q6): default layer scope for fab_plan_context.
export type DefaultLayerFilter = "team" | "personal" | "both";

export interface FabricConfig {
  clientPaths?: ClientPaths;
  scanIgnores?: string[];
  audit_mode?: AuditMode;
  mcpPayloadLimits?: McpPayloadLimits;
  fabric_language?: FabricLanguage;
  default_layer_filter?: DefaultLayerFilter;
  // v2.0.0-rc.29 hotfix: rc.29 ship pipeline caught a long-standing drift
  // between this hand-written `FabricConfig` interface and `fabricConfigSchema`
  // — TASK-008 BUG-F3 added a `selection_token_ttl_ms` read in
  // `config-loader.ts:50` but the field was never declared here, so local
  // `tsup --dts` passed while CI's `tsc --noEmit` failed with TS2339.
  // Minimal-surface fix: declare the one field used by the config-loader. The
  // broader interface↔schema drift (~20 other fabricConfigSchema fields not
  // mirrored here) is tracked separately for rc.30 (candidate: replace this
  // interface with `z.infer<typeof fabricConfigSchema>` once we audit
  // downstream type imports).
  selection_token_ttl_ms?: number;
}

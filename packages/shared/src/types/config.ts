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

// v2.0 (grill-followup Q3): drives bilingual init-scan templates. Mirrored
// from packages/shared/src/schemas/fabric-config.ts → keep in sync.
export type KnowledgeLanguage = "match-existing" | "zh-CN" | "en";

// v2.0 (grill-followup Q6): default layer scope for fab_plan_context.
export type DefaultLayerFilter = "team" | "personal" | "both";

export interface FabricConfig {
  clientPaths?: ClientPaths;
  externalFixturePath?: string;
  scanIgnores?: string[];
  auditMode?: AuditMode;
  audit_mode?: AuditMode;
  mcpPayloadLimits?: McpPayloadLimits;
  knowledge_language?: KnowledgeLanguage;
  default_layer_filter?: DefaultLayerFilter;
}

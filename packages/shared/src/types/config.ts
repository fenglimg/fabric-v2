export interface ClientPaths {
  claudeCodeCLI?: string;
  claudeCodeDesktop?: string;
  cursor?: string;
  windsurf?: string;
  rooCode?: string;
  geminiCLI?: string;
  codexCLI?: string;
}

export type AuditMode = "strict" | "warn" | "off";

export interface FabricConfig {
  clientPaths?: ClientPaths;
  externalFixturePath?: string;
  scanIgnores?: string[];
  auditMode?: AuditMode;
  audit_mode?: AuditMode;
}

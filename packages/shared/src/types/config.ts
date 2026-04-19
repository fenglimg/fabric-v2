export interface ClientPaths {
  claudeCodeCLI?: string;
  claudeCodeDesktop?: string;
  cursor?: string;
  windsurf?: string;
  rooCode?: string;
  geminiCLI?: string;
  codexCLI?: string;
}

export interface FabricConfig {
  clientPaths?: ClientPaths;
  externalFixturePath?: string;
  scanIgnores?: string[];
}

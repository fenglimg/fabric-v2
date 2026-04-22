export type ClientKind =
  | "ClaudeCodeCLI"
  | "ClaudeCodeDesktop"
  | "Cursor"
  | "Windsurf"
  | "RooCode"
  | "GeminiCLI"
  | "CodexCLI";

export type ServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export interface ClientConfigWriter {
  clientKind: ClientKind;
  detect(workspaceRoot: string, overridePath?: string): Promise<string | null>;
  write(serverPath: string, workspaceRoot: string, overridePath?: string): Promise<void>;
}

/**
 * serverPath may be absolute (global install) or project-relative (local install).
 */
export function createServerEntry(serverPath: string): ServerEntry {
  return {
    command: process.execPath,
    args: [serverPath],
  };
}

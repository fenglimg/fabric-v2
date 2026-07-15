import { resolve } from "node:path";

export type ClientKind =
  | "ClaudeCodeCLI"
  | "ClaudeCodeDesktop"
  | "CodexCLI";

export type ServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/**
 * Result of a {@link ClientConfigWriter.remove} invocation. The shape mirrors
 * the per-client install report consumed by `fabric uninstall` so the orchestrator
 * can roll detail records up into a single summary table.
 *
 * Semantics:
 *   - `removed`  — the named server entry was present and has been pruned;
 *                  `path` is the config file that was rewritten.
 *   - `skipped`  — nothing to do: the config file does not exist, or the named
 *                  server entry is not present. `path` may be the detected
 *                  config path (when the file existed but lacked the entry)
 *                  or `undefined` (when the client itself is not installed).
 *                  `message` carries a short reason ("not-present", "no-config-path").
 *   - `error`    — write attempted but failed. `path` is the offending file;
 *                  `message` carries the error text. Best-effort callers log
 *                  and continue with the next client.
 */
export type RemoveResult = {
  status: "removed" | "skipped" | "error";
  path?: string;
  message?: string;
};

export interface ClientConfigWriter {
  clientKind: ClientKind;
  detect(workspaceRoot: string, overridePath?: string): Promise<string | null>;
  write(serverPath: string, workspaceRoot: string, overridePath?: string): Promise<void>;
  /**
   * Prune the named MCP server entry from the client's config. Idempotent and
   * best-effort: missing config files / absent entries return `skipped` rather
   * than throwing. Preserves every other `mcpServers` entry byte-for-byte so
   * users do not lose their other-tool registrations.
   *
   * Added in rc.9 for the `fabric uninstall` MCP stage. See {@link RemoveResult}
   * for the result schema.
   */
  remove(serverName: string, workspaceRoot: string, overridePath?: string): Promise<RemoveResult>;
}

/**
 * serverPath may be absolute (global install) or project-relative (local install).
 *
 * ISS-58 (GH): when `projectRoot` is supplied, pin `FABRIC_PROJECT_ROOT` in the
 * generated entry's env. The MCP client spawns the server with an UNCONTROLLED
 * cwd (observed: `/`, or another fabric-installed repo). meta-reader's
 * resolveProjectRoot() then either resolves nothing (cwd=`/` → empty write_routes
 * → `fab_propose` "no write-target" + recall degraded to personal-only, silently)
 * or git-anchors onto the WRONG repo (cwd=other project → silent cross-project
 * read/write — a data-integrity risk). Pinning the trusted-operator override at
 * install time makes the resolver deterministic regardless of spawn cwd. env is
 * serialized by BOTH client formats (json deepMerge + codex TOML managed block),
 * and FABRIC_PROJECT_ROOT is the highest-priority signal resolveProjectRoot reads.
 */
export function createServerEntry(serverPath: string, projectRoot?: string): ServerEntry {
  const entry: ServerEntry = {
    command: process.execPath,
    args: [serverPath],
  };
  if (typeof projectRoot === "string" && projectRoot.length > 0) {
    entry.env = { FABRIC_PROJECT_ROOT: resolve(projectRoot) };
  }
  return entry;
}

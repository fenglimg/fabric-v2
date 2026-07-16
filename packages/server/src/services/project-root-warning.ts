/**
 * ISS werewolf-minigame (rootless MCP spawn, KT-PIT-0046): when the MCP host
 * launches the server with cwd=/ and no env (Claude desktop app respawn), the
 * resolved project root carries no `.fabric/fabric-config.json`, so
 * `required_stores` is empty and the read-set silently collapses to the
 * personal store — team knowledge disappears with zero signal (the hooks run
 * through the CLI path and keep working, masking the outage for days).
 *
 * This module is the loud half of the fix (KT-PIT-0042: silent best-effort
 * degradation needs a positive sink). Every MCP tool response appends this
 * warning while the root is unconfigured, and `startStdioServer` mirrors it to
 * stderr + the initialize instructions.
 */

import { isProjectRootConfigured } from "../meta-reader.js";

/**
 * Mirrors `structuredWarningSchema` (code/file/message?/action_hint) the same
 * way `GateWarning` does — declared locally so tool handlers can append it
 * without a cross-package import dance. `code` stays `string` for structural
 * assignability into the tools' existing warning arrays.
 */
export interface ProjectRootWarning {
  code: string;
  file: string;
  message: string;
  action_hint: string;
}

export const PROJECT_ROOT_UNRESOLVED_CODE = "project_root_unresolved";

export function projectRootUnresolvedMessage(projectRoot: string): string {
  return (
    `project root unresolved — serving personal store only ` +
    `(resolved "${projectRoot}", no .fabric/fabric-config.json found; team stores are NOT loaded)`
  );
}

const PROJECT_ROOT_ACTION_HINT =
  "Set FABRIC_PROJECT_ROOT (or CLAUDE_PROJECT_DIR) in the MCP server env, launch the server from inside the project, " +
  "or use an MCP client that exposes workspace roots (adopted automatically after initialize). " +
  "Run `fabric doctor` in the project to verify.";

/**
 * Returns the fail-loud warning when `projectRoot` carries no
 * `.fabric/fabric-config.json`, else null. Tool handlers append the non-null
 * result to their response `warnings[]`.
 */
export function projectRootWarning(projectRoot: string): ProjectRootWarning | null {
  if (isProjectRootConfigured(projectRoot)) return null;
  return {
    code: PROJECT_ROOT_UNRESOLVED_CODE,
    file: "<server>",
    message: projectRootUnresolvedMessage(projectRoot),
    action_hint: PROJECT_ROOT_ACTION_HINT,
  };
}

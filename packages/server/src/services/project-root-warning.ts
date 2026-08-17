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

import type { ProjectContext } from "@fenglimg/fabric-shared";

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

function workspaceRoot(input: string | Readonly<ProjectContext>): string {
  return typeof input === "string" ? input : input.workspaceRoot;
}

export function projectRootUnresolvedMessage(input: string | Readonly<ProjectContext>): string {
  const projectRoot = workspaceRoot(input);
  return (
    `project root unresolved — serving personal store only ` +
    `(resolved "${projectRoot}", no .fabric/fabric-config.json found; team stores are NOT loaded)`
  );
}

const PROJECT_ROOT_ACTION_HINT =
  "Set FABRIC_PROJECT_ROOT (or CLAUDE_PROJECT_DIR) in the MCP server env, launch the server from inside the project, " +
  "or use an MCP client that exposes workspace roots (adopted automatically after initialize). " +
  "Run `fabric doctor` in the project to verify.";

export const PROJECT_IDENTITY_INHERITED_CODE = "project_identity_inherited";

const PROJECT_IDENTITY_INHERITED_ACTION_HINT =
  "Run `fabric install` in this checkout to give it its own identity, and commit " +
  "`.fabric/fabric-config.json` so every worktree of this repository carries it.";

/**
 * Returns the fail-loud warning when the resolved identity root carries no
 * `.fabric/fabric-config.json`, else null. Tool handlers append the non-null
 * result to their response `warnings[]`.
 *
 * The check is keyed on `identityRoot`, not `workspaceRoot`: under local-first
 * resolution those differ exactly on the inherited cold path, where the checkout
 * has no config of its own but a real identity (and therefore a real read-set)
 * was inherited from the main worktree. Keying on `workspaceRoot` there claimed
 * "team stores are NOT loaded" while they were loaded — a warning that fires when
 * nothing is wrong is how a fail-loud signal gets trained away (KT-DEC-0075).
 *
 * That case still gets a signal, just an accurate and milder one.
 *
 * A bare projectRoot string keeps the old behaviour — the rootless MCP spawn this
 * module was written for (`fallbackContext`, cwd=/) pins identityRoot to
 * workspaceRoot, so it still trips the unresolved arm.
 */
export function projectRootWarning(
  input: string | Readonly<ProjectContext>,
): ProjectRootWarning | null {
  const identityRoot = typeof input === "string" ? input : input.identityRoot;
  if (!isProjectRootConfigured(identityRoot)) {
    return {
      code: PROJECT_ROOT_UNRESOLVED_CODE,
      file: "<server>",
      message: projectRootUnresolvedMessage(workspaceRoot(input)),
      action_hint: PROJECT_ROOT_ACTION_HINT,
    };
  }
  if (typeof input !== "string" && input.identitySource === "inherited") {
    return {
      code: PROJECT_IDENTITY_INHERITED_CODE,
      file: "<server>",
      message:
        `this checkout has no .fabric/fabric-config.json — project identity inherited ` +
        `from the main worktree "${input.identityRoot}" (stores ARE loaded)`,
      action_hint: PROJECT_IDENTITY_INHERITED_ACTION_HINT,
    };
  }
  return null;
}

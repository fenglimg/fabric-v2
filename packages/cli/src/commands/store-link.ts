// ---------------------------------------------------------------------------
// BORROW-010: workspace linking CLI — `fabric store link`.
//
// Links a local workspace directory (e.g. a project checkout) to a mounted
// store. This creates a bidirectional reference:
//   - The store records the workspace path in its `store.json` under
//     `linked_workspaces[]`.
//   - The workspace root gets a `.fabric-store-link` marker file pointing
//     back at the store's UUID.
//
// Use cases:
//   - A monorepo with multiple sub-projects each linked to the team store
//   - A local clone of a store that needs to know which workspaces consume it
//   - CI/CD — a pipeline that links a checkout so doctor can verify linkage
//
// This is additive metadata — the store remains fully functional without any
// linked workspace. The link is purely for discoverability and doctor lint.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  loadGlobalConfig,
  resolveGlobalRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { getProjectTranslator } from "../i18n.js";
import {
  resolveStoreDir,
  storeList,
} from "../store/store-ops.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreLinkInfo {
  storeUuid: string;
  storeAlias: string;
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LINK_MARKER_FILENAME = ".fabric-store-link";

// ---------------------------------------------------------------------------
// Link operations
// ---------------------------------------------------------------------------

/**
 * Link a workspace directory to a store. Writes the marker file in the
 * workspace root and records the link in the store's store.json.
 *
 * Returns the link info on success, or throws on failure.
 */
export function linkWorkspaceToStore(
  storeAlias: string,
  workspacePath: string,
): StoreLinkInfo {
  const resolvedWorkspace = resolveWorkspacePath(workspacePath);
  const storeDir = resolveStoreDir(storeAlias);
  if (storeDir === null) {
    throw new Error(`no mounted store '${storeAlias}' — run \`fabric store list\` to see mounts`);
  }
  const storeJsonPath = join(storeDir, "store.json");

  // Read or create store.json.
  let storeConfig: { linked_workspaces?: string[] };
  try {
    const raw = readFileSync(storeJsonPath, "utf8");
    storeConfig = JSON.parse(raw);
  } catch {
    storeConfig = {};
  }

  if (!Array.isArray(storeConfig.linked_workspaces)) {
    storeConfig.linked_workspaces = [];
  }

  // Check for existing link.
  if (storeConfig.linked_workspaces.includes(resolvedWorkspace)) {
    throw new Error(
      `Workspace ${resolvedWorkspace} is already linked to store ${storeAlias}`,
    );
  }

  // Write marker file in workspace.
  const markerPath = join(resolvedWorkspace, LINK_MARKER_FILENAME);
  const markerContent = JSON.stringify({ store_uuid: storeDirToUuid(storeDir), store_alias: storeAlias }, null, 2);
  writeFileSync(markerPath, markerContent + "\n", "utf8");

  // Update store.json.
  storeConfig.linked_workspaces.push(resolvedWorkspace);
  writeFileSync(storeJsonPath, JSON.stringify(storeConfig, null, 2) + "\n", "utf8");

  return {
    storeUuid: storeDirToUuid(storeDir),
    storeAlias,
    workspacePath: resolvedWorkspace,
  };
}

/**
 * Unlink a workspace from a store. Removes the marker file and the entry
 * from store.json.
 */
export function unlinkWorkspaceFromStore(
  storeAlias: string,
  workspacePath: string,
): void {
  const resolvedWorkspace = resolveWorkspacePath(workspacePath);
  const storeDir = resolveStoreDir(storeAlias);
  if (storeDir === null) {
    throw new Error(`no mounted store '${storeAlias}' — run \`fabric store list\` to see mounts`);
  }
  const storeJsonPath = join(storeDir, "store.json");

  // Remove marker file.
  const markerPath = join(resolvedWorkspace, LINK_MARKER_FILENAME);
  try {
    if (existsSync(markerPath)) {
      const { unlinkSync } = require("node:fs");
      unlinkSync(markerPath);
    }
  } catch {
    // Best-effort — marker may not exist.
  }

  // Update store.json.
  try {
    const raw = readFileSync(storeJsonPath, "utf8");
    const storeConfig = JSON.parse(raw);
    if (Array.isArray(storeConfig.linked_workspaces)) {
      storeConfig.linked_workspaces = storeConfig.linked_workspaces.filter(
        (w: string) => w !== resolvedWorkspace,
      );
      writeFileSync(storeJsonPath, JSON.stringify(storeConfig, null, 2) + "\n", "utf8");
    }
  } catch {
    // Best-effort — store.json may not exist.
  }
}

/**
 * List all linked workspaces for a store.
 */
export function listLinkedWorkspaces(storeAlias: string): string[] {
  const storeDir = resolveStoreDir(storeAlias);
  if (storeDir === null) {
    return [];
  }
  const storeJsonPath = join(storeDir, "store.json");
  try {
    const raw = readFileSync(storeJsonPath, "utf8");
    const storeConfig = JSON.parse(raw);
    if (Array.isArray(storeConfig.linked_workspaces)) {
      return storeConfig.linked_workspaces;
    }
  } catch {
    // Fall through to empty.
  }
  return [];
}

/**
 * Resolve a store directory to its UUID by reading store.json.
 */
function storeDirToUuid(storeDir: string): string {
  const storeJsonPath = join(storeDir, "store.json");
  try {
    const raw = readFileSync(storeJsonPath, "utf8");
    const config = JSON.parse(raw);
    if (config.store_uuid) {
      return config.store_uuid;
    }
  } catch {
    // Fall through to derive from dir name.
  }
  // Fallback: use the directory name as the UUID.
  return storeDir.split(/[/\\]/u).pop() ?? "unknown";
}

/**
 * Resolve a workspace path to an absolute path.
 */
function resolveWorkspacePath(path: string): string {
  // If relative, resolve from cwd.
  const resolved = join(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export const storeLinkCommand = defineCommand({
  meta: {
    name: "store link",
    description: "Link a workspace directory to a mounted store",
  },
  args: {
    store: {
      type: "positional",
      description: "Store alias (e.g. 'team')",
      required: true,
    },
    workspace: {
      type: "positional",
      description: "Workspace directory path (default: current dir)",
      required: false,
    },
    unlink: {
      type: "boolean",
      alias: "u",
      description: "Remove the link instead of creating it",
      required: false,
    },
    list: {
      type: "boolean",
      alias: "l",
      description: "List linked workspaces for the store",
      required: false,
    },
  },
  async run(context) {
    const t = getProjectTranslator();
    const args = context.args;

    if (args.list) {
      const workspaces = listLinkedWorkspaces(args.store);
      if (workspaces.length === 0) {
        console.log(t("store.link.list.empty", { alias: args.store }));
      } else {
        console.log(t("store.link.list.header", { alias: args.store }));
        for (const ws of workspaces) {
          console.log(`  ${ws}`);
        }
      }
      return;
    }

    const workspacePath = args.workspace ?? process.cwd();

    if (args.unlink) {
      unlinkWorkspaceFromStore(args.store, workspacePath);
      console.log(t("store.link.unlinked", {
        store: args.store,
        workspace: workspacePath,
      }));
      return;
    }

    // Create link.
    try {
      const info = linkWorkspaceToStore(args.store, workspacePath);
      console.log(t("store.link.created", {
        store: info.storeAlias,
        uuid: info.storeUuid,
        workspace: info.workspacePath,
      }));
    } catch (error) {
      console.error(t("store.link.failed", {
        store: args.store,
        workspace: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      }));
      process.exit(1);
    }
  },
});
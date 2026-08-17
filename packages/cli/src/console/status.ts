// ---------------------------------------------------------------------------
// Data for the console's landing page (`GET /api/status`).
//
// Assembly only. Every value here comes from a kernel function that the CLI
// already uses; this module must not decide anything ("is this stale", "which
// layer wins") on its own. A second place that computes an answer is a second
// place that can disagree with the CLI, and "the console says X, `fabric doctor`
// says Y" is unrunnable to debug. Same reason KT-MOD-0004 refuses dual-write
// config: one question, one producer.
// ---------------------------------------------------------------------------

import { collectStoreCanonicalEntries, computeReadSetRevision } from "@fenglimg/fabric-server";

import { loadProjectConfig } from "../store/project-config-io.js";

declare const __CLI_VERSION__: string | undefined;

interface ConsoleStoreView {
  alias: string;
  layer: "team" | "personal";
  entryCount: number;
  /** True when this is the project's active write target. */
  write: boolean;
}

export interface ConsoleStatus {
  fabricVersion: string;
  projectRoot: string;
  /** Absent until the project binds a store — an install without a bind leaves the config `{}`. */
  projectId: string | null;
  activeWriteStore: string | null;
  stores: ConsoleStoreView[];
  entryCount: number;
  revision: string;
  /** Machine-readable reason the page renders guidance instead of data. */
  emptyReason: "no-config" | "no-stores" | "no-entries" | null;
}

// `<alias>:<stableId>` — neither half contains ':', so the alias is everything
// before the trailing stable id. Mirrors preview.ts#storeAliasOf.
function aliasOf(qualifiedId: string, stableId: string): string {
  const cut = qualifiedId.length - stableId.length - 1;
  return cut > 0 ? qualifiedId.slice(0, cut) : qualifiedId;
}

export async function collectConsoleStatus(projectRoot: string): Promise<ConsoleStatus> {
  const config = loadProjectConfig(projectRoot);
  const entries = await collectStoreCanonicalEntries(projectRoot);
  const activeWriteStore = config?.active_write_store ?? null;

  const byAlias = new Map<string, ConsoleStoreView>();
  for (const entry of entries) {
    const alias = aliasOf(entry.qualifiedId, entry.stableId);
    const existing = byAlias.get(alias);
    if (existing === undefined) {
      byAlias.set(alias, {
        alias,
        layer: entry.layer,
        entryCount: 1,
        write: alias === activeWriteStore,
      });
    } else {
      existing.entryCount += 1;
    }
  }
  const stores = [...byAlias.values()].sort((a, b) =>
    a.write === b.write ? a.alias.localeCompare(b.alias) : a.write ? -1 : 1,
  );

  // Distinguishing the empty states is the point, not a nicety. "No .fabric at
  // all", "installed but no store bound", and "store bound but empty" need three
  // different next commands; collapsing them into one blank panel is how a user
  // ends up running the wrong one.
  const emptyReason: ConsoleStatus["emptyReason"] =
    config === null
      ? "no-config"
      : stores.length === 0
        ? "no-stores"
        : entries.length === 0
          ? "no-entries"
          : null;

  return {
    fabricVersion: typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "unknown",
    projectRoot,
    projectId: config?.project_id ?? null,
    activeWriteStore,
    stores,
    entryCount: entries.length,
    revision: await computeReadSetRevision(projectRoot),
    emptyReason,
  };
}

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
import { listRegisteredProjects } from "../store/project-registry-io.js";
import { asPlainObject, currentProjectIdOf } from "./config-resolve.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { collectKnownProjects } from "./project-list.js";

declare const __CLI_VERSION__: string | undefined;

function runningVersion(): string {
  return typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "unknown";
}

interface ConsoleStoreView {
  alias: string;
  layer: "team" | "personal";
  entryCount: number;
  /** True when this is the project's active write target. */
  write: boolean;
}

export interface ConsoleStatus {
  /** Discriminator — the machine payload is a different shape (see MachineStatus). */
  scope: "project";
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

/** Group entries by store alias, write-target first then alphabetical. */
function storeViews(
  entries: readonly { qualifiedId: string; stableId: string; layer: "team" | "personal" }[],
  activeWriteStore: string | null,
): ConsoleStoreView[] {
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
  return [...byAlias.values()].sort((a, b) =>
    a.write === b.write ? a.alias.localeCompare(b.alias) : a.write ? -1 : 1,
  );
}

export async function collectConsoleStatus(projectRoot: string): Promise<ConsoleStatus> {
  const config = loadProjectConfig(projectRoot);
  const entries = await collectStoreCanonicalEntries(projectRoot);
  const activeWriteStore = config?.active_write_store ?? null;
  const stores = storeViews(entries, activeWriteStore);

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
    scope: "project",
    fabricVersion: runningVersion(),
    projectRoot,
    projectId: config?.project_id ?? null,
    activeWriteStore,
    stores,
    entryCount: entries.length,
    revision: await computeReadSetRevision(projectRoot),
    emptyReason,
  };
}

/** One row of the machine overview's project table. */
export interface MachineProjectView {
  projectId: string | null;
  path: string | null;
  name: string;
  /** Version recorded by the `fabric install` that registered it. */
  installedVersion: string | null;
  /** Registered at a path that no longer exists. */
  stale: boolean;
  /** The directory the console was launched in. */
  isCurrent: boolean;
  /**
   * Not in the machine registry. Either no directory is known at all (and none
   * is derivable — KT-PIT-0050), or it is known only because the console
   * happens to be running inside it. Both need the same remedy: re-run
   * `fabric install` there so the project stops depending on where the console
   * was started to be visible.
   */
  unregistered: boolean;
}

export interface MachineStatus {
  scope: "machine";
  /** The version of the CLI serving this console. */
  fabricVersion: string;
  projects: MachineProjectView[];
  /** Every store mounted on this machine, not one project's read-set. */
  stores: ConsoleStoreView[];
  entryCount: number;
  revision: string;
  /** Projects whose recorded install version differs from the running CLI. */
  outdatedCount: number;
  /**
   * Projects this machine can name but not locate — an id from a config
   * segment or a store binding, with no directory to go with it.
   *
   * Reported as its own number because it is the one thing the scan fixes, and
   * because folding it into the project list made it invisible: those rows
   * render as bare uuids among named ones and read as noise rather than as
   * "there are N more of your projects here".
   */
  unlocatedCount: number;
  emptyReason: "no-projects" | "no-stores" | "no-entries" | null;
}

/**
 * The machine-wide overview: every project this machine knows about, and every
 * store mounted on it.
 *
 * `launchDir` is used for two things and nothing else: resolving the mounted
 * store set (the store resolver needs some anchor directory) and marking which
 * row is the current one. It must not filter or reorder the list — that is the
 * property the whole scope model exists to guarantee.
 *
 * The store set is deliberately the ALL-MOUNTED set, the same one `--all`
 * walks (KT-DEC-0079). Machine scope answers "what knowledge bases do I have on
 * this machine"; a project's read-set answers "what can this project see". Two
 * different questions, and inventing a third aggregate would give the user two
 * things both called "全部".
 */
export async function collectMachineStatus(launchDir: string): Promise<MachineStatus> {
  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  const registry = await listRegisteredProjects();
  const versionByPath = new Map(registry.map((r) => [r.path, r.fabricVersion]));

  const merged = await collectKnownProjects(launchDir);
  const running = runningVersion();
  const projects: MachineProjectView[] = merged.map((p) => ({
    projectId: p.projectId,
    path: p.path,
    name: p.name,
    installedVersion: p.path === null ? null : (versionByPath.get(p.path) ?? null),
    stale: p.stale,
    isCurrent: p.isCurrent,
    unregistered: p.origin === "config-only" || p.origin === "current-only",
  }));

  const entries = await collectStoreCanonicalEntries(launchDir, { allStores: true });
  // No write flag at machine scope: the active write store is a per-project
  // setting, so claiming one here would name whichever project happened to
  // launch the console — the exact confusion scopes remove.
  const stores = storeViews(entries, null);

  return {
    scope: "machine",
    fabricVersion: running,
    projects,
    stores,
    entryCount: entries.length,
    revision: await computeReadSetRevision(launchDir, { allStores: true }),
    outdatedCount: projects.filter(
      (p) => p.installedVersion !== null && p.installedVersion !== running,
    ).length,
    unlocatedCount: projects.filter((p) => p.path === null).length,
    emptyReason:
      projects.length === 0
        ? "no-projects"
        : stores.length === 0
          ? "no-stores"
          : entries.length === 0
            ? "no-entries"
            : null,
  };
}

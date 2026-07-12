import { readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

import {
  addStoreProject,
  buildStoreResolveInput,
  createStoreResolver,
  readStoreProjects,
  resolveGlobalRoot,
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PROJECT_ID_PATTERN,
  storeRelativePathForMount,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";

// ---------------------------------------------------------------------------
// W2 (F-003 / DA-05·DA-06·DA-07) — doctor lint over the store project registry.
//
// Phase-1 (TASK-001/002/003) taught the scanner + write path the
// `knowledge/projects/<id>/<type>/` subtree and the committed `projects.json`
// registry at the store root. This lint reconciles the two: does every
// on-disk projects/<id>/ folder have a projects.json registration, and vice
// versa. FOUR orthogonal states over (registered?, has-entries?):
//
//   orphan-folder     — a projects/<id>/ dir NOT in projects.json, and EMPTY of
//                        .md entries. severity `warning`; `--fix` addStoreProject
//                        (rescue-register). Never a folder delete (a genuinely
//                        empty orphan is still registered, not pruned — the id
//                        was clearly intended).
//   unregistered-write — a projects/<id>/ dir NOT in projects.json but carrying
//                        .md entries. severity `error` (manual_error) — real
//                        project knowledge is unrouted. `--fix` addStoreProject
//                        (rescue-before-delete: register the data, NEVER delete
//                        a non-empty folder). Mirrors doctor-store-orphan's
//                        rescue precedent + doctor-stable-id-collision's
//                        manual_error kind for the data-bearing case.
//   empty-folder      — a REGISTERED id whose projects/<id>/ dir holds zero .md
//                        across every type subdir. severity `info`; `--fix`
//                        prunes ONLY when genuinely empty.
//   ghost-registration — a REGISTERED id with NO projects/<id>/ dir. NO finding
//                        (lazy creation is legal, DA-05 — a freshly-bound but
//                        unwritten project has no folder yet).
//
// Deprecate-not-delete (DA-07): a projects.json entry is a registration; being
// registered is exactly what makes an id NOT an orphan. `storeProjectSchema` is
// strict `{id, name?, created_at}` — there is no deprecated/status axis — so a
// registered id (deprecated or not) is never reported as orphan/unregistered.
//
// Reads ONLY stores (the post-decolo knowledge home). Pure read; NEVER throws —
// any readdir/read hiccup degrades to "no drift observable", never crashes the
// doctor pipeline. Mirrors doctor-scope-lint.ts's store resolution and
// doctor-store-orphan.ts's inspect/fix/create triad.
// ---------------------------------------------------------------------------

// Names beside the type dirs under knowledge/projects/ that are NOT project ids
// (mirrors the scanner's C-107 collision guard in store/core.ts).
const PROJECTS_DIR = "projects";

export type RegistryDriftKind = "orphan_folder" | "unregistered_write" | "empty_folder";

export interface RegistryDriftFinding {
  kind: RegistryDriftKind;
  store_alias: string;
  store_uuid: string;
  project_id: string;
  // Absolute path of the store dir (the addStoreProject / prune anchor).
  store_dir: string;
}

export interface RegistryDriftInspection {
  findings: RegistryDriftFinding[];
}

const EMPTY_INSPECTION: RegistryDriftInspection = { findings: [] };

interface StoreCtx {
  uuid: string;
  alias: string;
  dir: string;
}

// Resolve the project's read-set stores to on-disk dirs. [] when there is no
// global config / no mounted store (never throws).
function resolveDriftStores(projectRoot: string): StoreCtx[] {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  if (readSet.stores.length === 0) {
    return [];
  }
  const globalRoot = resolveGlobalRoot();
  return readSet.stores.map((entry) => {
    const mounted = input.mountedStores.find((s) => s.store_uuid === entry.store_uuid);
    return {
      uuid: entry.store_uuid,
      alias: entry.alias,
      dir: join(globalRoot, storeRelativePathForMount(mounted ?? { store_uuid: entry.store_uuid })),
    };
  });
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// The set of projects/<id>/ directories physically on disk in a store, filtered
// through the same id guard the scanner uses (C-107): a single [a-z0-9_-]
// segment that is neither "projects" nor a reserved type dir name.
async function listProjectFolders(storeDir: string): Promise<string[]> {
  const projectsRoot = join(storeDir, STORE_LAYOUT.knowledgeDir, PROJECTS_DIR);
  const reserved = new Set<string>([PROJECTS_DIR, ...STORE_KNOWLEDGE_TYPE_DIRS]);
  return (await listDir(projectsRoot))
    .filter((id) => STORE_PROJECT_ID_PATTERN.test(id) && !reserved.has(id))
    .sort();
}

// True when a projects/<id>/ folder holds at least one .md entry across any
// type subdir. Degrades to false (treat as empty) on any read hiccup.
async function folderHasEntries(storeDir: string, projectId: string): Promise<boolean> {
  const base = join(storeDir, STORE_LAYOUT.knowledgeDir, PROJECTS_DIR, projectId);
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const names = await listDir(join(base, type));
    if (names.some((name) => name.endsWith(".md"))) {
      return true;
    }
  }
  return false;
}

// Walk every read-set store, classifying the (registered?, has-entries?) matrix
// into the three reportable drift states. ghost-registration emits nothing.
export async function inspectProjectRegistryDrift(
  projectRoot: string,
): Promise<RegistryDriftInspection> {
  const stores = resolveDriftStores(projectRoot);
  if (stores.length === 0) {
    return EMPTY_INSPECTION;
  }

  const findings: RegistryDriftFinding[] = [];
  for (const store of stores) {
    const registered = new Set((await readStoreProjects(store.dir)).map((p) => p.id));
    const folders = await listProjectFolders(store.dir);
    const folderSet = new Set(folders);
    const base = { store_alias: store.alias, store_uuid: store.uuid, store_dir: store.dir };

    // On-disk folders → orphan-folder (empty) / unregistered-write (has data).
    for (const projectId of folders) {
      if (registered.has(projectId)) {
        // Registered + on-disk: only report when the folder is empty.
        if (!(await folderHasEntries(store.dir, projectId))) {
          findings.push({ ...base, project_id: projectId, kind: "empty_folder" });
        }
        continue;
      }
      const kind: RegistryDriftKind = (await folderHasEntries(store.dir, projectId))
        ? "unregistered_write"
        : "orphan_folder";
      findings.push({ ...base, project_id: projectId, kind });
    }

    // Registered ids with NO folder → ghost-registration → NO finding (DA-05).
    // (folderSet is only consulted here to make the ghost exclusion explicit.)
    void folderSet;
  }

  findings.sort(
    (a, b) =>
      a.store_alias.localeCompare(b.store_alias) || a.project_id.localeCompare(b.project_id),
  );
  return { findings };
}

// `--fix` result: which drift findings were repaired and how.
export interface RegistryDriftFixResult {
  registered: RegistryDriftFinding[]; // orphan/unregistered rescue-registered
  pruned: RegistryDriftFinding[]; // empty registered folders removed
}

// Repair the drift: rescue-register every orphan/unregistered folder (adds the
// id to projects.json — NEVER deletes a non-empty folder), and prune every
// registered empty folder (only genuinely-empty dirs are removed via rmdir,
// which itself refuses a non-empty dir — a second safety net over the empty
// classification). Best-effort per finding: a single failure is skipped, never
// aborts the pass. Re-inspects rather than trusting a caller-passed list so the
// mutation decision uses fresh on-disk state.
export async function fixProjectRegistryDrift(
  projectRoot: string,
): Promise<RegistryDriftFixResult> {
  const registered: RegistryDriftFinding[] = [];
  const pruned: RegistryDriftFinding[] = [];
  const { findings } = await inspectProjectRegistryDrift(projectRoot);

  for (const finding of findings) {
    if (finding.kind === "empty_folder") {
      // Prune ONLY when the folder is (still) genuinely empty. rmdir on a
      // non-empty dir throws ENOTEMPTY — caught below, so a race that filled
      // the folder between inspect and prune degrades to "left in place".
      if (await folderHasEntries(finding.store_dir, finding.project_id)) {
        continue;
      }
      try {
        const base = join(
          finding.store_dir,
          STORE_LAYOUT.knowledgeDir,
          PROJECTS_DIR,
          finding.project_id,
        );
        // Remove the (empty) type subdirs first, then the project dir. rmdir
        // never removes a non-empty dir, so real data can never be lost here.
        for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
          await rmdir(join(base, type)).catch(() => undefined);
        }
        await rmdir(base);
        pruned.push(finding);
      } catch {
        // Non-empty / permission hiccup — leave the folder in place.
      }
      continue;
    }

    // orphan_folder / unregistered_write → rescue-register (never a delete).
    try {
      await addStoreProject(finding.store_dir, {
        id: finding.project_id,
        created_at: new Date().toISOString(),
      });
      registered.push(finding);
    } catch {
      // Duplicate id (raced registration) / write hiccup — skip, never abort.
    }
  }

  return { registered, pruned };
}

// Roll the four-state drift matrix into one doctor check. unregistered-write
// (real data unrouted) is a manual_error; orphan-folder / empty-folder are
// advisory (warning / info). Reports the most-severe finding's kind to drive
// the check status.
export function createProjectRegistryDriftCheck(
  t: Translator,
  inspection: RegistryDriftInspection,
): DoctorCheck {
  const { findings } = inspection;
  if (findings.length === 0) {
    return {
      name: t("doctor.check.project_registry_drift.name"),
      status: "ok",
      message: t("doctor.check.project_registry_drift.ok"),
    };
  }

  const unregistered = findings.filter((f) => f.kind === "unregistered_write").length;
  const orphans = findings.filter((f) => f.kind === "orphan_folder").length;
  const empties = findings.filter((f) => f.kind === "empty_folder").length;
  const breakdown = [
    unregistered > 0 ? `${unregistered} unregistered-write` : null,
    orphans > 0 ? `${orphans} orphan-folder` : null,
    empties > 0 ? `${empties} empty-folder` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  // Severity ladder: unregistered-write (data unrouted) → error; else orphan
  // → warning; else empty-only → info.
  if (unregistered > 0) {
    const first = findings.find((f) => f.kind === "unregistered_write")!;
    return {
      name: t("doctor.check.project_registry_drift.name"),
      status: "error",
      kind: "manual_error",
      code: "project_registry_drift",
      fixable: true,
      message: t("doctor.check.project_registry_drift.message.unregistered", {
        total: String(findings.length),
        breakdown,
        projectId: first.project_id,
        storeAlias: first.store_alias,
      }),
      actionHint: t("doctor.check.project_registry_drift.remediation"),
    };
  }

  if (orphans > 0) {
    const first = findings.find((f) => f.kind === "orphan_folder")!;
    return {
      name: t("doctor.check.project_registry_drift.name"),
      status: "warn",
      kind: "warning",
      code: "project_registry_drift",
      fixable: true,
      message: t("doctor.check.project_registry_drift.message.orphan", {
        total: String(findings.length),
        breakdown,
        projectId: first.project_id,
        storeAlias: first.store_alias,
      }),
      actionHint: t("doctor.check.project_registry_drift.remediation"),
    };
  }

  const first = findings.find((f) => f.kind === "empty_folder")!;
  return {
    name: t("doctor.check.project_registry_drift.name"),
    status: "warn",
    kind: "info",
    code: "project_registry_drift",
    fixable: true,
    message: t("doctor.check.project_registry_drift.message.empty", {
      total: String(findings.length),
      breakdown,
      projectId: first.project_id,
      storeAlias: first.store_alias,
    }),
    actionHint: t("doctor.check.project_registry_drift.remediation"),
  };
}

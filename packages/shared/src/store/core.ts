import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { readStoreIdentityAsync } from "../resolver/store-disk-reader.js";
import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PROJECT_ID_PATTERN,
  type StoreIdentity,
  storeIdentitySchema,
  type StoreProject,
  storeProjectSchema,
  storeProjectsFileSchema,
} from "../schemas/store.js";

// The projects/ subdir holds the project-partitioned mirror of the root type
// layout: knowledge/projects/<id>/<type>/*.md. Named beside the type dirs, so a
// subdir whose name collides with a type dir (or is literally "projects") is
// skipped by the scanner's id guard (C-107).
const STORE_PROJECTS_DIR = "projects";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P1 — Multi-store storage + git core.
//
// Each store is its OWN parallel git repo under `~/.fabric/stores/<uuid>/` with
// the isomorphic layout (S42/A2). This module provides the physical primitives:
//   initStore                    — scaffold an empty store (layout + store.json
//                                  + .gitignore [+ git init])
//   listStoreKnowledge           — entries in one store, tagged with provenance
//   readKnowledgeAcrossStores    — cross-store read that NEVER merges identity
//                                  (each entry keeps its store_uuid; S61 anti-
//                                  shadowing is a resolver concern, not here)
//   aggregatePendingAcrossStores — the cross-store pending aggregation API that
//                                  underpins P2 fab_review (roadmap gemini#3)
//
// The store `.gitignore` keeps volatile/derived data OUT of the store git:
// `state/` (S43/S58 — the event ledger lives in the GLOBAL ~/.fabric/state, the
// per-store state/ is local scratch), `agents.meta.json` (S18 — deterministically
// rebuilt, never committed), `.cache/`.
// ---------------------------------------------------------------------------

// Pending (draft, awaiting review) sits beside the 5 canonical type dirs.
export const STORE_PENDING_DIR = "pending";

export const STORE_GITIGNORE = [
  "# v2.1 store — volatile / derived data is never committed",
  "state/",
  "agents.meta.json",
  ".cache/",
  "",
].join("\n");

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

export interface InitStoreOptions {
  // Run `git init` (each store is its own repo). Default true; pass false for
  // pure-fs scaffolding in tests that don't exercise git.
  git?: boolean;
}

// Scaffold an empty store at `absDir`. Idempotent on the directory structure;
// refuses to overwrite an existing store.json (identity is mint-once, S55).
export async function initStore(
  absDir: string,
  identity: StoreIdentity,
  options: InitStoreOptions = {},
): Promise<StoreIdentity> {
  const parsed = storeIdentitySchema.parse(identity);

  const identityFile = join(absDir, STORE_LAYOUT.identityFile);
  try {
    await access(identityFile);
    throw new Error(`store already initialized at ${absDir} (store.json exists)`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already initialized")) {
      throw err;
    }
  }

  // D4b — pre-create all 5 canonical category dirs (+ pending) with a committed
  // `.gitkeep` so the full store structure is visible/complete from birth, even
  // before any entry of that type exists (empty git dirs are otherwise invisible).
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const typeDir = join(absDir, STORE_LAYOUT.knowledgeDir, type);
    await mkdir(typeDir, { recursive: true });
    await writeFile(join(typeDir, ".gitkeep"), "", "utf8");
  }
  await mkdir(join(absDir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR), { recursive: true });
  await mkdir(join(absDir, STORE_LAYOUT.bindingsDir), { recursive: true });
  await mkdir(join(absDir, STORE_LAYOUT.stateDir), { recursive: true });

  await writeFile(identityFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await writeFile(join(absDir, ".gitignore"), STORE_GITIGNORE, "utf8");

  if (options.git !== false) {
    await git(absDir, ["init", "-b", "main"]);
  }

  const readBack = await readStoreIdentityAsync(absDir);
  if (readBack === null) {
    throw new Error(`store init wrote an unrecognizable store.json at ${absDir}`);
  }
  return readBack;
}

// A knowledge entry's physical location + store provenance. Frontmatter parsing
// (id/scope) is the server's job (P2); here we expose enough for cross-store
// reads to stay disambiguated by store_uuid.
export interface StoreKnowledgeRef {
  store_uuid: string;
  alias: string;
  type: string; // one of the 5 canonical dirs (or "pending")
  file: string; // absolute path
  // The structural project id this entry belongs to, derived from the
  // knowledge/projects/<id>/ path segment. Absent ⇒ team-general (root type
  // dirs). This is the raw path-derived id ONLY — the `project:<id>` scope
  // coordinate is assembled elsewhere (scope derivation is not the scanner's
  // job, C-104).
  project?: string;
}

async function listMarkdown(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}

// Mounted store identity + on-disk location, as resolved by the StoreResolver
// read-set plus the physical directory.
export interface MountedStoreDir {
  store_uuid: string;
  alias: string;
  dir: string;
}

// Knowledge entries in one store, each tagged with the store's provenance.
//
// Explicit two-pass (NOT recursive) scan over the isomorphic layout:
//   pass-1  knowledge/<type>/*.md          → team-general refs (project undefined)
//   pass-2  knowledge/projects/<id>/<type>/*.md → project-tagged refs
// A store with no projects/ dir is byte-identical to pass-1 alone (root-only
// equivalence, C-103) — the ENOENT early-return keeps that path untouched.
export async function listStoreKnowledge(store: MountedStoreDir): Promise<StoreKnowledgeRef[]> {
  const knowledgeDir = join(store.dir, STORE_LAYOUT.knowledgeDir);
  const refs: StoreKnowledgeRef[] = [];

  // pass-1 — root type dirs (team-general; no project tag).
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    for (const file of await listMarkdown(join(knowledgeDir, type))) {
      refs.push({ store_uuid: store.store_uuid, alias: store.alias, type, file });
    }
  }

  // pass-2 — project-partitioned dirs. Absent projects/ ⇒ root-only (C-103).
  let projectEntries: string[];
  try {
    projectEntries = await readdir(join(knowledgeDir, STORE_PROJECTS_DIR));
  } catch {
    return refs;
  }
  // C-107 collision guard: a project id is a single [a-z0-9_-] segment that is
  // neither the literal "projects" nor one of the reserved type dir names, so
  // an accidental/mis-nested dir under projects/ is silently skipped (mirrors
  // listMarkdown's degrade-to-[] discipline, never errors). sort() = determinism.
  const reserved = new Set<string>([STORE_PROJECTS_DIR, ...STORE_KNOWLEDGE_TYPE_DIRS]);
  const projectIds = projectEntries
    .filter((id) => STORE_PROJECT_ID_PATTERN.test(id) && !reserved.has(id))
    .sort();
  for (const project of projectIds) {
    for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
      for (const file of await listMarkdown(join(knowledgeDir, STORE_PROJECTS_DIR, project, type))) {
        refs.push({ store_uuid: store.store_uuid, alias: store.alias, type, file, project });
      }
    }
  }

  return refs;
}

// Cross-store read: union of every store's knowledge, each entry retaining its
// own store_uuid. Reads NEVER merge across stores — same-numbered local ids in
// different stores stay distinct (their global_ref differs, S61).
export async function readKnowledgeAcrossStores(stores: MountedStoreDir[]): Promise<StoreKnowledgeRef[]> {
  const lists = await Promise.all(stores.map((store) => listStoreKnowledge(store)));
  return lists.flat();
}

// ---------------------------------------------------------------------------
// Store-internal project registry (W1/A2). The committed `projects.json` at the
// store root enumerates the projects this store serves. Read returns [] when the
// file is absent (a store with no enumerated projects is valid). Add refuses a
// duplicate id (idempotent registration is the caller's concern via storeHasProject).
// ---------------------------------------------------------------------------

function storeProjectsPath(storeDir: string): string {
  return join(storeDir, STORE_LAYOUT.projectsFile);
}

// Enumerate the projects registered in a store. Absent/unreadable/invalid
// projects.json ⇒ [] (a store need not have any projects).
export async function readStoreProjects(storeDir: string): Promise<StoreProject[]> {
  const path = storeProjectsPath(storeDir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
  const parsed = storeProjectsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data.projects : [];
}

// True when `id` is a registered project in this store.
export async function storeHasProject(storeDir: string, id: string): Promise<boolean> {
  return (await readStoreProjects(storeDir)).some((p) => p.id === id);
}

// Register a new project in the store (writes projects.json). Refuses a
// duplicate id so a typo never silently overwrites an existing project's
// metadata. Returns the full project list after the add.
export async function addStoreProject(storeDir: string, project: StoreProject): Promise<StoreProject[]> {
  const parsed = storeProjectSchema.parse(project);
  const existing = await readStoreProjects(storeDir);
  if (existing.some((p) => p.id === parsed.id)) {
    throw new Error(`project '${parsed.id}' already exists in store at ${storeDir}`);
  }
  const next = [...existing, parsed];
  const validated = storeProjectsFileSchema.parse({ projects: next });
  await writeFile(storeProjectsPath(storeDir), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return validated.projects;
}

// Cross-store pending aggregation API (roadmap gemini#3) — the底座 P2 fab_review
// builds on instead of walking store git itself. Returns the union of pending
// entries across the given (writable) stores, each tagged with provenance.
export async function aggregatePendingAcrossStores(stores: MountedStoreDir[]): Promise<StoreKnowledgeRef[]> {
  const lists = await Promise.all(stores.map(async (store) =>
    (await listMarkdown(join(store.dir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR))).map((file) => ({
      store_uuid: store.store_uuid,
      alias: store.alias,
      type: STORE_PENDING_DIR,
      file,
    })),
  ));
  return lists.flat();
}

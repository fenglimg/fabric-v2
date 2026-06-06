import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readStoreIdentity } from "../resolver/store-disk-reader.js";
import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  type StoreIdentity,
  storeIdentitySchema,
  type StoreProject,
  storeProjectSchema,
  storeProjectsFileSchema,
} from "../schemas/store.js";

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

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

export interface InitStoreOptions {
  // Run `git init` (each store is its own repo). Default true; pass false for
  // pure-fs scaffolding in tests that don't exercise git.
  git?: boolean;
}

// Scaffold an empty store at `absDir`. Idempotent on the directory structure;
// refuses to overwrite an existing store.json (identity is mint-once, S55).
export function initStore(
  absDir: string,
  identity: StoreIdentity,
  options: InitStoreOptions = {},
): StoreIdentity {
  const parsed = storeIdentitySchema.parse(identity);

  const identityFile = join(absDir, STORE_LAYOUT.identityFile);
  if (existsSync(identityFile)) {
    throw new Error(`store already initialized at ${absDir} (store.json exists)`);
  }

  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    mkdirSync(join(absDir, STORE_LAYOUT.knowledgeDir, type), { recursive: true });
  }
  mkdirSync(join(absDir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR), { recursive: true });
  mkdirSync(join(absDir, STORE_LAYOUT.bindingsDir), { recursive: true });
  mkdirSync(join(absDir, STORE_LAYOUT.stateDir), { recursive: true });

  writeFileSync(identityFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  writeFileSync(join(absDir, ".gitignore"), STORE_GITIGNORE, "utf8");

  if (options.git !== false) {
    git(absDir, ["init", "-b", "main"]);
  }

  const readBack = readStoreIdentity(absDir);
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
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
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
export function listStoreKnowledge(store: MountedStoreDir): StoreKnowledgeRef[] {
  const refs: StoreKnowledgeRef[] = [];
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    for (const file of listMarkdown(join(store.dir, STORE_LAYOUT.knowledgeDir, type))) {
      refs.push({ store_uuid: store.store_uuid, alias: store.alias, type, file });
    }
  }
  return refs;
}

// Cross-store read: union of every store's knowledge, each entry retaining its
// own store_uuid. Reads NEVER merge across stores — same-numbered local ids in
// different stores stay distinct (their global_ref differs, S61).
export function readKnowledgeAcrossStores(stores: MountedStoreDir[]): StoreKnowledgeRef[] {
  return stores.flatMap((store) => listStoreKnowledge(store));
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
export function readStoreProjects(storeDir: string): StoreProject[] {
  const path = storeProjectsPath(storeDir);
  if (!existsSync(path)) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const parsed = storeProjectsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data.projects : [];
}

// True when `id` is a registered project in this store.
export function storeHasProject(storeDir: string, id: string): boolean {
  return readStoreProjects(storeDir).some((p) => p.id === id);
}

// Register a new project in the store (writes projects.json). Refuses a
// duplicate id so a typo never silently overwrites an existing project's
// metadata. Returns the full project list after the add.
export function addStoreProject(storeDir: string, project: StoreProject): StoreProject[] {
  const parsed = storeProjectSchema.parse(project);
  const existing = readStoreProjects(storeDir);
  if (existing.some((p) => p.id === parsed.id)) {
    throw new Error(`project '${parsed.id}' already exists in store at ${storeDir}`);
  }
  const next = [...existing, parsed];
  const validated = storeProjectsFileSchema.parse({ projects: next });
  writeFileSync(storeProjectsPath(storeDir), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return validated.projects;
}

// Cross-store pending aggregation API (roadmap gemini#3) — the底座 P2 fab_review
// builds on instead of walking store git itself. Returns the union of pending
// entries across the given (writable) stores, each tagged with provenance.
export function aggregatePendingAcrossStores(stores: MountedStoreDir[]): StoreKnowledgeRef[] {
  return stores.flatMap((store) =>
    listMarkdown(join(store.dir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR)).map((file) => ({
      store_uuid: store.store_uuid,
      alias: store.alias,
      type: STORE_PENDING_DIR,
      file,
    })),
  );
}

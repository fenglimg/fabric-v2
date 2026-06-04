import { z } from "zod";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0 — Multi-store identity, layout, and config contracts
//
// Surfaces: S55 (store identity = intrinsic UUID) · S59/B3 (required_stores
// config, suggested_remote|$personal) · S42/A2 (isomorphic store layout) ·
// S33 (global uid field).
//
// This is the PURE DEFINITION LAYER (P0). It declares the schemas/types only;
// no real HOME/git is touched and no resolver runs here. The StoreResolver
// implementation (P0.6) and physical multi-store mounting (P1) build on top.
//
// Clean-slate (S22 / KT-DEC-0002): there is NO migration path from the v2.0
// dual-root (~/.fabric + <repo>/.fabric) layout — the v2.1 model is N parallel
// git stores under ~/.fabric/stores/<uuid>/, and the disk reader only accepts
// the new layout. See memory/project_layered_kb_registry_northstar.md.
// ---------------------------------------------------------------------------

// Canonical UUID (8-4-4-4-12 hex). A store's identity is an *intrinsic* UUID
// that lives inside the store's own git tree (store.json), NOT derived from
// its remote URL or filesystem path — so a store can be re-homed, re-cloned,
// or its remote rotated without changing identity (S55). Earlier design drafts
// flirted with a canonical-remote identity; that was reversed (a remote is a
// locator, not an identity).
export const STORE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const storeUuidSchema = z
  .string()
  .regex(STORE_UUID_PATTERN, "store_uuid must be a canonical lowercase UUID");

// The sentinel value a project may use in place of a concrete remote URL to
// declare "this required store is satisfied by the user's implicit personal
// store" (S59/B3). The personal store is never shared and carries no remote.
export const PERSONAL_STORE_SENTINEL = "$personal" as const;

// ---------------------------------------------------------------------------
// Store identity — persisted as `store.json` at the root of each store git
// tree (`~/.fabric/stores/<uuid>/store.json`). Committed into the store so the
// identity travels with the repository content (S55). `remote` is intentionally
// ABSENT here: a remote is a per-clone git locator tracked by git itself, not
// part of the store's intrinsic identity.
// ---------------------------------------------------------------------------
export const storeIdentitySchema = z
  .object({
    // Intrinsic, immutable once minted. Read from store.json, never recomputed.
    store_uuid: storeUuidSchema,
    // ISO-8601. When the store was first initialized.
    created_at: z.string(),
    // Optional human-facing canonical alias baked into the store (e.g. the
    // team picks "platform-kb"). Local per-machine aliases are resolved by the
    // StoreResolver from config and may differ; this is the suggested default.
    canonical_alias: z.string().optional(),
    // Optional one-line description surfaced in `store list` / onboarding.
    description: z.string().optional(),
    // The semantic scopes this store is *allowed* to hold. A shared (team)
    // store MUST NOT list "personal" (R5#3 privacy boundary, enforced at write
    // time in P2). Open coordinate strings — see schemas/scope.ts.
    allowed_scopes: z.array(z.string()).optional(),
  })
  .strict();

export type StoreIdentity = z.infer<typeof storeIdentitySchema>;

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1/A2) — store-internal project registry.
//
// A store serves knowledge for one OR MORE projects. An entry tags WHICH
// project it belongs to via the `project:<id>` semantic_scope coordinate
// (schemas/scope.ts); the `<id>` segment is one of the projects enumerated
// here. The registry lives in a committed `projects.json` at the store root
// (parallel to store.json) — separate from the mint-once identity file so the
// mutable project list can grow without touching immutable identity (S55).
//
// A project `id` is a SINGLE scope segment (`[a-z0-9_-]+`, no ':') so that
// `project:<id>` is a well-formed coordinate. Binding a repo to a project
// (CLI `store bind --project <id>`) validates `<id>` against this registry so
// a typo can't silently route writes/recall to a non-existent project.
// ---------------------------------------------------------------------------
export const STORE_PROJECT_ID_PATTERN = /^[a-z0-9_-]+$/u;

export const storeProjectSchema = z
  .object({
    // Single scope segment forming the `project:<id>` coordinate. Immutable.
    id: z
      .string()
      .regex(STORE_PROJECT_ID_PATTERN, "project id must be a single lowercase [a-z0-9_-] segment"),
    // Optional human-facing label surfaced in `store project list`.
    name: z.string().optional(),
    // ISO-8601. When the project was first registered in this store.
    created_at: z.string(),
  })
  .strict();

export type StoreProject = z.infer<typeof storeProjectSchema>;

// The committed `projects.json` file at a store root. Empty/absent ⇒ the store
// has no enumerated projects yet (a store can still hold team/personal-scoped
// knowledge that is not project-specific).
export const storeProjectsFileSchema = z
  .object({
    projects: z.array(storeProjectSchema).default([]),
  })
  .strict();

export type StoreProjectsFile = z.infer<typeof storeProjectsFileSchema>;

// ---------------------------------------------------------------------------
// required_stores — a PROJECT-level config field (`.fabric/fabric-config.json`)
// listing the stores a repo expects to be mounted. `id` is the canonical alias
// or UUID the project references; `suggested_remote` is a hint used by `clone`
// / `install` to offer mounting a missing store (S51 missing-store warnings).
// `$personal` means "bind to the implicit personal store" (no remote).
// ---------------------------------------------------------------------------
export const requiredStoreEntrySchema = z
  .object({
    id: z.string().min(1),
    suggested_remote: z
      .union([z.string().min(1), z.literal(PERSONAL_STORE_SENTINEL)])
      .optional(),
  })
  .strict();

export type RequiredStoreEntry = z.infer<typeof requiredStoreEntrySchema>;

// ---------------------------------------------------------------------------
// Isomorphic store layout (S42/A2). EVERY store — shared or personal, default
// or extra — has the identical on-disk shape under `~/.fabric/stores/<uuid>/`:
//
//   store.json                      ← storeIdentitySchema (committed)
//   knowledge/<type>/*.md           ← the 5 knowledge types (committed)
//   bindings/                       ← store-local binding metadata (committed)
//   state/                          ← store-local volatile state (gitignored)
//   .git/                           ← each store is its own parallel git repo
//
// CROSS-store volatile data — the event ledger and the resolved-binding
// snapshots the hooks consume — lives OUTSIDE any store git, under the GLOBAL
// `~/.fabric/state/` (events: S43/S58; resolved bindings: P3 generates
// `~/.fabric/state/bindings/<project_id>_resolved.json`, P4 hooks read). The
// per-store `state/` dir above is for a store's OWN local scratch, never
// committed and never the cross-store ledger.
//
// `knowledge/<type>` uses the canonical PLURAL type dirs already used by v2.0
// (models/decisions/guidelines/pitfalls/processes) — see api-contracts.ts.
// ---------------------------------------------------------------------------
export const STORE_KNOWLEDGE_TYPE_DIRS = [
  "models",
  "decisions",
  "guidelines",
  "pitfalls",
  "processes",
] as const;

// Relative (POSIX) paths that define the isomorphic store layout. A disk reader
// recognizes a directory as a store iff it contains `store.json` parsing to
// storeIdentitySchema; these constants give readers the canonical sub-paths.
export const STORE_LAYOUT = {
  identityFile: "store.json",
  // Store-internal project registry (W1/A2). Committed parallel to store.json.
  projectsFile: "projects.json",
  knowledgeDir: "knowledge",
  bindingsDir: "bindings",
  stateDir: "state",
} as const;

export type StoreLayout = typeof STORE_LAYOUT;

// Root-relative location of a store within the global home (`~/.fabric`).
export const STORES_ROOT_DIR = "stores";
// Global volatile state root (events, caches, resolved bindings) — never in git.
export const GLOBAL_STATE_DIR = "state";
// Resolved-bindings snapshot dir under the global state root (P3 generates,
// P4 hooks consume): `~/.fabric/state/bindings/<project_id>_resolved.json`.
export const GLOBAL_BINDINGS_DIR = "bindings";

// POSIX-join helper so readers/resolvers agree on the canonical sub-paths
// without re-deriving string layout. Pure string math — no fs access (P0).
export function storeKnowledgeTypeDir(
  type: (typeof STORE_KNOWLEDGE_TYPE_DIRS)[number],
): string {
  return `${STORE_LAYOUT.knowledgeDir}/${type}`;
}

export function storeRelativePath(storeUuid: string): string {
  return `${STORES_ROOT_DIR}/${storeUuid}`;
}

// ---------------------------------------------------------------------------
// Global config (`~/.fabric/fabric-global.json`). Holds machine-wide identity
// and the registry of locally-mounted stores. The `uid` (S33) defaults — at
// IMPLEMENTATION time (P0.6) — to a normalized hash of `git config user.email`;
// the schema only types the field. `uid` namespaces personal knowledge ids so
// the same personal store cloned on two machines/accounts stays disambiguated.
// ---------------------------------------------------------------------------
export const mountedStoreSchema = z
  .object({
    // Intrinsic identity of the mounted store (matches its store.json).
    store_uuid: storeUuidSchema,
    // Local per-machine alias the user references this store by (resolver maps
    // alias → uuid). May differ from the store's canonical_alias.
    alias: z.string().min(1),
    // Git remote locator for this clone, if any. Absent = local-only store
    // (valid; doctor nudges to add a remote for backup — R5#5, P6).
    remote: z.string().min(1).optional(),
    // v2.1.0-rc.1 P3: marks the implicit personal store (the one minted by
    // `install --global`). Exactly one mounted store carries personal=true; it
    // is the write target for personal-scope entries (R5#3) and always in the
    // read-set (S11). Optional (no default) so the output type stays a plain
    // optional — consumers coalesce `?? false` when building resolver input.
    personal: z.boolean().optional(),
    // Whether writes are accepted into this store from this machine. Optional;
    // consumers coalesce `?? true`. Shared stores cloned read-only set false.
    writable: z.boolean().optional(),
  })
  .strict();

export type MountedStore = z.infer<typeof mountedStoreSchema>;

export const globalConfigSchema = z
  .object({
    // Machine/account identity. Personal-knowledge id namespace (S33/S27).
    uid: z.string().min(1),
    // All stores mounted on this machine. The implicit personal store is
    // included here once initialized. Default empty so a fresh global config
    // (before `install --global`) parses cleanly.
    stores: z.array(mountedStoreSchema).optional().default([]),
  })
  // Root NOT strict: tolerate forward-compat keys without aborting the hot
  // read path, mirroring fabricConfigSchema's lenient-root convention.
  .passthrough();

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

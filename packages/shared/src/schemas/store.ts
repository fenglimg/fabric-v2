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

export const STORE_ALIAS_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/u;

export const storeAliasSchema = z
  .string()
  .regex(
    STORE_ALIAS_PATTERN,
    "store alias must be a single [A-Za-z0-9._-] path segment, max 80 chars",
  );

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
    canonical_alias: storeAliasSchema.optional(),
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
export const STORE_MOUNT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,78}[a-z0-9]$/u;

export const storeMountNameSchema = z
  .string()
  .regex(
    STORE_MOUNT_NAME_PATTERN,
    "mount_name must be lowercase [a-z0-9._-], start/end with alnum, max 80 chars",
  )
  .refine((value) => value !== "." && value !== "..", "mount_name cannot be . or ..");

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
// `~/.fabric/state/bindings/<workspace_binding_id>_resolved.json`, P4 hooks read). The
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
  // v2.2 W4 (agents.meta decolo) — per-store monotonic stable_id counters.
  // COMMITTED parallel to store.json/projects.json (NOT gitignored like the
  // derived agents.meta) because the counter ledger is non-derivable state that
  // must travel with the store on clone: a fresh clone rebuilding from disk-max
  // would re-mint a deleted entry's id and corrupt cite history (KT-DEC-0004
  // monotonic invariant). Replaces the retired co-location
  // <projectRoot>/.fabric/agents.meta.json#counters.
  countersFile: "counters.json",
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
// P4 hooks consume): `~/.fabric/state/bindings/<workspace_binding_id>_resolved.json`.
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

// grill-6fixes (D4) — TWO-LAYER store layout: `stores/<group>/<label>/`.
//
//   group  = the PERSONAL/TEAM bucket, derived purely from `personal:true` in
//            fabric-global.json (NOT baked into the on-disk name). A store's
//            bucket is a config fact, not part of its directory label.
//   label  = a human-readable directory name (the `mount_name`). It is a LABEL,
//            never the identity — the store's true identity is store.json's
//            store_uuid. The label is derived from the remote repo name (see
//            deriveMountLabel), so renaming/rotating a remote only makes the
//            local label stale; lookup still goes via the config record →
//            uuid (resolveStoreByAliasOrUuid), and `fabric doctor --fix` can
//            refresh a stale label. When `mount_name` is absent the label falls
//            back to the full store_uuid so the path stays a valid segment.
export const STORE_MOUNT_GROUPS = ["personal", "team"] as const;
export type StoreMountGroup = (typeof STORE_MOUNT_GROUPS)[number];

export function storeMountGroup(store: { personal?: boolean }): StoreMountGroup {
  return store.personal === true ? "personal" : "team";
}

// `<group>/<label>` — the store's location RELATIVE to STORES_ROOT_DIR. Used by
// the by-alias symlink layer (target relative to `stores/by-alias/`).
export function storeMountSubPath(store: {
  store_uuid: string;
  mount_name?: string;
  personal?: boolean;
}): string {
  return `${storeMountGroup(store)}/${store.mount_name ?? store.store_uuid}`;
}

export function storeRelativePathForMount(store: {
  store_uuid: string;
  mount_name?: string;
  personal?: boolean;
}): string {
  return `${STORES_ROOT_DIR}/${storeMountSubPath(store)}`;
}

// Sanitize an arbitrary string into a valid `mount_name` directory label (the
// second layer of the two-layer store layout). Lowercases, maps any char outside
// [a-z0-9._-] to '-', collapses runs, and trims to start/end on an alphanumeric
// so the result satisfies STORE_MOUNT_NAME_PATTERN. Returns undefined when
// nothing usable (length < 2) survives.
function sanitizeMountLabel(raw: string): string | undefined {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/[-._]{2,}/gu, "-")
    .replace(/^[^a-z0-9]+/u, "")
    .replace(/[^a-z0-9]+$/u, "")
    .slice(0, 80)
    .replace(/[^a-z0-9]+$/u, "");
  return STORE_MOUNT_NAME_PATTERN.test(slug) ? slug : undefined;
}

// Extract a repository-name label from a git remote URL. Handles both
// `https://host/org/repo(.git)` and scp-style `git@host:org/repo(.git)`.
function mountLabelFromRemote(remote: string): string | undefined {
  const withoutGit = remote.trim().replace(/\.git$/iu, "").replace(/\/+$/u, "");
  const lastSegment = withoutGit.split(/[\\/:]/u).filter(Boolean).at(-1);
  return lastSegment === undefined ? undefined : sanitizeMountLabel(lastSegment);
}

// Derive the on-disk directory label for a store from its identity hints.
// Priority (D4 guardrail): remote-derived repo name → alias → short store_uuid.
// ALWAYS returns a STORE_MOUNT_NAME_PATTERN-valid label so persisting it through
// mountedStoreSchema never throws.
export function deriveMountLabel(input: {
  remote?: string;
  alias?: string;
  store_uuid: string;
}): string {
  const fromRemote = input.remote === undefined ? undefined : mountLabelFromRemote(input.remote);
  if (fromRemote !== undefined) {
    return fromRemote;
  }
  if (input.alias !== undefined) {
    const fromAlias = sanitizeMountLabel(input.alias);
    if (fromAlias !== undefined) {
      return fromAlias;
    }
  }
  return input.store_uuid.replace(/-/gu, "").slice(0, 8);
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
    // Stable human-readable local directory under ~/.fabric/stores/. When absent,
    // older uuid-named mounts stay valid and resolve to stores/<store_uuid>.
    mount_name: storeMountNameSchema.optional(),
    // Local per-machine alias the user references this store by (resolver maps
    // alias → uuid). May differ from the store's canonical_alias.
    alias: storeAliasSchema,
    // Optional user-facing label. Does not participate in resolution.
    display_name: z.string().optional(),
    // Git remote locator for this clone, if any. Absent = local-only store
    // (valid; doctor nudges to add a remote for backup — R5#5, P6).
    remote: z.string().min(1).optional(),
    // v2.1.0-rc.1 P3: marks a personal store (the kind minted by
    // `install --global`). 语义 A (multi-personal): MULTIPLE mounted stores may
    // carry personal=true — a machine can mount several personal stores and
    // switch which is ACTIVE via globalConfig.active_personal_store. The ACTIVE
    // personal is the write target for personal-scope entries (R5#3) and the one
    // in the read-set (S11); non-active personal stores stay mounted but out of
    // the read-set. Absent active pointer ⇒ resolver falls back to the first
    // mounted personal (back-compat). Optional (no default) so the output type
    // stays a plain optional — consumers coalesce `?? false`.
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
    // grill-6fixes (D1): the single machine-wide language base tone. Governs
    // BOTH the CLI display locale AND the knowledge-authoring language — there
    // is no per-project override (the old project `fabric_language` +
    // README-detection path was removed). Picked once via the install
    // language selector; changeable via `fabric config`. Absent ⇒ resolvers
    // fall back to env detection (FAB_LANG → LANG → en).
    language: z.enum(["zh-CN", "en"]).optional(),
    // All stores mounted on this machine. The implicit personal store is
    // included here once initialized. Default empty so a fresh global config
    // (before `install --global`) parses cleanly.
    stores: z.array(mountedStoreSchema).optional().default([]),
    // 语义 A (multi-personal): alias/UUID of the ACTIVE personal store among the
    // possibly-many `personal:true` stores in `stores[]`. Machine-wide (personal
    // is uid-scoped identity, KT-DEC-0020) — switching it in any repo takes
    // effect everywhere. Set by `fabric store switch-personal <alias>` and the
    // install personal slot. Absent ⇒ the resolver falls back to the first
    // mounted personal, so legacy single-personal configs are unchanged.
    active_personal_store: z.string().min(1).optional(),
  })
  // Root NOT strict: tolerate forward-compat keys without aborting the hot
  // read path, mirroring fabricConfigSchema's lenient-root convention.
  .passthrough();

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

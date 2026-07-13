import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  addMountedStore,
  addStoreProject,
  assertAllowedGitRemote,
  bindRequiredStore,
  deriveMountLabel,
  detachMountedStore,
  explainStore,
  initStore,
  STORE_GITIGNORE,
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  STORES_ROOT_DIR,
  storeHasProject,
  storeIdentitySchema,
  storeProjectsFileSchema,
  storeMountSubPath,
  storeRelativePath,
  storeRelativePathForMount,
  storeMountNameSchema,
  type FabricConfig,
  type GlobalConfig,
  type MountedStore,
  type RequiredStoreEntry,
  type StoreIdentity,
  type StoreExplain,
  type StoreProject,
  writeRouteSchema,
} from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "@fenglimg/fabric-server";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfigAsync } from "./global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "./project-config-io.js";

/** Best-effort store topology audit (ISS-20260711-127). Never fails the config write. */
async function emitStoreAdminEvent(
  projectRoot: string | undefined,
  event: Parameters<typeof appendEventLedgerEvent>[1],
): Promise<void> {
  const root = projectRoot && projectRoot.length > 0 ? projectRoot : process.cwd();
  try {
    await appendEventLedgerEvent(root, event);
  } catch {
    // observability-only — config mutation already committed
  }
}

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric store {list,add,remove,explain}` orchestration.
//
// Thin load → mutate (shared lifecycle core) → save wrappers, parameterized on
// `globalRoot` so they integration-test against an isolated FABRIC_HOME. The
// citty command (commands/store.ts) is a presentation-only shell over these.
// `remove` is detach (E4): it never deletes the store's on-disk git tree.
// ---------------------------------------------------------------------------

const NO_GLOBAL_CONFIG =
  "no global Fabric config found — run `fabric install --global <url>` first";

function requireConfig(globalRoot: string): GlobalConfig {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    throw new Error(NO_GLOBAL_CONFIG);
  }
  return config;
}

export function storeList(globalRoot: string = resolveGlobalRoot()): MountedStore[] {
  return requireConfig(globalRoot).stores;
}

function mountedStoreDir(store: MountedStore, globalRoot: string): string {
  return join(globalRoot, storeRelativePathForMount(store));
}

export function resolveStoreByAliasOrUuid(
  aliasOrUuid: string,
  globalRoot: string = resolveGlobalRoot(),
): MountedStore | null {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return null;
  }
  return (
    config.stores.find(
      (s) => s.alias === aliasOrUuid || s.store_uuid === aliasOrUuid || s.mount_name === aliasOrUuid,
    ) ?? null
  );
}

// v2.2 全砍 C3 — by-alias readability layer. The store's PHYSICAL identity stays
// the intrinsic UUID directory (KT-DEC-0004, path-decoupled), but `cd`-ing into
// `~/.fabric/stores/<uuid>` is opaque. This maintains a sibling
// `~/.fabric/stores/by-alias/<alias>` symlink → `../<uuid>` for human/tooling
// observability, derived purely from the registry (UUID never changes, so a
// rename/remount just re-points the link). Best-effort + cross-platform-safe:
// symlink creation that fails (e.g. unprivileged Windows) is swallowed — the
// UUID dir and `store list` alias column remain the source of truth. Idempotent:
// re-running reconciles links to exactly match the registry (this IS the doctor
// heal). Returns the reconciliation delta for diagnostics.
export const STORE_BY_ALIAS_DIR = "by-alias";

export interface AliasLinkSync {
  created: string[];
  removed: string[];
  errors: string[];
}

export function syncStoreAliasLinks(globalRoot: string = resolveGlobalRoot()): AliasLinkSync {
  const result: AliasLinkSync = { created: [], removed: [], errors: [] };
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return result;
  }
  const byAliasDir = join(globalRoot, STORES_ROOT_DIR, STORE_BY_ALIAS_DIR);
  // Two-layer layout: the link target is `../<group>/<label>` relative to
  // `stores/by-alias/` (storeMountSubPath), NOT a single segment anymore.
  const desired = new Map(config.stores.map((s) => [s.alias, storeMountSubPath(s)]));

  try {
    mkdirSync(byAliasDir, { recursive: true });
  } catch {
    return result; // can't create the dir at all → nothing to reconcile.
  }

  // Remove stale links (alias no longer mounted, or not a symlink we manage).
  let existing: string[] = [];
  try {
    existing = readdirSync(byAliasDir);
  } catch {
    existing = [];
  }
  for (const name of existing) {
    if (desired.has(name)) {
      continue;
    }
    try {
      rmSync(join(byAliasDir, name), { force: true, recursive: false });
      result.removed.push(name);
    } catch {
      result.errors.push(name);
    }
  }

  // Create / re-point links for every mounted store.
  for (const [alias, mountName] of desired) {
    const link = join(byAliasDir, alias);
    const target = join("..", mountName); // relative → stores/<group>/<label>
    try {
      let current: string | null = null;
      try {
        if (lstatSync(link).isSymbolicLink()) {
          current = readlinkSync(link);
        }
      } catch {
        current = null;
      }
      if (current === target) {
        continue; // already correct.
      }
      rmSync(link, { force: true });
      symlinkSync(target, link);
      result.created.push(alias);
    } catch {
      // Best-effort: unprivileged Windows / unsupported FS — skip silently.
      result.errors.push(alias);
    }
  }

  return result;
}

// C3 read-only drift detector for `fabric doctor`: aliases whose by-alias link
// is missing or points at the wrong uuid. `fabric doctor --fix` calls
// syncStoreAliasLinks to repair. Returns [] when there's nothing mounted or the
// platform/FS can't represent symlinks (best-effort — never a hard failure).
export function detectAliasLinkDrift(globalRoot: string = resolveGlobalRoot()): string[] {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return [];
  }
  const byAliasDir = join(globalRoot, STORES_ROOT_DIR, STORE_BY_ALIAS_DIR);
  // The by-alias layer is opt-in/best-effort: when the dir doesn't exist at all
  // (fresh machine, pre-C3, or a platform where symlinks aren't usable) that is
  // NOT drift to nag about — `fabric doctor --fix` / the next store mutation
  // materializes it unconditionally. Only flag per-link drift once the layer
  // exists (a link went missing or points at the wrong uuid).
  if (!existsSync(byAliasDir)) {
    return [];
  }
  const drifted: string[] = [];
  for (const store of config.stores) {
    const link = join(byAliasDir, store.alias);
    const target = join("..", storeMountSubPath(store));
    try {
      if (!lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) {
        drifted.push(store.alias);
      }
    } catch {
      drifted.push(store.alias); // missing link
    }
  }
  return drifted;
}

export async function storeAdd(
  store: MountedStore,
  globalRoot: string = resolveGlobalRoot(),
): Promise<GlobalConfig> {
  const next = addMountedStore(requireConfig(globalRoot), store);
  await saveGlobalConfigAsync(next, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: keep the by-alias readability layer current.
  await emitStoreAdminEvent(undefined, {
    event_type: "store_mounted",
    alias: store.alias,
    store_uuid: store.store_uuid,
    personal: store.personal === true,
    source: "storeAdd",
  });
  return next;
}

// ADJ-NEWN-5 (v2.1 dogfood): create a brand-new LOCAL store + mount it.
//
// Wave0 found there was no CLI path to birth a fresh store: `install --global`
// only mints the personal store, `install --global --url` clones an EXISTING
// remote, and `store mount` merely registers an already-on-disk store. The first
// team store therefore had to be hand-rolled (git init + the internal initStore
// symbol). This wraps that into a first-class command: mint an intrinsic uuid
// (S55 identity-is-intrinsic), scaffold the store tree via initStore (git), and
// mount it into the registry. `now`/`uuid` are injectable for deterministic
// tests; production mints them.
export interface StoreCreateResult {
  config: GlobalConfig;
  store_uuid: string;
  storeDir: string;
}

export async function storeCreate(
  alias: string,
  now: string,
  options: {
    uuid?: string;
    remote?: string;
    git?: boolean;
    globalRoot?: string;
    mountName?: string;
    // 语义 A (multi-personal): mint a PERSONAL store (personal:true) rather than a
    // team-class one. Threaded into mountedBase BEFORE the storeDir is computed so
    // storeRelativePathForMount groups it under the `personal/` bucket (not team/).
    // Lets `store create --personal` / the install slot add an Nth personal store.
    personal?: boolean;
  } = {},
): Promise<StoreCreateResult> {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  // requireConfig first: refuse to create before `install --global` (no uid).
  const config = requireConfig(globalRoot);
  const uuid = options.uuid ?? randomUUID();
  // D4 — explicit --mount-name wins (validated); otherwise the label is derived
  // from the remote repo name, falling back to the alias / short uuid.
  const mount_name =
    options.mountName !== undefined
      ? storeMountNameSchema.parse(options.mountName)
      : deriveMountLabel({ remote: options.remote, alias, store_uuid: uuid });
  const mountedBase: MountedStore = {
    store_uuid: uuid,
    alias,
    mount_name,
    ...(options.personal === true ? { personal: true } : {}),
  };
  const storeDir = mountedStoreDir(mountedBase, globalRoot);

  const identity = { store_uuid: uuid, created_at: now, canonical_alias: alias };
  if (options.git === false) {
    initStoreSync(storeDir, identity);
  } else {
    await initStore(storeDir, identity, { git: options.git });
  }

  // v2.1 global-refactor (W2-T4, F-SYNC-REMOTE): wire the remote into the store's
  // OWN git repo, not just the config metadata. Before this, `--remote` was
  // recorded in the registry but `git remote add` never ran, so the store could
  // never pull/push (sync's `git pull --rebase`/`git push` had no `origin`).
  // Only when the repo was actually git-init'd (options.git !== false; tests use
  // pure-fs scaffolding) and a remote was requested.
  // ISS-20260713-005: same protocol allowlist as install clone path.
  const safeRemote =
    options.remote === undefined ? undefined : assertAllowedGitRemote(options.remote);
  if (safeRemote !== undefined && options.git !== false) {
    gitRemoteAdd(storeDir, safeRemote);
  }

  const mounted: MountedStore =
    safeRemote === undefined ? mountedBase : { ...mountedBase, remote: safeRemote };
  const next = addMountedStore(config, mounted);
  await saveGlobalConfigAsync(next, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: mint the by-alias readability link.
  await emitStoreAdminEvent(undefined, {
    event_type: "store_mounted",
    alias,
    store_uuid: uuid,
    personal: options.personal === true,
    source: "storeCreate",
  });
  return { config: next, store_uuid: uuid, storeDir };
}

function initStoreSync(absDir: string, identity: StoreIdentity): StoreIdentity {
  const parsed = storeIdentitySchema.parse(identity);
  const identityFile = join(absDir, STORE_LAYOUT.identityFile);
  if (existsSync(identityFile)) {
    throw new Error(`store already initialized at ${absDir} (store.json exists)`);
  }
  // D4b — pre-create all 5 canonical category dirs with a committed `.gitkeep`
  // so the full store structure is visible/complete from birth (mirrors initStore).
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const typeDir = join(absDir, STORE_LAYOUT.knowledgeDir, type);
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, ".gitkeep"), "", "utf8");
  }
  mkdirSync(join(absDir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR), { recursive: true });
  mkdirSync(join(absDir, STORE_LAYOUT.bindingsDir), { recursive: true });
  mkdirSync(join(absDir, STORE_LAYOUT.stateDir), { recursive: true });
  // Mirror async initStore: identity last so a crash mid-scaffold never leaves a
  // recognisable half-init (disk readers key off store.json) — ISS-20260711-146.
  writeFileSync(join(absDir, ".gitignore"), STORE_GITIGNORE, "utf8");
  writeFileSync(identityFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

// `git remote add origin <remote>` in the store's repo. Idempotent: if an
// `origin` already exists (re-create over an existing tree shouldn't happen —
// initStore refuses — but be defensive), update it via `set-url` instead.
function gitRemoteAdd(storeDir: string, remote: string): void {
  const safeRemote = assertAllowedGitRemote(remote);
  try {
    execFileSync("git", ["remote", "add", "origin", safeRemote], {
      cwd: storeDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // origin already present (or add failed) → set the url so the store is still
    // remote-backed. A genuine git failure surfaces on the next sync with git's
    // own diagnostic; we don't want create to crash on a benign re-add.
    try {
      execFileSync("git", ["remote", "set-url", "origin", safeRemote], {
        cwd: storeDir,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      // best-effort — leave the store with the config metadata remote; sync will
      // report the missing/broken origin actionably.
    }
  }
}

// v2.1 global-refactor (W2-T4, F14): the TRUE git remote of a store, read from
// its repo (`git remote get-url origin`), not the config metadata. `store list`
// uses this so the local-only label reflects on-disk reality — a store whose
// config claims a remote but whose repo has no `origin` (e.g. created before the
// F-SYNC-REMOTE fix) is honestly shown as local-only. Returns undefined when the
// store has no origin / is not a git repo / the dir is missing.
export function storeGitRemote(
  aliasOrUuid: string,
  globalRoot: string = resolveGlobalRoot(),
): string | undefined {
  const storeDir = resolveStoreDir(aliasOrUuid, globalRoot) ?? join(globalRoot, storeRelativePath(aliasOrUuid));
  if (!existsSync(storeDir)) {
    return undefined;
  }
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: storeDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// ADJ-NEWN-6 (v2.1 dogfood): refuse a "phantom mount". `store mount` previously
// wrote the registry entry even when no store tree existed on disk for that
// uuid — the failure only surfaced later when `fabric sync` crashed on a
// non-existent cwd (spawnSync git ENOENT). This guard moves the failure to
// `add` time: the store directory must already exist on disk (cloned via
// `fabric install --global --url <remote>` or created locally). Pure existence
// check so the I/O edge (commands/store.ts) stays testable.
export function assertStoreMountable(
  uuid: string,
  globalRoot: string = resolveGlobalRoot(),
  mountName?: string,
): void {
  const registered = resolveStoreByAliasOrUuid(uuid, globalRoot);
  const candidates =
    mountName === undefined && registered === null
      ? [join(globalRoot, storeRelativePath(uuid))]
      : [
          join(
            globalRoot,
            storeRelativePathForMount({
              store_uuid: uuid,
              mount_name: mountName ?? registered?.mount_name,
              personal: registered?.personal,
            }),
          ),
          join(globalRoot, storeRelativePath(uuid)),
        ];
  const storeDir = candidates.find((dir) => existsSync(join(dir, "store.json"))) ?? candidates[0]!;
  if (!existsSync(join(storeDir, "store.json"))) {
    throw new Error(
      `cannot mount store ${uuid}: no store tree at ${storeDir} — ` +
        `clone it first (\`fabric install --global --url <remote>\`) or create it locally, ` +
        `then re-run \`fabric store mount\`. Refusing to register a phantom store.`,
    );
  }
}

export async function storeRemove(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): Promise<{ config: GlobalConfig; detached: MountedStore | null }> {
  const result = detachMountedStore(requireConfig(globalRoot), alias);
  await saveGlobalConfigAsync(result.config, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: drop the detached store's by-alias link.
  await emitStoreAdminEvent(undefined, {
    event_type: "store_detached",
    alias,
    ...(result.detached ? { store_uuid: result.detached.store_uuid } : {}),
    source: "storeRemove",
  });
  return result;
}

export function storeExplain(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreExplain | null {
  return explainStore(requireConfig(globalRoot), alias);
}

const NO_PROJECT_CONFIG =
  "no project Fabric config — run `fabric install` in this repo first";

function requireProjectConfig(projectRoot: string): FabricConfig {
  const config = loadProjectConfig(projectRoot);
  if (config === null) {
    throw new Error(NO_PROJECT_CONFIG);
  }
  return config;
}

// Resolve a mounted store's on-disk directory by its alias or UUID. Null when
// no store with that alias/uuid is registered in the global config.
export function resolveStoreDir(
  aliasOrUuid: string,
  globalRoot: string = resolveGlobalRoot(),
): string | null {
  const store = resolveStoreByAliasOrUuid(aliasOrUuid, globalRoot);
  if (store === null) {
    return null;
  }
  return mountedStoreDir(store, globalRoot);
}

// `fabric store project list <alias>`: enumerate a store's registered projects
// (W1/A2). Throws when the alias/uuid is not a mounted store.
export function storeProjectList(
  aliasOrUuid: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreProject[] {
  const storeDir = resolveStoreDir(aliasOrUuid, globalRoot);
  if (storeDir === null) {
    throw new Error(`no mounted store '${aliasOrUuid}' — run \`fabric store list\` to see mounts`);
  }
  return readStoreProjectsSync(storeDir);
}

function readStoreProjectsSync(storeDir: string): StoreProject[] {
  try {
    const parsed = storeProjectsFileSchema.safeParse(
      JSON.parse(readFileSync(join(storeDir, STORE_LAYOUT.projectsFile), "utf8")),
    );
    return parsed.success ? parsed.data.projects : [];
  } catch {
    return [];
  }
}

// `fabric store project create <alias> <id>`: register a new project in a store
// (W1/A2). `id` is the single scope segment forming `project:<id>`. Refuses a
// duplicate id (addStoreProject) or an unmounted store.
export async function storeProjectCreate(
  aliasOrUuid: string,
  id: string,
  now: string,
  options: { name?: string; globalRoot?: string } = {},
): Promise<StoreProject> {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const storeDir = resolveStoreDir(aliasOrUuid, globalRoot);
  if (storeDir === null) {
    throw new Error(`no mounted store '${aliasOrUuid}' — run \`fabric store list\` to see mounts`);
  }
  const project: StoreProject =
    options.name === undefined
      ? { id, created_at: now }
      : { id, name: options.name, created_at: now };
  await addStoreProject(storeDir, project);
  return project;
}

// `fabric store bind <id> [--project <p>]`: declare a required store on the
// PROJECT config (drives the read-set + clone onboarding; dedupes by id, S59).
// When `project` is given it is validated against the bound store's projects.json
// (W1/A2) — binding to a non-existent project is REFUSED so a typo can't route
// writes/recall to a phantom project — and recorded as the repo's
// `active_project` coordinate segment.
//
// Multi-repo dogfood (ccpm): `store list` leads with DESCRIPTIVE `mount_name`
// (e.g. fabric-team-knowledge) while the bindable id is the short `alias`
// (`team`). If the user pastes the display name and we persist it verbatim,
// first-hit reports missing_required even though the store is mounted (KT-PIT-0027).
// When a mounted store matches alias | store_uuid | mount_name, persist the
// canonical **alias**. Unmounted ids stay as typed (clone-onboarding still works).
export async function storeBind(
  projectRoot: string,
  entry: RequiredStoreEntry,
  options: { project?: string; globalRoot?: string } = {},
): Promise<FabricConfig> {
  const config = requireProjectConfig(projectRoot);
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const mounted = resolveStoreByAliasOrUuid(entry.id, globalRoot);
  const canonicalId = mounted?.alias ?? entry.id;
  const canonicalEntry: RequiredStoreEntry =
    entry.suggested_remote === undefined
      ? { id: canonicalId }
      : { id: canonicalId, suggested_remote: entry.suggested_remote };
  let activeProject = config.active_project;
  if (options.project !== undefined) {
    const storeDir = resolveStoreDir(canonicalId, globalRoot);
    if (storeDir === null) {
      throw new Error(
        `cannot bind project '${options.project}': store '${entry.id}' is not mounted — ` +
          `mount it first (\`fabric store mount\` / \`fabric install --global --url <remote>\`)`,
      );
    }
    if (!(await storeHasProject(storeDir, options.project))) {
      throw new Error(
        `cannot bind to project '${options.project}': not registered in store '${canonicalId}' — ` +
          `create it first with \`fabric store project create ${canonicalId} ${options.project}\``,
      );
    }
    activeProject = options.project;
  }
  const next: FabricConfig = {
    ...config,
    required_stores: bindRequiredStore(config.required_stores ?? [], canonicalEntry),
    ...(activeProject === undefined ? {} : { active_project: activeProject }),
  };
  saveProjectConfig(next, projectRoot);
  void emitStoreAdminEvent(projectRoot, {
    event_type: "store_bound",
    alias: canonicalId,
    store_uuid: mounted?.store_uuid ?? canonicalId,
    ...(activeProject === undefined ? {} : { project: activeProject }),
    source: "storeBind",
  });
  return next;
}

// `fabric store switch-write <alias>`: set the project's active write store for
// non-personal scopes (S60). Personal-scope writes are unaffected (R5#3).
//
// Multi-repo dogfood (ccpm, 2026-07-12): first-hit stays on `no_write_target` if
// this mutation ever "succeeds" without disk persistence. We write through the
// strict schema then **reload and assert** so CLI never prints ok on a silent
// no-op (false-green onboarding).
export function storeSwitchWrite(
  projectRoot: string,
  alias: string,
  options: { globalRoot?: string } = {},
): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const store = resolveStoreByAliasOrUuid(alias, options.globalRoot ?? resolveGlobalRoot());
  if (store === null || store.personal === true || store.writable === false) {
    throw new Error(`cannot set default write store '${alias}': mount a writable shared store first`);
  }
  const previous = config.active_write_store ?? config.default_write_store;
  const next: FabricConfig = {
    ...config,
    active_write_store: alias,
    default_write_store: alias,
  };
  saveProjectConfig(next, projectRoot);
  const reloaded = loadProjectConfig(projectRoot);
  if (
    reloaded?.active_write_store !== alias ||
    reloaded.default_write_store !== alias
  ) {
    throw new Error(
      `switch-write '${alias}' did not persist to .fabric/fabric-config.json ` +
        `(active_write_store=${reloaded?.active_write_store ?? "∅"}, ` +
        `default_write_store=${reloaded?.default_write_store ?? "∅"}) — ` +
        `check that the project config is writable and not being overwritten`,
    );
  }
  void emitStoreAdminEvent(projectRoot, {
    event_type: "write_store_switched",
    alias,
    ...(previous !== undefined ? { previous_alias: previous } : {}),
    switch_kind: "project_write",
    source: "storeSwitchWrite",
  });
  return reloaded;
}

// 语义 A (multi-personal): `fabric store switch-personal <alias>` — set the
// machine-wide ACTIVE personal store. Unlike `storeSwitchWrite` (which writes the
// PROJECT config's active_write_store for team scopes), this writes the GLOBAL
// config's `active_personal_store` because personal is uid-scoped machine
// identity (KT-DEC-0020): switching it in any repo takes effect everywhere. The
// target MUST be a mounted `personal:true` store — switch-write stays team-only
// and is unchanged. The resolver's findPersonal honors this pointer for both the
// read-set and the personal write-target.
export async function storeSwitchPersonal(
  alias: string,
  options: { globalRoot?: string } = {},
): Promise<GlobalConfig> {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const config = requireConfig(globalRoot);
  const store = resolveStoreByAliasOrUuid(alias, globalRoot);
  if (store === null || store.personal !== true) {
    throw new Error(
      `cannot switch active personal store to '${alias}': mount a personal store first ` +
        "(`fabric install --global` mints one; `--url <remote>` clones an existing one)",
    );
  }
  const previous = config.active_personal_store;
  const next: GlobalConfig = { ...config, active_personal_store: alias };
  await saveGlobalConfigAsync(next, globalRoot);
  await emitStoreAdminEvent(undefined, {
    event_type: "write_store_switched",
    alias,
    ...(previous !== undefined ? { previous_alias: previous } : {}),
    switch_kind: "personal",
    source: "storeSwitchPersonal",
  });
  return next;
}

// 语义 A (multi-personal): `fabric doctor --fix` repair for the active-personal
// pointer (parallels syncStoreAliasLinks — idempotent global-config repair).
// Repairs two doctor lints: a DANGLING active_personal_store (set but not a
// mounted personal store) is rewritten to the first mounted personal (or the
// field is dropped when no personal exists at all); an UNSET pointer with ≥2
// personal stores is defaulted to the first. A valid pointer, or the 0/1-personal
// no-pointer common case, is a no-op. Returns true iff the config was rewritten.
export async function fixActivePersonalPointer(globalRoot: string = resolveGlobalRoot()): Promise<boolean> {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return false;
  }
  const personals = config.stores.filter((s) => s.personal === true);
  const active = config.active_personal_store;
  const valid =
    active !== undefined && personals.some((p) => p.alias === active || p.store_uuid === active);
  if (valid) {
    return false;
  }
  // Nothing to fix: no pointer and fewer than 2 personals (0/1-personal default).
  if (active === undefined && personals.length < 2) {
    return false;
  }
  const first = personals[0];
  if (first === undefined) {
    // Stale pointer with no personal store mounted at all → clear it.
    const cleared = { ...config };
    delete cleared.active_personal_store;
    await saveGlobalConfigAsync(cleared, globalRoot);
    return true;
  }
  await saveGlobalConfigAsync({ ...config, active_personal_store: first.alias }, globalRoot);
  return true;
}

export function storeSetWriteRoute(
  projectRoot: string,
  scope: string,
  alias: string,
  options: { globalRoot?: string } = {},
): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const route = writeRouteSchema.parse({ scope, store: alias });
  const store = resolveStoreByAliasOrUuid(alias, options.globalRoot ?? resolveGlobalRoot());
  if (store === null || store.personal === true || store.writable === false) {
    throw new Error(`cannot route scope '${scope}' to '${alias}': mount a writable shared store first`);
  }
  const routes = [
    ...(config.write_routes ?? []).filter((existing) => existing.scope !== route.scope),
    route,
  ];
  const previous = (config.write_routes ?? []).find((r) => r.scope === route.scope)?.store;
  const next: FabricConfig = { ...config, write_routes: routes };
  saveProjectConfig(next, projectRoot);
  void emitStoreAdminEvent(projectRoot, {
    event_type: "write_route_changed",
    scope: route.scope,
    alias,
    ...(previous !== undefined ? { previous_alias: previous } : {}),
    source: "storeSetWriteRoute",
  });
  return next;
}

// Clone-onboarding guidance core (S51): which of this project's required_stores
// are NOT mounted in the global registry. After `git clone` of a Fabric project
// the CLI runs this to guide the user to `fabric store mount` the missing stores.
// Empty global config ⇒ every required store is missing (nothing mounted yet).
export function missingRequiredStores(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): RequiredStoreEntry[] {
  const project = loadProjectConfig(projectRoot);
  if (project === null || project.required_stores === undefined) {
    return [];
  }
  const global = loadGlobalConfig(globalRoot);
  // Match alias | store_uuid | mount_name — same keys as resolveStoreByAliasOrUuid
  // so a legacy required id written as mount_name (pre-canonical-bind) is not
  // falsely "missing" when the store is mounted under a short alias.
  const mounted = new Set(
    (global?.stores ?? []).flatMap((s) =>
      s.mount_name === undefined || s.mount_name.length === 0
        ? [s.alias, s.store_uuid]
        : [s.alias, s.store_uuid, s.mount_name],
    ),
  );
  return project.required_stores.filter((r) => !mounted.has(r.id));
}

// Onboarding nudge core (Wave A): the INVERSE of missingRequiredStores — which
// mounted non-personal stores has this project NOT yet declared as required.
// Drives the post-install + doctor nudge to `fabric store bind <alias>` so a
// mounted team/shared store stops being invisible to the project's read-set
// (the F3/D4 onboarding cliff). Personal stores are implicit (always in the
// read-set) and never need binding, so they are excluded. Empty global config
// ⇒ nothing mounted ⇒ nothing to bind.
export function unboundAvailableStores(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): MountedStore[] {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    return [];
  }
  const project = loadProjectConfig(projectRoot);
  const declared = new Set((project?.required_stores ?? []).map((r) => r.id));
  return global.stores.filter((s) => {
    if (s.personal === true) return false;
    if (declared.has(s.alias) || declared.has(s.store_uuid)) return false;
    // Pre-canonicalization configs may still declare mount_name as required id.
    if (s.mount_name !== undefined && declared.has(s.mount_name)) return false;
    return true;
  });
}

// W2 dual-slot (TASK-002): a single team-type candidate is one row of the team
// slot's single-select. `bound:true` flags the store this project currently
// reads/writes (rendered highlighted as the slot's status); the rest are
// mounted-but-unbound stores the user can switch to. The store's REAL alias is
// carried so the UI shows it verbatim — the team slot is named by category
// ("团队库 / team-class"), NEVER implying the store must be aliased `team`
// (KT-MOD-0001 naming-axis trap).
export interface TeamStoreCandidate {
  alias: string;
  remote?: string;
  bound: boolean;
  // A human disambiguator for the store BEHIND the alias — surfaced in the slot
  // status / keep-current option so an alias that collides with the category word
  // (e.g. a store literally aliased `team`) still tells the user WHICH physical
  // store it is. A SHORT identity (label / remote repo basename / mount dir), and
  // ONLY present when it actually adds information — i.e. it differs from the
  // alias. A descriptive alias (already == the repo name) carries no suffix, so we
  // never tack a redundant full git URL onto an already-clear name.
  source?: string;
}

/**
 * A short, human disambiguator for the store behind an alias: the user-facing
 * label if set, else the git remote reduced to its repo basename
 * (`…/wespy-team-cocos-knowledge-base.git` → `wespy-team-cocos-knowledge-base`),
 * else the on-disk mount dir. Returns undefined when there is nothing to show OR
 * when the result merely repeats the alias (no new information).
 */
function shortTeamStoreSource(
  alias: string,
  store: { display_name?: string; remote?: string; mount_name?: string },
): string | undefined {
  const repoBasename = store.remote
    ? store.remote.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean).pop()
    : undefined;
  const raw = store.display_name ?? repoBasename ?? store.mount_name;
  return raw && raw !== alias ? raw : undefined;
}

// W2 dual-slot (TASK-002): the team-slot candidate lister — EVERY mounted
// non-personal store, partitioned into the currently-bound one (if any) and the
// mounted-but-unbound rest. Replaces the bind-only `unboundAvailableStores` view
// for the install team slot: a bound store is no longer invisible to the prompt,
// so the slot can render its status AND offer a switch in one single-select.
// Empty global config ⇒ no candidates (nothing mounted). The bound store sorts
// first so the slot's default selection lands on the current binding (no-op pick).
export function teamStoreCandidates(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): TeamStoreCandidate[] {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    return [];
  }
  const project = loadProjectConfig(projectRoot);
  const declared = new Set((project?.required_stores ?? []).map((r) => r.id));
  const candidates = global.stores
    .filter((s) => s.personal !== true)
    .map((s) => {
      const source = shortTeamStoreSource(s.alias, s);
      return {
        alias: s.alias,
        ...(s.remote === undefined ? {} : { remote: s.remote }),
        bound: declared.has(s.alias) || declared.has(s.store_uuid),
        ...(source === undefined ? {} : { source }),
      };
    });
  return candidates.sort((a, b) => Number(b.bound) - Number(a.bound));
}

// 语义 A (multi-personal): a single personal-slot candidate — one row of the
// install personal slot's single-select. `active:true` flags the machine's
// current active personal (the one resolved for read-set + personal writes); the
// rest are mounted-but-inactive personal stores the user can switch to. Mirrors
// `teamStoreCandidates` so the install slot reuses the same data shape, but
// filters to `personal === true` and partitions by the GLOBAL active pointer
// (active_personal_store) rather than the project's required_stores.
export interface PersonalStoreCandidate {
  alias: string;
  remote?: string;
  active: boolean;
}

// 语义 A (multi-personal): the personal-slot candidate lister — EVERY mounted
// `personal:true` store, with the active one (per global active_personal_store,
// matched by alias OR store_uuid) flagged and sorted first so the slot's default
// selection lands on the current active (no-op pick). Empty/absent global config
// ⇒ no candidates. When no active pointer is set, no candidate is marked active
// (the resolver still falls back to the first personal at read time).
export function personalStoreCandidates(
  globalRoot: string = resolveGlobalRoot(),
): PersonalStoreCandidate[] {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    return [];
  }
  const active = global.active_personal_store;
  const candidates = global.stores
    .filter((s) => s.personal === true)
    .map((s) => ({
      alias: s.alias,
      ...(s.remote === undefined ? {} : { remote: s.remote }),
      active: active !== undefined && (s.alias === active || s.store_uuid === active),
    }));
  return candidates.sort((a, b) => Number(b.active) - Number(a.active));
}

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import {
  addMountedStore,
  bindRequiredStore,
  detachMountedStore,
  explainStore,
  initStore,
  STORES_ROOT_DIR,
  storeRelativePath,
  type FabricConfig,
  type GlobalConfig,
  type MountedStore,
  type RequiredStoreEntry,
  type StoreExplain,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "./global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "./project-config-io.js";

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
  const desired = new Map(config.stores.map((s) => [s.alias, s.store_uuid]));

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
  for (const [alias, uuid] of desired) {
    const link = join(byAliasDir, alias);
    const target = join("..", uuid); // relative → stores/<uuid>
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
    const target = join("..", store.store_uuid);
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

export function storeAdd(
  store: MountedStore,
  globalRoot: string = resolveGlobalRoot(),
): GlobalConfig {
  const next = addMountedStore(requireConfig(globalRoot), store);
  saveGlobalConfig(next, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: keep the by-alias readability layer current.
  return next;
}

// ADJ-NEWN-5 (v2.1 dogfood): create a brand-new LOCAL store + mount it.
//
// Wave0 found there was no CLI path to birth a fresh store: `install --global`
// only mints the personal store, `install --global --url` clones an EXISTING
// remote, and `store add` merely registers an already-on-disk store. The first
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

export function storeCreate(
  alias: string,
  now: string,
  options: { uuid?: string; remote?: string; git?: boolean; globalRoot?: string } = {},
): StoreCreateResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  // requireConfig first: refuse to create before `install --global` (no uid).
  const config = requireConfig(globalRoot);
  const uuid = options.uuid ?? randomUUID();
  const storeDir = join(globalRoot, storeRelativePath(uuid));

  initStore(
    storeDir,
    { store_uuid: uuid, created_at: now, canonical_alias: alias },
    { git: options.git },
  );

  // v2.1 global-refactor (W2-T4, F-SYNC-REMOTE): wire the remote into the store's
  // OWN git repo, not just the config metadata. Before this, `--remote` was
  // recorded in the registry but `git remote add` never ran, so the store could
  // never pull/push (sync's `git pull --rebase`/`git push` had no `origin`).
  // Only when the repo was actually git-init'd (options.git !== false; tests use
  // pure-fs scaffolding) and a remote was requested.
  if (options.remote !== undefined && options.git !== false) {
    gitRemoteAdd(storeDir, options.remote);
  }

  const mounted: MountedStore =
    options.remote === undefined
      ? { store_uuid: uuid, alias }
      : { store_uuid: uuid, alias, remote: options.remote };
  const next = addMountedStore(config, mounted);
  saveGlobalConfig(next, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: mint the by-alias readability link.
  return { config: next, store_uuid: uuid, storeDir };
}

// `git remote add origin <remote>` in the store's repo. Idempotent: if an
// `origin` already exists (re-create over an existing tree shouldn't happen —
// initStore refuses — but be defensive), update it via `set-url` instead.
function gitRemoteAdd(storeDir: string, remote: string): void {
  try {
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: storeDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // origin already present (or add failed) → set the url so the store is still
    // remote-backed. A genuine git failure surfaces on the next sync with git's
    // own diagnostic; we don't want create to crash on a benign re-add.
    try {
      execFileSync("git", ["remote", "set-url", "origin", remote], {
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
  uuid: string,
  globalRoot: string = resolveGlobalRoot(),
): string | undefined {
  const storeDir = join(globalRoot, storeRelativePath(uuid));
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

// ADJ-NEWN-6 (v2.1 dogfood): refuse a "phantom mount". `store add` previously
// wrote the registry entry even when no store tree existed on disk for that
// uuid — the failure only surfaced later when `fabric sync` crashed on a
// non-existent cwd (spawnSync git ENOENT). This guard moves the failure to
// `add` time: the store directory must already exist on disk (cloned via
// `fabric install --global --url <remote>` or created locally). Pure existence
// check so the I/O edge (commands/store.ts) stays testable.
export function assertStoreMountable(
  uuid: string,
  globalRoot: string = resolveGlobalRoot(),
): void {
  const storeDir = join(globalRoot, storeRelativePath(uuid));
  if (!existsSync(join(storeDir, "store.json"))) {
    throw new Error(
      `cannot mount store ${uuid}: no store tree at ${storeDir} — ` +
        `clone it first (\`fabric install --global --url <remote>\`) or create it locally, ` +
        `then re-run \`fabric store add\`. Refusing to register a phantom store.`,
    );
  }
}

export function storeRemove(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): { config: GlobalConfig; detached: MountedStore | null } {
  const result = detachMountedStore(requireConfig(globalRoot), alias);
  saveGlobalConfig(result.config, globalRoot);
  syncStoreAliasLinks(globalRoot); // C3: drop the detached store's by-alias link.
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

// `fabric store bind <id>`: declare a required store on the PROJECT config
// (drives the read-set + clone onboarding). Dedupes by id (S59).
export function storeBind(
  projectRoot: string,
  entry: RequiredStoreEntry,
): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const next: FabricConfig = {
    ...config,
    required_stores: bindRequiredStore(config.required_stores ?? [], entry),
  };
  saveProjectConfig(next, projectRoot);
  return next;
}

// `fabric store switch-write <alias>`: set the project's active write store for
// non-personal scopes (S60). Personal-scope writes are unaffected (R5#3).
export function storeSwitchWrite(projectRoot: string, alias: string): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const next: FabricConfig = { ...config, active_write_store: alias };
  saveProjectConfig(next, projectRoot);
  return next;
}

// Clone-onboarding guidance core (S51): which of this project's required_stores
// are NOT mounted in the global registry. After `git clone` of a Fabric project
// the CLI runs this to guide the user to `fabric store add` the missing stores.
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
  const mounted = new Set(
    (global?.stores ?? []).flatMap((s) => [s.alias, s.store_uuid]),
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
  return global.stores.filter(
    (s) => s.personal !== true && !declared.has(s.alias) && !declared.has(s.store_uuid),
  );
}

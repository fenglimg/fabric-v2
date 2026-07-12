import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  STORE_PROJECT_ID_PATTERN,
  buildStoreResolveInput,
  createStoreResolver,
  isPersonalLeakIntoSharedStore,
  loadProjectConfig,
  resolveGlobalRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";
import {
  PersonalScopeLeakError,
  StoreWriteTargetUnresolvedError,
} from "@fenglimg/fabric-shared/errors";
import { atomicWriteText, withFileLock } from "@fenglimg/fabric-shared/node/atomic-write";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1-T2) — cross-store write-side wiring.
// v2.2 全砍 Stage 2 (B2 cutover) — the write path is now STORE-ONLY.
//
// The knowledge write path (extract-knowledge → pending; review approve →
// canonical) historically fell back to the dual-root co-location:
//   team     → <projectRoot>/.fabric/knowledge/...
//   personal → <FABRIC_HOME>/.fabric/knowledge/...
// That fallback is removed. Knowledge now lives ONLY inside the resolved
// write-target store (~/.fabric/stores/<uuid>/). When no target resolves the
// write hard-fails with an actionable StoreWriteTargetUnresolvedError pointing
// at the onboarding commands — never a silent fallback to the retired model.
//
// Pre-req (S1): a per-repo `fabric install` mints the global config + personal
// store, and `fabric store bind` + `switch-write` select the team target, so a
// correctly-onboarded project always resolves a target. The hard-fail only
// fires on a genuinely un-onboarded write.
// ---------------------------------------------------------------------------

function writeTargetUnresolved(scope: string, layer: "team" | "personal"): StoreWriteTargetUnresolvedError {
  const actionHint =
    layer === "personal"
      ? "run `fabric install --global` to mint your personal store, then retry"
      : `mount + bind a shared store, then set an explicit route: \`fabric store switch-write <alias> --scope ${scope}\``;
  return new StoreWriteTargetUnresolvedError(
    `no write-target store resolved for scope '${scope}' — knowledge writes are store-only (dual-root co-location removed)`,
    { actionHint, fixable: true, details: { layer, scope } },
  );
}

function defaultWriteScope(layer: "team" | "personal", projectRoot: string): string {
  if (layer === "personal") {
    return "personal";
  }
  const activeProject = loadProjectConfig(projectRoot)?.active_project;
  return activeProject !== undefined && activeProject.length > 0
    ? `project:${activeProject}`
    : "team";
}

function resolveSemanticWriteScope(
  layer: "team" | "personal",
  projectRoot: string,
  semanticScope?: string,
): string {
  return semanticScope ?? defaultWriteScope(layer, projectRoot);
}

// Absolute directory of the write-target store for a layer (the store root, not
// its knowledge subdir). Exposed for the stable_id counter allocation (W4 decolo):
// a newly-minted id's per-store `counters.json` must live in the SAME store the
// entry physically lands in. Throws StoreWriteTargetUnresolvedError when no
// target resolves (B2 cutover — no dual-root fallback).
export function resolveWriteTargetStoreDir(
  layer: "team" | "personal",
  projectRoot: string,
  semanticScope?: string,
): string {
  const input = buildStoreResolveInput(projectRoot);
  const scope = resolveSemanticWriteScope(layer, projectRoot, semanticScope);
  if (input === null) {
    throw writeTargetUnresolved(scope, layer);
  }
  const { target } = createStoreResolver().resolveWriteTarget(input, scope);
  if (target === null) {
    throw writeTargetUnresolved(scope, layer);
  }
  const mounted = input.mountedStores.find((s) => s.store_uuid === target.store_uuid);
  return join(
    resolveGlobalRoot(),
    storeRelativePathForMount(mounted ?? { store_uuid: target.store_uuid }),
  );
}

// Store-rooted pending base for a layer. Throws StoreWriteTargetUnresolvedError
// when no write-target store resolves (B2 cutover — no dual-root fallback).
export function resolveStorePendingBase(
  layer: "team" | "personal",
  projectRoot: string,
  semanticScope?: string,
): string {
  return join(resolveWriteTargetStoreDir(layer, projectRoot, semanticScope), STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR);
}

// The projects/ subdir name for the project-partitioned canonical layout
// (knowledge/projects/<id>/<type>/*.md). Mirrors the local const the read-side
// scanner (shared store/core.ts) uses — the two sides own separate concerns
// (write-landing vs read-scan) so each keeps its own literal rather than sharing
// a barrel export.
const STORE_PROJECTS_DIR = "projects";

// C-107 project-id guard for the write-side project segment: a landing project
// id must be a single [a-z0-9_-] segment that is neither the literal "projects"
// nor one of the reserved type dir names, so a hostile/typo `active_project`
// never mints a stray or colliding folder. Invalid → caller falls back to flat.
// Symmetric to the read-side collision guard in shared store/core.ts.
function isValidWriteProjectSegment(project: string): boolean {
  if (project.length === 0) {
    return false;
  }
  if (project === STORE_PROJECTS_DIR) {
    return false;
  }
  if ((STORE_KNOWLEDGE_TYPE_DIRS as readonly string[]).includes(project)) {
    return false;
  }
  return STORE_PROJECT_ID_PATTERN.test(project);
}

// Store-rooted canonical knowledge base (the per-type subdir is appended by the
// caller) — where review approve promotes a pending entry. Throws when no
// write-target store resolves (B2 cutover — no dual-root fallback). Keeps the
// extract→approve→recall round-trip entirely inside the store.
//
// W1/TASK-003 (project-folder reroot): a team-layer write bound to a project
// lands in the project-partitioned subtree knowledge/projects/<id>/<type>/ —
// the single point that owns store-root→knowledge-base path math (symmetric to
// resolveStorePendingBase). The project segment is injected ONLY for the team
// layer with a valid `active_project` (C-107 guarded); personal writes and
// unbound team writes stay FLAT at knowledge/<type>/ (C-106 personal-flat +
// backward-compat). Intentional asymmetry: resolveStorePendingBase stays flat —
// pending is pre-promote scratch and only this canonical promote injects the
// project segment (KT-DEC parallels defaultWriteScope keeping scope-string vs
// path-shape separate).
export function resolveStoreCanonicalBase(
  layer: "team" | "personal",
  projectRoot: string,
  project?: string,
): string {
  const base = join(resolveWriteTargetStoreDir(layer, projectRoot), STORE_LAYOUT.knowledgeDir);
  if (layer === "team" && project !== undefined && isValidWriteProjectSegment(project)) {
    return join(base, STORE_PROJECTS_DIR, project);
  }
  return base;
}

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1/A1) — scope metadata an entry's frontmatter records.
//
//   semantic_scope   — WHO the entry is for (the resolution axis, schemas/scope.ts):
//                        personal layer → "personal"
//                        team layer     → "project:<active_project>" when the repo
//                                          is bound to a project (A2), else "team".
//   visibility_store — the alias of the store the entry PHYSICALLY lands in (the
//                      resolved write-target). Decouples scope from storage (S42).
//
// R5#3 RED LINE: a personal-scope entry must never resolve to a SHARED store.
// The resolver already routes personal scope → the personal store, so the happy
// path can't leak; this is the explicit refusal for any path that would force a
// personal scope into a shared target (e.g. a forced team-layer write carrying a
// personal coordinate). Throws PersonalScopeLeakError in that case.
// ---------------------------------------------------------------------------
export interface WriteScopeMeta {
  semantic_scope: string;
  visibility_store: string;
}

export function resolveWriteScopeMeta(
  layer: "team" | "personal",
  projectRoot: string,
  semanticScope?: string,
): WriteScopeMeta {
  const input = buildStoreResolveInput(projectRoot);
  const scope = resolveSemanticWriteScope(layer, projectRoot, semanticScope);
  if (input === null) {
    throw writeTargetUnresolved(scope, layer);
  }
  const { target } = createStoreResolver().resolveWriteTarget(input, scope);
  if (target === null) {
    throw writeTargetUnresolved(scope, layer);
  }

  const semantic_scope = scope;

  // R5#3 guard: the resolved store's visibility (personal store carries
  // personal=true; everything else is shared). A personal scope into a shared
  // store is refused.
  const targetIsPersonal =
    input.mountedStores.find((s) => s.store_uuid === target.store_uuid)?.personal === true;
  const targetVisibility = targetIsPersonal ? "personal" : "shared";
  if (isPersonalLeakIntoSharedStore(layer, targetVisibility)) {
    throw new PersonalScopeLeakError(
      `refusing to write personal-scope knowledge into shared store '${target.alias}' (R5#3 privacy boundary)`,
      { actionHint: "personal knowledge lives only in your personal store; do not force it into a shared write-target", details: { store: target.alias } },
    );
  }

  return { semantic_scope, visibility_store: target.alias };
}

// ---------------------------------------------------------------------------
// BORROW-011: per-file lock + sha256 pre-write validation for safe CRUD writes.
//
// Each knowledge file write is serialized through a per-file lock
// (`<filePath>.write.lock`) using the same `withFileLock` primitive as
// store-counters.ts and event-ledger.ts. Before the caller's write lands,
// the current on-disk content is sha256-hashed and compared against an
// optional `expectedHash` — when the hash mismatches (a concurrent writer
// landed first), the write is refused with a concurrency conflict error
// rather than silently overwriting. This is optimistic concurrency: the
// caller reads, edits, then writes with the hash it read; a mismatch means
// another writer beat it to the file.
// ---------------------------------------------------------------------------

/** Result of a locked file write. */
export interface LockedWriteResult {
  /** True when the write landed. */
  committed: boolean;
  /** The sha256 of the content that was written (committed=true) or the
   *  content that beat us to the file (committed=false). */
  hash: string;
}

/**
 * Write `content` to `filePath` under a per-file advisory lock, with an
 * optional optimistic-concurrency pre-write hash check.
 *
 * - When `expectedHash` is undefined the write always lands (the lock still
 *   serializes concurrent callers).
 * - When `expectedHash` is supplied, the current on-disk content is hashed
 *   BEFORE the write; a mismatch returns `{ committed: false, hash: <actual> }`
 *   without touching the file.
 * - The lock file is `<filePath>.write.lock` (same pattern as
 *   `store-counters.ts` uses `<countersPath>.lock`).
 */
export async function lockedWriteFile(
  filePath: string,
  content: string,
  expectedHash?: string,
): Promise<LockedWriteResult> {
  const lockPath = `${filePath}.write.lock`;
  return withFileLock(lockPath, async () => {
    // Pre-write hash gate (optimistic concurrency).
    if (expectedHash !== undefined) {
      let current: string;
      try {
        current = await readFile(filePath, "utf8");
      } catch {
        // File doesn't exist yet — no conflict possible.
        current = "";
      }
      const actualHash = sha256(current);
      if (actualHash !== expectedHash) {
        return { committed: false, hash: actualHash };
      }
    }

    // Write + return the new hash. Atomic tmp+rename under the advisory lock
    // (ISS-20260711-179: production write path for review promote/modify).
    await mkdir(dirname(filePath), { recursive: true });
    await atomicWriteText(filePath, content);
    return { committed: true, hash: sha256(content) };
  });
}

/** Hash a string with sha256, prefixed like _shared.ts:sha256(). */
function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

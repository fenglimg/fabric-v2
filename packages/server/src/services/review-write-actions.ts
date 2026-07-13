/**
 * ISS-20260713-013: fab_review write actions (approve/reject/modify/defer/retire).
 * Extracted from review.ts by action family.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";
import type { FabReviewOutput, KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  allocateStoreKnowledgeId,
  isPersonalScope,
  lintCrossStoreReferences,
  loadProjectConfig,
} from "@fenglimg/fabric-shared";
import {
  lockedWriteFile,
  resolveStoreCanonicalBase,
  resolveStorePendingBase,
  resolveWriteTargetStoreDir,
} from "./cross-store-write.js";
import { atomicWriteText, ensureParentDirectory } from "./_shared.js";
import { extractReviewSlug, isPendingKnowledgePath } from "./review-path.js";
import {
  parseFrontmatter,
  rewriteFrontmatterForPromote,
  rewriteFrontmatterMerge,
  type ParsedFrontmatter,
  type FrontmatterScalarPatch,
} from "./review-frontmatter.js";
import { hasUnresolvedDismissal } from "./promotion-gate.js";

type PluralType = KnowledgeType;
type Layer = "team" | "personal";
type Maturity = "draft" | "verified" | "proven";
type RelevanceScope = "narrow" | "broad";
type LifecycleStatus = "active" | "rejected" | "deferred";

const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

const SCOPE_COORDINATE_PATTERN = /^(?:personal|team|project:[a-z0-9][a-z0-9_-]*)$/u;

// Injected from review.ts facade to share sandbox + audit without circular imports.
export type ReviewWriteDeps = {
  resolveSandboxedPath: (
    projectRoot: string,
    pendingPath: string,
    opts?: { allowPersonal?: boolean },
  ) => { abs: string; isInProjectTree: boolean };
  assertNoSecretsInReviewContent: (content: string, op: string) => void;
  assertCrossStoreRefsSafe: (content: string, entryLayer: "team" | "personal") => void;
  emitKnowledgeLifecycleEvent: (
    projectRoot: string,
    event: EventLedgerEventInput,
  ) => Promise<void>;
  extractBodyTrimmed: (content: string) => string;
  resolvePersonalRoot: () => string;
  storeKnowledgeRoots: (projectRoot: string) => string[];
  isUnder: (abs: string, root: string) => boolean;
  realpathExistingPrefix: (path: string) => string;
};

let deps: ReviewWriteDeps | null = null;

export function bindReviewWriteDeps(d: ReviewWriteDeps): void {
  deps = d;
}

function D(): ReviewWriteDeps {
  if (!deps) throw new Error("review-write-actions: bindReviewWriteDeps not called");
  return deps;
}

export async function approveAll(
  projectRoot: string,
  pendingPaths: string[],
): Promise<{
  approved: Array<{ pending_path: string; stable_id: string }>;
  failed: Array<{ pending_path: string; reason: string }>;
}> {
  const approved: Array<{ pending_path: string; stable_id: string }> = [];
  const failed: Array<{ pending_path: string; reason: string }> = [];

  for (const pendingPath of pendingPaths) {
    const result = await approveOne(projectRoot, pendingPath);
    if (result !== null) {
      approved.push(result);
    } else {
      failed.push({
        pending_path: pendingPath,
        reason: "approve skipped: path unresolved, IO failure, or gated",
      });
    }
  }

  return { approved, failed };
}

async function approveOne(
  projectRoot: string,
  pendingPath: string,
): Promise<{ pending_path: string; stable_id: string } | null> {
  // Defense-in-depth: confine the caller-supplied pending path to the resolved
  // write-target store's knowledge/pending/<type>/ tree.
  let sourceAbs: string;
  let sourceOrigin: "team" | "personal";
  // v2.1 global-refactor (NEW-APPROVE-PROMOTE): true when the resolved pending
  // base is a write-target STORE repo (not the project / personal dual-root).
  let sourceIsStore = false;
  try {
    const sandboxed = D().resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
    // v2.2 全砍 Stage 2: resolve each layer's store pending base defensively — a
    // layer whose store is not mounted (e.g. team-only setup with no personal
    // store) is simply not a membership candidate, never an approve-time crash.
    const resolvePendingBaseOrNull = (layer: "team" | "personal"): string | null => {
      try {
        return resolveStorePendingBase(layer, projectRoot);
      } catch {
        return null;
      }
    };
    const teamPendingAbs = resolvePendingBaseOrNull("team");
    const personalPendingAbs = resolvePendingBaseOrNull("personal");

    const inTeamPending =
      teamPendingAbs !== null && D().isUnder(sandboxed.abs, resolve(teamPendingAbs));
    const inPersonalPending =
      personalPendingAbs !== null && D().isUnder(sandboxed.abs, resolve(personalPendingAbs));

    if (!inTeamPending && !inPersonalPending) {
      throw new Error(`approve path is outside the resolved store knowledge/pending/ roots: ${pendingPath}`);
    }
    sourceAbs = sandboxed.abs;
    sourceOrigin = inPersonalPending ? "personal" : "team";
    // v2.2 全砍 Stage 2: the pending base is ALWAYS a store repo now (store-only
    // write path); we only reached here because pendingBaseAbs resolved a store.
    sourceIsStore = true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_promote_failed",
      timestamp: new Date().toISOString(),
      reason: `approve:${pendingPath}: ${reason}`,
    });
    return null;
  }
  const slug = basename(pendingPath).replace(/\.md$/u, "");

  // rc.31 BUG-G2: previously `knowledge_proposed` was only emitted by
  // extract-knowledge.ts (i.e. only when a pending file was created via the
  // fab_propose MCP tool). Pending files written by hand or by
  // third-party Skills would never produce a proposed event, so the ledger
  // invariant `proposed_count >= promoted_count` got silently violated (in
  // werewolf-minigame rc.30 audit: proposed=17, promoted=52). Synthesize a
  // proposed event here at approve-time so the (proposed → promote_started →
  // promoted) triple stays balanced regardless of how the pending file was
  // born. The synth reason prefix lets cite-coverage / ledger consumers
  // distinguish backfill emissions from real extract-time ones.
  //
  // Best-effort: failure to write the synth proposed must not block the
  // approve, the promote_started/promoted pair below is the authoritative
  // signal for the operation.
  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_proposed",
    timestamp: new Date().toISOString(),
    reason: `approve-synth:${slug}`,
  });

  // Phase 1: signal we're starting. Emitted before any allocator/IO mutation
  // so forensic recovery (rc.3 doctor filesystem-edit fallback) can detect a
  // crashed approve mid-flight.
  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_promote_started",
    timestamp: new Date().toISOString(),
    reason: `approve:${slug}`,
  });

  let allocatedId: string | undefined;
  let targetAbs: string | undefined;
  let writtenTarget = false;

  try {
    const content = await readFile(sourceAbs, "utf8");
    const fm = parseFrontmatter(content);

    const pluralType = fm.type;
    if (pluralType === undefined || !PLURAL_TYPES.includes(pluralType)) {
      throw new Error(`pending file missing or invalid 'type' frontmatter: ${pendingPath}`);
    }
    const layer: Layer = fm.layer ?? "team";

    // rc.29 BUG-C1: KnowledgeType is now plural; pluralType is the canonical
    // value passed straight to the allocator.
    // W4 decolo: mint the id from the write-target STORE's committed counters.json
    // (same store the entry lands in below) — the co-location agents.meta counter
    // is retired. resolveWriteTargetStoreDir throws the same actionable
    // StoreWriteTargetUnresolvedError as resolveStoreCanonicalBase on no target.
    const stableId = await allocateStoreKnowledgeId(
      layer,
      pluralType,
      resolveWriteTargetStoreDir(layer, projectRoot),
    );
    allocatedId = stableId;

    const newFilename = `${stableId}--${slug}.md`;
    // v2.2 全砍 Stage 2 (B2 cutover): promote into the resolved write-target
    // store's canonical knowledge dir so the full extract→approve→recall
    // round-trip stays inside the store. resolveStoreCanonicalBase throws an
    // actionable StoreWriteTargetUnresolvedError when no target resolves — no
    // dual-root fallback.
    // W1/TASK-003 (project-folder reroot): a team-layer promote bound to a
    // project lands in knowledge/projects/<id>/<type>/. Derive the project from
    // the SAME source defaultWriteScope uses (active_project) and only for team
    // layer — personal stays flat (C-106). The call-site stays a THIN consumer:
    // it appends only pluralType + newFilename; the projects/<id> path-shape math
    // lives entirely inside resolveStoreCanonicalBase (C-104, C-107 guard).
    const promoteProject =
      layer === "team" ? loadProjectConfig(projectRoot)?.active_project : undefined;
    targetAbs = join(
      resolveStoreCanonicalBase(layer, projectRoot, promoteProject),
      pluralType,
      newFilename,
    );
    await ensureParentDirectory(targetAbs);

    // Inject id, drop x-fabric-idempotency-key (no longer meaningful post-promote).
    // v2.2 C1: approve is THE review-confirmation moment — stamp the recheck clock
    // so the doctor broad review-recheck lint measures from "last confirmed by a
    // reviewer", not from authoring time.
    const rewritten = rewriteFrontmatterMerge(
      rewriteFrontmatterForPromote(content, stableId),
      { last_review_confirmed_at: new Date().toISOString() },
    );
    D().assertNoSecretsInReviewContent(rewritten, "approve");
    D().assertCrossStoreRefsSafe(rewritten, layer);
    // ISS-20260711-179: knowledge writes go through lockedWriteFile (was unused).
    await lockedWriteFile(targetAbs, rewritten);
    writtenTarget = true;

    // Remove pending file. The decision tree keys off the SOURCE origin
    // (where the pending file lives), not the destination layer:
    //   source in workspace pending → try `git rm` (preserves rename detection
    //     when the entry was tracked) with fs.unlink fallback for untracked
    //     or non-repo cases.
    //   source in personal pending  → plain unlink (the path lives outside
    //     the project's git tree, so `git rm` is meaningless).
    // rc.5 B1: a personal-classified entry can originate from either root
    // (the Skill may have written to workspace pending if the layer field
    // wasn't classified upstream), so use sourceOrigin to choose the removal
    // strategy independent of fm.layer.
    //
    // v2.1 global-refactor (NEW-APPROVE-PROMOTE): a store-rooted pending source
    // lives in a SEPARATE git repo (~/.fabric/stores/<uuid>/), not the project
    // repo, so the project-cwd `git rm` below would fail (path is absolute /
    // outside the project tree). Conservative choice: plain fs.unlink. The
    // canonical copy is written via atomicWriteText (already done above), and
    // committing the store's pending-removal + canonical-add is the sync layer's
    // job (`fabric sync` stages + commits the store repo) — review must not
    // pre-stage in a repo it doesn't own. Loss of git rename detection across
    // the pending→canonical move is acceptable (same trade-off as personal).
    if (sourceIsStore) {
      if (existsSync(sourceAbs)) {
        await unlink(sourceAbs);
      }
    } else if (sourceOrigin === "team") {
      try {
        execFileSync("git", ["rm", "--quiet", "-f", pendingPath], {
          cwd: projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
        // git rm leaves the index updated and removes the working file.
      } catch {
        // Fall back to plain unlink when not in a git repo (eg. tests
        // without `git init`). The promote is still observable via the
        // events pair; loss of git rename detection is acceptable in
        // non-repo contexts.
        if (existsSync(sourceAbs)) {
          await unlink(sourceAbs);
        }
      }
    } else {
      // Personal pending source: target may be either team or personal, but
      // the source file lives outside the project's git tree so we always
      // use fs.unlink.
      if (existsSync(sourceAbs)) {
        await unlink(sourceAbs);
      }
    }

    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_promoted",
      stable_id: stableId,
      timestamp: new Date().toISOString(),
      reason: `approve:${slug}`,
    });

    // v2.2 W5 R2 (agents.meta decolo): the rc.27 post-approve
    // `reconcileKnowledge` (which rebuilt the co-location agents.meta.json so
    // the promoted entry's description flowed into `nodes[id]`) is retired.
    // The approved entry is written into its store above; the cross-store recall
    // path builds descriptions on the fly from the store markdown at read time,
    // so there is no project-local index to flush post-approve.

    return { pending_path: pendingPath, stable_id: stableId };
  } catch (err) {
    // Best-effort rollback: if the target was written before failure, remove
    // it so the canonical path stays clean. The pending file (if still
    // present) remains for retry. The allocator counter is NOT rolled back —
    // counters are monotonic by design (knowledge-id-allocator.ts:38-41).
    if (writtenTarget && targetAbs !== undefined && existsSync(targetAbs)) {
      try {
        await unlink(targetAbs);
      } catch {
        // ignore — forensics will reconcile via doctor filesystem-edit fallback.
      }
    }

    const reason = err instanceof Error ? err.message : String(err);
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_promote_failed",
      ...(allocatedId !== undefined ? { stable_id: allocatedId } : {}),
      timestamp: new Date().toISOString(),
      reason: `approve:${slug}: ${reason}`,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// reject action
//
// v2.0.0-rc.27 TASK-001 (§2.2): writes `status: rejected` to the pending
// file's frontmatter so subsequent list/search calls filter the entry out by
// default. The original rc.3 design only emitted a `knowledge_rejected` event
// and left the file untouched — that left a "ghost queue" of rejected entries
// that re-surfaced on every list call and aged into the stale-archive signal
// at 14d, generating a permanent review-hint loop. Frontmatter authoring
// makes the rejection visible to the same code path that reads pending files
// without requiring callers to cross-reference the ledger.
//
// Physical deletion remains a vacuum concern (doctor --vacuum) so the audit
// history stays inspectable for forensic recovery.
// ---------------------------------------------------------------------------

export async function rejectAll(
  projectRoot: string,
  pendingPaths: string[],
  reason: string,
): Promise<string[]> {
  const rejected: string[] = [];
  for (const pendingPath of pendingPaths) {
    // Best-effort frontmatter write. A read/parse/write failure must NOT
    // prevent the ledger event from firing — the event is the durable record
    // of the operator's intent, frontmatter is the secondary cache that
    // list/search consult. Same priority ordering as approve's event-vs-IO
    // contract (line 383-387 above: signal-then-mutate).
    try {
      const sandboxed = D().resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
      if (existsSync(sandboxed.abs)) {
        const content = await readFile(sandboxed.abs, "utf8");
        const merged = rewriteFrontmatterMerge(content, { status: "rejected" });
        // v2.2 全砍 F15: reject is now physically intuitive — MOVE the entry out
        // of pending/ into a sibling `rejected/` dir (within the same store)
        // rather than leaving a status-flagged file sitting in the active
        // pending queue. The pending/ dir then reflects only live proposals;
        // rejected entries are preserved (frontmatter status + the move) for
        // audit/restore but no longer scanned by list/recall (which only read
        // pending/ + the 5 canonical type dirs). Falls back to in-place flag
        // when the path isn't under a `/pending/` segment (defensive).
        const rejectedAbs = sandboxed.abs.includes(`${sep}pending${sep}`)
          ? sandboxed.abs.replace(`${sep}pending${sep}`, `${sep}rejected${sep}`)
          : null;
        if (rejectedAbs !== null) {
          await ensureParentDirectory(rejectedAbs);
          D().assertNoSecretsInReviewContent(merged, "review-write");
    await lockedWriteFile(rejectedAbs, merged);
          await unlink(sandboxed.abs);
        } else if (merged !== content) {
          D().assertNoSecretsInReviewContent(merged, "review-write");
    await lockedWriteFile(sandboxed.abs, merged);
        }
      }
    } catch {
      // Sandboxed-resolve threw (path traversal) or IO error. The event
      // below still records the operator intent; list/search will continue
      // surfacing the entry until the operator runs vacuum or fixes the
      // path. Silent failure is intentional — the public contract for
      // reject is "the entry is no longer recommended", not "the file is
      // mutated", so partial mutation is acceptable.
    }
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_rejected",
      timestamp: new Date().toISOString(),
      reason: `reject:${pendingPath}: ${reason}`,
    });
    rejected.push(pendingPath);
  }
  return rejected;
}

// ---------------------------------------------------------------------------
// modify action (TASK-002)
//
// Two paths:
//   1. In-place rewrite — frontmatter scalars (title/summary/maturity/tags)
//      are merged into the existing file. id and layer are preserved.
//   2. Layer-flip — when changes.layer differs from current layer, allocate
//      a NEW id under the target layer, move the file across layer roots,
//      emit knowledge_layer_changed. This is the ONLY legal stable_id
//      mutation in the rc.3 surface.
//
// Schema overload note: the discriminated-union field name is `pending_path`,
// but the value can reference either a store pending entry or a post-approve
// canonical entry. The helper `resolveModifyTarget` handles the lookup inside
// the resolved store knowledge roots.
// ---------------------------------------------------------------------------

type ModifyChanges = {
  title?: string;
  summary?: string;
  layer?: Layer;
  maturity?: Maturity;
  tags?: string[];
  // v2.0-rc.5 C3 (TASK-012): relevance fields editable via modify. Apply to
  // pending AND canonical entries. A narrow team → personal layer flip
  // triggers an auto-degrade override (broad + []) regardless of caller-sent
  // values — see `modifyEntry`.
  relevance_scope?: RelevanceScope;
  relevance_paths?: string[];
  // v2.2 project-scope migration: in-place re-scope of the resolution
  // coordinate (team → project:<id>). visibility_store is untouched —
  // scope ⊥ store. Personal-root coordinates are rejected in modifyEntry.
  semantic_scope?: string;
  // v2.2 graph edges (KT-DEC-0031): `related` H2 adjacency. REPLACE semantics
  // like tags. Previously dropped by zod .strip() in the changes schema before
  // it ever reached here (the only related-write path was non-functional).
  related?: string[];
  // rc.9 (2026-07-06): discovery-signal scalar patches. Same recurrence pattern
  // as `related` above (KT-PIT-0005 / KT-PIT-0018): pre-rc.9 the zod .strip()
  // silently dropped these three, so the only path to fix a bad-shape
  // must_read_if / missing intent_clues was direct Edit — bypassing the skill
  // audit trail. REPLACE semantics; must_read_if is a scalar string; the other
  // two are flow-arrays mirroring tags/related.
  must_read_if?: string;
  intent_clues?: string[];
  impact?: string[];
  // ISS-20260711-180: keep in lockstep with _fabReviewModifyChangesSchema.
  tech_stack?: string[];
  evidence_paths?: string[];
  onboard_slot?:
    | "tech-stack-decision"
    | "architecture-pattern"
    | "code-style-tone"
    | "build-system-idiom"
    | "domain-vocabulary";
};

// Prefer shared FrontmatterScalarPatch from review-frontmatter (includes modify + lifecycle fields).
// Local ModifyChanges remains the public modify surface (no status/deferred_until).
type _AssertModifySubset = ModifyChanges extends FrontmatterScalarPatch ? true : false;


export async function modifyEntry(
  projectRoot: string,
  pendingPath: string,
  changes: ModifyChanges,
): Promise<FabReviewOutput> {
  const target = resolveModifyTarget(projectRoot, pendingPath);
  if (target === null) {
    throw new Error(`modify target not found: ${pendingPath}`);
  }

  const content = await readFile(target.absPath, "utf8");
  const fm = parseFrontmatter(content);
  const currentLayer: Layer = fm.layer ?? "team";

  // v2.2 C1 (processes/maturity-promotion-rubric-v1): verified→proven NECESSARY
  // gate "0 dismiss". The promotion's importance signal is mechanical (related
  // in-degree, surfaced by doctor); the SUFFICIENT judgment is offline/human
  // (guideline/model summary cold-eval + a reviewer's "this is foundational"
  // affirmation, driven by the fabric-review skill — see summary-cold-eval.ts).
  // The one necessary condition enforceable server-side is "0 dismiss": an entry
  // carrying an UNRESOLVED dismissed cite has a live objection on record and must
  // not be laundered into the foundational tier. Hard-fail (fix-don't-hide); the
  // reviewer resolves the dismissal (re-affirm with an applied cite, or address
  // the objection) before retrying. Scoped to the exact verified→proven edge so
  // draft→verified and verified-staying-verified are untouched.
  if (fm.maturity === "verified" && changes.maturity === "proven" && fm.id !== undefined) {
    if (await hasUnresolvedDismissal(projectRoot, fm.id)) {
      throw new Error(
        `verified→proven promotion blocked for ${fm.id}: an unresolved dismissed cite is on record (rubric necessary gate "0 dismiss"). Re-affirm the entry with an applied cite or address the objection, then retry.`,
      );
    }
  }

  // v2.2 project-scope migration: a personal-root semantic_scope would move the
  // entry into the personal store (R5#3 privacy boundary) — that is a store
  // move, not an in-place scalar edit. Refuse it here; the dedicated path is
  // modify-layer (changes.layer: "personal"), which re-resolves the target store.
  if (changes.semantic_scope !== undefined && isPersonalScope(changes.semantic_scope)) {
    throw new Error(
      `cannot re-scope to personal coordinate '${changes.semantic_scope}' via modify; use action 'modify-layer' with layer 'personal' to move the entry into the personal store (R5#3)`,
    );
  }

  // ------ Layer-flip path ------
  if (changes.layer !== undefined && changes.layer !== currentLayer) {
    return await modifyLayerFlip(projectRoot, target, content, fm, changes);
  }

  // ------ In-place path ------
  // v2.0-rc.5 C3 (TASK-012): relevance fields apply to canonical entries too —
  // the modify branch accepts both pending and canonical paths (resolved by
  // `resolveModifyTarget`), so a narrow→broad rescope on a post-approve entry
  // flows through the same in-place rewrite as a scalar tag/maturity edit.
  // v2.2 C1: a modify IS a review touch — stamp the recheck clock. The stamp is
  // merged into the write but kept OUT of `changedFields` (it is an automatic
  // side-effect, not a caller-requested change) so the knowledge_modified event
  // stays a faithful record of the operator's intent.
  const merged = rewriteFrontmatterMerge(content, {
    ...changes,
    last_review_confirmed_at: new Date().toISOString(),
  });
  D().assertNoSecretsInReviewContent(merged, "modify");
  D().assertCrossStoreRefsSafe(merged, currentLayer);
  await lockedWriteFile(target.absPath, merged);
  const changedFields = Object.keys(changes).filter(
    (field) => changes[field as keyof ModifyChanges] !== undefined,
  );
  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_modified",
    ...(fm.id !== undefined ? { stable_id: fm.id } : {}),
    timestamp: new Date().toISOString(),
    path: pendingPath,
    changed_fields: changedFields,
    before: pickModifyEventValues(fm, changedFields),
    after: pickModifyEventValues(changes, changedFields),
    reason: `modify:${pendingPath}`,
  });

  return {
    action: "modify",
    pending_path: pendingPath,
  };
}

// v2.3 batch content-modify: the array-native flush path for the fabric-review
// maintain loop (parity with approveAll/rejectAll/deferAll — the *All helpers
// that already loop internally). Each item is applied as a content-only edit
// (layer stripped, mirroring the modify-content dispatch case), caught
// per-item so one bad entry reports {ok:false, error} without aborting the
// batch. The first-reconcile gate + payload guard run ONCE for the whole batch
// in the tool wrapper — collapsing N gate-waits to 1 is the latency this path
// exists to reclaim. A verified→proven item still hard-fails inside modifyEntry
// (the 0-dismiss gate), surfacing as ok:false rather than laundering the entry.
export async function modifyContentBatch(
  projectRoot: string,
  items: ReadonlyArray<{ pending_path: string; changes: ModifyChanges }>,
): Promise<Array<{ pending_path: string; ok: boolean; error?: string }>> {
  const results: Array<{ pending_path: string; ok: boolean; error?: string }> = [];
  for (const item of items) {
    // Strip any layer field so a batch item can never flip layer (parity with
    // the modify-content dispatch case; layer-flips stay on modify-layer).
    const { layer: _droppedLayer, ...contentChanges } = item.changes;
    try {
      await modifyEntry(projectRoot, item.pending_path, contentChanges);
      results.push({ pending_path: item.pending_path, ok: true });
    } catch (error) {
      results.push({
        pending_path: item.pending_path,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

type ResolvedTarget = {
  absPath: string;
  // Whether the target lives under the project's git tree (team or pending)
  // or under FABRIC_HOME (personal canonical).
  isInProjectTree: boolean;
  // Plural type (parsed from path segment if available); null for pending
  // files where the directory is `pending/<type>/` — caller can derive.
  inferredType: PluralType | null;
  // Slug (filename without .md, with id prefix stripped if present).
  slug: string;
};

function pickModifyEventValues(
  source: Partial<ParsedFrontmatter & ModifyChanges>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field] = source[field as keyof (ParsedFrontmatter & ModifyChanges)] ?? null;
  }
  return out;
}

function resolveModifyTarget(
  projectRoot: string,
  pendingPath: string,
): ResolvedTarget | null {
  // Defense-in-depth: constrain caller-supplied path to the resolved store
  // knowledge roots. Reject traversal attempts. modify accepts both pending and
  // canonical store entries.
  let sandboxed: { abs: string; isInProjectTree: boolean };
  try {
    sandboxed = D().resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
  } catch {
    return null;
  }

  if (existsSync(sandboxed.abs)) {
    return {
      absPath: sandboxed.abs,
      isInProjectTree: sandboxed.isInProjectTree,
      inferredType: inferTypeFromPath(pendingPath),
      slug: extractSlug(pendingPath),
    };
  }

  return null;
}

function inferTypeFromPath(path: string): PluralType | null {
  // Match `<...>/knowledge/[pending/]<type>/<file>.md`.
  const match = /(?:^|[\\/])knowledge[\\/](?:pending[\\/])?([^\\/]+)[\\/][^\\/]+\.md$/u.exec(path);
  if (match === null) return null;
  const seg = match[1];
  if (seg !== undefined && PLURAL_TYPES.includes(seg as PluralType)) {
    return seg as PluralType;
  }
  return null;
}

function extractSlug(path: string): string {
  return extractReviewSlug(path);
}

// test hook lives in review.ts facade re-exporting review-path

export async function modifyLayerFlip(
  projectRoot: string,
  target: ResolvedTarget,
  content: string,
  fm: ParsedFrontmatter,
  changes: ModifyChanges,
): Promise<FabReviewOutput> {
  // v2.0.0-rc.27 TASK-001 (§2.10): refuse layer-flip on pending entries. The
  // rc.3 modify+layer-flip was designed for canonical → canonical movement
  // (a published team entry reclassified as personal, or vice versa). On a
  // pending entry the flip silently doubled as a promote — allocating a
  // stable_id, writing the canonical destination, and skipping the
  // approve gate's frontmatter audit. That's a quiet way to launder
  // unreviewed content into the canonical registry. Callers who actually
  // want "promote with layer X" must approve first (which writes the
  // canonical file with the source-declared layer) and then modify the
  // canonical entry's layer.
  if (isPendingKnowledgePath(target.absPath)) {
    throw new Error(
      "layer-flip not allowed on pending entries; approve first, then modify the canonical entry's layer",
    );
  }

  const fromLayer: Layer = fm.layer ?? "team";
  const toLayer: Layer = changes.layer as Layer;
  const pluralType = fm.type ?? target.inferredType;
  if (pluralType === null || pluralType === undefined) {
    throw new Error(`layer-flip requires a known type; could not infer for ${target.absPath}`);
  }
  const slug = target.slug;
  const priorStableId = fm.id;

  // v2.0-rc.5 C3 (TASK-012): narrow team→personal flip triggers auto-degrade.
  // Personal knowledge is cross-project so workspace-relative `relevance_paths`
  // anchors have no anchor in the new context — we force scope=broad+[] and
  // record the degrade in the event ledger. The override takes precedence
  // over any caller-supplied `relevance_scope` / `relevance_paths` patch
  // because preserving the narrow anchors after the flip would silently lie
  // about applicability (the anchors no longer mean what they meant).
  // Also handles pending entries (pending is pre-canonical; layer flip is
  // unusual there but still mechanically valid).
  const fromScope: RelevanceScope = fm.relevance_scope ?? "broad";
  const shouldAutoDegrade =
    fromScope === "narrow" && fromLayer === "team" && toLayer === "personal";

  // rc.29 BUG-C1: KnowledgeType is now plural; pluralType is the canonical
  // value passed straight to the allocator.
  // W4 decolo: layer-flip mints the new id from the destination layer's
  // write-target STORE counters (same store the flipped entry lands in below).
  const newStableId = await allocateStoreKnowledgeId(
    toLayer,
    pluralType,
    resolveWriteTargetStoreDir(toLayer, projectRoot),
  );

  // v2.2 全砍 Stage 2 (B2 cutover): the layer-flip destination is the NEW layer's
  // write-target store canonical dir (no dual-root). resolveStoreCanonicalBase
  // throws an actionable error when no target store resolves.
  // W1/TASK-003 parity: mirror the approve-promote path — a team-layer flip bound
  // to an active_project lands in knowledge/projects/<id>/<type>/ too, so a
  // flipped-to-team entry and a promoted team entry sharing that active_project
  // land at the SAME path (C-104 path=source-of-truth). personal flips pass no
  // project ⇒ stay flat (C-106 personal-flat); resolveStoreCanonicalBase only
  // injects the segment for team + a C-107-valid project.
  const flipProject =
    toLayer === "team" ? loadProjectConfig(projectRoot)?.active_project : undefined;
  const toAbs = join(
    resolveStoreCanonicalBase(toLayer, projectRoot, flipProject),
    pluralType,
    `${newStableId}--${slug}.md`,
  );
  await ensureParentDirectory(toAbs);

  // Phase 1: signal start (mirrors approve's two-phase pattern).
  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_promote_started",
    ...(priorStableId !== undefined ? { stable_id: priorStableId } : {}),
    timestamp: new Date().toISOString(),
    reason: `layer_flip:${priorStableId ?? "<unassigned>"}->${newStableId}`,
  });

  // Build the effective patch. Auto-degrade overrides caller-supplied relevance
  // fields; otherwise pass them through unchanged.
  const effectivePatch: ModifyChanges = shouldAutoDegrade
    ? {
        ...changes,
        layer: toLayer,
        relevance_scope: "broad",
        relevance_paths: [],
      }
    : { ...changes, layer: toLayer };

  // Rewrite frontmatter with new id + new layer + any other merged changes.
  // v2.2 C1: a layer-flip is a reviewer reclassification — stamp the recheck clock.
  const rewritten = rewriteFrontmatterMerge(
    content,
    { ...effectivePatch, last_review_confirmed_at: new Date().toISOString() },
    { id: newStableId },
  );

  // C-007 (W2/TASK-005): a layer-flip RELOCATES the entry (source→toAbs), so use
  // `git mv` — NOT rm+create — to carry the source's history forward (`git blame`
  // / `git log --follow` recover the original commit at toAbs). git mv moves the
  // file first, THEN we rewrite the frontmatter in place, so the move is a pure
  // rename git can detect. team→? source lives in the project tree; personal→?
  // (outside the git tree) uses an fs write + unlink as before.
  let moved = false;
  if (target.isInProjectTree) {
    const relSource = relative(projectRoot, target.absPath);
    const relDest = relative(projectRoot, toAbs);
    try {
      execFileSync("git", ["mv", "-f", relSource, relDest], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      moved = true;
    } catch {
      // Untracked source / non-git repo (eg. tests without `git init`): fall back
      // to write-dest + unlink-source. git rename detection (blame) is lost here,
      // same trade-off as the pre-TASK-005 rm+create path.
      moved = false;
    }
  }
  // Whether git mv relocated the file or not, the destination gets the rewritten
  // frontmatter (git mv moved the OLD bytes; this stamps the new id/layer in
  // place). When git mv did NOT run, the source still exists and must be removed.
  D().assertNoSecretsInReviewContent(rewritten, "review-write");
    await lockedWriteFile(toAbs, rewritten);
  if (!moved && existsSync(target.absPath) && target.absPath !== toAbs) {
    await unlink(target.absPath);
  }

  const flipReason = `layer_flip:${priorStableId ?? "<unassigned>"}->${newStableId}`;
  const flipTimestamp = new Date().toISOString();
  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_layer_changed",
    stable_id: newStableId,
    timestamp: flipTimestamp,
    from_layer: fromLayer,
    to_layer: toLayer,
    reason: flipReason,
    // v2.0.0-rc.37 NEW-24: stamp old id so downstream redirect resolvers
    // (fab_plan_context.redirects, fab_get_knowledge_sections.redirect_to)
    // can map stale caller-held ids without rebuilding from path history.
    ...(priorStableId !== undefined ? { previous_stable_id: priorStableId } : {}),
  });

  // v2.0.0-rc.37 NEW-24: dedicated id-redirect event. Emitted only when a
  // previous id existed (a layer-flip on an unassigned pending row mints a
  // fresh id with no "old" to map from). Consumers that only care about the
  // id remap subscribe to this single event instead of replaying
  // knowledge_layer_changed. Shares `reason` with the paired flip event for
  // correlation.
  if (priorStableId !== undefined) {
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_id_redirect",
      timestamp: flipTimestamp,
      previous_stable_id: priorStableId,
      new_stable_id: newStableId,
      reason: flipReason,
    });
  }

  // v2.0-rc.5 C3 (TASK-012): emit knowledge_scope_degraded when the flip
  // auto-degraded the relevance scope. The event records the original scope
  // (narrow) and the new one (broad) so the audit trail explains *why* the
  // entry's relevance_paths array is now empty post-flip. Reason is a fixed
  // tag so doctor lints / observability filters can key off it.
  if (shouldAutoDegrade) {
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_scope_degraded",
      stable_id: newStableId,
      timestamp: new Date().toISOString(),
      from_scope: "narrow",
      to_scope: "broad",
      reason: "personal-implies-broad",
    });
  }

  // Compute the response path. For team destinations report project-relative;
  // for personal use the `~/.fabric/...` form (matches knowledge-meta-builder
  // content_ref convention).
  const responsePath = toLayer === "team"
    ? relative(projectRoot, toAbs)
    : `~/${relative(D().resolvePersonalRoot(), toAbs)}`;

  // v2.2 W5 R2 (agents.meta decolo): the rc.27 post-modify layer-flip
  // `reconcileKnowledge` is retired alongside post-approve — the flipped entry
  // is written to its destination store above, and cross-store recall builds
  // its description from store markdown at read time. No co-location index to
  // rebuild.

  return {
    action: "modify",
    pending_path: responsePath,
    ...(priorStableId !== undefined ? { prior_stable_id: priorStableId } : {}),
    new_stable_id: newStableId,
  };
}

export async function deferAll(
  projectRoot: string,
  pendingPaths: string[],
  until: string | undefined,
  reason: string | undefined,
): Promise<string[]> {
  const deferred: string[] = [];
  for (const pendingPath of pendingPaths) {
    let stableId: string | undefined;
    // Mirror reject's best-effort dual-write contract (see rejectAll for the
    // event-vs-IO priority rationale).
    try {
      const sandboxed = D().resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
      if (existsSync(sandboxed.abs)) {
        const content = await readFile(sandboxed.abs, "utf8");
        stableId = parseFrontmatter(content).id;
        const patch: FrontmatterScalarPatch = {
          status: "deferred",
          ...(until !== undefined ? { deferred_until: until } : {}),
        };
        const merged = rewriteFrontmatterMerge(content, patch);
        if (merged !== content) {
          D().assertNoSecretsInReviewContent(merged, "review-write");
    await lockedWriteFile(sandboxed.abs, merged);
        }
      }
    } catch {
      // See rejectAll comment for failure semantics.
    }
    await D().emitKnowledgeLifecycleEvent(projectRoot, {
      event_type: "knowledge_deferred",
      timestamp: new Date().toISOString(),
      pending_path: pendingPath,
      ...(stableId !== undefined ? { stable_id: stableId } : {}),
      ...(until !== undefined ? { until } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
    deferred.push(pendingPath);
  }
  return deferred;
}

// ---------------------------------------------------------------------------
// retire action (W3-C: fabric-review retire-mode landing surface)
//
// Semantically deprecates one or more CANONICAL knowledge entries: writes
// `deprecated: true` (+ `superseded_by: <id>` when the caller names a replacing
// entry) into the entry's frontmatter via the SAME in-place merge path modify
// uses (resolveModifyTarget → rewriteFrontmatterMerge → atomicWriteText). The
// file is NEVER deleted (red line: deprecate-over-delete) — the body + stable_id
// survive so the "当时为什么这么决策" rationale stays inspectable, while
// cross-store-recall filters the deprecated entry OUT of recall candidates and
// broad SessionStart indexes.
//
// Batched over pending_paths like reject/defer (best-effort per entry — an
// unresolvable path is skipped, mirroring approveOne's return-null contract, so
// it simply does not appear in the returned `retired[]`). The retire is recorded
// as a `knowledge_modified` ledger event (changed_fields=[deprecated,...]) with a
// `retire:` reason prefix — retire IS a frontmatter modification, so no new
// event_type is minted (keeps the ledger discriminated-union census stable).
// ---------------------------------------------------------------------------

type RetiredEntry = { path: string; stable_id?: string; superseded_by?: string };

export async function retireAll(
  projectRoot: string,
  pendingPaths: string[],
  supersededBy: string | undefined,
  reason: string | undefined,
): Promise<{ retired: RetiredEntry[]; failed: Array<{ pending_path: string; reason: string }> }> {
  const retired: RetiredEntry[] = [];
  const failed: Array<{ pending_path: string; reason: string }> = [];
  for (const pendingPath of pendingPaths) {
    const result = await retireOne(projectRoot, pendingPath, supersededBy, reason);
    if (result !== null) {
      retired.push(result);
    } else {
      // ISS-20260712-012: surface skips so empty retired[] is not false-success.
      failed.push({
        pending_path: pendingPath,
        reason: "retire skipped: path unresolved, not canonical, or IO failure",
      });
    }
  }
  return { retired, failed };
}

async function retireOne(
  projectRoot: string,
  pendingPath: string,
  supersededBy: string | undefined,
  reason: string | undefined,
): Promise<RetiredEntry | null> {
  // Same target resolution as modify — accepts canonical (and, defensively,
  // pending) store entries; returns null on traversal / not-found (skipped).
  const target = resolveModifyTarget(projectRoot, pendingPath);
  if (target === null) {
    return null;
  }

  const content = await readFile(target.absPath, "utf8");
  const fm = parseFrontmatter(content);

  // In-place merge writes ONLY the deprecation markers; every other frontmatter
  // key (id / type / summary / body …) is preserved verbatim by
  // rewriteFrontmatterMerge — deprecate-over-delete.
  const patch: FrontmatterScalarPatch = {
    deprecated: true,
    ...(supersededBy !== undefined ? { superseded_by: supersededBy } : {}),
  };
  const merged = rewriteFrontmatterMerge(content, patch);
  D().assertNoSecretsInReviewContent(merged, "review-write");
    await lockedWriteFile(target.absPath, merged);

  const changedFields = supersededBy !== undefined
    ? ["deprecated", "superseded_by"]
    : ["deprecated"];
  const before: Record<string, unknown> = { deprecated: fm.deprecated ?? null };
  const after: Record<string, unknown> = { deprecated: true };
  if (supersededBy !== undefined) {
    before.superseded_by = fm.superseded_by ?? null;
    after.superseded_by = supersededBy;
  }

  await D().emitKnowledgeLifecycleEvent(projectRoot, {
    event_type: "knowledge_modified",
    ...(fm.id !== undefined ? { stable_id: fm.id } : {}),
    timestamp: new Date().toISOString(),
    path: pendingPath,
    changed_fields: changedFields,
    before,
    after,
    reason:
      reason !== undefined ? `retire:${pendingPath}: ${reason}` : `retire:${pendingPath}`,
  });

  return {
    path: pendingPath,
    ...(fm.id !== undefined ? { stable_id: fm.id } : {}),
    ...(supersededBy !== undefined ? { superseded_by: supersededBy } : {}),
  };
}


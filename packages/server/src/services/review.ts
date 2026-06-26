import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  FabPendingInput,
  FabPendingOutput,
  FabReviewInput,
  FabReviewOutput,
  KnowledgeType,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";

import type { RuleDescription, RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { hasUnresolvedDismissal } from "./promotion-gate.js";
import {
  buildScoringContext,
  rankDescriptionItems,
  type ScoringContext,
} from "./plan-context.js";
import { computeReadSetRevision } from "./cross-store-recall.js";
import { allocateStoreKnowledgeId, isPersonalScope } from "@fenglimg/fabric-shared";
import {
  resolveStoreCanonicalBase,
  resolveStorePendingBase,
  resolveWriteTargetStoreDir,
} from "./cross-store-write.js";
import { atomicWriteText, ensureParentDirectory, extractBody } from "./_shared.js";
import { mergePendingTwins } from "./pending-dedupe.js";

// KT-GLD-0006: the review-time summary self-sufficiency gate is a COLD-EVAL judge
// (zero-context, batched, offline via maestro delegate) — see summary-cold-eval.ts
// for the protocol + batch builder. It is driven by the fabric-review skill, not
// the synchronous fab_review service here, so a non-deterministic LLM call never
// lands on this hot path. The write-time mechanical floor (extract-knowledge.ts)
// is the deterministic first line of defence this review pass complements.

// v2.2 全砍 Stage 2 (B2 cutover): store-only pending root. extract-knowledge
// routes pending entries INTO the resolved write-target store
// (cross-store-write.resolveStorePendingBase); review's list/search/approve read
// from the SAME base so the round-trip closes. resolveStorePendingBase throws an
// actionable StoreWriteTargetUnresolvedError when no store target resolves (read
// callers resolve it defensively; the write path lets the hard-fail surface).

// rc.29 BUG-C1: the plural ↔ singular bridge is now identity — the canonical
// KnowledgeType enum was unified to plural across the codebase (matches FS
// layout, MCP I/O, and disk frontmatter). `PluralType` is retained as an
// alias for local readability of "directory name" sites; equivalent to
// KnowledgeType.
type PluralType = KnowledgeType;

const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

type Layer = "team" | "personal";

type Maturity = "draft" | "verified" | "proven";

type RelevanceScope = "narrow" | "broad";

// v2.0.0-rc.27 TASK-001 (§2.2/§2.3): lifecycle status markers authored by
// reject/defer write paths. Default "active" semantics when field is absent
// (legacy behavior — every pending entry was treated as approvable). Stored
// in frontmatter so list/search can filter without re-walking the event ledger,
// and so the doctor cleanup pass (rc.4 vacuum policy) has a stable signal
// independent of jsonl events.
type LifecycleStatus = "active" | "rejected" | "deferred";

type ParsedFrontmatter = {
  id?: string;
  type?: PluralType;
  layer?: Layer;
  maturity?: Maturity;
  source_session?: string;
  created_at?: string;
  tags?: string[];
  title?: string;
  summary?: string;
  // v2.0-rc.5 C1/C3: relevance hints. Missing fields are treated as broad+[]
  // at consumption time (matches knowledge-meta-builder defaults).
  relevance_scope?: RelevanceScope;
  relevance_paths?: string[];
  // v2.2 project-scope migration: resolution coordinate (personal/team/project:<id>).
  semantic_scope?: string;
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3 frontmatter authoring path).
  status?: LifecycleStatus;
  deferred_until?: string;
  // v2.2 C1 (processes/maturity-promotion-rubric-v1): the review-confirmation
  // clock. Stamped at approve/modify (every fab-review touch IS a re-confirmation)
  // and read by the doctor broad review-recheck lint to nudge stale broad
  // knowledge — broad is exempt from usage-age decay, so this is its only clock.
  last_review_confirmed_at?: string;
};

/**
 * v2.0 rc.3 fab_review service (W3-K K2: WRITE-only).
 *
 * Pure async dispatcher over a discriminated union of 6 WRITE actions (approve,
 * reject, modify, modify-content, modify-layer, defer). The two READ actions
 * (list / search) were lifted out into `reviewPending` (the fab_pending tool) —
 * pure relocation, ZERO behavior change.
 *
 * Approve performs late-bind id allocation (KP-/KT- + type-code + monotonic
 * counter via KnowledgeIdAllocator), emits 2-phase events (knowledge_promote_started
 * → knowledge_promoted | knowledge_promote_failed), and uses git mv to preserve
 * file history when the target lives in the team layer (same repo). Personal
 * layer files use plain fs.rename because they live under ~/.fabric/ outside
 * the project's git tree.
 *
 * Modify implements the only legal stable_id mutation: layer-flip across
 * KP/KT counter spaces. Allocates a new id under the target layer, renames
 * the file across layer roots, emits knowledge_layer_changed.
 */
export async function reviewKnowledge(
  projectRoot: string,
  input: FabReviewInput,
): Promise<FabReviewOutput> {
  switch (input.action) {
    case "approve":
      return {
        action: "approve",
        approved: await approveAll(projectRoot, input.pending_paths),
      };
    case "reject":
      return {
        action: "reject",
        rejected: await rejectAll(projectRoot, input.pending_paths, input.reason),
      };
    case "modify":
      return await modifyEntry(projectRoot, input.pending_path, input.changes);
    // v2.0.0-rc.37 NEW-12: explicit modify split. Both delegate to modifyEntry
    // (which already branches content-edit vs layer-flip internally); the split
    // makes the SKILL's intent explicit at the call site + lets the contract
    // enforce "content edits never carry a layer flip".
    case "modify-content": {
      // Strip any layer field so this path can never flip layer.
      const { layer: _droppedLayer, ...contentChanges } = input.changes;
      return await modifyEntry(projectRoot, input.pending_path, contentChanges);
    }
    case "modify-layer":
      // changes.layer is REQUIRED by the modify-layer input schema.
      return await modifyEntry(projectRoot, input.pending_path, input.changes);
    case "defer":
      return {
        action: "defer",
        deferred: await deferAll(
          projectRoot,
          input.pending_paths,
          input.until,
          input.reason,
        ),
      };
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * fab_pending service (W3-K K2: READ-only).
 *
 * Pure async dispatcher over the two READ actions (list / search) relocated
 * from `reviewKnowledge`. list browses the store-backed pending backlog;
 * search ranges over BOTH pending and canonical knowledge. Neither mutates
 * state — the fab_pending tool is registered readOnlyHint:true / idempotentHint:true.
 * P1 recall-engine-refactor (TASK-005): search now routes through `triageSearch`,
 * which gates on the substring query then RANKS the matches via the shared
 * rankDescriptionItems('triage') — NO top_k, NO floor, so pending review never
 * silently drops a match. The old substring-only search machine is gone.
 */
export async function reviewPending(
  projectRoot: string,
  input: FabPendingInput,
): Promise<FabPendingOutput> {
  switch (input.action) {
    case "list":
      return {
        action: "list",
        items: await listPending(projectRoot, input.filters),
      };
    case "search":
      return {
        action: "search",
        items: await triageSearch(projectRoot, input.query, input.filters),
      };
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// path-sandboxing helpers
//
// All caller-supplied `pending_path` / `pending_paths` values are constrained
// to the resolved write-target store knowledge roots for this project. This is
// defense-in-depth against accidental traversal — fab_review is invoked by an
// MCP-trusted agent, but a stray `../` from a buggy skill prompt should not
// allow reading/deleting outside the store knowledge tree.
//
// Returns the resolved absolute path on success; throws on traversal attempts
// or when the path resolves outside the allowed roots.
// ---------------------------------------------------------------------------

// v2.1 global-refactor (NEW-APPROVE-PROMOTE): the resolved write-target store
// knowledge roots (team + personal) that approve/list operate inside when the
// project has selected an active write store. Used to extend the sandbox
// whitelist to the SPECIFIC store dirs the resolver actually returns — never a
// blanket `~/.fabric/stores/**` so a buggy/malicious path can't reach a store
// the project did not mount-as-write-target. Best-effort: a layer whose
// write-target is unresolved (StoreWriteTargetUnresolvedError) is simply
// skipped — this builds the sandbox whitelist, so the hard-fail belongs on the
// actual write path (pendingBaseAbs / approve canonical), not here.
function storeKnowledgeRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  for (const layer of ["team", "personal"] as const) {
    try {
      roots.push(resolve(resolveStoreCanonicalBase(layer, projectRoot)));
    } catch {
      // layer has no resolvable write-target store — not a whitelist entry.
    }
  }
  return roots;
}

function isUnder(abs: string, root: string): boolean {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveSandboxedPath(
  projectRoot: string,
  candidate: string,
  options: { allowPersonal?: boolean } = {},
): { abs: string; isInProjectTree: boolean } {
  if (candidate.length === 0) {
    throw new Error("path is empty");
  }

  // Defense-in-depth: only the EXACT store knowledge roots the resolver returns
  // for this project are admitted (never an arbitrary store path).
  const storeRoots = storeKnowledgeRoots(projectRoot);

  // Retired non-store personal roots are not valid knowledge targets anymore.
  // Store paths should be passed as absolute paths returned by list/search, or
  // resolved through the exact store roots above.
  if (candidate.startsWith("~/")) {
    throw new Error(`legacy personal knowledge root is retired; use a store path: ${candidate}`);
  }

  // Absolute paths are admitted ONLY when they resolve under a resolved store
  // knowledge root (the form listPending reports for store-routed entries).
  // Store entries live outside the project's git tree (each store is its own
  // repo), so isInProjectTree is false.
  if (isAbsolute(candidate)) {
    const abs = resolve(candidate);
    if (storeRoots.some((root) => isUnder(abs, root))) {
      return { abs, isInProjectTree: false };
    }
    throw new Error(`path escapes store knowledge root: ${candidate}`);
  }

  // Project-relative legacy non-store paths are retired. Only admit a relative
  // path if it happens to resolve under one of this project's resolved store
  // roots (normally callers pass absolute store paths from list/search).
  const projectAbs = resolve(projectRoot, candidate);
  if (storeRoots.some((root) => isUnder(projectAbs, root))) {
    return { abs: projectAbs, isInProjectTree: false };
  }

  throw new Error(`path escapes store knowledge root: ${candidate}`);
}

// ---------------------------------------------------------------------------
// list action
// ---------------------------------------------------------------------------

type ListFilters = {
  type?: PluralType;
  layer?: "team" | "personal" | "both";
  maturity?: Maturity;
  tags?: string[];
  // rc.4 TASK-006 fix (c): ISO-8601 lower bound on entry created_at. Entries
  // strictly older than this threshold are excluded. Applied to both list and
  // search actions for symmetry. Comparison is lexicographic on the ISO-8601
  // string, which is correct for fully-qualified UTC timestamps with
  // identical zone suffix (Z) — the contract layer enforces datetime() format.
  created_after?: string;
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): opt-in surfacing of lifecycle-filtered
  // entries. Default behavior hides rejected (always) and deferred (when the
  // deferred_until threshold is still in the future). Callers that need the
  // full pending population — vacuum tooling, audit dashboards — pass these
  // overrides explicitly.
  include_rejected?: boolean;
  include_deferred?: boolean;
  // v2.0.0-rc.27 TASK-006 (audit §2.23): opt-in body inspection. When true,
  // list/search attach the full post-frontmatter body to each item; search
  // additionally extends the query haystack to body text. Default-off
  // (keeps the wire payload small).
  include_body?: boolean;
};

/**
 * v2.0.0-rc.27 TASK-006 (audit §2.23): extract everything AFTER the closing
 * `---` of frontmatter. Used by list/search when filters.include_body=true
 * to surface the body content for reviewer inspection — the prompt-injection
 * mitigation surface (a malicious payload hiding under `## Evidence` is
 * invisible to frontmatter-only views).
 *
 * Returns the trimmed body; if no frontmatter is present, returns the
 * full content as body (defensive — a malformed entry without `---`
 * fences shouldn't be silently dropped from the body inspection surface).
 */
// ISS-017: body extraction now uses the single shared extractBody (_shared.ts).
// review trims for its list/search inspection surface, so this wrapper applies
// `.trim()` explicitly \u2014 keeping the trim policy visible at the consumer.
function extractBodyTrimmed(content: string): string {
  return extractBody(content).trim();
}

type ListItem = {
  pending_path: string;
  // v2.0.0-rc.27 TASK-001 (§2.12): only emitted for personal-layer entries.
  // Team entries use project-relative paths in `pending_path` which are
  // already programmatically consumable without expansion.
  pending_path_absolute?: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  title?: string;
  summary?: string;
  // origin indicates which write-target store root the entry came from.
  // Both layers now resolve to mounted store knowledge/pending/ trees.
  origin?: "team" | "personal";
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): lifecycle status surfaced when present
  // in the frontmatter. Listings filter on this by default (see
  // applyLifecycleFilter); the field is also surfaced so callers can pivot
  // their own UI on it (e.g. show a "deferred" badge).
  status?: LifecycleStatus;
  deferred_until?: string;
  // v2.0.0-rc.27 TASK-006 (audit §2.23): full body content (everything
  // after the closing `---` of frontmatter). Surfaced only when the
  // caller passed `filters.include_body: true`.
  body?: string;
};

// v2.0.0-rc.29 TASK-007 (BUG-M4): search result item. Search ranges over both
// pending and canonical entries, so the misleading `pending_path` field (used
// by `list` for pending-only results) is renamed to a neutral `path` and a
// required `area` discriminator is added so consumers can tell the two apart
// without parsing the directory prefix out of the path string.
type SearchItem = {
  area: "pending" | "canonical";
  path: string;
  // `path_absolute` mirrors `ListItem.pending_path_absolute`: emitted only for
  // personal-layer entries where the `path` carries the `~/...` shell-only form.
  path_absolute?: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  title?: string;
  summary?: string;
  origin?: "team" | "personal";
  status?: LifecycleStatus;
  deferred_until?: string;
  body?: string;
  stable_id?: string;
};

/**
 * v2.0.0-rc.27 TASK-001 (§2.2/§2.3): default visibility filter for list/search.
 * Returns true if the entry should be SHOWN given the caller's filter request.
 *
 * Defaults (when filters absent):
 *   - status="rejected"   → hide (audit only via doctor/event-ledger)
 *   - status="deferred"   → hide IFF deferred_until is absent OR > now
 *   - status="active" / absent → show
 *
 * Callers can pass include_rejected / include_deferred to override. The
 * include_deferred override surfaces deferred entries regardless of their
 * deferred_until threshold (useful for "show me what I've parked" workflows).
 */
function isVisibleByLifecycle(
  fm: ParsedFrontmatter,
  filters: ListFilters | undefined,
): boolean {
  if (fm.status === "rejected" && filters?.include_rejected !== true) {
    return false;
  }
  if (fm.status === "deferred" && filters?.include_deferred !== true) {
    // No deferred_until → indefinite defer, stay hidden until override.
    // deferred_until in the past → defer expired, surface again.
    if (fm.deferred_until === undefined) return false;
    if (fm.deferred_until > new Date().toISOString()) return false;
  }
  return true;
}

async function listPending(
  projectRoot: string,
  filters: ListFilters | undefined,
): Promise<ListItem[]> {
  // crack 4: deterministic pre-pass — collapse cross-session (type, slug) twins
  // BEFORE enumerating, so the reviewer never sees a duplicate pair that only
  // exists because two sessions archived the same knowledge under different
  // idempotency keys. Best-effort: a merge failure must never break the list.
  try {
    await mergePendingTwins(projectRoot);
  } catch {
    // never let the self-healing pre-pass break a read
  }

  const items: ListItem[] = [];

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  // v2.2 全砍 Stage 2 (B2 cutover): pending lives ONLY in the resolved
  // write-target stores (team + personal). Resolve each defensively — a read
  // operation degrades to "nothing to list" for an un-onboarded layer rather
  // than hard-failing (the hard-fail is reserved for the WRITE path). Entries
  // are reported by absolute path (resolveSandboxedPath admits them under the
  // store knowledge root).
  const sources: Array<{ origin: "team" | "personal"; root: string; isStore: boolean }> = [];
  for (const origin of ["team", "personal"] as const) {
    try {
      const pendingRoot = resolveStorePendingBase(origin, projectRoot);
      sources.push({ origin, root: pendingRoot, isStore: true });
      // v2.2 全砍 F15: rejected entries are MOVED to a sibling `rejected/` dir
      // (out of the active pending queue). Surface them only when the caller
      // opts in via include_rejected — preserving the audit/restore view.
      if (filters?.include_rejected === true) {
        sources.push({
          origin,
          root: pendingRoot.replace(`${sep}pending`, `${sep}rejected`),
          isStore: true,
        });
      }
    } catch {
      // layer has no resolvable write-target store — nothing to list there.
    }
  }

  for (const source of sources) {
    for (const type of typesToScan) {
      const dir = join(source.root, type);
      if (!existsSync(dir)) {
        continue;
      }
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith(".md")) continue;
        const absolutePath = join(dir, name);
        let content: string;
        try {
          content = await readFile(absolutePath, "utf8");
        } catch {
          continue;
        }
        const fm = parseFrontmatter(content);
        // Frontmatter `layer` declares the *destination* classification. For
        // entries living under the personal pending root, default to
        // "personal" when frontmatter omits the field; otherwise default to
        // "team" (mirrors pre-B1 behavior).
        const layer = fm.layer ?? (source.origin === "personal" ? "personal" : "team");
        const maturity = fm.maturity ?? "draft";

        // Apply filters (best-effort — missing frontmatter values fall back to defaults)
        if (filters?.layer !== undefined && filters.layer !== "both" && filters.layer !== layer) {
          continue;
        }
        if (filters?.maturity !== undefined && filters.maturity !== maturity) {
          continue;
        }
        if (filters?.tags !== undefined && filters.tags.length > 0) {
          const itemTags = fm.tags ?? [];
          const hasAll = filters.tags.every((t) => itemTags.includes(t));
          if (!hasAll) continue;
        }
        // rc.4 TASK-006 fix (c): created_after threshold. Entries lacking
        // created_at frontmatter are conservatively excluded when the filter
        // is set (caller asked for a date window — undated entries cannot be
        // proven to fall inside it).
        if (filters?.created_after !== undefined) {
          const createdAt = fm.created_at;
          if (createdAt === undefined || createdAt < filters.created_after) {
            continue;
          }
        }

        // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): hide rejected/deferred entries
        // by default. See isVisibleByLifecycle for the precise rules.
        if (!isVisibleByLifecycle(fm, filters)) {
          continue;
        }

        // Store-rooted entries (any layer) live outside both the project tree
        // and the personal ~/.fabric root, so they are reported by absolute
        // path. Non-store team → workspace-relative; non-store personal → `~/`.
        const reportedPath = source.isStore
          ? absolutePath
          : source.origin === "personal"
            ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
            : relative(projectRoot, absolutePath);

        items.push({
          pending_path: reportedPath,
          // v2.0.0-rc.27 TASK-001 (§2.12): absolute path companion for
          // personal entries so programmatic consumers (Read, fs.readFile)
          // don't need to shell-expand the `~` themselves. Store entries
          // already report an absolute pending_path, so the companion is
          // emitted for non-store personal entries only.
          ...(source.origin === "personal" && !source.isStore ? { pending_path_absolute: absolutePath } : {}),
          type,
          layer,
          maturity,
          origin: source.origin,
          ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
          ...(fm.status !== undefined ? { status: fm.status } : {}),
          ...(fm.deferred_until !== undefined ? { deferred_until: fm.deferred_until } : {}),
          // v2.0.0-rc.27 TASK-006 (audit §2.23): full body when caller
          // opted in. Reviewer UI consumes this to scan for prompt-injection
          // payloads hidden under `## Evidence` body.
          ...(filters?.include_body === true ? { body: extractBodyTrimmed(content) } : {}),
        });
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// approve action
// ---------------------------------------------------------------------------

async function approveAll(
  projectRoot: string,
  pendingPaths: string[],
): Promise<Array<{ pending_path: string; stable_id: string }>> {
  const approved: Array<{ pending_path: string; stable_id: string }> = [];

  for (const pendingPath of pendingPaths) {
    const result = await approveOne(projectRoot, pendingPath);
    if (result !== null) {
      approved.push(result);
    }
  }

  return approved;
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
    const sandboxed = resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
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
      teamPendingAbs !== null && isUnder(sandboxed.abs, resolve(teamPendingAbs));
    const inPersonalPending =
      personalPendingAbs !== null && isUnder(sandboxed.abs, resolve(personalPendingAbs));

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
    await emitEventBestEffort(projectRoot, {
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
  await emitEventBestEffort(projectRoot, {
    event_type: "knowledge_proposed",
    timestamp: new Date().toISOString(),
    reason: `approve-synth:${slug}`,
  });

  // Phase 1: signal we're starting. Emitted before any allocator/IO mutation
  // so forensic recovery (rc.3 doctor filesystem-edit fallback) can detect a
  // crashed approve mid-flight.
  await emitEventBestEffort(projectRoot, {
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
    targetAbs = join(resolveStoreCanonicalBase(layer, projectRoot), pluralType, newFilename);
    await ensureParentDirectory(targetAbs);

    // Inject id, drop x-fabric-idempotency-key (no longer meaningful post-promote).
    // v2.2 C1: approve is THE review-confirmation moment — stamp the recheck clock
    // so the doctor broad review-recheck lint measures from "last confirmed by a
    // reviewer", not from authoring time.
    const rewritten = rewriteFrontmatterMerge(
      rewriteFrontmatterForPromote(content, stableId),
      { last_review_confirmed_at: new Date().toISOString() },
    );
    await atomicWriteText(targetAbs, rewritten);
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

    await emitEventBestEffort(projectRoot, {
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
    await emitEventBestEffort(projectRoot, {
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

async function rejectAll(
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
      const sandboxed = resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
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
          await atomicWriteText(rejectedAbs, merged);
          await unlink(sandboxed.abs);
        } else if (merged !== content) {
          await atomicWriteText(sandboxed.abs, merged);
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
    await emitEventBestEffort(projectRoot, {
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
};

// v2.0.0-rc.27 TASK-001: superset of ModifyChanges used internally by
// reject/defer write paths. Kept distinct from ModifyChanges so the public
// modify surface does not silently grow status/deferred_until fields — the
// only legal way to author a lifecycle status is reject/defer, never modify.
type FrontmatterScalarPatch = ModifyChanges & {
  status?: LifecycleStatus;
  deferred_until?: string;
  // v2.2 C1: review-confirmation stamp. Internal-only (like status/deferred_until)
  // — never part of the public modify `changes` surface; authored automatically
  // by approve/modify, never by a caller.
  last_review_confirmed_at?: string;
};

async function modifyEntry(
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
  await atomicWriteText(target.absPath, merged);
  const changedFields = Object.keys(changes).filter(
    (field) => changes[field as keyof ModifyChanges] !== undefined,
  );
  await emitEventBestEffort(projectRoot, {
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
    sandboxed = resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
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
  const file = basename(path).replace(/\.md$/u, "");
  // Strip canonical id prefix `KP-XXX-9999--` if present.
  return file.replace(/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d+--/u, "");
}

export function __isPendingKnowledgePathForTest(path: string): boolean {
  return /(?:^|[\\/])knowledge[\\/]pending[\\/]/u.test(path);
}

async function modifyLayerFlip(
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
  if (__isPendingKnowledgePathForTest(target.absPath)) {
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
  const toAbs = join(
    resolveStoreCanonicalBase(toLayer, projectRoot),
    pluralType,
    `${newStableId}--${slug}.md`,
  );
  await ensureParentDirectory(toAbs);

  // Phase 1: signal start (mirrors approve's two-phase pattern).
  await emitEventBestEffort(projectRoot, {
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

  await atomicWriteText(toAbs, rewritten);

  // Remove the source. team→? uses git rm when the source lives in the
  // project tree; personal→? uses fs.unlink (outside git tree).
  if (target.isInProjectTree) {
    const relSource = relative(projectRoot, target.absPath);
    try {
      execFileSync("git", ["rm", "--quiet", "-f", relSource], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      if (existsSync(target.absPath)) {
        await unlink(target.absPath);
      }
    }
  } else if (existsSync(target.absPath)) {
    await unlink(target.absPath);
  }

  const flipReason = `layer_flip:${priorStableId ?? "<unassigned>"}->${newStableId}`;
  const flipTimestamp = new Date().toISOString();
  await emitEventBestEffort(projectRoot, {
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
    await emitEventBestEffort(projectRoot, {
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
    await emitEventBestEffort(projectRoot, {
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
    : `~/${relative(resolvePersonalRoot(), toAbs)}`;

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

// ---------------------------------------------------------------------------
// search action (TASK-002)
//
// Walks pending + canonical (team + personal) trees, parses frontmatter, and
// applies filters. Search keeps a process-local per-file index keyed by mtime
// and size so repeated queries do not reread and reparse the whole corpus.
// ---------------------------------------------------------------------------

type SearchSource = {
  root: string;
  isPending: boolean;
  isPersonal: boolean;
  isStore: boolean;
};

type IndexedSearchEntry = {
  name: string;
  absolutePath: string;
  type: PluralType;
  source: SearchSource;
  fm: ParsedFrontmatter;
  layer: Layer;
  maturity: Maturity;
  body: string;
};

type SearchEntryCacheRecord = {
  fingerprint: string;
  entry: IndexedSearchEntry;
};

type SearchDirectoryCache = {
  files: Map<string, SearchEntryCacheRecord>;
};

const SEARCH_INDEX_CACHE_MAX_DIRS = 256;
const searchEntryIndexCache = new Map<string, SearchDirectoryCache>();
let searchEntryIndexContentReads = 0;

export function __resetReviewSearchIndexCacheForTests(): void {
  searchEntryIndexCache.clear();
  searchEntryIndexContentReads = 0;
}

export function __getReviewSearchIndexCacheStatsForTests(): {
  directories: number;
  indexedFiles: number;
  contentReads: number;
} {
  let indexedFiles = 0;
  for (const directoryCache of searchEntryIndexCache.values()) {
    indexedFiles += directoryCache.files.size;
  }
  return {
    directories: searchEntryIndexCache.size,
    indexedFiles,
    contentReads: searchEntryIndexContentReads,
  };
}

function getSearchDirectoryCache(cacheKey: string): SearchDirectoryCache {
  const cached = searchEntryIndexCache.get(cacheKey);
  if (cached !== undefined) {
    searchEntryIndexCache.delete(cacheKey);
    searchEntryIndexCache.set(cacheKey, cached);
    return cached;
  }

  const created: SearchDirectoryCache = { files: new Map() };
  searchEntryIndexCache.set(cacheKey, created);
  while (searchEntryIndexCache.size > SEARCH_INDEX_CACHE_MAX_DIRS) {
    const lru = searchEntryIndexCache.keys().next().value;
    if (lru === undefined) break;
    searchEntryIndexCache.delete(lru);
  }
  return created;
}

async function listIndexedSearchEntries(
  source: SearchSource,
  type: PluralType,
): Promise<IndexedSearchEntry[]> {
  const dir = join(source.root, type);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const cacheKey = `${dir}|${source.isPending ? "pending" : "canonical"}|${source.isPersonal ? "personal" : "team"}|${source.isStore ? "store" : "local"}`;
  const directoryCache = getSearchDirectoryCache(cacheKey);
  const seen = new Set<string>();
  const indexed: IndexedSearchEntry[] = [];

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const absolutePath = join(dir, name);
    let fingerprint: string;
    try {
      const st = await stat(absolutePath);
      if (!st.isFile()) continue;
      fingerprint = `${st.size}:${st.mtimeMs}`;
    } catch {
      continue;
    }

    seen.add(absolutePath);
    const cached = directoryCache.files.get(absolutePath);
    if (cached !== undefined && cached.fingerprint === fingerprint) {
      indexed.push(cached.entry);
      continue;
    }

    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
      searchEntryIndexContentReads += 1;
    } catch {
      directoryCache.files.delete(absolutePath);
      continue;
    }

    const fm = parseFrontmatter(content);
    const entry: IndexedSearchEntry = {
      name,
      absolutePath,
      type,
      source,
      fm,
      layer: fm.layer ?? (source.isPersonal ? "personal" : "team"),
      maturity: fm.maturity ?? "draft",
      body: extractBodyTrimmed(content),
    };
    directoryCache.files.set(absolutePath, { fingerprint, entry });
    indexed.push(entry);
  }

  for (const cachedPath of directoryCache.files.keys()) {
    if (!seen.has(cachedPath)) {
      directoryCache.files.delete(cachedPath);
    }
  }

  return indexed;
}

// P1 recall-engine-refactor (TASK-005): the substring relevance GATE for triage
// search. A reviewer searching "auth" wants the auth entries, not the whole
// corpus — so query-matching is what defines a "match" / "candidate". The
// UNIFIED ranker (rankDescriptionItems triage mode) then ORDERS the matches and
// — crucially — applies NO top_k and NO floor, so pending review never silently
// drops a match (守 KT-DEC-0019 no-server-filter). Mirrors the prior search
// haystack: title || summary || tags || filename (+ body when include_body).
function matchesTriageQuery(
  indexed: IndexedSearchEntry,
  lowerQuery: string,
  includeBody: boolean,
): boolean {
  const haystacks = [
    indexed.fm.title ?? "",
    indexed.fm.summary ?? "",
    ...(indexed.fm.tags ?? []),
    indexed.name,
    includeBody ? indexed.body : "",
  ].map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(lowerQuery));
}

// P1 recall-engine-refactor (TASK-005): pending/canonical → ranker item adapter.
// A pending DRAFT carries fewer frontmatter fields than a recall candidate, so
// every field the ranker reads degrades gracefully (never crash, never
// fabricate): maturity ?? 'draft', relevance_paths ?? [], summary ?? title ??
// filename, and a MISSING created_at adds no recency boost (the scorer already
// no-ops on an absent/unparseable created_at — we simply pass it through rather
// than inventing a date). The `stable_id` key is the absolute path (unique per
// entry; pending drafts have no real id yet) so the ranker can de-dupe and the
// caller can map ranked items back to their SearchItem.
function pendingEntryToRankerItem(indexed: IndexedSearchEntry): RuleDescriptionIndexItem {
  const { fm, name } = indexed;
  const slug = name.replace(/\.md$/u, "");
  const summary = fm.summary ?? fm.title ?? slug;
  const description: RuleDescription = {
    summary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: fm.title ?? summary,
    ...(fm.id !== undefined ? { id: fm.id } : {}),
    ...(fm.type !== undefined ? { knowledge_type: fm.type } : {}),
    maturity: fm.maturity ?? "draft",
    knowledge_layer: indexed.layer,
    ...(fm.semantic_scope !== undefined ? { semantic_scope: fm.semantic_scope } : {}),
    ...(fm.created_at !== undefined ? { created_at: fm.created_at } : {}),
    tags: fm.tags ?? [],
    relevance_scope: fm.relevance_scope ?? "broad",
    relevance_paths: fm.relevance_paths ?? [],
  };
  return { stable_id: indexed.absolutePath, description };
}

// P1 recall-engine-refactor (TASK-005): fab_pending search runs through the
// UNIFIED triage ranker. The old substring-only `.includes()`
// machine is GONE — query-matching is now just the relevance GATE, and the
// shared rankDescriptionItems('triage') orders the matches with no top_k/floor.
async function triageSearch(
  projectRoot: string,
  query: string,
  filters: ListFilters | undefined,
): Promise<SearchItem[]> {
  const lowerQuery = query.toLowerCase();
  const includeBody = filters?.include_body === true;

  // v2.2 全砍 Stage 2 (B2 cutover): search scans pending + canonical (+ rejected
  // when opted in) INSIDE the resolved write-target stores (team + personal) — no
  // dual-root. Each layer is resolved defensively so an un-onboarded layer is
  // skipped rather than crashing the read. Store entries are reported by
  // absolute path.
  const sources: SearchSource[] = [];
  for (const layer of ["team", "personal"] as const) {
    const isPersonal = layer === "personal";
    try {
      const pendingRoot = resolveStorePendingBase(layer, projectRoot);
      sources.push({ root: pendingRoot, isPending: true, isPersonal, isStore: true });
      if (filters?.include_rejected === true) {
        sources.push({
          root: pendingRoot.replace(`${sep}pending`, `${sep}rejected`),
          isPending: true,
          isPersonal,
          isStore: true,
        });
      }
    } catch {
      // no pending store for this layer — skip.
    }
    try {
      sources.push({ root: resolveStoreCanonicalBase(layer, projectRoot), isPending: false, isPersonal, isStore: true });
    } catch {
      // no canonical store for this layer — skip.
    }
  }

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  // ------ corpus prep: walk sources, apply the layer/maturity/tags/created_after
  // + lifecycle filters (migrated verbatim from the prior search), then the
  // substring query GATE. Each surviving entry is adapted into a ranker item,
  // keyed by absolute path so the ranked output maps back to its SearchItem. ------
  const matchedByKey = new Map<string, { indexed: IndexedSearchEntry; source: SearchSource; type: PluralType }>();
  const rankerItems: RuleDescriptionIndexItem[] = [];

  for (const source of sources) {
    for (const type of typesToScan) {
      for (const indexed of await listIndexedSearchEntries(source, type)) {
        const { fm, layer, maturity } = indexed;

        // Filter: layer
        if (filters?.layer !== undefined && filters.layer !== "both" && filters.layer !== layer) {
          continue;
        }
        // Filter: maturity
        if (filters?.maturity !== undefined && filters.maturity !== maturity) {
          continue;
        }
        // Filter: tags subset
        if (filters?.tags !== undefined && filters.tags.length > 0) {
          const itemTags = fm.tags ?? [];
          const hasAll = filters.tags.every((t) => itemTags.includes(t));
          if (!hasAll) continue;
        }
        // rc.4 TASK-006 fix (c): created_after threshold (mirrors listPending).
        if (filters?.created_after !== undefined) {
          const createdAt = fm.created_at;
          if (createdAt === undefined || createdAt < filters.created_after) {
            continue;
          }
        }

        // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): mirror listPending's lifecycle
        // visibility default. Search shares the same hide-rejected /
        // hide-future-deferred semantics so callers don't see different
        // populations from the two read APIs.
        if (!isVisibleByLifecycle(fm, filters)) {
          continue;
        }

        // Substring relevance GATE (the "match" definition). Triage ranking
        // below adds NO further cut, so a gated match is never silently dropped.
        if (!matchesTriageQuery(indexed, lowerQuery, includeBody)) continue;

        const item = pendingEntryToRankerItem(indexed);
        matchedByKey.set(item.stable_id, { indexed, source, type });
        rankerItems.push(item);
      }
    }
  }

  if (rankerItems.length === 0) {
    return [];
  }

  // ------ rank the matches through the UNIFIED ranker in 'triage' mode (NO
  // top_k, NO floor — completeness for the reviewer). The scoring context is
  // built by the SAME helper fab_recall uses, so triage and recall rank over
  // identical BM25/vector/scope/fusion signals. The corpus fingerprint keys the
  // on-disk BM25 cache (mirrors plan-context's read-set revision key). ------
  let revision: string;
  try {
    revision = await computeReadSetRevision(projectRoot);
  } catch {
    revision = "triage-search";
  }
  const scoringContext: ScoringContext = await buildScoringContext(projectRoot, revision, rankerItems, {
    queryText: query,
    targetPaths: [],
  });
  const ranked = rankDescriptionItems(rankerItems, scoringContext, "triage");

  // ------ map ranked items back to SearchItems (ranked order preserved). ------
  const items: SearchItem[] = [];
  for (const { item } of ranked) {
    const match = matchedByKey.get(item.stable_id);
    if (match === undefined) continue; // defensive — every ranked item was matched
    const { indexed, source, type } = match;
    const { absolutePath, fm, layer, maturity } = indexed;

    // v2.2 全砍: store entries (all entries now) report by absolute path —
    // they live in a store repo outside both the project + personal roots.
    const reportedPath = source.isStore
      ? absolutePath
      : source.isPersonal
        ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
        : relative(projectRoot, absolutePath);

    // v2.0.0-rc.29 TASK-007 (BUG-M4): emit the new search-item shape.
    // `area` is the authoritative pending-vs-canonical discriminator;
    // `path` replaces the misleading `pending_path` field. Personal hits add
    // `path_absolute` (mirrors list's `pending_path_absolute`).
    items.push({
      area: source.isPending ? "pending" : "canonical",
      path: reportedPath,
      ...(source.isPersonal ? { path_absolute: absolutePath } : {}),
      type,
      layer,
      maturity,
      // Only pending entries carry an origin tag (canonical hits live
      // outside the dual-pending-root convention).
      ...(source.isPending ? { origin: source.isPersonal ? ("personal" as const) : ("team" as const) } : {}),
      ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
      ...(fm.title !== undefined ? { title: fm.title } : {}),
      ...(fm.summary !== undefined ? { summary: fm.summary } : {}),
      ...(fm.status !== undefined ? { status: fm.status } : {}),
      ...(fm.deferred_until !== undefined ? { deferred_until: fm.deferred_until } : {}),
      // v2.0.0-rc.27 TASK-006 (audit §2.23): body emission when opted in.
      ...(includeBody ? { body: indexed.body } : {}),
      // Canonical hits always have an id; pending hits typically don't yet —
      // surface the frontmatter id when present so consumers can dedupe.
      ...(fm.id !== undefined ? { stable_id: fm.id } : {}),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// defer action
//
// v2.0.0-rc.27 TASK-001 (§2.3): writes `status: deferred` + `deferred_until`
// to the pending file's frontmatter so list/search hide the entry until the
// deferred_until threshold passes. Mirrors the reject action's frontmatter
// authoring pattern — both lifecycle mutations are dual-write (ledger event
// + frontmatter cache) so consumers don't need to walk the ledger.
//
// When `until` is omitted the caller didn't request a time gate; we still
// write status=deferred so list/search can hide the entry, but list will
// surface it again at the next manual filter relaxation
// (filters.include_deferred=true).
// ---------------------------------------------------------------------------

async function deferAll(
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
      const sandboxed = resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
      if (existsSync(sandboxed.abs)) {
        const content = await readFile(sandboxed.abs, "utf8");
        stableId = parseFrontmatter(content).id;
        const patch: FrontmatterScalarPatch = {
          status: "deferred",
          ...(until !== undefined ? { deferred_until: until } : {}),
        };
        const merged = rewriteFrontmatterMerge(content, patch);
        if (merged !== content) {
          await atomicWriteText(sandboxed.abs, merged);
        }
      }
    } catch {
      // See rejectAll comment for failure semantics.
    }
    await emitEventBestEffort(projectRoot, {
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
// frontmatter helpers (hand-rolled regex parser, mirrors knowledge-meta-builder.ts
// pattern — flat scalars + flow arrays only, no nested objects)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(content);
  if (match === null) {
    return {};
  }
  const block = match[1];
  if (block === undefined) {
    return {};
  }

  const out: ParsedFrontmatter = {};

  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();

    switch (key) {
      case "id":
        out.id = stripQuotes(value);
        break;
      case "type":
        if (PLURAL_TYPES.includes(value as PluralType)) {
          out.type = value as PluralType;
        }
        break;
      case "layer":
        if (value === "team" || value === "personal") {
          out.layer = value;
        }
        break;
      case "maturity":
        if (value === "draft" || value === "verified" || value === "proven") {
          out.maturity = value;
        }
        break;
      case "source_session":
        out.source_session = stripQuotes(value);
        break;
      case "created_at":
        out.created_at = stripQuotes(value);
        break;
      case "tags":
        out.tags = parseFlowArray(value);
        break;
      case "title":
        out.title = stripQuotes(value);
        break;
      case "summary":
        out.summary = stripQuotes(value);
        break;
      case "relevance_scope":
        // v2.0-rc.5 C3: strict allow-list; anything else → leave field absent
        // so consumers fall back to broad default (matches knowledge-meta-builder).
        if (value === "narrow" || value === "broad") {
          out.relevance_scope = value;
        }
        break;
      case "relevance_paths":
        // v2.0-rc.5 C3: flow-style inline YAML array, same parser as `tags`.
        out.relevance_paths = parseFlowArray(value);
        break;
      case "semantic_scope":
        // v2.2 project-scope migration: open coordinate string (schemas/scope.ts).
        // No allow-list — the grammar is open (team/personal/project:x/org:y...);
        // the modify input schema already validated it against SCOPE_COORDINATE_PATTERN.
        out.semantic_scope = stripQuotes(value);
        break;
      case "status":
        // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): strict allow-list. Unknown
        // values leave the field absent so list/search apply the "active"
        // default — matches the relevance_scope handling pattern above.
        if (value === "active" || value === "rejected" || value === "deferred") {
          out.status = value;
        }
        break;
      case "deferred_until":
        // ISO-8601 string per FabReviewInput.defer schema. We do NOT validate
        // here — list/search compare lexicographically against new Date()
        // ISO, and malformed values lose that comparison (treated as past).
        out.deferred_until = stripQuotes(value);
        break;
      case "last_review_confirmed_at":
        // v2.2 C1: ISO-8601 review-confirmation stamp (approve/modify). Parsed
        // for round-trip read; the doctor recheck lint reads it from raw body.
        out.last_review_confirmed_at = stripQuotes(value);
        break;
      default:
        break;
    }
  }

  return out;
}

function stripQuotes(value: string): string {
  return value.replace(/^["'](.*)["']$/u, "$1");
}

function parseFlowArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  return inner
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter((item) => item.length > 0);
}

/**
 * Inject `id: <stableId>` into frontmatter and remove `x-fabric-idempotency-key`
 * (which becomes meaningless after promote — the canonical file is the source
 * of truth, not the pending triple).
 *
 * Surgical edit on the frontmatter block: split on `---\n`, mutate, rejoin.
 * Preserves all other fields verbatim, including line ordering.
 */
function rewriteFrontmatterForPromote(content: string, stableId: string): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match === null) {
    // No frontmatter — synthesize one. Should not happen for real pending
    // files (extract-knowledge always writes one) but keep the function total.
    return `---\nid: ${stableId}\n---\n\n${content}`;
  }

  const block = match[1] ?? "";
  const filteredLines = block
    .split(/\r?\n/u)
    .filter((line) => !/^x-fabric-idempotency-key\s*:/u.test(line));

  // Insert `id:` as the first frontmatter line so it's prominent on read.
  filteredLines.unshift(`id: ${stableId}`);

  const newBlock = filteredLines.join("\n");
  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  return `${before}---\n${newBlock}\n---${after}`;
}

/**
 * Merge a frontmatter patch into an existing file's frontmatter block,
 * preserving body and unrelated keys. Used by modify (in-place + layer-flip).
 *
 * Behavior:
 *   - For each key in `patch`, replace the existing line if present, else
 *     append the line at the end of the frontmatter block.
 *   - If `forced` overrides are supplied (eg. layer-flip injects a new id),
 *     they take precedence.
 *   - Preserves comments, unrelated fields, and the body verbatim.
 */
function rewriteFrontmatterMerge(
  content: string,
  patch: FrontmatterScalarPatch,
  forced?: { id?: string },
): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match === null) {
    // No frontmatter: synthesize a minimal one.
    const synthLines: string[] = [];
    if (forced?.id !== undefined) synthLines.push(`id: ${forced.id}`);
    appendPatchLines(synthLines, patch);
    return `---\n${synthLines.join("\n")}\n---\n\n${content}`;
  }

  const block = match[1] ?? "";
  const updates: Record<string, string> = {};
  if (forced?.id !== undefined) updates.id = `id: ${forced.id}`;
  if (patch.title !== undefined) updates.title = `title: ${quoteIfNeeded(patch.title)}`;
  if (patch.summary !== undefined) updates.summary = `summary: ${quoteIfNeeded(patch.summary)}`;
  if (patch.layer !== undefined) updates.layer = `layer: ${patch.layer}`;
  if (patch.maturity !== undefined) updates.maturity = `maturity: ${patch.maturity}`;
  if (patch.tags !== undefined) updates.tags = `tags: ${flowArray(patch.tags)}`;
  // v2.0-rc.5 C3 (TASK-012): relevance hints — same flow-array shape as tags.
  if (patch.relevance_scope !== undefined) updates.relevance_scope = `relevance_scope: ${patch.relevance_scope}`;
  if (patch.relevance_paths !== undefined) updates.relevance_paths = `relevance_paths: ${flowArray(patch.relevance_paths)}`;
  // v2.2 project-scope migration: in-place re-scope (team → project:<id>).
  if (patch.semantic_scope !== undefined) updates.semantic_scope = `semantic_scope: ${patch.semantic_scope}`;
  // v2.2 graph edges: `related` flow-array, same emit shape as tags/relevance_paths.
  if (patch.related !== undefined) updates.related = `related: ${flowArray(patch.related)}`;
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): status + deferred_until are only ever
  // written by reject/defer write paths. quoteIfNeeded handles ISO-8601
  // datetimes correctly (no colon in the date portion would need quoting,
  // but the `T` and `Z` separators are unambiguous YAML bareword chars).
  if (patch.status !== undefined) updates.status = `status: ${patch.status}`;
  if (patch.deferred_until !== undefined) updates.deferred_until = `deferred_until: ${quoteIfNeeded(patch.deferred_until)}`;
  // v2.2 C1: review-confirmation stamp (approve/modify).
  if (patch.last_review_confirmed_at !== undefined) updates.last_review_confirmed_at = `last_review_confirmed_at: ${quoteIfNeeded(patch.last_review_confirmed_at)}`;

  const lines = block.split(/\r?\n/u);
  const seen = new Set<string>();
  const newLines: string[] = [];

  for (const line of lines) {
    const sep = line.indexOf(":");
    const key = sep === -1 ? "" : line.slice(0, sep).trim();
    if (key in updates) {
      newLines.push(updates[key]!);
      seen.add(key);
    } else {
      newLines.push(line);
    }
  }

  // Append any patched keys that weren't present.
  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) {
      newLines.push(updates[key]!);
    }
  }

  const newBlock = newLines.join("\n");
  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  return `${before}---\n${newBlock}\n---${after}`;
}

function appendPatchLines(lines: string[], patch: FrontmatterScalarPatch): void {
  if (patch.title !== undefined) lines.push(`title: ${quoteIfNeeded(patch.title)}`);
  if (patch.summary !== undefined) lines.push(`summary: ${quoteIfNeeded(patch.summary)}`);
  if (patch.layer !== undefined) lines.push(`layer: ${patch.layer}`);
  if (patch.maturity !== undefined) lines.push(`maturity: ${patch.maturity}`);
  if (patch.tags !== undefined) lines.push(`tags: ${flowArray(patch.tags)}`);
  if (patch.relevance_scope !== undefined) lines.push(`relevance_scope: ${patch.relevance_scope}`);
  if (patch.relevance_paths !== undefined) lines.push(`relevance_paths: ${flowArray(patch.relevance_paths)}`);
  if (patch.related !== undefined) lines.push(`related: ${flowArray(patch.related)}`);
  if (patch.status !== undefined) lines.push(`status: ${patch.status}`);
  if (patch.deferred_until !== undefined) lines.push(`deferred_until: ${quoteIfNeeded(patch.deferred_until)}`);
  if (patch.last_review_confirmed_at !== undefined) lines.push(`last_review_confirmed_at: ${quoteIfNeeded(patch.last_review_confirmed_at)}`);
}

// F55 (ISS-20260531-055): flow-array emit must escape EACH element, not
// raw-join them. An element carrying a newline, `]`/`[`, `,`, quote, `#` or `:`
// would otherwise break out of the single-line `[...]` scalar and inject a new
// frontmatter key/line. Such elements are emitted as JSON double-quoted scalars
// (valid YAML, escapes `\`, `"`, newline). Diff-friendly barewords and globs
// (`auth`, `src/ui/**/*`) carry none of those chars and stay bare.
function flowArrayElement(value: string): string {
  if (/[\n\r,\[\]{}"#:]/u.test(value) || /^\s|\s$/u.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
function flowArray(values: string[]): string {
  return `[${values.map(flowArrayElement).join(", ")}]`;
}

function quoteIfNeeded(value: string): string {
  // rc.4 TASK-006 fix (a): multiline-safe emit. Newlines or carriage returns
  // would split a YAML scalar across lines and break the `---` frontmatter
  // block. Detect them BEFORE the bare-vs-quoted decision and emit a
  // JSON-escaped quoted form (\\n, \\r preserved as backslash-letter literals
  // inside double quotes, which is valid YAML 1.2 double-quoted scalar
  // syntax). Round-trip through stripQuotes is lossless because consumers
  // read the literal value (downstream parsers like knowledge-meta-builder.ts
  // strip surrounding quotes only — they don't unescape \\n; this is
  // acceptable since the rc.3 contract restricts title/summary to
  // single-line at the schema layer).
  if (/[\n\r]/u.test(value)) {
    return JSON.stringify(value);
  }
  // Quote values that contain colons, leading/trailing whitespace, or special
  // YAML chars. Otherwise emit bare so the file stays diff-friendly.
  // F36/F35 (ISS-20260531-034/033): a backslash is itself the escape char in a
  // YAML double-quoted scalar, so it MUST be doubled BEFORE escaping the inner
  // quotes — otherwise a value ending in `\` produces `"…\"`, where the trailing
  // `\"` reads as an escaped quote, swallowing the closing quote and corrupting
  // (or injecting into) the frontmatter block.
  if (/[\\:#\[\]{}&*!|>'"%@`,]|^\s|\s$/u.test(value)) {
    return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// home-dir resolver (FABRIC_HOME override mirrors knowledge-meta-builder.ts:319)
// ---------------------------------------------------------------------------

function resolvePersonalRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

// ---------------------------------------------------------------------------
// event emission helper (mirrors extract-knowledge.ts:231-241 best-effort
// observability — pending/canonical files are the source of truth, events
// are observability)
// ---------------------------------------------------------------------------

async function emitEventBestEffort(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<void> {
  try {
    await appendEventLedgerEvent(projectRoot, event);
  } catch {
    // Event emission is observability-only.
  }
}

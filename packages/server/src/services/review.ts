import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

import type {
  FabReviewInput,
  FabReviewOutput,
  KnowledgeType,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { KnowledgeIdAllocator } from "./knowledge-id-allocator.js";
import { atomicWriteText, ensureParentDirectory } from "./_shared.js";

// rc.5 B1: dual pending root. Team layer writes/reads via the workspace
// .fabric/knowledge/pending/; personal layer via ~/.fabric/knowledge/pending/.
// PENDING_BASE_TEAM_REL kept as a workspace-relative literal so existing tests
// that assert pending_path strings (".fabric/knowledge/pending/<type>/<slug>.md")
// continue to pass for team entries.
const PENDING_BASE_TEAM_REL = ".fabric/knowledge/pending";

function pendingBaseAbs(layer: "team" | "personal", projectRoot: string): string {
  if (layer === "personal") {
    return join(resolvePersonalRoot(), ".fabric", "knowledge", "pending");
  }
  return join(projectRoot, PENDING_BASE_TEAM_REL);
}

// Plural directory names mirror FabExtractKnowledge type enum + on-disk layout
// (.fabric/knowledge/pending/decisions/, etc.). KnowledgeType (singular) is
// only used when crossing into the allocator boundary.
type PluralType = "decisions" | "pitfalls" | "guidelines" | "models" | "processes";

const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

const PLURAL_TO_SINGULAR: Record<PluralType, KnowledgeType> = {
  decisions: "decision",
  pitfalls: "pitfall",
  guidelines: "guideline",
  models: "model",
  processes: "process",
};

type Layer = "team" | "personal";

type Maturity = "draft" | "verified" | "proven";

type RelevanceScope = "narrow" | "broad";

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
};

/**
 * v2.0 rc.3 fab_review service.
 *
 * Pure async dispatcher over a discriminated union of 6 actions (list, approve,
 * reject, modify, search, defer). All branches are implemented as of TASK-002.
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
    case "list":
      return {
        action: "list",
        items: await listPending(projectRoot, input.filters),
      };
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
    case "search":
      return {
        action: "search",
        items: await searchEntries(projectRoot, input.query, input.filters),
      };
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

// ---------------------------------------------------------------------------
// path-sandboxing helpers
//
// All caller-supplied `pending_path` / `pending_paths` values are constrained
// to the knowledge directories under the project root (.fabric/knowledge) or
// the personal root ($FABRIC_HOME/.fabric/knowledge). This is defense-in-depth
// against accidental traversal — fab_review is invoked by an MCP-trusted
// agent, but a stray `../` from a buggy skill prompt should not allow
// reading/deleting outside the knowledge tree.
//
// Returns the resolved absolute path on success; throws on traversal attempts
// or when the path resolves outside the allowed roots.
// ---------------------------------------------------------------------------

function resolveSandboxedPath(
  projectRoot: string,
  candidate: string,
  options: { allowPersonal?: boolean } = {},
): { abs: string; isInProjectTree: boolean } {
  if (candidate.length === 0) {
    throw new Error("path is empty");
  }

  const projectKnowledgeRoot = resolve(projectRoot, ".fabric", "knowledge");
  const personalKnowledgeRoot = resolve(resolvePersonalRoot(), ".fabric", "knowledge");

  // `~/...` form maps to FABRIC_HOME (only meaningful for modify on canonical
  // personal entries; approve always operates on pending which is project-local).
  if (candidate.startsWith("~/")) {
    if (options.allowPersonal !== true) {
      throw new Error(`personal-root path not allowed for this action: ${candidate}`);
    }
    const abs = resolve(resolvePersonalRoot(), candidate.slice(2));
    if (abs !== personalKnowledgeRoot && !abs.startsWith(personalKnowledgeRoot + "/")) {
      throw new Error(`path escapes personal knowledge root: ${candidate}`);
    }
    return { abs, isInProjectTree: false };
  }

  // Project-relative — must resolve under .fabric/knowledge.
  const projectAbs = resolve(projectRoot, candidate);
  if (projectAbs === projectKnowledgeRoot || projectAbs.startsWith(projectKnowledgeRoot + "/")) {
    return { abs: projectAbs, isInProjectTree: true };
  }

  // Modify allows resolution against personal root for raw paths too (caller
  // may pass an absolute-looking-but-relative path like `.fabric/knowledge/...`
  // intended for personal). Try the personal root as a fallback.
  if (options.allowPersonal === true) {
    const personalAbs = resolve(resolvePersonalRoot(), candidate);
    if (
      personalAbs === personalKnowledgeRoot ||
      personalAbs.startsWith(personalKnowledgeRoot + "/")
    ) {
      return { abs: personalAbs, isInProjectTree: false };
    }
  }

  throw new Error(`path escapes knowledge root: ${candidate}`);
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
};

type ListItem = {
  pending_path: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  title?: string;
  summary?: string;
  // rc.5 B1: origin indicates which on-disk pending root the entry came from.
  // team   → workspace .fabric/knowledge/pending  (path is workspace-relative)
  // personal → ~/.fabric/knowledge/pending        (path uses `~/...` form)
  origin?: "team" | "personal";
};

async function listPending(
  projectRoot: string,
  filters: ListFilters | undefined,
): Promise<ListItem[]> {
  const items: ListItem[] = [];

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  // rc.5 B1: enumerate BOTH pending roots. Each entry is tagged with its
  // origin so callers can distinguish workspace-rooted from home-rooted
  // pending entries. Missing roots are silently skipped (personal root may
  // not exist yet on a fresh install — that's not an error).
  const sources: ReadonlyArray<{ origin: "team" | "personal"; root: string }> = [
    { origin: "team", root: pendingBaseAbs("team", projectRoot) },
    { origin: "personal", root: pendingBaseAbs("personal", projectRoot) },
  ];

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

        const reportedPath = source.origin === "personal"
          ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
          : relative(projectRoot, absolutePath);

        items.push({
          pending_path: reportedPath,
          type,
          layer,
          maturity,
          origin: source.origin,
          ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
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
  const allocator = new KnowledgeIdAllocator(
    join(projectRoot, ".fabric", "agents.meta.json"),
  );

  const approved: Array<{ pending_path: string; stable_id: string }> = [];

  for (const pendingPath of pendingPaths) {
    const result = await approveOne(projectRoot, pendingPath, allocator);
    if (result !== null) {
      approved.push(result);
    }
  }

  return approved;
}

async function approveOne(
  projectRoot: string,
  pendingPath: string,
  allocator: KnowledgeIdAllocator,
): Promise<{ pending_path: string; stable_id: string } | null> {
  // Defense-in-depth: confine the caller-supplied pending path to the pending
  // tree of EITHER root.
  //   team     → <project>/.fabric/knowledge/pending/<type>/
  //   personal → <FABRIC_HOME>/.fabric/knowledge/pending/<type>/  (rc.5 B1)
  // resolveSandboxedPath with allowPersonal=true accepts both `~/...` and
  // project-relative forms, then we narrow to pending/ specifically.
  let sourceAbs: string;
  let sourceOrigin: "team" | "personal";
  try {
    const sandboxed = resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
    const teamPendingAbs = pendingBaseAbs("team", projectRoot);
    const personalPendingAbs = pendingBaseAbs("personal", projectRoot);

    const inTeamPending =
      sandboxed.abs === teamPendingAbs || sandboxed.abs.startsWith(teamPendingAbs + "/");
    const inPersonalPending =
      sandboxed.abs === personalPendingAbs ||
      sandboxed.abs.startsWith(personalPendingAbs + "/");

    if (!inTeamPending && !inPersonalPending) {
      throw new Error(`approve path is outside .fabric/knowledge/pending/: ${pendingPath}`);
    }
    sourceAbs = sandboxed.abs;
    sourceOrigin = inPersonalPending ? "personal" : "team";
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

    const singularType = PLURAL_TO_SINGULAR[pluralType];
    const stableId = await allocator.allocate(layer, singularType);
    allocatedId = stableId;

    const newFilename = `${stableId}--${slug}.md`;
    const layerRoot = layer === "personal"
      ? join(resolvePersonalRoot(), ".fabric")
      : join(projectRoot, ".fabric");
    targetAbs = join(layerRoot, "knowledge", pluralType, newFilename);
    await ensureParentDirectory(targetAbs);

    // Inject id, drop x-fabric-idempotency-key (no longer meaningful post-promote).
    const rewritten = rewriteFrontmatterForPromote(content, stableId);
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
    if (sourceOrigin === "team") {
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
// reject action (TASK-002)
//
// Per task spec: emits knowledge_rejected event but does NOT delete the file.
// Doctor (rc.4) owns cleanup so the audit history remains inspectable until
// the operator runs vacuum.
// ---------------------------------------------------------------------------

async function rejectAll(
  projectRoot: string,
  pendingPaths: string[],
  reason: string,
): Promise<string[]> {
  const rejected: string[] = [];
  for (const pendingPath of pendingPaths) {
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
// Schema overload note: the discriminated-union field name is `pending_path`
// but the value can reference either a pending entry (.fabric/knowledge/pending/<type>/<slug>.md)
// OR a post-approve canonical entry (.fabric/knowledge/<type>/<id>--<slug>.md
// for team, ~/.fabric/knowledge/<type>/<id>--<slug>.md for personal). The
// helper `resolveModifyTarget` handles the lookup.
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

  // ------ Layer-flip path ------
  if (changes.layer !== undefined && changes.layer !== currentLayer) {
    return await modifyLayerFlip(projectRoot, target, content, fm, changes);
  }

  // ------ In-place path ------
  // v2.0-rc.5 C3 (TASK-012): relevance fields apply to canonical entries too —
  // the modify branch accepts both pending and canonical paths (resolved by
  // `resolveModifyTarget`), so a narrow→broad rescope on a post-approve entry
  // flows through the same in-place rewrite as a scalar tag/maturity edit.
  const merged = rewriteFrontmatterMerge(content, changes);
  await atomicWriteText(target.absPath, merged);

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

function resolveModifyTarget(
  projectRoot: string,
  pendingPath: string,
): ResolvedTarget | null {
  // Defense-in-depth: constrain caller-supplied path to the knowledge roots
  // (project's .fabric/knowledge/ or personal root .fabric/knowledge/). Reject
  // traversal attempts. modify accepts both project-tree and personal-canonical
  // entries, so allowPersonal=true.
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
  const match = /knowledge\/(?:pending\/)?([^/]+)\/[^/]+\.md$/u.exec(path);
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

async function modifyLayerFlip(
  projectRoot: string,
  target: ResolvedTarget,
  content: string,
  fm: ParsedFrontmatter,
  changes: ModifyChanges,
): Promise<FabReviewOutput> {
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

  const allocator = new KnowledgeIdAllocator(
    join(projectRoot, ".fabric", "agents.meta.json"),
  );
  const singularType = PLURAL_TO_SINGULAR[pluralType];
  const newStableId = await allocator.allocate(toLayer, singularType);

  const toRoot = toLayer === "personal"
    ? join(resolvePersonalRoot(), ".fabric")
    : join(projectRoot, ".fabric");
  const toAbs = join(toRoot, "knowledge", pluralType, `${newStableId}--${slug}.md`);
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
  const rewritten = rewriteFrontmatterMerge(content, effectivePatch, { id: newStableId });

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

  await emitEventBestEffort(projectRoot, {
    event_type: "knowledge_layer_changed",
    stable_id: newStableId,
    timestamp: new Date().toISOString(),
    from_layer: fromLayer,
    to_layer: toLayer,
    reason: `layer_flip:${priorStableId ?? "<unassigned>"}->${newStableId}`,
  });

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
// applies filters. The query is a case-insensitive substring matched against
// title, summary, and tag values. O(N) full scan — acceptable for current
// corpus sizes (<500 entries); rc.4 may add a description_index accelerator.
// ---------------------------------------------------------------------------

async function searchEntries(
  projectRoot: string,
  query: string,
  filters: ListFilters | undefined,
): Promise<ListItem[]> {
  const lowerQuery = query.toLowerCase();
  const items: ListItem[] = [];

  // Sources: pending (team + personal, rc.5 B1) + team canonical + personal
  // canonical. `isPersonal` flags the home-rooted sources so the path-reporting
  // logic can emit the `~/...` form (matches list and knowledge-meta-builder
  // content_ref conventions).
  const sources: Array<{ root: string; isPending: boolean; isPersonal: boolean }> = [
    { root: pendingBaseAbs("team", projectRoot), isPending: true, isPersonal: false },
    { root: pendingBaseAbs("personal", projectRoot), isPending: true, isPersonal: true },
    { root: join(projectRoot, ".fabric", "knowledge"), isPending: false, isPersonal: false },
    { root: join(resolvePersonalRoot(), ".fabric", "knowledge"), isPending: false, isPersonal: true },
  ];

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  for (const source of sources) {
    for (const type of typesToScan) {
      const dir = join(source.root, type);
      if (!existsSync(dir)) continue;
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
        const layer: Layer = fm.layer ?? (source.isPersonal ? "personal" : "team");
        const maturity: Maturity = fm.maturity ?? "draft";

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

        // Query match: title || summary || tags || filename
        const haystacks = [
          fm.title ?? "",
          fm.summary ?? "",
          ...(fm.tags ?? []),
          name,
        ].map((s) => s.toLowerCase());
        const matches = haystacks.some((h) => h.includes(lowerQuery));
        if (!matches) continue;

        // rc.5 B1: personal sources (both pending and canonical) report
        // via the `~/...` form; workspace sources report workspace-relative.
        const reportedPath = source.isPersonal
          ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
          : relative(projectRoot, absolutePath);

        items.push({
          pending_path: reportedPath,
          type,
          layer,
          maturity,
          // Only pending entries carry an origin tag (search results that are
          // canonical entries don't have a pending root to point back to).
          ...(source.isPending ? { origin: source.isPersonal ? ("personal" as const) : ("team" as const) } : {}),
          ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
          ...(fm.title !== undefined ? { title: fm.title } : {}),
          ...(fm.summary !== undefined ? { summary: fm.summary } : {}),
        });
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// defer action (TASK-002)
// ---------------------------------------------------------------------------

async function deferAll(
  projectRoot: string,
  pendingPaths: string[],
  until: string | undefined,
  reason: string | undefined,
): Promise<string[]> {
  const deferred: string[] = [];
  for (const pendingPath of pendingPaths) {
    await emitEventBestEffort(projectRoot, {
      event_type: "knowledge_deferred",
      timestamp: new Date().toISOString(),
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
  patch: ModifyChanges,
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
  if (patch.tags !== undefined) updates.tags = `tags: [${patch.tags.join(", ")}]`;
  // v2.0-rc.5 C3 (TASK-012): relevance hints — same flow-array shape as tags.
  if (patch.relevance_scope !== undefined) updates.relevance_scope = `relevance_scope: ${patch.relevance_scope}`;
  if (patch.relevance_paths !== undefined) updates.relevance_paths = `relevance_paths: [${patch.relevance_paths.join(", ")}]`;

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

function appendPatchLines(lines: string[], patch: ModifyChanges): void {
  if (patch.title !== undefined) lines.push(`title: ${quoteIfNeeded(patch.title)}`);
  if (patch.summary !== undefined) lines.push(`summary: ${quoteIfNeeded(patch.summary)}`);
  if (patch.layer !== undefined) lines.push(`layer: ${patch.layer}`);
  if (patch.maturity !== undefined) lines.push(`maturity: ${patch.maturity}`);
  if (patch.tags !== undefined) lines.push(`tags: [${patch.tags.join(", ")}]`);
  if (patch.relevance_scope !== undefined) lines.push(`relevance_scope: ${patch.relevance_scope}`);
  if (patch.relevance_paths !== undefined) lines.push(`relevance_paths: [${patch.relevance_paths.join(", ")}]`);
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
  if (/[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/u.test(value)) {
    return `"${value.replace(/"/gu, '\\"')}"`;
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


import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

import type {
  FabReviewInput,
  FabReviewOutput,
  KnowledgeType,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { KnowledgeIdAllocator } from "./knowledge-id-allocator.js";
import { atomicWriteText, ensureParentDirectory } from "./_shared.js";

const PENDING_BASE = ".fabric/knowledge/pending";

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
// list action
// ---------------------------------------------------------------------------

type ListFilters = {
  type?: PluralType;
  layer?: "team" | "personal" | "both";
  maturity?: Maturity;
  tags?: string[];
};

type ListItem = {
  pending_path: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  title?: string;
  summary?: string;
};

async function listPending(
  projectRoot: string,
  filters: ListFilters | undefined,
): Promise<ListItem[]> {
  const items: ListItem[] = [];

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  for (const type of typesToScan) {
    const dir = join(projectRoot, PENDING_BASE, type);
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
      const layer = fm.layer ?? "team";
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

      items.push({
        pending_path: relative(projectRoot, absolutePath),
        type,
        layer,
        maturity,
        ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
      });
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
  const sourceAbs = join(projectRoot, pendingPath);
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

    // Remove pending file. For team layer prefer git mv semantics (rename via
    // git so history is preserved); the new file is already on disk so we
    // emulate git mv with a follow-up `git rm` of the source. For personal
    // layer (different repo root, possibly outside any git tree) use plain
    // fs.unlink.
    if (layer === "team") {
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
      // Personal layer: target lives outside the project's git tree. Plain
      // unlink — the new file at ~/.fabric/knowledge/<type>/ is already on
      // disk; removing the pending file completes the move.
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
  // Try project-relative first (handles pending and team-canonical paths).
  const projectAbs = join(projectRoot, pendingPath);
  if (existsSync(projectAbs)) {
    return {
      absPath: projectAbs,
      isInProjectTree: true,
      inferredType: inferTypeFromPath(pendingPath),
      slug: extractSlug(pendingPath),
    };
  }

  // Personal canonical — caller may pass a `~/.fabric/...`-style path or a
  // raw path under FABRIC_HOME. Try resolving against the personal root.
  const personalAbs = pendingPath.startsWith("~/")
    ? join(resolvePersonalRoot(), pendingPath.slice(2))
    : join(resolvePersonalRoot(), pendingPath);
  if (existsSync(personalAbs)) {
    return {
      absPath: personalAbs,
      isInProjectTree: false,
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

  // Rewrite frontmatter with new id + new layer + any other merged changes.
  const rewritten = rewriteFrontmatterMerge(content, {
    ...changes,
    layer: toLayer,
  }, { id: newStableId });

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

  // Compute the response path. For team destinations report project-relative;
  // for personal use the `~/.fabric/...` form (matches rule-meta-builder
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

  // Sources: pending + team canonical + personal canonical.
  const sources: Array<{ root: string; isPending: boolean; pathPrefix: string }> = [
    { root: join(projectRoot, ".fabric", "knowledge", "pending"), isPending: true, pathPrefix: ".fabric/knowledge/pending" },
    { root: join(projectRoot, ".fabric", "knowledge"), isPending: false, pathPrefix: ".fabric/knowledge" },
    { root: join(resolvePersonalRoot(), ".fabric", "knowledge"), isPending: false, pathPrefix: "~/.fabric/knowledge" },
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
        const layer: Layer = fm.layer ?? (source.pathPrefix.startsWith("~/") ? "personal" : "team");
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

        // Query match: title || summary || tags || filename
        const haystacks = [
          fm.title ?? "",
          fm.summary ?? "",
          ...(fm.tags ?? []),
          name,
        ].map((s) => s.toLowerCase());
        const matches = haystacks.some((h) => h.includes(lowerQuery));
        if (!matches) continue;

        const reportedPath = source.isPending
          ? relative(projectRoot, absolutePath)
          : layer === "personal"
            ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
            : relative(projectRoot, absolutePath);

        items.push({
          pending_path: reportedPath,
          type,
          layer,
          maturity,
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
// frontmatter helpers (hand-rolled regex parser, mirrors rule-meta-builder.ts
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
}

function quoteIfNeeded(value: string): string {
  // Quote values that contain colons, leading/trailing whitespace, or special
  // YAML chars. Otherwise emit bare so the file stays diff-friendly.
  if (/[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/u.test(value)) {
    return `"${value.replace(/"/gu, '\\"')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// home-dir resolver (FABRIC_HOME override mirrors rule-meta-builder.ts:319)
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


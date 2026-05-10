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
const KNOWLEDGE_BASE = ".fabric/knowledge";

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

type ParsedFrontmatter = {
  type?: PluralType;
  layer?: Layer;
  maturity?: "draft" | "verified" | "proven";
  source_session?: string;
  created_at?: string;
  tags?: string[];
};

/**
 * v2.0 rc.3 fab_review service.
 *
 * Pure async dispatcher over a discriminated union of 6 actions (list, approve,
 * reject, modify, search, defer). TASK-001 lands list+approve only — the other
 * branches throw so the schema compiles but TASK-002 owns their semantics.
 *
 * Approve performs late-bind id allocation (KP-/KT- + type-code + monotonic
 * counter via KnowledgeIdAllocator), emits 2-phase events (knowledge_promote_started
 * → knowledge_promoted | knowledge_promote_failed), and uses git mv to preserve
 * file history when the target lives in the team layer (same repo). Personal
 * layer files use plain fs.rename because they live under ~/.fabric/ outside
 * the project's git tree.
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
    case "modify":
    case "search":
    case "defer":
      throw new Error(
        `action ${input.action} not yet implemented (TASK-002)`,
      );
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
  maturity?: "draft" | "verified" | "proven";
  tags?: string[];
};

type ListItem = {
  pending_path: string;
  type: PluralType;
  layer: Layer;
  maturity: "draft" | "verified" | "proven";
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
    const layerRoot = layer === "personal" ? join(homedir(), ".fabric") : join(projectRoot, ".fabric");
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

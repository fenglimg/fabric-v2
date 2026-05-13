import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

import {
  PROPOSED_REASON_DESCRIPTIONS,
  type FabExtractKnowledgeInput,
  type FabExtractKnowledgeOutput,
  type ProposedReason,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import {
  atomicWriteText,
  ensureParentDirectory,
  sha256,
} from "./_shared.js";

const TEAM_PENDING_REL = ".fabric/knowledge/pending";
const SLUG_MAX_LENGTH = 40;

// ---------------------------------------------------------------------------
// rc.5 B1: dual pending root. Layer-dependent pending base.
//
//   team     → <projectRoot>/.fabric/knowledge/pending          (workspace)
//   personal → <FABRIC_HOME or homedir>/.fabric/knowledge/pending (home)
//
// The personal root mirrors knowledge-meta-builder / review.ts personal-root
// resolution (FABRIC_HOME env override → os.homedir()) so tests can redirect
// without polluting the developer's real home directory.
// ---------------------------------------------------------------------------

export function pendingBase(layer: "team" | "personal", projectRoot: string): string {
  if (layer === "personal") {
    return join(resolvePersonalRoot(), ".fabric", "knowledge", "pending");
  }
  return join(projectRoot, TEAM_PENDING_REL);
}

function resolvePersonalRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

/**
 * Append-evidence-on-collision service for fab_extract_knowledge.
 *
 * Idempotency_key = sha256({source_session, type, slug}). When the same
 * triple hits an existing pending file (verified by frontmatter
 * `x-fabric-idempotency-key`), the body is preserved and a fresh
 * `## Evidence (call N)` section is appended — LLM-regenerated summaries
 * stay observable without overwriting prior context.
 *
 * NO `id` frontmatter is written — Q2 late-bind delegates id allocation
 * to rc.3 fab_review approve. See planning-context.md "NO id frontmatter".
 */
export async function extractKnowledge(
  projectRoot: string,
  input: FabExtractKnowledgeInput,
): Promise<FabExtractKnowledgeOutput> {
  const sanitizedSlug = sanitizeSlug(input.slug);

  // v2.0.0-rc.7 T5: source_sessions[] is the array form. Pre-T5 callers may
  // still pass a single `source_session` string; the schema's preprocess shim
  // already coerces that to [string], and the superRefine guarantees at least
  // one of the two fields is present. We normalize to the array form here
  // and pick the first session for legacy-keyed structures (idempotency_key,
  // event correlation_id) so existing on-disk pending files keep colliding
  // correctly across the rc.5 → rc.7 transition.
  const sourceSessions: string[] = Array.isArray(input.source_sessions) && input.source_sessions.length > 0
    ? input.source_sessions
    : input.source_session !== undefined && input.source_session.length > 0
      ? [input.source_session]
      : [];
  const primarySession = sourceSessions[0] ?? "";

  const idempotencyKey = sha256(
    JSON.stringify({
      source_session: primarySession,
      type: input.type,
      slug: sanitizedSlug,
    }),
  );

  const summary = input.user_messages_summary ?? "";
  const summaryIsEmpty = summary.trim().length === 0;
  const slugIsEmpty = sanitizedSlug.length === 0;

  if (summaryIsEmpty || slugIsEmpty) {
    await emitEventBestEffort(projectRoot, {
      event_type: "knowledge_archive_attempted",
      timestamp: new Date().toISOString(),
      correlation_id: primarySession,
      session_id: primarySession,
      reason: `extract_knowledge:${sanitizedSlug || input.slug}`,
    });
    return {
      pending_path: "",
      idempotency_key: idempotencyKey,
    };
  }

  // rc.5 B1: route to layer-specific pending root.
  //   team     → workspace .fabric/knowledge/pending  (reported workspace-relative)
  //   personal → ~/.fabric/knowledge/pending          (reported as `~/...` form,
  //                                                    mirrors review.ts search
  //                                                    convention for personal
  //                                                    canonical entries)
  const layer = input.layer ?? "team";
  const baseDir = pendingBase(layer, projectRoot);
  const absolutePath = join(baseDir, input.type, `${sanitizedSlug}.md`);
  const reportedPath = layer === "personal"
    ? `~/${relative(resolvePersonalRoot(), absolutePath)}`
    : relative(projectRoot, absolutePath);

  await ensureParentDirectory(absolutePath);

  if (existsSync(absolutePath)) {
    const existing = await readFile(absolutePath, "utf8");
    const existingKey = readFrontmatterKey(existing, "x-fabric-idempotency-key");
    if (existingKey === idempotencyKey) {
      // v2.0.0-rc.7 T6: Evidence-merge on idempotency_key collision.
      // Previously, each repeated call appended `## Evidence (call N)` with
      // the full summary verbatim — re-running extract three times produced
      // three duplicated Notes blocks. The fix: merge new note text into a
      // single `## Evidence` section, dedup by trimmed-text match.
      const augmented = mergeEvidenceNotes(existing, summary, input.recent_paths);
      await atomicWriteText(absolutePath, augmented);
      await emitEventBestEffort(projectRoot, {
        event_type: "knowledge_proposed",
        timestamp: new Date().toISOString(),
        correlation_id: primarySession,
        session_id: primarySession,
        reason: `extract_knowledge:${sanitizedSlug}`,
      });
      return {
        pending_path: reportedPath,
        idempotency_key: idempotencyKey,
      };
    }
    // rc.4 TASK-006 fix (b): different idempotency_key on existing pending
    // file = slug collision (typically two distinct triples whose slugs
    // sanitize/truncate to the same canonical form). Previously this branch
    // silently overwrote, causing data loss for the prior triple. Now we
    // throw loudly so the caller can disambiguate (rename slug or merge
    // upstream). Emit a knowledge_archive_attempted observability event
    // before throwing so forensics can correlate.
    await emitEventBestEffort(projectRoot, {
      event_type: "knowledge_archive_attempted",
      timestamp: new Date().toISOString(),
      correlation_id: primarySession,
      session_id: primarySession,
      reason: `extract_knowledge:${sanitizedSlug}: slug-collision (existing key ${existingKey ?? "<none>"} != incoming ${idempotencyKey})`,
    });
    throw new Error(
      `slug collision: pending file ${reportedPath} already exists with a different idempotency_key (existing=${existingKey ?? "<missing>"}, incoming=${idempotencyKey}); rename slug or resolve upstream`,
    );
  }

  const fresh = renderFreshEntry({
    type: input.type,
    sourceSessions,
    idempotencyKey,
    summary,
    recentPaths: input.recent_paths,
    layer,
    proposedReason: input.proposed_reason,
    sessionContext: input.session_context,
  });
  await atomicWriteText(absolutePath, fresh);

  await emitEventBestEffort(projectRoot, {
    event_type: "knowledge_proposed",
    timestamp: new Date().toISOString(),
    correlation_id: primarySession,
    session_id: primarySession,
    reason: `extract_knowledge:${sanitizedSlug}`,
  });

  return {
    pending_path: reportedPath,
    idempotency_key: idempotencyKey,
  };
}

/**
 * Sanitize a free-form slug to kebab-case lowercase alphanumeric+dash, max 40 chars.
 *
 * Spec: discussion-followup.md L60 (kebab-case, 2-5 words, 20-40 chars).
 * Empty input or input that fully sanitizes to empty returns "" — caller
 * treats empty slug as a validation failure (knowledge_archive_attempted).
 */
function sanitizeSlug(raw: string): string {
  const lower = raw.toLowerCase();
  // Replace any run of non-alphanumeric chars with a single dash.
  const collapsed = lower.replace(/[^a-z0-9]+/g, "-");
  // Trim leading/trailing dashes.
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

type FreshEntryArgs = {
  type: FabExtractKnowledgeInput["type"];
  sourceSessions: string[];
  idempotencyKey: string;
  summary: string;
  recentPaths: string[];
  layer: "team" | "personal";
  proposedReason: ProposedReason;
  sessionContext: string;
};

function renderFreshEntry(args: FreshEntryArgs): string {
  const createdAt = new Date().toISOString();
  // Frontmatter intentionally omits `id` — Q2 late-bind allocator runs
  // at rc.3 fab_review approve. Order is stable to make tests assertive.
  // v2.0.0-rc.7 T5: source_sessions is now an array (YAML flow form).
  // v2.0.0-rc.7 T6: proposed_reason is a new required field.
  const frontmatter = [
    "---",
    `type: ${args.type}`,
    "maturity: draft",
    `layer: ${args.layer}`,
    `created_at: ${createdAt}`,
    `source_sessions: [${args.sourceSessions.map((s) => JSON.stringify(s)).join(", ")}]`,
    `proposed_reason: ${args.proposedReason}`,
    "tags: []",
    `x-fabric-idempotency-key: ${args.idempotencyKey}`,
    "---",
  ].join("\n");

  // v2.0.0-rc.7 T6: body section order is fixed:
  //   ## Summary
  //   ## Why proposed       (1-line from PROPOSED_REASON_DESCRIPTIONS)
  //   ## Session context    (3-5 line passthrough from input)
  //   ## Evidence           (merged on idempotency collision — no per-call section)
  const reasonExplanation = PROPOSED_REASON_DESCRIPTIONS[args.proposedReason];
  const body = [
    "",
    "## Summary",
    "",
    args.summary,
    "",
    "## Why proposed",
    "",
    `${args.proposedReason} — ${reasonExplanation}`,
    "",
    "## Session context",
    "",
    args.sessionContext,
    "",
    "## Evidence",
    "",
    renderEvidenceBlock(args.summary, args.recentPaths),
    "",
  ].join("\n");

  return `${frontmatter}\n${body}`;
}

function renderEvidenceBlock(summary: string, recentPaths: string[]): string {
  const pathLines = recentPaths.length === 0
    ? "_(no recent paths reported)_"
    : recentPaths.map((p) => `- ${p}`).join("\n");
  return [
    "Recent paths:",
    "",
    pathLines,
    "",
    "Notes:",
    "",
    `- ${summary.trim()}`,
  ].join("\n");
}

// v2.0.0-rc.7 T6: replace prior append-`## Evidence (call N)` semantics with a
// merged `## Evidence` section. On idempotency collision we parse the existing
// section, dedup notes by trimmed text, and rewrite — guaranteeing a single
// section regardless of how many times extract is re-invoked.
//
// Bullet shape: each note becomes a leading-dash list item under `Notes:`.
// Recent paths are union-merged (dedup by literal path string). The Summary
// / Why proposed / Session context sections are preserved verbatim.
function mergeEvidenceNotes(
  existing: string,
  newSummary: string,
  newRecentPaths: string[],
): string {
  // Parse existing Evidence section (best-effort; supports both rc.7 single
  // `## Evidence` and any leftover rc.6 `## Evidence (call N)` blocks).
  const beforeMatch = /^([\s\S]*?)(\n## Evidence(?:\s*\(call \d+\))?\s*\n)/u.exec(
    existing.endsWith("\n") ? existing : `${existing}\n`,
  );
  if (beforeMatch === null) {
    // No existing Evidence section — append a fresh one.
    const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
    return `${trimmed}\n## Evidence\n\n${renderEvidenceBlock(newSummary, newRecentPaths)}\n`;
  }
  const head = beforeMatch[1] ?? "";

  // Collect existing notes (lines starting with "- " under Notes:) and existing
  // path bullets (lines starting with "- " under Recent paths:) by scanning
  // every Evidence-* block in the file.
  const existingNotes: string[] = [];
  const existingPaths: string[] = [];
  const evidenceBlockRe = /\n## Evidence(?:\s*\(call \d+\))?\s*\n([\s\S]*?)(?=\n## |$)/gu;
  let m: RegExpExecArray | null;
  while ((m = evidenceBlockRe.exec(`${existing}\n`)) !== null) {
    const block = m[1] ?? "";
    // Split into the two sub-sections by their labels. The rc.6 shape may
    // have inline summary lines instead of a Notes: list; treat any leading
    // dash line as a note bullet, paragraphs as a single note.
    const pathSection = /Recent paths:\s*\n([\s\S]*?)(?:\n\s*Notes:|$)/u.exec(block);
    if (pathSection !== null) {
      for (const rawLine of (pathSection[1] ?? "").split(/\r?\n/u)) {
        const t = rawLine.trim();
        if (t.startsWith("- ")) {
          existingPaths.push(t.slice(2).trim());
        }
      }
    }
    const notesSection = /Notes:\s*\n([\s\S]*?)$/u.exec(block);
    const noteBody = (notesSection !== null ? notesSection[1] : block) ?? "";
    // Extract dash-list items; if no dashes, treat the whole body as one note.
    const bulletLines: string[] = [];
    let prose: string[] = [];
    for (const rawLine of noteBody.split(/\r?\n/u)) {
      const t = rawLine.trim();
      if (t.length === 0) continue;
      if (t.startsWith("- ")) {
        if (prose.length > 0) {
          existingNotes.push(prose.join(" ").trim());
          prose = [];
        }
        bulletLines.push(t.slice(2).trim());
      } else {
        prose.push(t);
      }
    }
    if (prose.length > 0) existingNotes.push(prose.join(" ").trim());
    for (const n of bulletLines) existingNotes.push(n);
  }

  // Dedup notes + paths.
  const mergedNotes: string[] = [];
  const seenNotes = new Set<string>();
  const incomingNote = newSummary.trim();
  const candidates = [...existingNotes, incomingNote];
  for (const note of candidates) {
    const key = note.replace(/\s+/gu, " ").trim();
    if (key.length === 0) continue;
    if (seenNotes.has(key)) continue;
    seenNotes.add(key);
    mergedNotes.push(note);
  }

  const mergedPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const p of [...existingPaths, ...newRecentPaths]) {
    const key = p.trim();
    if (key.length === 0) continue;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    mergedPaths.push(key);
  }

  const pathLines = mergedPaths.length === 0
    ? "_(no recent paths reported)_"
    : mergedPaths.map((p) => `- ${p}`).join("\n");
  const noteLines = mergedNotes.length === 0
    ? "_(no notes recorded)_"
    : mergedNotes.map((n) => `- ${n}`).join("\n");

  const evidenceBody = [
    "Recent paths:",
    "",
    pathLines,
    "",
    "Notes:",
    "",
    noteLines,
  ].join("\n");

  // Rebuild: head (frontmatter + Summary + Why proposed + Session context) +
  // single merged Evidence section. Trailing newline preserved.
  return `${head}\n## Evidence\n\n${evidenceBody}\n`;
}

function readFrontmatterKey(content: string, key: string): string | undefined {
  const match = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (match === null) {
    return undefined;
  }
  const block = match[1];
  if (block === undefined) {
    return undefined;
  }
  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const k = line.slice(0, sep).trim();
    if (k === key) {
      return line.slice(sep + 1).trim();
    }
  }
  return undefined;
}

async function emitEventBestEffort(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<void> {
  try {
    await appendEventLedgerEvent(projectRoot, event);
  } catch {
    // Event emission is observability-only — pending file write is the
    // source of truth (mirrors plan-context.ts:134-151 best-effort policy).
  }
}

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  FabExtractKnowledgeInput,
  FabExtractKnowledgeOutput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import {
  atomicWriteText,
  ensureParentDirectory,
  sha256,
} from "./_shared.js";

const PENDING_BASE = ".fabric/knowledge/pending";
const SLUG_MAX_LENGTH = 40;

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
  const idempotencyKey = sha256(
    JSON.stringify({
      source_session: input.source_session,
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
      correlation_id: input.source_session,
      session_id: input.source_session,
      reason: `extract_knowledge:${sanitizedSlug || input.slug}`,
    });
    return {
      pending_path: "",
      idempotency_key: idempotencyKey,
    };
  }

  const relativePath = `${PENDING_BASE}/${input.type}/${sanitizedSlug}.md`;
  const absolutePath = join(projectRoot, relativePath);

  await ensureParentDirectory(absolutePath);

  if (existsSync(absolutePath)) {
    const existing = await readFile(absolutePath, "utf8");
    const existingKey = readFrontmatterKey(existing, "x-fabric-idempotency-key");
    if (existingKey === idempotencyKey) {
      const callIndex = countEvidenceSections(existing) + 1;
      const augmented = appendEvidenceSection(existing, callIndex, summary);
      await atomicWriteText(absolutePath, augmented);
      await emitEventBestEffort(projectRoot, {
        event_type: "knowledge_proposed",
        timestamp: new Date().toISOString(),
        correlation_id: input.source_session,
        session_id: input.source_session,
        reason: `extract_knowledge:${sanitizedSlug}`,
      });
      return {
        pending_path: relativePath,
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
      correlation_id: input.source_session,
      session_id: input.source_session,
      reason: `extract_knowledge:${sanitizedSlug}: slug-collision (existing key ${existingKey ?? "<none>"} != incoming ${idempotencyKey})`,
    });
    throw new Error(
      `slug collision: pending file ${relativePath} already exists with a different idempotency_key (existing=${existingKey ?? "<missing>"}, incoming=${idempotencyKey}); rename slug or resolve upstream`,
    );
  }

  const fresh = renderFreshEntry({
    type: input.type,
    sourceSession: input.source_session,
    idempotencyKey,
    summary,
    recentPaths: input.recent_paths,
  });
  await atomicWriteText(absolutePath, fresh);

  await emitEventBestEffort(projectRoot, {
    event_type: "knowledge_proposed",
    timestamp: new Date().toISOString(),
    correlation_id: input.source_session,
    session_id: input.source_session,
    reason: `extract_knowledge:${sanitizedSlug}`,
  });

  return {
    pending_path: relativePath,
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
  sourceSession: string;
  idempotencyKey: string;
  summary: string;
  recentPaths: string[];
};

function renderFreshEntry(args: FreshEntryArgs): string {
  const createdAt = new Date().toISOString();
  // Frontmatter intentionally omits `id` — Q2 late-bind allocator runs
  // at rc.3 fab_review approve. Order is stable to make tests assertive.
  const frontmatter = [
    "---",
    `type: ${args.type}`,
    "maturity: draft",
    "layer: team",
    `created_at: ${createdAt}`,
    `source_session: ${args.sourceSession}`,
    "tags: []",
    `x-fabric-idempotency-key: ${args.idempotencyKey}`,
    "---",
  ].join("\n");

  const body = [
    "",
    "## Summary",
    "",
    args.summary,
    "",
    "## Evidence (call 1)",
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
    summary,
  ].join("\n");
}

function appendEvidenceSection(
  existing: string,
  callIndex: number,
  summary: string,
): string {
  const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
  const block = [
    "",
    `## Evidence (call ${callIndex})`,
    "",
    summary,
    "",
  ].join("\n");
  return `${trimmed}${block}`;
}

function countEvidenceSections(content: string): number {
  const matches = content.match(/^## Evidence \(call \d+\)/gmu);
  return matches?.length ?? 0;
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

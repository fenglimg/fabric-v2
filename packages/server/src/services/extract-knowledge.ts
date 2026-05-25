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

import { AgentsMetaFileMissingError } from "../meta-reader.js";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { loadActiveMeta } from "./load-active-meta.js";
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
 * Idempotency_key = sha256({source_session: source_sessions[0], type, slug}).
 * The `source_session` key inside the hash payload is FROZEN for backward
 * compatibility with on-disk pending entries written before rc.23 — changing
 * it would invalidate every existing `x-fabric-idempotency-key`. When the
 * same triple hits an existing pending file (verified by frontmatter
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
  // v2.0.0-rc.22 Scope D T-D2: STRICT meta auto-heal at extract entry. extract
  // itself never reads agents.meta.json — id allocation happens at review/
  // approve time. But review's KnowledgeIdAllocator pulls its counter directly
  // from the persisted meta, so if a stale meta survives until approve, the
  // counter advance starts from the wrong base. Re-healing here keeps the
  // counter / nodes envelope consistent with the on-disk knowledge tree the
  // moment a new pending entry is proposed. Build failures (e.g. transient
  // fs errors during the rebuild) propagate loudly — that's the strict
  // contract. Missing on-disk meta is the ONE exception: extract is the
  // first-touch entry for many "import knowledge from session" flows where
  // doctor-init hasn't run yet, and refusing to write a pending until the
  // baseline exists would break those onboarding paths. So we swallow
  // AgentsMetaFileMissingError specifically; every other failure is loud.
  try {
    await loadActiveMeta(projectRoot, { caller: "extractKnowledge" });
  } catch (error) {
    if (!(error instanceof AgentsMetaFileMissingError)) {
      throw error;
    }
  }

  const sanitizedSlug = sanitizeSlug(input.slug);

  // v2.0.0-rc.7 T5 / rc.23 TASK-003 (F5): source_sessions[] is the only accepted
  // shape. The schema's superRefine guarantees a non-empty array at parse time,
  // so direct destructuring is safe. primarySession (= source_sessions[0]) is
  // still used as the idempotency-hash and event correlation_id input — that
  // hash payload's `source_session` key is frozen for on-disk compatibility
  // (see jsdoc above) but the wire-level field is array-only.
  const sourceSessions: string[] = input.source_sessions ?? [];
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

  // v2.0.0-rc.8 A1: personal-implies-broad silent degrade. When the caller
  // declares both `layer: personal` and `relevance_scope: narrow`, the scope
  // is invalid by construction — personal knowledge crosses projects so
  // workspace-relative `relevance_paths` lose meaning. Mirror the rc.5
  // review.ts:725-739 behaviour: flip to broad + [] and emit a
  // `knowledge_scope_degraded` event so the audit trail records the original
  // intent. The pending file has no canonical stable_id yet (id late-bind at
  // approve), so we use a `pending:<idempotency_key>` sentinel — review.ts
  // can later attach the real stable_id when the entry approves. The event
  // is emitted BEFORE the knowledge_proposed write so log readers see the
  // degrade before the pending file appears.
  let relevanceScope = input.relevance_scope;
  let relevancePaths = input.relevance_paths;
  const shouldAutoDegrade =
    layer === "personal" && relevanceScope === "narrow";
  if (shouldAutoDegrade) {
    relevanceScope = "broad";
    relevancePaths = [];
    await emitEventBestEffort(projectRoot, {
      event_type: "knowledge_scope_degraded",
      stable_id: `pending:${idempotencyKey}`,
      timestamp: new Date().toISOString(),
      from_scope: "narrow",
      to_scope: "broad",
      reason: "personal-implies-broad",
    });
  }

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
      // three duplicated Notes blocks.
      //
      // v2.0.0-rc.27 TASK-003 (audit §2.13/§2.19/§2.27): semantic decision —
      // narrative body sections (## Summary / ## Why proposed / ## Session
      // context) are now LAST-WINS, not first-wins. The rc.7 fix only merged
      // Evidence (notes + recent_paths) but preserved the old `head`
      // verbatim, which meant repeated extract calls with refined summaries
      // could never replace the first call's incomplete narrative — the only
      // workaround was reject + re-extract. Per audit §2.19, callers expect
      // last-wins semantics on the narrative fields because each extract
      // call represents the operator's CURRENT understanding.
      //
      // New flow: render the fresh entry first (new head with current
      // summary / why proposed / session context, plus new Evidence holding
      // current note + recent_paths), then transplant the OLD Evidence
      // notes/paths INTO the fresh content (Evidence stays append-merged).
      const fresh = renderFreshEntry({
        type: input.type,
        sourceSessions,
        idempotencyKey,
        summary,
        recentPaths: input.recent_paths,
        layer,
        proposedReason: input.proposed_reason,
        sessionContext: input.session_context,
        relevanceScope,
        relevancePaths,
        intentClues: input.intent_clues,
        techStack: input.tech_stack,
        impact: input.impact,
        mustReadIf: input.must_read_if,
        onboardSlot: input.onboard_slot,
      });
      const augmented = mergeEvidenceNotes(existing, fresh);
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
    relevanceScope,
    relevancePaths,
    // v2.0.0-rc.23 TASK-006 (a-C1): optional structured triage fields. Each is
    // emitted as a YAML line only when caller-supplied; omitted lines preserve
    // the historical pending-file shape.
    intentClues: input.intent_clues,
    techStack: input.tech_stack,
    impact: input.impact,
    mustReadIf: input.must_read_if,
    // v2.0.0-rc.23 TASK-014 (F8c): optional S5 onboard-slot tag. Same emit
    // discipline as the four a-C1 fields — bare YAML line iff caller-supplied,
    // never in the idempotency_key hash. fabric-archive's first-run phase is
    // the only producer; downstream `fab onboard-coverage` walks frontmatter
    // looking for this exact key.
    onboardSlot: input.onboard_slot,
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
  // v2.0.0-rc.8 A1: optional relevance fields. When undefined, the YAML
  // emit skips the line entirely — knowledge-meta-builder defaults missing
  // fields to broad/[] at parse time (L1007-1021). Caller-supplied values
  // are emitted verbatim using the same flow-style array shape as
  // scan.ts:1042-1060 / doctor.ts:627-628 regex parser expects.
  relevanceScope?: "narrow" | "broad";
  relevancePaths?: string[];
  // v2.0.0-rc.23 TASK-006 (a-C1): optional structured triage fields.
  // Each line is emitted ONLY when caller-supplied; missing values produce
  // no YAML line. Arrays use the same flow-form shape as relevance_paths;
  // must_read_if is a single quoted string. None of these participate in
  // the idempotency_key hash (extract-knowledge.ts:100-106).
  intentClues?: string[];
  techStack?: string[];
  impact?: string[];
  mustReadIf?: string;
  // v2.0.0-rc.23 TASK-014 (F8c): S5 onboard slot label. Same emit discipline as
  // the four a-C1 fields — YAML line iff caller-supplied; never in the
  // idempotency_key hash. The value is the bare slot name (no quoting needed —
  // every slot name in `ONBOARD_SLOT_NAMES` is alphanumeric+dash).
  onboardSlot?: string;
};

function renderFreshEntry(args: FreshEntryArgs): string {
  const createdAt = new Date().toISOString();
  // Frontmatter intentionally omits `id` — Q2 late-bind allocator runs
  // at rc.3 fab_review approve. Order is stable to make tests assertive.
  // v2.0.0-rc.7 T5: source_sessions is now an array (YAML flow form).
  // v2.0.0-rc.7 T6: proposed_reason is a new required field.
  // v2.0.0-rc.8 A1: relevance_scope / relevance_paths lines are emitted ONLY
  // when caller-supplied. Omitted fields → no YAML line, matching the
  // knowledge-meta-builder default behaviour (broad + []) without forcing a
  // canonical value into every freshly-archived entry. Flow-style array
  // form + bare-string scope value match doctor.ts:627-628 regex shape
  // (RELEVANCE_SCOPE_LINE_PATTERN / RELEVANCE_PATHS_LINE_PATTERN) and
  // scan.ts:1042-1060 quoteIfNeeded emit pattern.
  const frontmatterLines: string[] = [
    "---",
    `type: ${args.type}`,
    "maturity: draft",
    `layer: ${args.layer}`,
    `created_at: ${createdAt}`,
    `source_sessions: [${args.sourceSessions.map((s) => JSON.stringify(s)).join(", ")}]`,
    `proposed_reason: ${args.proposedReason}`,
    // rc.31 BUG-2.9/2.1: persist the caller-supplied summary in frontmatter so
    // knowledge-meta-builder.extractDescriptionFromFrontmatter picks it up
    // directly. Without this, the meta-builder fell back to extractRule
    // Description's h1-or-stable-id-or-placeholder synthesis (line ~944),
    // which made user-visible description.summary == stable_id for any
    // pending file whose body started with h2-only sections (`## Summary` is
    // the canonical pending shape). The frontmatter `summary:` line is the
    // canonical source-of-truth: `extractDescriptionFromFrontmatter` reads it
    // before extractRuleDescription's fallback kicks in.
    `summary: ${quoteRelevancePath(args.summary)}`,
    "tags: []",
  ];
  if (args.relevanceScope !== undefined) {
    frontmatterLines.push(`relevance_scope: ${args.relevanceScope}`);
  }
  if (args.relevancePaths !== undefined) {
    const pathsBody = args.relevancePaths
      .map((p) => quoteRelevancePath(p))
      .join(", ");
    frontmatterLines.push(`relevance_paths: [${pathsBody}]`);
  }
  // v2.0.0-rc.23 TASK-006 (a-C1): emit structured triage fields when supplied.
  // Arrays use the same flow-form quoting as relevance_paths so the existing
  // line-based YAML regex parsers can scan them uniformly; must_read_if is
  // quoted as a YAML flow-scalar. Empty arrays are honoured verbatim ("[]")
  // because an explicit empty value is a deliberate skill-side signal —
  // distinct from "field absent entirely" which omits the line.
  if (args.intentClues !== undefined) {
    const body = args.intentClues.map((s) => quoteRelevancePath(s)).join(", ");
    frontmatterLines.push(`intent_clues: [${body}]`);
  }
  if (args.techStack !== undefined) {
    const body = args.techStack.map((s) => quoteRelevancePath(s)).join(", ");
    frontmatterLines.push(`tech_stack: [${body}]`);
  }
  if (args.impact !== undefined) {
    const body = args.impact.map((s) => quoteRelevancePath(s)).join(", ");
    frontmatterLines.push(`impact: [${body}]`);
  }
  if (args.mustReadIf !== undefined) {
    frontmatterLines.push(`must_read_if: ${quoteRelevancePath(args.mustReadIf)}`);
  }
  // v2.0.0-rc.23 TASK-014 (F8c): onboard_slot bare-scalar line. Slot names
  // are constrained to ONBOARD_SLOT_NAMES (alphanumeric + dash), so emitting
  // without quotes is YAML-safe and matches the `type:`/`maturity:`/`layer:`
  // bare-scalar shape upstream of this block. Omitted when undefined.
  if (args.onboardSlot !== undefined) {
    frontmatterLines.push(`onboard_slot: ${args.onboardSlot}`);
  }
  frontmatterLines.push(
    `x-fabric-idempotency-key: ${args.idempotencyKey}`,
    "---",
  );
  const frontmatter = frontmatterLines.join("\n");

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

// v2.0.0-rc.8 A1: YAML scalar quoting for relevance_paths flow-array items.
// Mirrors scan.ts:1085 quoteIfNeeded (always quote, escape inner quotes) so
// the doctor.ts:627-628 line-based regex parses both quoted and unquoted
// forms uniformly across creation surfaces.
function quoteRelevancePath(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
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
// merged `## Evidence` section. On idempotency collision we parse Evidence from
// both old + fresh content, dedup notes by trimmed text, and rewrite —
// guaranteeing a single section regardless of how many times extract is re-invoked.
//
// v2.0.0-rc.27 TASK-003 (audit §2.13/§2.19/§2.27): semantic flip — narrative
// `head` (## Summary / ## Why proposed / ## Session context) now comes from
// FRESH content instead of EXISTING. This makes those sections last-wins
// while keeping Evidence (notes + Recent paths) append-merged. Callers
// re-running extract with a refined understanding finally see the new
// narrative land on disk; prior calls' contributions remain visible in
// Evidence notes for the audit trail.
//
// Bullet shape: each note becomes a leading-dash list item under `Notes:`.
// Recent paths are union-merged (dedup by literal path string).
function mergeEvidenceNotes(existing: string, fresh: string): string {
  // Find the Evidence section in the fresh content (the new head + new
  // notes + new recent_paths). The fresh content always has an Evidence
  // section because it comes from renderFreshEntry.
  const freshSplit = splitAtEvidence(fresh);
  if (freshSplit === null) {
    // Defensive: fresh content lacks Evidence. Should not happen given
    // renderFreshEntry's contract, but degrade to "use fresh as-is" rather
    // than mangling.
    return fresh.endsWith("\n") ? fresh : `${fresh}\n`;
  }
  const freshHead = freshSplit.head;

  // Collect evidence (notes + paths) from BOTH existing and fresh. Order
  // matters for the dedup pass below — existing items appear first so a
  // re-archive doesn't reorder historical notes.
  const oldEvidence = collectEvidenceItems(existing);
  const freshEvidence = collectEvidenceItems(fresh);

  // Dedup notes (case-sensitive after whitespace collapse).
  const mergedNotes: string[] = [];
  const seenNotes = new Set<string>();
  for (const note of [...oldEvidence.notes, ...freshEvidence.notes]) {
    const key = note.replace(/\s+/gu, " ").trim();
    if (key.length === 0) continue;
    if (seenNotes.has(key)) continue;
    seenNotes.add(key);
    mergedNotes.push(note);
  }

  // Dedup paths (literal trimmed string).
  const mergedPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const p of [...oldEvidence.paths, ...freshEvidence.paths]) {
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

  // Rebuild: fresh head (new frontmatter + new Summary + new Why proposed
  // + new Session context) + merged Evidence section. Trailing newline.
  return `${freshHead}\n## Evidence\n\n${evidenceBody}\n`;
}

/**
 * Split content at the first `\n## Evidence` line. Returns null if no
 * Evidence section is present. Shared by mergeEvidenceNotes (which uses
 * fresh's head) and collectEvidenceItems (which walks all evidence blocks
 * in a single content blob).
 */
function splitAtEvidence(content: string): { head: string } | null {
  const tail = content.endsWith("\n") ? content : `${content}\n`;
  const match = /^([\s\S]*?)(\n## Evidence(?:\s*\(call \d+\))?\s*\n)/u.exec(tail);
  if (match === null) return null;
  return { head: match[1] ?? "" };
}

/**
 * Extract notes + Recent paths from every `## Evidence` block in `content`.
 * Supports both the rc.7 single-block shape and any leftover rc.6
 * `## Evidence (call N)` repetitions. Returns parallel arrays — caller
 * is responsible for dedup + merge ordering.
 */
function collectEvidenceItems(content: string): { notes: string[]; paths: string[] } {
  const notes: string[] = [];
  const paths: string[] = [];
  const evidenceBlockRe = /\n## Evidence(?:\s*\(call \d+\))?\s*\n([\s\S]*?)(?=\n## |$)/gu;
  let m: RegExpExecArray | null;
  while ((m = evidenceBlockRe.exec(`${content}\n`)) !== null) {
    const block = m[1] ?? "";
    const pathSection = /Recent paths:\s*\n([\s\S]*?)(?:\n\s*Notes:|$)/u.exec(block);
    if (pathSection !== null) {
      for (const rawLine of (pathSection[1] ?? "").split(/\r?\n/u)) {
        const t = rawLine.trim();
        if (t.startsWith("- ")) {
          paths.push(t.slice(2).trim());
        }
      }
    }
    const notesSection = /Notes:\s*\n([\s\S]*?)$/u.exec(block);
    const noteBody = (notesSection !== null ? notesSection[1] : block) ?? "";
    const bulletLines: string[] = [];
    let prose: string[] = [];
    for (const rawLine of noteBody.split(/\r?\n/u)) {
      const t = rawLine.trim();
      if (t.length === 0) continue;
      if (t.startsWith("- ")) {
        if (prose.length > 0) {
          notes.push(prose.join(" ").trim());
          prose = [];
        }
        bulletLines.push(t.slice(2).trim());
      } else {
        prose.push(t);
      }
    }
    if (prose.length > 0) notes.push(prose.join(" ").trim());
    for (const n of bulletLines) notes.push(n);
  }
  return { notes, paths };
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

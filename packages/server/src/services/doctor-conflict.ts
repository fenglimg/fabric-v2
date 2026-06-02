// v2.1 ④ conflict-detection (P4): doctor wiring for the knowledge-conflict lint.
//
// Loads canonical knowledge entries (both layers) with their bodies, runs the
// conflict-lint pure pass (bm25 candidate pairs + optional injected LLM judge),
// and shapes the result into a doctor report. Kept OPT-IN (`fabric doctor
// --lint-conflicts`) rather than folded into the default report so the large
// runDoctorReport check-set contract stays byte-stable.

import { readFile } from "node:fs/promises";

import { readAgentsMeta } from "../meta-reader.js";
import { resolveContentRefPath } from "./knowledge-sync.js";
import {
  lintConflicts,
  DEFAULT_CONFLICT_SIMILARITY_THRESHOLD,
  type ConflictEntry,
  type ConflictJudge,
  type ConflictPair,
} from "./conflict-lint.js";
import { readConflictLintThreshold } from "../config-loader.js";

export interface ConflictLintReport {
  status: "ok";
  threshold: number;
  deep: boolean;
  /** Total candidate pairs (similarity ≥ threshold). */
  candidate_count: number;
  /** Subset judged a real contradiction (deep mode only). */
  conflict_count: number;
  pairs: ConflictPair[];
}

// Drop YAML frontmatter so the similarity signal comes from the entry's prose,
// not the boilerplate scalar keys every entry shares.
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const after = content.indexOf("\n", end + 1);
  return after === -1 ? "" : content.slice(after + 1);
}

/**
 * Load canonical knowledge entries with bodies from the agents.meta node index.
 * Skips pending/draft staging entries (conflict detection targets the curated
 * corpus) and any node missing a stable_id or knowledge_type. Bodies are read
 * best-effort — an unreadable file contributes no entry.
 */
export async function loadConflictEntries(projectRoot: string): Promise<ConflictEntry[]> {
  let meta;
  try {
    meta = await readAgentsMeta(projectRoot);
  } catch {
    return [];
  }
  const entries: ConflictEntry[] = [];
  for (const node of Object.values(meta.nodes)) {
    const stableId = node.stable_id;
    if (typeof stableId !== "string" || stableId.length === 0) continue;
    // The on-disk path lives in content_ref (the node KEY is the stable_id).
    const contentRef = node.content_ref;
    if (typeof contentRef !== "string" || contentRef.length === 0) continue;
    if (contentRef.includes("/pending/")) continue; // skip drafts
    const knowledgeType = node.description?.knowledge_type;
    if (typeof knowledgeType !== "string" || knowledgeType.length === 0) continue;
    // Layer from the stable_id prefix (KT-* = team, KP-* = personal) — the
    // authoritative signal per KT-DEC-0004. knowledge_layer is often unset on
    // freshly built meta, so don't depend on it.
    const layer = stableId.startsWith("KP-") ? "personal" : "team";
    let body: string;
    try {
      body = await readFile(resolveContentRefPath(projectRoot, contentRef), "utf8");
    } catch {
      continue;
    }
    entries.push({ stable_id: stableId, knowledge_type: knowledgeType, layer, text: stripFrontmatter(body) });
  }
  return entries;
}

/**
 * Run the knowledge-conflict lint. Always runs the cheap bm25 candidate pass;
 * when `deep` is set AND a judge is supplied, escalates candidates to
 * conflict/similar verdicts via the injected LLM judge.
 *
 * threshold resolution: opts.threshold → fabric-config
 * conflict_lint_similarity_threshold → DEFAULT_CONFLICT_SIMILARITY_THRESHOLD.
 */
export async function runDoctorConflictLint(
  projectRoot: string,
  opts: { threshold?: number; deep?: boolean; judge?: ConflictJudge } = {},
): Promise<ConflictLintReport> {
  const threshold =
    typeof opts.threshold === "number"
      ? opts.threshold
      : readConflictLintThreshold(projectRoot) ?? DEFAULT_CONFLICT_SIMILARITY_THRESHOLD;
  const deep = opts.deep === true && opts.judge !== undefined;
  const entries = await loadConflictEntries(projectRoot);
  const pairs = await lintConflicts(entries, {
    threshold,
    judge: deep ? opts.judge : undefined,
  });
  return {
    status: "ok",
    threshold,
    deep,
    candidate_count: pairs.length,
    conflict_count: pairs.filter((p) => p.verdict === "conflict").length,
    pairs,
  };
}

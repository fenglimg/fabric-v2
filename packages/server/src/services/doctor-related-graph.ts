// ---------------------------------------------------------------------------
// BORROW-007: related broken links + hub ranking inspection.
//
// Walks the include_related graph of all canonical entries across the read-set
// stores. Two axes:
//
//   1. Broken links — a `related` target that does not resolve to any canonical
//      entry in any store. A dangling related edge is dead metadata that the
//      recall include_related path silently skips (advisory warning).
//
//   2. Hub ranking — entries with the highest `related` in-degree across the
//      corpus. Surfaces the most-referenced entries so the operator can decide
//      whether the hub roles are appropriate (advisory info).
//
// Reads ONLY from the store canonical corpus via collectStoreCanonicalEntries
// (the same source the recall path reads from) so the graph is always
// self-consistent. The wiring into the doctor surface lives in the CLI registry
// (packages/cli/src/store/knowledge-doctor-checks.ts) — this module is pure
// inspection logic, kept factory-free so it can be unit-tested without a
// translator or the doctor report shape.
// ---------------------------------------------------------------------------

import { tokenize } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelatedBrokenLink {
  /** The entry (store-qualified id) that declared the `related` edge. */
  source: string;
  /** The unresolvable related value. */
  target: string;
}

export interface RelatedHubEntry {
  stableId: string;
  inDegree: number;
}

export interface RelatedGraphInspection {
  brokenLinks: RelatedBrokenLink[];
  hubEntries: RelatedHubEntry[];
  /** Total canonical entries scanned. */
  totalEntries: number;
}

/** A single node fed into the pure graph builder. */
export interface RelatedGraphNode {
  /** Store-qualified id (`<alias>:<stableId>`). */
  qualifiedId: string;
  /** The entry's declared `related` edges (frontmatter), if any. */
  related?: string[];
}

// ---------------------------------------------------------------------------
// Pure graph builder (unit-testable without disk / read-set)
// ---------------------------------------------------------------------------

/**
 * Build the related-edge graph from a list of nodes and report broken links +
 * hub ranking. Pure — no I/O — so the broken-link / in-degree logic can be
 * tested with hand-built fixtures.
 *
 * A "broken link" is a `related` value that does not appear as any node's
 * store-qualified id NOR bare stable_id in the corpus. Store-qualified
 * references (`alias:id`) and bare references (`id`) both resolve, because the
 * id index carries both forms for every node.
 */
export function buildRelatedGraph(nodes: RelatedGraphNode[]): RelatedGraphInspection {
  const brokenLinks: RelatedBrokenLink[] = [];
  const inDegree = new Map<string, number>();
  const allIds = new Set<string>();
  const edgeSources: Array<{ source: string; related: string[] }> = [];

  for (const node of nodes) {
    const bareId = extractBareStableId(node.qualifiedId);
    allIds.add(node.qualifiedId);
    if (bareId !== null) {
      allIds.add(bareId);
    }

    const related = node.related;
    if (related !== undefined && related.length > 0) {
      edgeSources.push({ source: node.qualifiedId, related });
      for (const rel of related) {
        inDegree.set(rel, (inDegree.get(rel) ?? 0) + 1);
      }
    }
  }

  // Broken links: a related target that is NOT in the id index.
  for (const { source, related } of edgeSources) {
    for (const rel of related) {
      if (!allIds.has(rel)) {
        brokenLinks.push({ source, target: rel });
      }
    }
  }

  // Hub ranking: sort by in-degree descending, then by id for stable ordering.
  const hubEntries = [...inDegree.entries()]
    .map(([stableId, degree]) => ({ stableId, inDegree: degree }))
    .sort((a, b) => b.inDegree - a.inDegree || a.stableId.localeCompare(b.stableId));

  return {
    brokenLinks,
    hubEntries,
    totalEntries: nodes.length,
  };
}

/**
 * Extract the bare stable_id from a store-qualified id (`alias:KT-DEC-0001`
 * → `KT-DEC-0001`), or return null when the id has no obvious store prefix.
 */
function extractBareStableId(qualifiedId: string): string | null {
  const colonIdx = qualifiedId.indexOf(":");
  if (colonIdx > 0 && colonIdx < qualifiedId.length - 1) {
    return qualifiedId.slice(colonIdx + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// PLN-004 F2: related edge SUGGESTION (advisory, human-gated)
//
// The corpus `related` edges are authored manually (fabric-connect / review) and
// are census-empty on most entries, so the include_related recall path and the
// broken-link / hub inspection above have little to work with. suggestRelatedEdges
// PROPOSES edges the corpus is MISSING, from lexical + metadata overlap, so a human
// can apply the high-confidence ones via fabric-review. It NEVER writes — TASK-004
// surfaces it as a NON-GATE doctor advisory (writes stay on the review path). Pure
// (no I/O), like buildRelatedGraph, so it is fixture-testable without a store.
// ---------------------------------------------------------------------------

/** A richer node carrying the text/metadata signals the suggestion heuristic reads. */
export interface RelatedGraphNodeRich {
  /** Store-qualified id (`<alias>:<stableId>`). */
  qualifiedId: string;
  summary: string;
  /** RuleDescription.intent_clues (NOT `keywords` — RuleDescription has no such field). */
  intentClues: string[];
  tags: string[];
  relevancePaths: string[];
  /** Existing declared `related` edges — a pair already connected here is never re-proposed. */
  related: string[];
}

/** A proposed related edge: an ordered id pair, a confidence, and the signals that fired. */
export interface SuggestedRelatedEdge {
  source: string;
  target: string;
  confidence: number;
  provenance: string[];
}

const SUGGEST_CONFIDENCE_THRESHOLD = 0.6;
const TAG_OVERLAP_BONUS = 0.15;
const PATH_OVERLAP_BONUS = 0.15;

/**
 * Propose related edges the corpus is missing. For every unordered pair NOT already
 * connected via existing `related`, score:
 *   - token Jaccard over tokenize(summary + intent_clues) — the DOMINANT signal
 *   - tag-set intersection — an INDEPENDENT boolean bonus (never folded into tokens)
 *   - shared relevance_paths — an INDEPENDENT boolean bonus
 * confidence = jaccard + bonuses, clamped [0,1]. Only pairs >= 0.6 are returned, each
 * with a non-empty provenance[] naming the firing signals. Pure + deterministic
 * (same input → same output; sorted confidence desc, then source, then target).
 */
export function suggestRelatedEdges(nodes: RelatedGraphNodeRich[]): SuggestedRelatedEdge[] {
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // Precompute each node's signal sets ONCE (O(n)), reused across the O(n^2) pairs.
  const prepared = nodes.map((node) => ({
    qualifiedId: node.qualifiedId,
    bareId: extractBareStableId(node.qualifiedId) ?? node.qualifiedId,
    tokens: new Set(tokenize(`${node.summary} ${node.intentClues.join(" ")}`)),
    tags: new Set(node.tags),
    paths: new Set(node.relevancePaths),
  }));

  // Existing edges as unordered bare-id pair keys so an already-connected pair (either
  // direction, bare or store-qualified reference) is skipped.
  const existing = new Set<string>();
  for (const node of nodes) {
    const aBare = extractBareStableId(node.qualifiedId) ?? node.qualifiedId;
    for (const rel of node.related) {
      existing.add(pairKey(aBare, extractBareStableId(rel) ?? rel));
    }
  }

  const out: SuggestedRelatedEdge[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.bareId === b.bareId) continue;
      if (existing.has(pairKey(a.bareId, b.bareId))) continue;

      let intersection = 0;
      for (const t of a.tokens) if (b.tokens.has(t)) intersection++;
      const union = a.tokens.size + b.tokens.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;

      let tagOverlap = false;
      for (const t of a.tags)
        if (b.tags.has(t)) {
          tagOverlap = true;
          break;
        }
      let pathOverlap = false;
      for (const p of a.paths)
        if (b.paths.has(p)) {
          pathOverlap = true;
          break;
        }

      let confidence = jaccard;
      if (tagOverlap) confidence += TAG_OVERLAP_BONUS;
      if (pathOverlap) confidence += PATH_OVERLAP_BONUS;
      confidence = Math.min(1, confidence);
      if (confidence < SUGGEST_CONFIDENCE_THRESHOLD) continue;

      const provenance: string[] = [];
      if (jaccard > 0) provenance.push("token-jaccard");
      if (tagOverlap) provenance.push("tag-overlap");
      if (pathOverlap) provenance.push("shared-path");

      const [source, target] =
        a.qualifiedId < b.qualifiedId
          ? [a.qualifiedId, b.qualifiedId]
          : [b.qualifiedId, a.qualifiedId];
      out.push({ source, target, confidence, provenance });
    }
  }

  out.sort(
    (x, y) =>
      y.confidence - x.confidence ||
      x.source.localeCompare(y.source) ||
      x.target.localeCompare(y.target),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Inspection (read-set walk + pure graph build)
// ---------------------------------------------------------------------------

/**
 * Walk the store canonical corpus and build the related graph. Never throws —
 * collectStoreCanonicalEntries degrades to [] when no store is in the read-set.
 *
 * Note: the previous (dead, never-wired) draft of this module re-parsed each
 * entry's frontmatter via extractRuleDescription(entry.file) — passing a FILE
 * PATH where a raw-markdown SOURCE was expected, which silently produced no
 * edges. StoreCanonicalEntry already carries the parsed `description`, so we
 * read `description.related` directly (the single source the recall path uses).
 */
export async function inspectRelatedGraph(
  projectRoot: string,
): Promise<RelatedGraphInspection> {
  const entries = await collectStoreCanonicalEntries(projectRoot);
  return buildRelatedGraph(
    entries.map((entry) => ({
      qualifiedId: entry.qualifiedId,
      related: entry.description.related,
    })),
  );
}

/** Cap on how many suggested edges the advisory surfaces (highest-confidence first). */
const SUGGESTED_EDGES_TOP_N = 20;

/**
 * Walk the store canonical corpus and PROPOSE the top-N missing related edges via the
 * pure suggestRelatedEdges heuristic. Never throws — collectStoreCanonicalEntries
 * degrades to [] when no store is in the read-set. READ-ONLY: it computes suggestions
 * and writes nothing; edge creation stays on the fabric-review modify path.
 */
export async function inspectSuggestedRelatedEdges(
  projectRoot: string,
): Promise<SuggestedRelatedEdge[]> {
  let entries;
  try {
    entries = await collectStoreCanonicalEntries(projectRoot);
  } catch {
    return [];
  }
  const nodes: RelatedGraphNodeRich[] = entries.map((entry) => ({
    qualifiedId: entry.qualifiedId,
    summary: entry.description.summary ?? "",
    intentClues: entry.description.intent_clues ?? [],
    tags: entry.description.tags ?? [],
    relevancePaths: entry.description.relevance_paths ?? [],
    related: entry.description.related ?? [],
  }));
  return suggestRelatedEdges(nodes).slice(0, SUGGESTED_EDGES_TOP_N);
}

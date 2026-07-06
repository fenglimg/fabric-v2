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
// Inspection (read-set walk + pure graph build)
//
// PLN-004 F2 note (rc.8 retired): a nearest-lexical "suggestRelatedEdges" heuristic
// once lived here and surfaced through doctor as an advisory. It was retired because
// token-Jaccard is字面-bound and cannot see the five semantic关联 types the
// fabric-connect skill actually authors edges for (互补 / 规避 / 取代 / 同域 / 引用链).
// A字面 filter above the AI skill's候选池 introduced a lexical bias and reduced the
// skill's semantic reach. Edge PROPOSAL now lives entirely in the fabric-connect
// skill (AI-driven, on-demand). This module stays state-diagnostic only.
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


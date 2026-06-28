// ---------------------------------------------------------------------------
// BORROW-007: related broken links + hub ranking doctor lint.
//
// Checks the include_related graph of all canonical entries across the
// read-set stores. Two axes:
//
//   1. Broken links — a `related` target that does not resolve to any
//      canonical entry in any store (warning). A dangling related edge is
//      dead metadata that the recall path will silently skip.
//
//   2. Hub ranking — entries with the highest `related` in-degree across
//      the corpus (info). Surfaces the most-referenced entries so the
//      operator can decide whether the hub roles are appropriate.
//
// Reads ONLY from the store canonical corpus via collectStoreCanonicalEntries
// (the same source the recall path reads from) so the graph is always
// self-consistent.
// ---------------------------------------------------------------------------

import type { Translator } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import { extractRuleDescription } from "./knowledge-meta-builder.js";
import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelatedBrokenLink {
  /** The entry that declared the `related` edge. */
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

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/**
 * Walk the store canonical corpus, build the related graph, and report
 * broken links + hub ranking.
 *
 * A "broken link" is a `related` value that does not appear as any
 * entry's stable_id (non-store-qualified) in the corpus. Store-qualified
 * references (`alias:id`) are resolved by stripping the alias prefix and
 * comparing against the bare stable_id.
 */
export async function inspectRelatedGraph(
  projectRoot: string,
): Promise<RelatedGraphInspection> {
  const brokenLinks: RelatedBrokenLink[] = [];
  const inDegree = new Map<string, number>();
  const allIds = new Set<string>();

  // Walk the store canonical corpus.
  const entries = await collectStoreCanonicalEntries(projectRoot);

  // Map each entry's store-qualified id and bare stable-id into the id index,
  // and build the related in-degree graph.
  const edgeSources: Array<{ source: string; related: string[] }> = [];

  for (const entry of entries) {
    // The entry key is store-qualified (`<alias>:<stableId>`). We also index
    // the bare stableId so that non-qualified related references resolve.
    const bareId = extractBareStableId(entry.qualifiedId);
    allIds.add(entry.qualifiedId);
    if (bareId !== null) {
      allIds.add(bareId);
    }

    // Read frontmatter to extract `related`.
    try {
      const desc = extractRuleDescription(entry.file);
      const related = desc?.related;
      if (related !== undefined && related.length > 0) {
        edgeSources.push({ source: entry.qualifiedId, related });

        // Count in-degree for the target.
        for (const rel of related) {
          inDegree.set(rel, (inDegree.get(rel) ?? 0) + 1);
        }
      }
    } catch {
      // Skip unparseable entries — they won't contribute to related either.
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

  // Hub ranking: sort by in-degree descending.
  const hubEntries = [...inDegree.entries()]
    .map(([stableId, degree]) => ({ stableId, inDegree: degree }))
    .sort((a, b) => b.inDegree - a.inDegree);

  return {
    brokenLinks,
    hubEntries,
    totalEntries: entries.length,
  };
}

/**
 * Extract the bare stable_id from a store-qualified id (`alias:KT-DEC-0001`
 * → `KT-DEC-0001`), or return null if the id has no obvious store prefix.
 */
function extractBareStableId(qualifiedId: string): string | null {
  const colonIdx = qualifiedId.indexOf(":");
  if (colonIdx > 0 && colonIdx < qualifiedId.length - 1) {
    return qualifiedId.slice(colonIdx + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Doctor check factories
// ---------------------------------------------------------------------------

export function createRelatedBrokenLinkCheck(
  t: Translator,
  inspection: RelatedGraphInspection,
): DoctorCheck {
  if (inspection.brokenLinks.length === 0) {
    return {
      name: t("doctor.check.related_graph_broken.name"),
      status: "ok",
      message: t("doctor.check.related_graph_broken.ok"),
    };
  }

  const samples = inspection.brokenLinks.slice(0, 5)
    .map((b) => `${b.source} → ${b.target}`)
    .join(", ");
  const total = inspection.brokenLinks.length;
  const message = total <= 5
    ? t("doctor.check.related_graph_broken.message", { links: samples })
    : t("doctor.check.related_graph_broken.message.many", {
        links: samples,
        count: String(total - 5),
      });

  return {
    name: t("doctor.check.related_graph_broken.name"),
    status: "warn",
    kind: "warning",
    code: "related_graph_broken_link",
    message,
    actionHint: t("doctor.check.related_graph_broken.remediation"),
  };
}

export function createRelatedHubRankCheck(
  t: Translator,
  inspection: RelatedGraphInspection,
): DoctorCheck {
  if (inspection.hubEntries.length === 0) {
    return {
      name: t("doctor.check.related_graph_hub.name"),
      status: "ok",
      message: t("doctor.check.related_graph_hub.ok"),
    };
  }

  const top = inspection.hubEntries.slice(0, 5)
    .map((h) => `${h.stableId} (×${h.inDegree})`)
    .join(", ");

  return {
    name: t("doctor.check.related_graph_hub.name"),
    status: "ok",
    kind: "info",
    message: t("doctor.check.related_graph_hub.message", {
      top,
      total: String(inspection.hubEntries.length),
    }),
  };
}
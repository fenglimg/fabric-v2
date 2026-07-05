import { describe, expect, it } from "vitest";

import {
  buildRelatedGraph,
  suggestRelatedEdges,
  type RelatedGraphNode,
  type RelatedGraphNodeRich,
} from "./doctor-related-graph.js";

// BORROW-007 re-wire: the pure related-graph builder. These tests exercise the
// broken-link detection (qualified + bare id resolution) and hub in-degree
// ranking directly — the read-set walk wrapper (inspectRelatedGraph) is covered
// by the real-data dogfood (KT-PIT-0014).

describe("buildRelatedGraph", () => {
  it("returns an empty inspection for an empty corpus", () => {
    const result = buildRelatedGraph([]);
    expect(result.totalEntries).toBe(0);
    expect(result.brokenLinks).toEqual([]);
    expect(result.hubEntries).toEqual([]);
  });

  it("resolves related targets by store-qualified id AND bare stable_id", () => {
    const nodes: RelatedGraphNode[] = [
      { qualifiedId: "team:KT-DEC-0001", related: ["team:KT-DEC-0002", "KT-DEC-0003"] },
      { qualifiedId: "team:KT-DEC-0002" },
      { qualifiedId: "team:KT-DEC-0003" },
    ];
    const result = buildRelatedGraph(nodes);
    // Both the qualified ref (team:KT-DEC-0002) and the bare ref (KT-DEC-0003,
    // resolved via the bare-id index entry of team:KT-DEC-0003) resolve.
    expect(result.brokenLinks).toEqual([]);
    expect(result.totalEntries).toBe(3);
  });

  it("flags a related target absent from the corpus as a broken link", () => {
    const nodes: RelatedGraphNode[] = [
      { qualifiedId: "team:KT-DEC-0001", related: ["team:KT-DEC-0099", "KT-DEC-0002"] },
      { qualifiedId: "team:KT-DEC-0002" },
    ];
    const result = buildRelatedGraph(nodes);
    expect(result.brokenLinks).toEqual([
      { source: "team:KT-DEC-0001", target: "team:KT-DEC-0099" },
    ]);
  });

  it("ranks hubs by in-degree descending, then by id for stable ordering", () => {
    const nodes: RelatedGraphNode[] = [
      { qualifiedId: "team:A", related: ["team:HUB"] },
      { qualifiedId: "team:B", related: ["team:HUB", "team:MID"] },
      { qualifiedId: "team:C", related: ["team:HUB", "team:MID"] },
      { qualifiedId: "team:HUB" },
      { qualifiedId: "team:MID" },
    ];
    const result = buildRelatedGraph(nodes);
    expect(result.hubEntries).toEqual([
      { stableId: "team:HUB", inDegree: 3 },
      { stableId: "team:MID", inDegree: 2 },
    ]);
  });

  it("ignores nodes with empty or undefined related arrays", () => {
    const nodes: RelatedGraphNode[] = [
      { qualifiedId: "team:A", related: [] },
      { qualifiedId: "team:B" },
    ];
    const result = buildRelatedGraph(nodes);
    expect(result.hubEntries).toEqual([]);
    expect(result.brokenLinks).toEqual([]);
    expect(result.totalEntries).toBe(2);
  });
});

// PLN-004 F2: related edge suggestion heuristic — pure, fixture-testable.
describe("suggestRelatedEdges", () => {
  const node = (
    qualifiedId: string,
    summary: string,
    over: Partial<RelatedGraphNodeRich> = {},
  ): RelatedGraphNodeRich => ({
    qualifiedId,
    summary,
    intentClues: over.intentClues ?? [],
    tags: over.tags ?? [],
    relevancePaths: over.relevancePaths ?? [],
    related: over.related ?? [],
  });

  it("proposes a high-token-overlap pair with token-jaccard provenance", () => {
    const edges = suggestRelatedEdges([
      node("team:KT-DEC-0001", "redis cache invalidation strategy", { intentClues: ["redis", "cache"] }),
      node("team:KT-DEC-0002", "redis cache invalidation strategy tuning", {
        intentClues: ["redis", "cache"],
      }),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("team:KT-DEC-0001");
    expect(edges[0].target).toBe("team:KT-DEC-0002");
    expect(edges[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(edges[0].provenance).toContain("token-jaccard");
  });

  it("does not propose an unrelated (no-overlap) pair", () => {
    const edges = suggestRelatedEdges([
      node("team:KT-DEC-0001", "redis cache invalidation strategy", { intentClues: ["cache"] }),
      node("team:KT-DEC-0002", "authentication rotation lifecycle", { intentClues: ["auth"] }),
    ]);
    expect(edges).toEqual([]);
  });

  it("never re-proposes a pair already connected via existing related", () => {
    const edges = suggestRelatedEdges([
      node("team:KT-DEC-0001", "redis cache invalidation strategy", {
        intentClues: ["redis", "cache"],
        related: ["KT-DEC-0002"],
      }),
      node("team:KT-DEC-0002", "redis cache invalidation strategy tuning", {
        intentClues: ["redis", "cache"],
      }),
    ]);
    expect(edges).toEqual([]);
  });

  it("promotes a moderate-overlap pair over the 0.6 floor via tag + path bonuses", () => {
    // Jaccard alone (~0.4) is below 0.6; the tag-overlap + shared-path bonuses
    // (0.15 each) push it over. Provenance names every firing signal.
    const edges = suggestRelatedEdges([
      node("team:KT-DEC-0001", "redis cache warmup", {
        intentClues: ["redis"],
        tags: ["perf"],
        relevancePaths: ["packages/server/src/cache.ts"],
      }),
      node("team:KT-DEC-0002", "redis cache eviction policy", {
        intentClues: ["redis"],
        tags: ["perf"],
        relevancePaths: ["packages/server/src/cache.ts"],
      }),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(edges[0].provenance).toEqual(
      expect.arrayContaining(["token-jaccard", "tag-overlap", "shared-path"]),
    );
  });

  it("is deterministic and input-order-independent (canonical source < target)", () => {
    const a = node("team:KT-DEC-0002", "redis cache invalidation", { intentClues: ["redis"] });
    const b = node("team:KT-DEC-0001", "redis cache invalidation", { intentClues: ["redis"] });
    const forward = suggestRelatedEdges([a, b]);
    const backward = suggestRelatedEdges([b, a]);
    expect(forward).toEqual(backward);
    expect(forward).toHaveLength(1);
    expect(forward[0].source).toBe("team:KT-DEC-0001");
    expect(forward[0].target).toBe("team:KT-DEC-0002");
  });
});

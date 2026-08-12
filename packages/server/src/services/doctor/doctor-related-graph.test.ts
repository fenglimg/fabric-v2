import { describe, expect, it } from "vitest";

import { buildRelatedGraph, type RelatedGraphNode } from "./doctor-related-graph.js";

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


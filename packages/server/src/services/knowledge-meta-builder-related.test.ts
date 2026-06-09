import { describe, expect, it } from "vitest";

import { isForbiddenCrossLayerEdge } from "./knowledge-meta-builder.js";

describe("knowledge meta related edge privacy guard", () => {
  it("treats store-qualified KP targets as personal topology leaks from team entries", () => {
    expect(isForbiddenCrossLayerEdge("team", "personal:KP-GLD-0001")).toBe(true);
    expect(isForbiddenCrossLayerEdge("team", "11111111-1111-4111-8111-111111111111:user-a:KP-GLD-0001")).toBe(true);
  });

  it("allows team targets and personal-source edges", () => {
    expect(isForbiddenCrossLayerEdge("team", "team:KT-GLD-0001")).toBe(false);
    expect(isForbiddenCrossLayerEdge("personal", "personal:KP-GLD-0001")).toBe(false);
    expect(isForbiddenCrossLayerEdge("personal", "team:KT-GLD-0001")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  resolveRetrievalBudget,
  retrievalBudgetProfile,
  DEFAULT_RETRIEVAL_BUDGET_PROFILE,
} from "./retrieval-budget.js";

describe("resolveRetrievalBudget (C5 layered budget)", () => {
  it("defaults to the balanced profile", () => {
    expect(DEFAULT_RETRIEVAL_BUDGET_PROFILE).toBe("balanced");
    expect(resolveRetrievalBudget()).toEqual(resolveRetrievalBudget({ profile: "balanced" }));
  });

  it("balanced reproduces the historical per-knob defaults exactly (zero regression)", () => {
    // top_k 24, payload warn/hard 16384/65536, injection 2000 — the pre-C5 defaults.
    expect(resolveRetrievalBudget({ profile: "balanced" })).toEqual({
      topK: 24,
      payloadWarnBytes: 16384,
      payloadHardBytes: 65536,
      injectionChars: 2000,
    });
  });

  it("scales every layer down for conservative and up for generous", () => {
    const c = resolveRetrievalBudget({ profile: "conservative" });
    const g = resolveRetrievalBudget({ profile: "generous" });
    expect(c.topK).toBeLessThan(24);
    expect(c.payloadHardBytes).toBeLessThan(65536);
    expect(c.injectionChars).toBeLessThan(2000);
    expect(g.topK).toBeGreaterThan(24);
    expect(g.payloadHardBytes).toBeGreaterThan(65536);
    expect(g.injectionChars).toBeGreaterThan(2000);
  });

  it("lets a per-field override win while the rest follow the profile", () => {
    const resolved = resolveRetrievalBudget({ profile: "conservative", topK: 100 });
    expect(resolved.topK).toBe(100); // override wins
    expect(resolved.payloadHardBytes).toBe(retrievalBudgetProfile("conservative").payloadHardBytes); // profile holds
  });

  it("resolves each field independently of the others", () => {
    const resolved = resolveRetrievalBudget({ payloadHardBytes: 99999 });
    expect(resolved.payloadHardBytes).toBe(99999);
    expect(resolved.topK).toBe(24); // balanced base for the un-pinned fields
  });
});

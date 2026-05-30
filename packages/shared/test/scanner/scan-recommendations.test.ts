import { describe, expect, it } from "vitest";

import { createTranslator } from "../../src/i18n/create-translator.js";
import { buildScanRecommendations } from "../../src/scanner/scan-recommendations.js";

// W4-11 (ISS-021): cli forensic + http scan share this one i18n-keyed builder,
// so the SAME input yields the SAME set, resolved through fabric_language.

const en = createTranslator("en");
const zh = createTranslator("zh-CN");

describe("buildScanRecommendations (ISS-021 unified)", () => {
  it("renders the same input in the configured language (en vs zh-CN)", () => {
    const input = { frameworkKind: "cocos-creator", hasMeta: true, readmeOk: false };
    const enRecs = buildScanRecommendations(input, en);
    const zhRecs = buildScanRecommendations(input, zh);

    // Same count of items (single implementation → no structural drift).
    expect(enRecs.length).toBe(zhRecs.length);
    // Language-correct.
    expect(enRecs.join("\n")).toMatch(/Cocos Creator Component lifecycle/);
    expect(zhRecs.join("\n")).toMatch(/Cocos Creator Component 生命周期/);
    // cocos meta-lock item appears when hasMeta is true.
    expect(zhRecs.join("\n")).toMatch(/\.meta/);
  });

  it("is deterministic for a given input (both 'entries' share one source)", () => {
    const input = { frameworkKind: "next", readmeOk: true };
    expect(buildScanRecommendations(input, en)).toEqual(buildScanRecommendations(input, en));
    expect(buildScanRecommendations(input, en).length).toBeGreaterThan(0);
  });

  it("emits setup items only when the signal is explicitly unmet", () => {
    // forensic-style input (no setup signals tracked) → framework item only.
    const forensicLike = buildScanRecommendations({ frameworkKind: "vite" }, en);
    expect(forensicLike.some((r) => r.includes("fabric install"))).toBe(false);
    // http-style input with unmet setup signals → install + contributing emitted.
    const httpLike = buildScanRecommendations(
      { frameworkKind: "vite", readmeOk: true, hasContributing: false, hasExistingFabric: false },
      en,
    );
    expect(httpLike.some((r) => r.includes("fabric install"))).toBe(true);
    expect(httpLike.some((r) => r.toLowerCase().includes("contributing"))).toBe(true);
  });

  it("falls back to the generic recommendation for an unmapped framework kind", () => {
    const recs = buildScanRecommendations({ frameworkKind: "rust" }, en);
    expect(recs.join("\n")).toContain("rust");
  });
});

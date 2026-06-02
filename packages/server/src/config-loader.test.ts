import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSelectionTokenTtlMs, readPlanContextTopK, readPayloadLimits, readEmbedConfig, readOrphanDemoteThresholdDays } from "./config-loader.js";

// v2.0.0-rc.29 REVIEW (codex HIGH-3): the raw JSON read previously cast the
// `selection_token_ttl_ms` field straight onto the typed config without going
// through `selectionTokenTtlMsSchema`. A string / negative / out-of-range
// value would then flow into `plan-context.ts`'s `expires_at` arithmetic and
// produce a bogus expiry. These tests pin the per-field safeParse fallback.

describe("config-loader — readSelectionTokenTtlMs (rc.29 REVIEW HIGH-3)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      process.cwd(),
      ".tmp-config-loader-tests",
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(content: string): void {
    writeFileSync(join(tempDir, "fabric.config.json"), content);
  }

  it("returns undefined when fabric.config.json is absent (fall back to default)", () => {
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns the value when within range [30_000, 3_600_000]", () => {
    writeConfig(JSON.stringify({ selection_token_ttl_ms: 600_000 }));
    expect(readSelectionTokenTtlMs(tempDir)).toBe(600_000);
  });

  it("returns undefined for a string value (schema rejects non-number)", () => {
    writeConfig(JSON.stringify({ selection_token_ttl_ms: "5000" }));
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a value below the 30s minimum", () => {
    writeConfig(JSON.stringify({ selection_token_ttl_ms: 1000 }));
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a value above the 1h maximum", () => {
    writeConfig(JSON.stringify({ selection_token_ttl_ms: 9_999_999 }));
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a negative value", () => {
    writeConfig(JSON.stringify({ selection_token_ttl_ms: -1 }));
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined when the field is omitted", () => {
    writeConfig(JSON.stringify({ fabric_language: "en" }));
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined when the config file is malformed JSON (best-effort)", () => {
    writeConfig("{ not json");
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });
});

// v2.2 C5-budget (W2-T3): the retrieval budget profile binds top_k + payload.
describe("config-loader — retrieval budget profile binding (C5 / W2-T3)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), ".tmp-config-loader-c5", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  function writeConfig(obj: unknown): void {
    writeFileSync(join(tempDir, "fabric.config.json"), JSON.stringify(obj));
  }

  it("no config → top_k 24 (balanced default) and payload limits undefined (guard defaults)", () => {
    expect(readPlanContextTopK(tempDir)).toBe(24);
    expect(readPayloadLimits(tempDir)).toBeUndefined();
  });

  it("conservative profile lowers top_k and pins payload bytes", () => {
    writeConfig({ retrieval_budget_profile: "conservative" });
    expect(readPlanContextTopK(tempDir)).toBe(12);
    expect(readPayloadLimits(tempDir)).toEqual({ warnBytes: 8192, hardBytes: 32768 });
  });

  it("generous profile raises top_k and pins payload bytes", () => {
    writeConfig({ retrieval_budget_profile: "generous" });
    expect(readPlanContextTopK(tempDir)).toBe(48);
    expect(readPayloadLimits(tempDir)).toEqual({ warnBytes: 32768, hardBytes: 131072 });
  });

  it("explicit plan_context_top_k overrides the profile", () => {
    writeConfig({ retrieval_budget_profile: "conservative", plan_context_top_k: 99 });
    expect(readPlanContextTopK(tempDir)).toBe(99);
  });

  it("explicit mcpPayloadLimits override the profile per-field; profile fills the rest", () => {
    writeConfig({ retrieval_budget_profile: "generous", mcpPayloadLimits: { hardBytes: 50000 } });
    // hardBytes explicit wins; warnBytes follows the generous profile.
    expect(readPayloadLimits(tempDir)).toEqual({ warnBytes: 32768, hardBytes: 50000 });
  });

  it("unknown profile string is ignored (falls back to balanced semantics)", () => {
    writeConfig({ retrieval_budget_profile: "bogus" });
    expect(readPlanContextTopK(tempDir)).toBe(24);
    expect(readPayloadLimits(tempDir)).toBeUndefined();
  });
});

// v2.2 C2-vector (W2-T7) + W2-REVIEW codex LOW-6: embed config bounding.
describe("config-loader — readEmbedConfig (C2 / W2-T7)", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(process.cwd(), ".tmp-config-loader-embed", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  function writeConfig(obj: unknown): void {
    writeFileSync(join(tempDir, "fabric.config.json"), JSON.stringify(obj));
  }

  it("defaults to disabled + weight 30 + Chinese model with no config", () => {
    expect(readEmbedConfig(tempDir)).toEqual({ enabled: false, weight: 30, model: "fast-bge-small-zh-v1.5" });
  });

  it("honors embed_enabled + an in-range weight", () => {
    writeConfig({ embed_enabled: true, embed_weight: 40 });
    expect(readEmbedConfig(tempDir)).toEqual({ enabled: true, weight: 40, model: "fast-bge-small-zh-v1.5" });
  });

  // v2.1 ③ vector-chinese-model (P3): embed_model selection.
  it("defaults embed_model to the light Chinese model (fast-bge-small-zh-v1.5)", () => {
    expect(readEmbedConfig(tempDir).model).toBe("fast-bge-small-zh-v1.5");
  });

  it("honors a supported embed_model override (multilingual-e5-large)", () => {
    writeConfig({ embed_enabled: true, embed_model: "fast-multilingual-e5-large" });
    expect(readEmbedConfig(tempDir).model).toBe("fast-multilingual-e5-large");
  });

  it("falls back to the Chinese default for an unknown / non-string embed_model", () => {
    for (const bad of ["not-a-real-model", "bge-small-en", 42, null]) {
      writeConfig({ embed_model: bad });
      expect(readEmbedConfig(tempDir).model).toBe("fast-bge-small-zh-v1.5");
    }
  });

  it("falls back to weight 30 for out-of-range / non-integer / wrong-type values", () => {
    for (const bad of [101, 50, -1, 1.5, "20", Number.NaN, Number.POSITIVE_INFINITY]) {
      writeConfig({ embed_enabled: true, embed_weight: bad });
      expect(readEmbedConfig(tempDir).weight).toBe(30);
    }
  });

  it("accepts the boundary weight 49 but not 50 (strictly below BM25_WEIGHT)", () => {
    writeConfig({ embed_weight: 49 });
    expect(readEmbedConfig(tempDir).weight).toBe(49);
    writeConfig({ embed_weight: 50 });
    expect(readEmbedConfig(tempDir).weight).toBe(30);
  });
});

// v2.2 W3-T5 (F-MATURITY-ENDORSED): readOrphanDemoteThresholdDays bridges the
// canonical maturity vocabulary (proven/verified, KT-DEC-0005) and the legacy
// stable/endorsed config keys, returning the doctor's internal ladder keys.
describe("config-loader — readOrphanDemoteThresholdDays (W3-T5)", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(process.cwd(), ".tmp-config-loader-orphan", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  function writeConfig(obj: unknown): void {
    writeFileSync(join(tempDir, "fabric.config.json"), JSON.stringify(obj));
  }

  it("returns empty when no config is present (defaults apply downstream)", () => {
    expect(readOrphanDemoteThresholdDays(tempDir)).toEqual({});
  });

  it("honors the CANONICAL keys (proven/verified) → internal stable/endorsed ladder", () => {
    writeConfig({
      orphan_demote_proven_days: 120,
      orphan_demote_verified_days: 45,
      orphan_demote_draft_days: 7,
    });
    expect(readOrphanDemoteThresholdDays(tempDir)).toEqual({ stable: 120, endorsed: 45, draft: 7 });
  });

  it("still honors the LEGACY keys (stable/endorsed) for backward-compat", () => {
    writeConfig({
      orphan_demote_stable_days: 200,
      orphan_demote_endorsed_days: 60,
    });
    expect(readOrphanDemoteThresholdDays(tempDir)).toEqual({ stable: 200, endorsed: 60 });
  });

  it("prefers the canonical key when both canonical + legacy are present", () => {
    writeConfig({
      orphan_demote_proven_days: 111,
      orphan_demote_stable_days: 222,
      orphan_demote_verified_days: 33,
      orphan_demote_endorsed_days: 44,
    });
    expect(readOrphanDemoteThresholdDays(tempDir)).toEqual({ stable: 111, endorsed: 33 });
  });

  it("drops out-of-range / non-integer values without nuking the rest", () => {
    writeConfig({
      orphan_demote_proven_days: 0, // below min → dropped
      orphan_demote_verified_days: 30,
      orphan_demote_draft_days: 4000, // above max → dropped
    });
    expect(readOrphanDemoteThresholdDays(tempDir)).toEqual({ endorsed: 30 });
  });
});

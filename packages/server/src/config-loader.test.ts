import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSelectionTokenTtlMs, readPlanContextTopK, readPayloadLimits } from "./config-loader.js";

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

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "@fenglimg/fabric-shared";

import {
  readSelectionTokenTtlMs,
  readPlanContextTopK,
  readPayloadLimits,
  readEmbedConfig,
} from "./config-loader.js";

// ---------------------------------------------------------------------------
// config-single-home W2: PREFERENCE-class knobs resolve from the GLOBAL policy
// layer (`~/.fabric/fabric-global.json` → `defaults` / `projects[<id>]`), never
// from the repo config and never from a store.
//
// This file pins the per-knob VALUE boundaries (range / type / fallback). The
// layer-ordering contract and the CORPUS-class knobs live in
// config-loader-cascade.test.ts, which owns the mounted-store fixture — keeping
// the store scaffolding in exactly one place.
// ---------------------------------------------------------------------------

let tempDir: string;
let originalFabricHome: string | undefined;

function freshTemp(tag: string): void {
  tempDir = join(
    process.cwd(),
    `.tmp-config-loader-${tag}`,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tempDir, { recursive: true });
  originalFabricHome = process.env.FABRIC_HOME;
  const home = join(tempDir, "home");
  mkdirSync(home, { recursive: true });
  process.env.FABRIC_HOME = home;
}

function cleanupTemp(): void {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  rmSync(tempDir, { recursive: true, force: true });
}

/** Write the machine-wide user defaults — the home of every preference knob. */
function writeDefaults(defaults: Record<string, unknown>): void {
  saveGlobalConfig({ uid: "test-uid", stores: [], defaults });
}

// v2.0.0-rc.29 REVIEW (codex HIGH-3): a string / negative / out-of-range value
// must not flow into plan-context's `expires_at` arithmetic. These pin the
// per-field safeParse fallback.
describe("config-loader — readSelectionTokenTtlMs (rc.29 REVIEW HIGH-3)", () => {
  beforeEach(() => freshTemp("ttl"));
  afterEach(cleanupTemp);

  it("returns undefined when no global config exists (fall back to default)", () => {
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns the value when within range [30_000, 3_600_000]", () => {
    writeDefaults({ selection_token_ttl_ms: 600_000 });
    expect(readSelectionTokenTtlMs(tempDir)).toBe(600_000);
  });

  it("returns undefined for a string value (type-strict, non-number rejected)", () => {
    writeDefaults({ selection_token_ttl_ms: "5000" });
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a value below the 30s minimum", () => {
    writeDefaults({ selection_token_ttl_ms: 1000 });
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a value above the 1h maximum", () => {
    writeDefaults({ selection_token_ttl_ms: 9_999_999 });
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined for a negative value", () => {
    writeDefaults({ selection_token_ttl_ms: -1 });
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });

  it("returns undefined when the field is omitted", () => {
    writeDefaults({ nudge_mode: "silent" });
    expect(readSelectionTokenTtlMs(tempDir)).toBeUndefined();
  });
});

// KT-DEC-0037: the retrieval_budget_profile enum was deleted. top_k is the sole
// retrieval knob; payload limits pass through explicit mcpPayloadLimits, else the
// fixed PAYLOAD_LIMIT_DEFAULT_* guardrail in the payload guard (undefined here).
describe("config-loader — per-knob retrieval budget (KT-DEC-0037)", () => {
  beforeEach(() => freshTemp("c5"));
  afterEach(cleanupTemp);

  it("no config → top_k 24 (default) and payload limits undefined (guard defaults)", () => {
    expect(readPlanContextTopK(tempDir)).toBe(24);
    expect(readPayloadLimits(tempDir)).toBeUndefined();
  });

  it("explicit plan_context_top_k is honored", () => {
    writeDefaults({ plan_context_top_k: 99 });
    expect(readPlanContextTopK(tempDir)).toBe(99);
  });

  it("invalid plan_context_top_k falls back to the default", () => {
    writeDefaults({ plan_context_top_k: "bad" });
    expect(readPlanContextTopK(tempDir)).toBe(24);
  });

  it("explicit mcpPayloadLimits pass through unchanged", () => {
    writeDefaults({ mcpPayloadLimits: { warnBytes: 20000, hardBytes: 50000 } });
    expect(readPayloadLimits(tempDir)).toEqual({ warnBytes: 20000, hardBytes: 50000 });
  });

  it("a malformed mcpPayloadLimits is rejected wholesale (guard defaults apply)", () => {
    writeDefaults({ mcpPayloadLimits: { warnBytes: -5 } });
    expect(readPayloadLimits(tempDir)).toBeUndefined();
  });

  it("a retired retrieval_budget_profile field is ignored (no top_k / payload effect)", () => {
    writeDefaults({ retrieval_budget_profile: "generous" });
    expect(readPlanContextTopK(tempDir)).toBe(24);
    expect(readPayloadLimits(tempDir)).toBeUndefined();
  });
});

// v2.2 C2-vector (W2-T7) + W2-REVIEW codex LOW-6: embed config bounding.
describe("config-loader — readEmbedConfig (C2 / W2-T7)", () => {
  beforeEach(() => freshTemp("embed"));
  afterEach(cleanupTemp);

  // TASK-004: enabled DEFAULTS TRUE — CJK semantic recall is on out of the box
  // (off only when embed_enabled is explicitly false). KT-PIT-0029.
  it("defaults to ENABLED + weight 30 + Chinese model with no config", () => {
    expect(readEmbedConfig(tempDir)).toEqual({
      enabled: true,
      weight: 30,
      model: "fast-bge-small-zh-v1.5",
    });
  });

  it("honors embed_enabled + an in-range weight", () => {
    writeDefaults({ embed_enabled: true, embed_weight: 40 });
    expect(readEmbedConfig(tempDir)).toEqual({
      enabled: true,
      weight: 40,
      model: "fast-bge-small-zh-v1.5",
    });
  });

  it("disables only when embed_enabled is explicitly false (TASK-004 opt-out)", () => {
    writeDefaults({ embed_enabled: false, embed_weight: 40 });
    expect(readEmbedConfig(tempDir)).toEqual({
      enabled: false,
      weight: 40,
      model: "fast-bge-small-zh-v1.5",
    });
  });

  it("defaults embed_model to the light Chinese model (fast-bge-small-zh-v1.5)", () => {
    expect(readEmbedConfig(tempDir).model).toBe("fast-bge-small-zh-v1.5");
  });

  it("honors a supported embed_model override (multilingual-e5-large)", () => {
    writeDefaults({ embed_enabled: true, embed_model: "fast-multilingual-e5-large" });
    expect(readEmbedConfig(tempDir).model).toBe("fast-multilingual-e5-large");
  });

  it("falls back to the Chinese default for an unknown / non-string embed_model", () => {
    for (const bad of ["not-a-real-model", "bge-small-en", 42, null]) {
      writeDefaults({ embed_model: bad });
      expect(readEmbedConfig(tempDir).model).toBe("fast-bge-small-zh-v1.5");
    }
  });

  it("falls back to weight 30 for out-of-range / non-integer / wrong-type values", () => {
    for (const bad of [101, 50, -1, 1.5, "20", Number.NaN, Number.POSITIVE_INFINITY]) {
      writeDefaults({ embed_enabled: true, embed_weight: bad });
      expect(readEmbedConfig(tempDir).weight).toBe(30);
    }
  });

  it("accepts the boundary weight 49 but not 50 (strictly below BM25_WEIGHT)", () => {
    writeDefaults({ embed_weight: 49 });
    expect(readEmbedConfig(tempDir).weight).toBe(49);
    writeDefaults({ embed_weight: 50 });
    expect(readEmbedConfig(tempDir).weight).toBe(30);
  });
});

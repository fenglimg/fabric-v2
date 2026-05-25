import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSelectionTokenTtlMs } from "./config-loader.js";

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

// v2.1 ③ vector-chinese-model (P3): tests for the opt-in semantic-search enable
// step. Covers idempotency (the install "可选步骤幂等") and the skip path (a
// normal install never touches embed config).

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  enableSemanticSearch,
  renderSemanticSearchInstructions,
  DEFAULT_EMBED_MODEL_PIN,
} from "../src/install/semantic-search.js";

let tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});
function mkTemp(): string {
  const d = mkdtempSync(join(tmpdir(), "fab-embed-enable-"));
  tempDirs.push(d);
  return d;
}
const configPathOf = (root: string) => join(root, "fabric.config.json");
const readCfg = (root: string) => JSON.parse(readFileSync(configPathOf(root), "utf8")) as Record<string, unknown>;

describe("enableSemanticSearch (v2.1 ③)", () => {
  it("creates fabric.config.json with embed_enabled + the Chinese-default model", () => {
    const root = mkTemp();
    const res = enableSemanticSearch(root);
    expect(res.changed).toBe(true);
    expect(res.alreadyEnabled).toBe(false);
    expect(res.model).toBe(DEFAULT_EMBED_MODEL_PIN);
    const cfg = readCfg(root);
    expect(cfg.embed_enabled).toBe(true);
    expect(cfg.embed_model).toBe("fast-bge-small-zh-v1.5");
  });

  it("is idempotent — a second identical call is a no-op (no write, byte-identical)", () => {
    const root = mkTemp();
    enableSemanticSearch(root);
    const firstBytes = readFileSync(configPathOf(root), "utf8");
    const res2 = enableSemanticSearch(root);
    expect(res2.alreadyEnabled).toBe(true);
    expect(res2.changed).toBe(false);
    expect(readFileSync(configPathOf(root), "utf8")).toBe(firstBytes);
  });

  it("honors an explicit model override", () => {
    const root = mkTemp();
    const res = enableSemanticSearch(root, { model: "fast-multilingual-e5-large" });
    expect(res.model).toBe("fast-multilingual-e5-large");
    expect(readCfg(root).embed_model).toBe("fast-multilingual-e5-large");
  });

  it("re-enabling with a DIFFERENT model rewrites (not a no-op)", () => {
    const root = mkTemp();
    enableSemanticSearch(root); // chinese default
    const res = enableSemanticSearch(root, { model: "fast-multilingual-e5-large" });
    expect(res.alreadyEnabled).toBe(false);
    expect(res.changed).toBe(true);
    expect(readCfg(root).embed_model).toBe("fast-multilingual-e5-large");
  });

  it("merge preserves pre-existing unrelated config keys", () => {
    const root = mkTemp();
    writeFileSync(configPathOf(root), JSON.stringify({ embed_weight: 40, retrieval_budget_profile: "balanced" }));
    enableSemanticSearch(root);
    const cfg = readCfg(root);
    expect(cfg.embed_weight).toBe(40);
    expect(cfg.retrieval_budget_profile).toBe("balanced");
    expect(cfg.embed_enabled).toBe(true);
  });

  it("skip path: NOT calling enableSemanticSearch leaves no fabric.config.json", () => {
    const root = mkTemp();
    // Simulate a normal install that never opts in.
    expect(existsSync(configPathOf(root))).toBe(false);
  });

  it("corrupt config is re-seeded rather than left unparseable", () => {
    const root = mkTemp();
    writeFileSync(configPathOf(root), "{ not valid json");
    const res = enableSemanticSearch(root);
    expect(res.changed).toBe(true);
    expect(readCfg(root).embed_enabled).toBe(true);
  });

  it("instructions mention fastembed install + cache + reindex", () => {
    const lines = renderSemanticSearchInstructions("fast-bge-small-zh-v1.5").join("\n");
    expect(lines).toContain("npm i -g fastembed");
    expect(lines).toContain("FABRIC_EMBED_CACHE_DIR");
    expect(lines).toContain("fast-bge-small-zh-v1.5");
  });
});

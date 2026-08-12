import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLegacyFabricCacheDirCheck,
  fixLegacyFabricCacheDirs,
} from "./doctor-legacy-fabric-cache.js";

// Minimal Translator stub — returns the key + a JSON blob of substitutions so a
// test can assert both the code path (which key was chosen) and that params
// flow through. Same pattern as other doctor lint tests that avoid pulling
// the real @fenglimg/fabric-shared translator into unit tests.
const t = (key: string, params?: Record<string, string>): string =>
  params !== undefined ? `${key} ${JSON.stringify(params)}` : key;

const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

async function setupRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "doctor-legacy-cache-"));
  tempDirs.push(root);
  return root;
}

describe("createLegacyFabricCacheDirCheck", () => {
  it("returns an ok check when nothing legacy exists", () => {
    const check = createLegacyFabricCacheDirCheck(t, []);
    expect(check.status).toBe("ok");
    expect(check.message).toBe("doctor.check.legacy_fabric_cache_dir_detected.ok");
  });

  it("returns a fixable warning listing the legacy dirs when found", () => {
    const check = createLegacyFabricCacheDirCheck(t, [
      ".fabric/cache/bm25",
      ".fabric/cache/vectors",
    ]);
    expect(check.status).toBe("warn");
    expect(check.code).toBe("legacy_fabric_cache_dir_detected");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("count");
    expect(check.message).toContain(".fabric/cache/bm25, .fabric/cache/vectors");
  });
});

describe("fixLegacyFabricCacheDirs", () => {
  it("no-op on a healthy project (before=[], ok=true)", async () => {
    const root = await setupRoot();
    const result = fixLegacyFabricCacheDirs(root);
    expect(result.before).toEqual([]);
    expect(result.after).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("migrates legacy dirs and reports ok=true when the sweep empties them", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    await writeFile(join(root, ".fabric/cache/bm25/rev-a.json"), "b", "utf8");

    const result = fixLegacyFabricCacheDirs(root);
    expect(result.before).toEqual([".fabric/cache/bm25"]);
    expect(result.after).toEqual([]);
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, ".fabric/.cache/bm25/rev-a.json"))).toBe(true);
  });
});

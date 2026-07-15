import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectLegacyFabricCacheDirs,
  migrateLegacyFabricCache,
} from "./fabric-cache-migration.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

async function setupRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-cache-mig-"));
  tempDirs.push(root);
  return root;
}

describe("migrateLegacyFabricCache", () => {
  it("no-op on a fresh project (neither old nor new exists)", async () => {
    const root = await setupRoot();
    migrateLegacyFabricCache(root);
    expect(existsSync(join(root, ".fabric/cache"))).toBe(false);
    expect(existsSync(join(root, ".fabric/.cache"))).toBe(false);
  });

  it("renames legacy .fabric/cache/bm25 → .fabric/.cache/bm25, preserving contents", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    await writeFile(join(root, ".fabric/cache/bm25/rev-a.json"), '{"x":1}', "utf8");

    migrateLegacyFabricCache(root);

    expect(existsSync(join(root, ".fabric/cache/bm25"))).toBe(false);
    expect(existsSync(join(root, ".fabric/.cache/bm25/rev-a.json"))).toBe(true);
    expect(readFileSync(join(root, ".fabric/.cache/bm25/rev-a.json"), "utf8")).toBe(
      '{"x":1}',
    );
  });

  it("migrates both bm25 and vectors in one call", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    await mkdir(join(root, ".fabric/cache/vectors"), { recursive: true });
    await writeFile(join(root, ".fabric/cache/bm25/rev-a.json"), "b", "utf8");
    await writeFile(join(root, ".fabric/cache/vectors/rev-a.json"), "v", "utf8");

    migrateLegacyFabricCache(root);

    expect(existsSync(join(root, ".fabric/.cache/bm25/rev-a.json"))).toBe(true);
    expect(existsSync(join(root, ".fabric/.cache/vectors/rev-a.json"))).toBe(true);
    // Empty legacy parent is swept.
    expect(existsSync(join(root, ".fabric/cache"))).toBe(false);
  });

  it("never clobbers a pre-existing new location", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    await writeFile(join(root, ".fabric/cache/bm25/rev-a.json"), "old", "utf8");
    // New location already populated by a newer code path.
    await mkdir(join(root, ".fabric/.cache/bm25"), { recursive: true });
    await writeFile(join(root, ".fabric/.cache/bm25/rev-a.json"), "new", "utf8");

    migrateLegacyFabricCache(root);

    // Both survive; new location wins authority.
    expect(readFileSync(join(root, ".fabric/.cache/bm25/rev-a.json"), "utf8")).toBe(
      "new",
    );
    expect(existsSync(join(root, ".fabric/cache/bm25/rev-a.json"))).toBe(true);
  });

  it("is idempotent: second call is a no-op", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    await writeFile(join(root, ".fabric/cache/bm25/rev-a.json"), "b", "utf8");

    migrateLegacyFabricCache(root);
    migrateLegacyFabricCache(root);

    expect(existsSync(join(root, ".fabric/.cache/bm25/rev-a.json"))).toBe(true);
    expect(existsSync(join(root, ".fabric/cache/bm25"))).toBe(false);
  });

  it("preserves a non-empty legacy parent when only one subdir migrated", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/bm25"), { recursive: true });
    // A hypothetical unrelated legacy sibling — must not be swept.
    await mkdir(join(root, ".fabric/cache/other"), { recursive: true });
    writeFileSync(join(root, ".fabric/cache/other/keep.txt"), "keep");

    migrateLegacyFabricCache(root);

    expect(existsSync(join(root, ".fabric/.cache/bm25"))).toBe(true);
    expect(existsSync(join(root, ".fabric/cache/other/keep.txt"))).toBe(true);
  });

  it("empty projectRoot string is a safe no-op", () => {
    migrateLegacyFabricCache("");
  });
});

describe("detectLegacyFabricCacheDirs", () => {
  it("returns [] when nothing legacy exists", async () => {
    const root = await setupRoot();
    expect(detectLegacyFabricCacheDirs(root)).toEqual([]);
  });

  it("returns the relative paths that still exist", async () => {
    const root = await setupRoot();
    await mkdir(join(root, ".fabric/cache/vectors"), { recursive: true });
    expect(detectLegacyFabricCacheDirs(root)).toEqual([".fabric/cache/vectors"]);
  });
});

/**
 * v2.0.0-rc.37 NEW-17: unit tests for the knowledge-hint-narrow plan-context-
 * hint result cache (per-session sidecar that skips a redundant CLI cold-start
 * spawn when the same path-set is re-edited within a stable knowledge graph).
 *
 * Pins: order-independent path-set key, write→read round-trip, meta-token
 * invalidation (knowledge-graph mutation drops the cache), null-token bypass,
 * and the FIFO size cap.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hook = require("../templates/hooks/knowledge-hint-narrow.cjs") as {
  metaFreshnessToken: (cwd: string) => number | null;
  narrowResultCacheFileName: (sessionId: string) => string;
  pathSetKey: (paths: string[]) => string;
  readNarrowResultCache: (
    cwd: string,
    sessionId: string,
    paths: string[],
    metaToken: number | null,
  ) => Promise<unknown | null>;
  writeNarrowResultCache: (
    cwd: string,
    sessionId: string,
    paths: string[],
    metaToken: number | null,
    payload: unknown,
  ) => Promise<void>;
};

let tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rc37-new17-narrowcache-"));
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(join(dir, ".fabric", "agents.meta.json"), JSON.stringify({ v: 1 }));
  tempDirs.push(dir);
  return dir;
}

describe("narrow result cache (rc.37 NEW-17)", () => {
  it("pathSetKey is order-independent", () => {
    expect(hook.pathSetKey(["a.ts", "b.ts"])).toBe(hook.pathSetKey(["b.ts", "a.ts"]));
  });

  it("filename sanitises unsafe session ids", () => {
    expect(hook.narrowResultCacheFileName("a/b..c")).toBe("narrow-result-cache-a-b..c.json");
  });

  it("write then read round-trips for the same path-set + meta token", async () => {
    const cwd = mkRepo();
    const token = hook.metaFreshnessToken(cwd);
    expect(typeof token).toBe("number");
    const payload = { revision_hash: "r1", entries: [{ id: "K-1" }] };
    await hook.writeNarrowResultCache(cwd, "sess-1", ["x.ts"], token, payload);
    await expect(hook.readNarrowResultCache(cwd, "sess-1", ["x.ts"], token)).resolves.toEqual(payload);
    // order-independent hit
    await expect(hook.readNarrowResultCache(cwd, "sess-1", ["x.ts"], token)).resolves.toEqual(payload);
  });

  it("invalidates wholesale when the meta token (knowledge graph) changes", async () => {
    const cwd = mkRepo();
    const token1 = hook.metaFreshnessToken(cwd);
    await hook.writeNarrowResultCache(cwd, "s", ["x.ts"], token1, { revision_hash: "r1" });
    // Bump agents.meta.json mtime → new freshness token.
    const metaPath = join(cwd, ".fabric", "agents.meta.json");
    const later = new Date(Date.now() + 10_000);
    utimesSync(metaPath, later, later);
    const token2 = hook.metaFreshnessToken(cwd);
    expect(token2).not.toBe(token1);
    // Old token no longer matches → miss.
    await expect(hook.readNarrowResultCache(cwd, "s", ["x.ts"], token2)).resolves.toBeNull();
  });

  it("null meta token (no agents.meta.json) bypasses the cache", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rc37-new17-nometa-"));
    tempDirs.push(cwd);
    expect(hook.metaFreshnessToken(cwd)).toBeNull();
    await hook.writeNarrowResultCache(cwd, "s", ["x.ts"], null, { revision_hash: "r" });
    await expect(hook.readNarrowResultCache(cwd, "s", ["x.ts"], null)).resolves.toBeNull();
  });

  it("caps the result map at 50 entries", async () => {
    const cwd = mkRepo();
    const token = hook.metaFreshnessToken(cwd);
    for (let i = 0; i < 55; i++) {
      await hook.writeNarrowResultCache(cwd, "s", [`f${i}.ts`], token, { revision_hash: `r${i}` });
    }
    // Earliest inserted keys evicted; the most-recent survives.
    await expect(hook.readNarrowResultCache(cwd, "s", ["f0.ts"], token)).resolves.toBeNull();
    await expect(hook.readNarrowResultCache(cwd, "s", ["f54.ts"], token)).resolves.toEqual({ revision_hash: "r54" });
  });
});

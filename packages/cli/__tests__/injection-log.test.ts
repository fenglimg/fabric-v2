import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

// v2.2 HK3-telemetry (W3-T1): injection-side per-inject logger.
const require = createRequire(import.meta.url);
const { logInjection } = require("../templates/hooks/lib/injection-log.cjs") as {
  logInjection: (
    projectRoot: string,
    record: { surface: string; stableIds?: string[]; count?: number; revisionHash?: string | null; ts?: number },
  ) => void;
};

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "fabric-injlog-"));
  tempDirs.push(d);
  return d;
}
function readRows(root: string): Array<Record<string, unknown>> {
  const path = join(root, ".fabric", "injections.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("logInjection (HK3 injection telemetry)", () => {
  it("appends one row with surface/count/stable_ids/revision_hash/ts", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["KT-DEC-0001", "KT-PIT-0002"], revisionHash: "rev-1", ts: 1700000000000 });
    const rows = readRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ts: 1700000000000,
      surface: "broad",
      count: 2,
      stable_ids: ["KT-DEC-0001", "KT-PIT-0002"],
      revision_hash: "rev-1",
    });
  });

  it("appends (does not overwrite) across calls — the per-inject ledger grows", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a"], ts: 1 });
    logInjection(root, { surface: "narrow", stableIds: ["b", "c"], ts: 2 });
    const rows = readRows(root);
    expect(rows.map((r) => r.surface)).toEqual(["broad", "narrow"]);
    expect(rows.map((r) => r.count)).toEqual([1, 2]);
  });

  it("derives count from stableIds when count is omitted", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a", "b", "c"] });
    expect(readRows(root)[0]?.count).toBe(3);
  });

  it("writes no row when nothing was injected (count 0 — keeps the denominator honest)", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: [] });
    expect(readRows(root)).toHaveLength(0);
  });

  it("is best-effort: a bad record or missing surface never throws and writes nothing", () => {
    const root = tmp();
    expect(() => logInjection(root, { surface: undefined as unknown as string, stableIds: ["a"] })).not.toThrow();
    expect(readRows(root)).toHaveLength(0);
  });

  it("filters non-string ids out of stable_ids", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a", 1 as unknown as string, "b"] });
    expect(readRows(root)[0]?.stable_ids).toEqual(["a", "b"]);
  });

  it("drops the row under lock contention rather than risk an interleaved write", () => {
    // ADJ-W3-INJECTION-CONCURRENCY: a fresh lock = another window mid-write.
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a"], ts: 1 }); // creates dir + first row
    const lockPath = join(root, ".fabric", "injections.jsonl.lock");
    writeFileSync(lockPath, ""); // simulate a concurrent holder
    logInjection(root, { surface: "broad", stableIds: ["b"], ts: 2 }); // contended → dropped
    expect(readRows(root).map((r) => r.ts)).toEqual([1]);
    rmSync(lockPath, { force: true });
  });

  it("reclaims a stale lock left by a crashed holder and resumes writing", () => {
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a"], ts: 1 });
    const lockPath = join(root, ".fabric", "injections.jsonl.lock");
    writeFileSync(lockPath, "");
    const oldSec = Date.now() / 1000 - 3600; // 1h ago — well past STALE_LOCK_MS
    utimesSync(lockPath, oldSec, oldSec);
    logInjection(root, { surface: "broad", stableIds: ["b"], ts: 2 }); // stale → reclaimed + written
    expect(readRows(root).map((r) => r.ts)).toEqual([1, 2]);
    expect(existsSync(lockPath)).toBe(false); // released after write
  });

  it("the consumed÷injected hit-rate is computable: injected ids ∩ consumed", () => {
    // Demonstrates the HK3 purpose — injections.jsonl supplies the denominator.
    const root = tmp();
    logInjection(root, { surface: "broad", stableIds: ["a", "b", "c", "d"], ts: 1 });
    const injected = new Set((readRows(root)[0]?.stable_ids as string[]) ?? []);
    const consumed = ["a", "c"]; // from metrics/events side
    const hitRate = consumed.filter((id) => injected.has(id)).length / injected.size;
    expect(hitRate).toBeCloseTo(0.5, 6);
  });
});

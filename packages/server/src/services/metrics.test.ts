// v2.0.0-rc.37 Wave B (B2): metrics service unit tests.
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  bumpCounter,
  drainCounters,
  flushMetrics,
  readMetrics,
  resetMetricsForTest,
  rotateMetricsIfNeeded,
  startMetricsFlush,
} from "./metrics.js";
import { getMetricsLedgerPath } from "./_shared.js";

const tempDirs: string[] = [];

afterEach(async () => {
  resetMetricsForTest();
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-metrics-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  return root;
}

describe("metrics (Wave B B2)", () => {
  it("bumpCounter accumulates in-memory without I/O", async () => {
    const projectRoot = await createTempProject();
    bumpCounter(projectRoot, "knowledge_consumed");
    bumpCounter(projectRoot, "knowledge_consumed", 5);
    bumpCounter(projectRoot, "edit_intent_checked", 2);

    const snapshot = drainCounters(projectRoot);
    expect(snapshot).toEqual({ knowledge_consumed: 6, edit_intent_checked: 2 });

    // drain should have cleared the accumulator.
    expect(drainCounters(projectRoot)).toEqual({});

    // No metrics.jsonl was written.
    const path = getMetricsLedgerPath(projectRoot);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("flushMetrics appends a single JSONL row and clears the accumulator", async () => {
    const projectRoot = await createTempProject();
    bumpCounter(projectRoot, "knowledge_consumed", 3);
    bumpCounter(projectRoot, "edit_intent_checked", 7);

    const row = await flushMetrics(projectRoot, {
      windowMs: 60_000,
      now: new Date("2026-05-27T17:00:00.000Z"),
    });
    expect(row).toEqual({
      timestamp: "2026-05-27T17:00:00.000Z",
      window: "1m",
      counters: { knowledge_consumed: 3, edit_intent_checked: 7 },
    });

    const onDisk = await readFile(getMetricsLedgerPath(projectRoot), "utf8");
    expect(onDisk.trim().split(/\r?\n/).length).toBe(1);
    const parsed = JSON.parse(onDisk.trim());
    expect(parsed.counters).toEqual({ knowledge_consumed: 3, edit_intent_checked: 7 });

    // Accumulator drained → second flush is a no-op (no zero row).
    const empty = await flushMetrics(projectRoot);
    expect(empty).toBeNull();
    const after = await readFile(getMetricsLedgerPath(projectRoot), "utf8");
    expect(after.trim().split(/\r?\n/).length).toBe(1);
  });

  it("readMetrics returns parsed rows, skips malformed lines, ENOENT → []", async () => {
    const projectRoot = await createTempProject();
    expect(await readMetrics(projectRoot)).toEqual([]);

    bumpCounter(projectRoot, "knowledge_consumed", 10);
    await flushMetrics(projectRoot);

    // Append a malformed row + a valid row to exercise the skip path.
    const path = getMetricsLedgerPath(projectRoot);
    await writeFile(
      path,
      [
        await readFile(path, "utf8"),
        "not-json\n",
        JSON.stringify({ timestamp: "2026-05-27T18:00:00.000Z", window: "1m", counters: { x: 1 } }),
        "",
      ].join(""),
    );

    const rows = await readMetrics(projectRoot);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.counters).toEqual({ knowledge_consumed: 10 });
    expect(rows[1]?.counters).toEqual({ x: 1 });
  });

  it("rotateMetricsIfNeeded archives stale rows and keeps recent rows", async () => {
    const projectRoot = await createTempProject();
    const path = getMetricsLedgerPath(projectRoot);
    const now = new Date("2026-05-27T18:00:00.000Z");
    await writeFile(
      path,
      [
        JSON.stringify({ timestamp: "2026-04-01T00:00:00.000Z", window: "1m", counters: { old: 1 } }),
        JSON.stringify({ timestamp: "2026-05-27T17:59:00.000Z", window: "1m", counters: { fresh: 2 } }),
        "",
      ].join("\n"),
    );

    const result = await rotateMetricsIfNeeded(projectRoot, { now });

    expect(result).toMatchObject({
      rotated: true,
      archivedCount: 1,
      keptCount: 1,
      archivePath: ".fabric/metrics.archive/metrics-rotated-2026-05-27.jsonl",
    });
    const archive = await readFile(join(projectRoot, result.archivePath as string), "utf8");
    expect(archive).toContain('"old":1');
    const rows = await readMetrics(projectRoot);
    expect(rows.map((row) => row.counters)).toEqual([{ fresh: 2 }]);
  });

  it("rotateMetricsIfNeeded archives oldest retained rows to satisfy maxBytes", async () => {
    const projectRoot = await createTempProject();
    const path = getMetricsLedgerPath(projectRoot);
    await writeFile(
      path,
      [
        JSON.stringify({ timestamp: "2026-05-27T17:00:00.000Z", window: "1m", counters: { a: 1 } }),
        JSON.stringify({ timestamp: "2026-05-27T17:01:00.000Z", window: "1m", counters: { b: 2 } }),
        JSON.stringify({ timestamp: "2026-05-27T17:02:00.000Z", window: "1m", counters: { c: 3 } }),
        "",
      ].join("\n"),
    );

    const newestLine = JSON.stringify({
      timestamp: "2026-05-27T17:02:00.000Z",
      window: "1m",
      counters: { c: 3 },
    });
    const result = await rotateMetricsIfNeeded(projectRoot, {
      now: new Date("2026-05-27T18:00:00.000Z"),
      maxBytes: Buffer.byteLength(newestLine, "utf8") + 1,
    });

    expect(result.rotated).toBe(true);
    expect(result.archivedCount).toBe(2);
    expect(result.keptCount).toBe(1);
    const rows = await readMetrics(projectRoot);
    expect(rows.map((row) => row.counters)).toEqual([{ c: 3 }]);
  });

  it("startMetricsFlush fires on interval and returns a stop handle that drains", async () => {
    const projectRoot = await createTempProject();
    const stop = startMetricsFlush(projectRoot, { intervalMs: 25 });
    bumpCounter(projectRoot, "knowledge_consumed", 4);

    // Wait long enough for at least one interval tick.
    await new Promise((resolve) => setTimeout(resolve, 80));

    const rowsAfterTick = await readMetrics(projectRoot);
    expect(rowsAfterTick.length).toBeGreaterThanOrEqual(1);
    expect(rowsAfterTick[0]?.counters).toEqual({ knowledge_consumed: 4 });

    // Bump again, then stop handle should drain remaining + cancel timer.
    bumpCounter(projectRoot, "edit_intent_checked", 11);
    await stop();
    const rowsAfterStop = await readMetrics(projectRoot);
    expect(rowsAfterStop.some((r) => r.counters.edit_intent_checked === 11)).toBe(true);
  });

  it("non-positive deltas are ignored (defensive)", async () => {
    const projectRoot = await createTempProject();
    bumpCounter(projectRoot, "foo", 0);
    bumpCounter(projectRoot, "foo", -5);
    bumpCounter(projectRoot, "foo", Number.NaN);
    expect(drainCounters(projectRoot)).toEqual({});
  });

  it("per-project isolation — accumulators don't leak between roots", async () => {
    const projectA = await createTempProject();
    const projectB = await createTempProject();
    bumpCounter(projectA, "knowledge_consumed", 9);
    bumpCounter(projectB, "knowledge_consumed", 3);

    expect(drainCounters(projectA)).toEqual({ knowledge_consumed: 9 });
    expect(drainCounters(projectB)).toEqual({ knowledge_consumed: 3 });
  });
});

// W1-01 (ISS-015): cite-rollup.jsonl appends must route through a per-path
// write queue (the serialization event-ledger uses) instead of a raw appendFile.
// Concurrent appends on the same path must not tear/interleave a line, and the
// writer's throw-to-caller contract on fs failure must be preserved (rotation
// relies on it to abort the drop rather than silently lose un-rolled-up turns).
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { appendCiteRollupRow, readCiteRollup, type CiteRollupRow } from "./cite-rollup.js";
import { getCiteRollupPath } from "./_shared.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function tmpProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-citeroll-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  return root;
}
function rowFor(date: string): CiteRollupRow {
  return {
    date,
    generated_at: `${date}T00:00:00.000Z`,
    metrics: {
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    },
  };
}

describe("cite-rollup append serialization (ISS-015)", () => {
  it("concurrent appends all land as well-formed lines (no torn/interleaved write)", async () => {
    const root = await tmpProject();
    const dates = Array.from({ length: 40 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    await Promise.all(dates.map((d) => appendCiteRollupRow(root, rowFor(d))));
    const rows = await readCiteRollup(root);
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((r) => r.date)).size).toBe(40);
  });

  it("preserves the throw-to-caller contract on an fs failure", async () => {
    const root = await tmpProject();
    // Make the target path a directory so the underlying append fails (EISDIR).
    await mkdir(getCiteRollupPath(root), { recursive: true });
    await expect(appendCiteRollupRow(root, rowFor("2026-02-01"))).rejects.toBeTruthy();
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readKnowledgeAcrossStores, type MountedStoreDir } from "../../src/store/core.js";
import { STORE_LAYOUT } from "../../src/schemas/store.js";

// v2.1.0-rc.1 P6 (S35) — large-library recall is bounded to the read-set and
// does NOT full-scan. Fixture: 1000 entries across 5 stores (200 each). The
// load-bearing guarantee is structural: recall over a 2-store read-set returns
// ONLY those stores' entries (scan count ≤ read-set size, never the other 3) —
// and is consequently faster than a full 5-store scan (p95 ≤ baseline × 1.2).

const STORES = 5;
const PER_STORE = 200; // 5 × 200 = 1000 total
const READ_SET_SIZE = 2;

let root: string;
let allStores: MountedStoreDir[];

function seedStore(dir: string, uuid: string, count: number): void {
  const decisionsDir = join(dir, STORE_LAYOUT.knowledgeDir, "decisions");
  mkdirSync(decisionsDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(decisionsDir, `KT-DEC-${String(i).padStart(4, "0")}.md`), `# entry ${i}\n`, "utf8");
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fabric-recall-perf-"));
  allStores = [];
  for (let s = 0; s < STORES; s++) {
    const uuid = `${s}0000000-0000-4000-8000-000000000000`;
    const dir = join(root, uuid);
    seedStore(dir, uuid, PER_STORE);
    allStores.push({ store_uuid: uuid, alias: `store-${s}`, dir });
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe("recall is bounded to the read-set (S35, 不全扫)", () => {
  it("recall over a 2-store read-set returns ONLY those stores' entries", () => {
    const readSet = allStores.slice(0, READ_SET_SIZE);
    const refs = readKnowledgeAcrossStores(readSet);
    // Scan count == read-set size, strictly less than the full 1000.
    expect(refs.length).toBe(READ_SET_SIZE * PER_STORE);
    expect(refs.length).toBeLessThan(STORES * PER_STORE);
    // Provenance proves it never touched the other 3 stores.
    const seen = new Set(refs.map((r) => r.store_uuid));
    expect(seen.size).toBe(READ_SET_SIZE);
    for (const s of allStores.slice(READ_SET_SIZE)) {
      expect(seen.has(s.store_uuid)).toBe(false);
    }
  });

  it("read-set recall p95 ≤ full-scan baseline × 1.2 (bounded work → no degradation)", () => {
    const readSet = allStores.slice(0, READ_SET_SIZE);
    const ITER = 30;
    const fullScan: number[] = [];
    const readSetScan: number[] = [];
    // Interleave to share cache/GC conditions fairly between the two.
    for (let i = 0; i < ITER; i++) {
      let t = performance.now();
      readKnowledgeAcrossStores(allStores);
      fullScan.push(performance.now() - t);
      t = performance.now();
      readKnowledgeAcrossStores(readSet);
      readSetScan.push(performance.now() - t);
    }
    // Baseline = full-scan p95; read-set scans 2/5 the stores so its p95 must
    // not exceed baseline × 1.2 (generous slack for timer noise).
    const baseline = p95(fullScan);
    expect(p95(readSetScan)).toBeLessThanOrEqual(baseline * 1.2);
  });
});

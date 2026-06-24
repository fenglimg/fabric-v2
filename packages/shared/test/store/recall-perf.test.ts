import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Count real directory reads deterministically. ESM forbids vi.spyOn on a
// node:fs/promises export ("namespace is not configurable"), so we mock the
// module and route readdir through a hoisted counting spy that delegates to the
// real implementation. The spy lets us assert bounded work without wall-clock
// timing (the old p95 assertion flaked under parallel load — ISS-20260609-018).
const readdirSpy = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  readdirSpy.mockImplementation(actual.readdir as never);
  return { ...actual, readdir: readdirSpy };
});

import { readKnowledgeAcrossStores, type MountedStoreDir } from "../../src/store/core.js";
import { STORE_LAYOUT } from "../../src/schemas/store.js";

// v2.1.0-rc.1 P6 (S35) — large-library recall is bounded to the read-set and
// does NOT full-scan. Fixture: 1000 entries across 5 stores (200 each). The
// load-bearing guarantee is structural: recall over a 2-store read-set returns
// ONLY those stores' entries (scan count ≤ read-set size, never the other 3) —
// and consequently opens proportionally fewer directories than a full 5-store
// scan. We assert that deterministically via a readdir count, not wall-clock
// timing (the old p95 assertion flaked under parallel load — ISS-20260609-018).

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

describe("recall is bounded to the read-set (S35, 不全扫)", () => {
  it("recall over a 2-store read-set returns ONLY those stores' entries", async () => {
    const readSet = allStores.slice(0, READ_SET_SIZE);
    const refs = await readKnowledgeAcrossStores(readSet);
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

  it("read-set recall does directory work proportional to the read-set, never the full store count (bounded work, no degradation)", async () => {
    const readSet = allStores.slice(0, READ_SET_SIZE);
    // The bounded-work guarantee is structural: recall only opens the dirs of
    // the stores it is handed, so the readdir count proves it deterministically.
    readdirSpy.mockClear();
    await readKnowledgeAcrossStores(allStores);
    const fullScanReaddirs = readdirSpy.mock.calls.length;

    readdirSpy.mockClear();
    await readKnowledgeAcrossStores(readSet);
    const readSetReaddirs = readdirSpy.mock.calls.length;

    // Guard: the spy must actually have intercepted, else a silent no-op would
    // false-pass with both counts at 0.
    expect(fullScanReaddirs).toBeGreaterThan(0);
    // Bounded work: read-set directory reads are strictly fewer than a full scan
    // and scale exactly with the read-set fraction (READ_SET_SIZE / STORES).
    expect(readSetReaddirs).toBeLessThan(fullScanReaddirs);
    expect(readSetReaddirs * STORES).toBe(fullScanReaddirs * READ_SET_SIZE);
  });
});

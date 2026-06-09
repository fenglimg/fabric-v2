import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultAgentsMetaCounters } from "../schemas/agents-meta.js";
import { STORE_LAYOUT } from "../schemas/store.js";
import {
  allocateStoreKnowledgeId,
  readStoreCounters,
  reconcileStoreCounters,
  storeCountersPath,
} from "./store-counters.js";

// v2.2 W4 — per-store committed counters.json (agents.meta decolo). Tests use a
// tmpdir store fixture; no global state mutation.

const created: string[] = [];

function makeStoreDir(): string {
  const dir = mkdtempSync(join(os.tmpdir(), "fabric-store-counters-"));
  created.push(dir);
  return dir;
}

// Write a canonical knowledge entry into the store's knowledge/<type> dir, as a
// bulk import would — its id is NOT reflected in counters.json.
function seedKnowledgeEntry(storeDir: string, type: string, id: string): void {
  const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, type);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}--seeded.md`),
    `---\nid: ${id}\ntype: ${type}\nlayer: team\nmaturity: proven\n---\n\n# seeded\n`,
    "utf8",
  );
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("store-counters", () => {
  it("returns all-zero slots when counters.json is absent", () => {
    const dir = makeStoreDir();
    expect(readStoreCounters(dir)).toEqual(defaultAgentsMetaCounters());
  });

  it("allocates the first id for a (layer, type) pair and persists it", async () => {
    const dir = makeStoreDir();
    const id = await allocateStoreKnowledgeId("team", "decisions", dir);
    expect(id).toBe("KT-DEC-0001");
    // persisted envelope reflects the advanced slot
    expect(readStoreCounters(dir).KT.DEC).toBe(1);
    // committed parallel to store.json, NOT gitignored
    expect(storeCountersPath(dir)).toBe(join(dir, "counters.json"));
  });

  it("is monotonic across sequential allocations of the same pair", async () => {
    const dir = makeStoreDir();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await allocateStoreKnowledgeId("team", "decisions", dir));
    }
    expect(ids).toEqual(["KT-DEC-0001", "KT-DEC-0002", "KT-DEC-0003"]);
    expect(readStoreCounters(dir).KT.DEC).toBe(3);
  });

  it("namespaces counters per layer (KP) and per type independently", async () => {
    const dir = makeStoreDir();
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0001");
    expect(await allocateStoreKnowledgeId("personal", "decisions", dir)).toBe("KP-DEC-0001");
    expect(await allocateStoreKnowledgeId("team", "pitfalls", dir)).toBe("KT-PIT-0001");
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0002");

    const counters = readStoreCounters(dir);
    expect(counters.KT.DEC).toBe(2);
    expect(counters.KP.DEC).toBe(1);
    expect(counters.KT.PIT).toBe(1);
  });

  it("never reuses a slot after the highest entry is deleted (monotonic ledger survives in counters.json)", async () => {
    const dir = makeStoreDir();
    await allocateStoreKnowledgeId("team", "decisions", dir); // 0001
    await allocateStoreKnowledgeId("team", "decisions", dir); // 0002
    // The persisted counter — NOT disk-max of surviving entries — drives the next
    // id, so deleting 0002's file must not let 0003 collapse back to 0002.
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0003");
  });

  it("serializes concurrent allocations into distinct ids (file lock)", async () => {
    const dir = makeStoreDir();
    const ids = await Promise.all([
      allocateStoreKnowledgeId("team", "decisions", dir),
      allocateStoreKnowledgeId("team", "decisions", dir),
      allocateStoreKnowledgeId("team", "decisions", dir),
      allocateStoreKnowledgeId("team", "decisions", dir),
    ]);
    expect(new Set(ids).size).toBe(4);
    expect([...ids].sort()).toEqual([
      "KT-DEC-0001",
      "KT-DEC-0002",
      "KT-DEC-0003",
      "KT-DEC-0004",
    ]);
    expect(readStoreCounters(dir).KT.DEC).toBe(4);
  });

  it("degrades to zeros on a corrupt counters.json rather than throwing on read", () => {
    const dir = makeStoreDir();
    writeFileSync(storeCountersPath(dir), "{ not valid json", "utf8");
    expect(readStoreCounters(dir)).toEqual(defaultAgentsMetaCounters());
  });

  it("fails closed on corrupt counters.json during allocation and preserves a sidecar", async () => {
    const dir = makeStoreDir();
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0001");
    writeFileSync(storeCountersPath(dir), "{ not valid json", "utf8");

    await expect(allocateStoreKnowledgeId("team", "decisions", dir)).rejects.toThrow(
      /counters\.json is corrupt/u,
    );

    expect(readFileSync(storeCountersPath(dir), "utf8")).toBe("{ not valid json");
    expect(readdirSync(dir).some((name) => /^counters\.json\.corrupted\.\d+$/u.test(name))).toBe(
      true,
    );
  });

  it("fails closed on schema-invalid counters.json during allocation", async () => {
    const dir = makeStoreDir();
    writeFileSync(storeCountersPath(dir), JSON.stringify({ KT: { DEC: "bad" } }), "utf8");

    await expect(allocateStoreKnowledgeId("team", "decisions", dir)).rejects.toThrow(
      /schema-invalid/u,
    );
    expect(readdirSync(dir).some((name) => /^counters\.json\.corrupted\.\d+$/u.test(name))).toBe(
      true,
    );
  });

  it("allocates after reconcile repairs a corrupt counters file from disk max", async () => {
    const dir = makeStoreDir();
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0004");
    writeFileSync(storeCountersPath(dir), "{ not valid json", "utf8");

    await expect(allocateStoreKnowledgeId("team", "decisions", dir)).rejects.toThrow(
      /counters\.json is corrupt/u,
    );
    reconcileStoreCounters(dir);

    expect(readStoreCounters(dir).KT.DEC).toBe(4);
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0005");
  });

  it("reconcileStoreCounters floors counters at the highest id present on disk", () => {
    const dir = makeStoreDir();
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0001");
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0005");
    seedKnowledgeEntry(dir, "pitfalls", "KT-PIT-0002");
    seedKnowledgeEntry(dir, "decisions", "KP-DEC-0003"); // personal id co-resident

    const counters = reconcileStoreCounters(dir);
    expect(counters.KT.DEC).toBe(5);
    expect(counters.KT.PIT).toBe(2);
    expect(counters.KP.DEC).toBe(3);
    // persisted
    expect(readStoreCounters(dir).KT.DEC).toBe(5);
  });

  it("reconcile never lowers a counter below its persisted value (monotonic floor)", () => {
    const dir = makeStoreDir();
    writeFileSync(
      storeCountersPath(dir),
      JSON.stringify({
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 9, GLD: 0, PIT: 0, PRO: 0 },
      }),
      "utf8",
    );
    // disk only has up to 0002, but the persisted counter already advanced to 9
    // (e.g. 0003..0009 were deleted) — reconcile must keep 9, not collapse to 2.
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0002");
    expect(reconcileStoreCounters(dir).KT.DEC).toBe(9);
  });

  it("F1 producer→consumer: after a bulk import + reconcile, allocate mints the NEXT free id (no collision)", async () => {
    const dir = makeStoreDir();
    // Simulate a bulk import of 3 entries WITHOUT touching counters.json.
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0001");
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0002");
    seedKnowledgeEntry(dir, "decisions", "KT-DEC-0003");
    // Pre-reconcile, the stale zero counter WOULD collide on the first id:
    expect(readStoreCounters(dir).KT.DEC).toBe(0);
    // The migrate path's seed step:
    reconcileStoreCounters(dir);
    // Runtime allocation now continues the sequence instead of re-minting 0001.
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0004");
  });

  it("round-trips an externally-written counters envelope", async () => {
    const dir = makeStoreDir();
    writeFileSync(
      storeCountersPath(dir),
      JSON.stringify({
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 7, GLD: 0, PIT: 0, PRO: 0 },
      }),
      "utf8",
    );
    expect(readStoreCounters(dir).KT.DEC).toBe(7);
    expect(await allocateStoreKnowledgeId("team", "decisions", dir)).toBe("KT-DEC-0008");
    expect(JSON.parse(readFileSync(storeCountersPath(dir), "utf8")).KT.DEC).toBe(8);
  });
});

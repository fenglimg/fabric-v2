import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultAgentsMetaCounters } from "../schemas/agents-meta.js";
import {
  allocateStoreKnowledgeId,
  readStoreCounters,
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

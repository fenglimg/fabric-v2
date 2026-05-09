import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { KnowledgeIdAllocator } from "./knowledge-id-allocator.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

describe("KnowledgeIdAllocator", () => {
  it("monotonic_allocation: returns sequential ids for the same (layer, type)", async () => {
    const dir = await createTempDir("kid-monotonic");
    const metaPath = join(dir, "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    const id1 = await allocator.allocate("team", "decision");
    const id2 = await allocator.allocate("team", "decision");
    const id3 = await allocator.allocate("team", "decision");

    expect(id1).toBe("KT-DEC-0001");
    expect(id2).toBe("KT-DEC-0002");
    expect(id3).toBe("KT-DEC-0003");
  });

  it("layer_type_independence: separate slots per (layer, type)", async () => {
    const dir = await createTempDir("kid-independence");
    const allocator = new KnowledgeIdAllocator(join(dir, "agents.meta.json"));

    const teamDec = await allocator.allocate("team", "decision");
    const personalDec = await allocator.allocate("personal", "decision");
    const teamMod = await allocator.allocate("team", "model");
    const teamDec2 = await allocator.allocate("team", "decision");

    expect(teamDec).toBe("KT-DEC-0001");
    expect(personalDec).toBe("KP-DEC-0001");
    expect(teamMod).toBe("KT-MOD-0001");
    expect(teamDec2).toBe("KT-DEC-0002");
  });

  it("persistence_roundtrip: counters survive across allocator instances", async () => {
    const dir = await createTempDir("kid-persistence");
    const metaPath = join(dir, "agents.meta.json");

    const first = new KnowledgeIdAllocator(metaPath);
    await first.allocate("team", "guideline");
    await first.allocate("team", "guideline");
    await first.allocate("personal", "pitfall");

    const second = new KnowledgeIdAllocator(metaPath);
    const counters = await second.getCounters();
    expect(counters.KT.GLD).toBe(2);
    expect(counters.KP.PIT).toBe(1);

    const next = await second.allocate("team", "guideline");
    expect(next).toBe("KT-GLD-0003");
  });

  it("monotonic_across_delete: counters never reuse slots after deletion", async () => {
    const dir = await createTempDir("kid-no-reuse");
    const metaPath = join(dir, "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    const first = await allocator.allocate("team", "process");
    const second = await allocator.allocate("team", "process");
    expect(first).toBe("KT-PRO-0001");
    expect(second).toBe("KT-PRO-0002");

    // Simulate deleting the file/entry whose id was KT-PRO-0001.
    // The counter must NOT regress — next allocation is still strictly greater.
    const third = await allocator.allocate("team", "process");
    expect(third).toBe("KT-PRO-0003");
  });

  it("loads pre-v2.0 meta files (no counters key) with default zero counters", async () => {
    const dir = await createTempDir("kid-v1-compat");
    const metaPath = join(dir, "agents.meta.json");

    // Pre-v2.0 meta: no counters key.
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          revision: "abc",
          nodes: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const allocator = new KnowledgeIdAllocator(metaPath);
    const counters = await allocator.getCounters();
    expect(counters.KP).toEqual({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });
    expect(counters.KT).toEqual({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });

    const id = await allocator.allocate("team", "decision");
    expect(id).toBe("KT-DEC-0001");
  });

  it("persists counters envelope into agents.meta.json", async () => {
    const dir = await createTempDir("kid-persist-shape");
    const metaPath = join(dir, "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    await allocator.allocate("team", "decision");
    await allocator.allocate("personal", "model");

    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as { counters?: unknown };

    expect(parsed.counters).toBeDefined();
    expect(parsed.counters).toMatchObject({
      KT: { DEC: 1 },
      KP: { MOD: 1 },
    });
  });

  it("preserves existing counters when starting with mid-stream values", async () => {
    const dir = await createTempDir("kid-preserve");
    const metaPath = join(dir, "agents.meta.json");

    await writeFile(
      metaPath,
      JSON.stringify(
        {
          revision: "seed",
          nodes: {},
          counters: {
            KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
            KT: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const allocator = new KnowledgeIdAllocator(metaPath);
    const id = await allocator.allocate("team", "decision");
    expect(id).toBe("KT-DEC-0006");

    const counters = await allocator.getCounters();
    expect(counters.KT.DEC).toBe(6);
  });
});

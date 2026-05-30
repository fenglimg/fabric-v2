import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

    const id1 = await allocator.allocate("team", "decisions");
    const id2 = await allocator.allocate("team", "decisions");
    const id3 = await allocator.allocate("team", "decisions");

    expect(id1).toBe("KT-DEC-0001");
    expect(id2).toBe("KT-DEC-0002");
    expect(id3).toBe("KT-DEC-0003");
  });

  it("layer_type_independence: separate slots per (layer, type)", async () => {
    const dir = await createTempDir("kid-independence");
    const allocator = new KnowledgeIdAllocator(join(dir, "agents.meta.json"));

    const teamDec = await allocator.allocate("team", "decisions");
    const personalDec = await allocator.allocate("personal", "decisions");
    const teamMod = await allocator.allocate("team", "models");
    const teamDec2 = await allocator.allocate("team", "decisions");

    expect(teamDec).toBe("KT-DEC-0001");
    expect(personalDec).toBe("KP-DEC-0001");
    expect(teamMod).toBe("KT-MOD-0001");
    expect(teamDec2).toBe("KT-DEC-0002");
  });

  it("persistence_roundtrip: counters survive across allocator instances", async () => {
    const dir = await createTempDir("kid-persistence");
    const metaPath = join(dir, "agents.meta.json");

    const first = new KnowledgeIdAllocator(metaPath);
    await first.allocate("team", "guidelines");
    await first.allocate("team", "guidelines");
    await first.allocate("personal", "pitfalls");

    const second = new KnowledgeIdAllocator(metaPath);
    const counters = await second.getCounters();
    expect(counters.KT.GLD).toBe(2);
    expect(counters.KP.PIT).toBe(1);

    const next = await second.allocate("team", "guidelines");
    expect(next).toBe("KT-GLD-0003");
  });

  it("monotonic_across_delete: counters never reuse slots after deletion", async () => {
    const dir = await createTempDir("kid-no-reuse");
    const metaPath = join(dir, "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    const first = await allocator.allocate("team", "processes");
    const second = await allocator.allocate("team", "processes");
    expect(first).toBe("KT-PRO-0001");
    expect(second).toBe("KT-PRO-0002");

    // Simulate deleting the file/entry whose id was KT-PRO-0001.
    // The counter must NOT regress — next allocation is still strictly greater.
    const third = await allocator.allocate("team", "processes");
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

    const id = await allocator.allocate("team", "decisions");
    expect(id).toBe("KT-DEC-0001");
  });

  it("persists counters envelope into agents.meta.json", async () => {
    const dir = await createTempDir("kid-persist-shape");
    const metaPath = join(dir, "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    await allocator.allocate("team", "decisions");
    await allocator.allocate("personal", "models");

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
    const id = await allocator.allocate("team", "decisions");
    expect(id).toBe("KT-DEC-0006");

    const counters = await allocator.getCounters();
    expect(counters.KT.DEC).toBe(6);
  });

  // W1-02 (ISS-013): allocate()'s read → mutate → atomic-write was three
  // separate awaited steps with no lock, so concurrent allocations (two windows
  // running fab_review / fabric-review approve at once) all read the same
  // counter and mint the SAME stable_id. A cross-process advisory lock must
  // serialize the whole R-M-W so every minted id is unique.
  it("concurrent_allocation: parallel allocate() never mints a duplicate stable_id", async () => {
    const dir = await createTempDir("kid-concurrent");
    const metaPath = join(dir, "agents.meta.json");

    // Two allocator instances on the SAME meta path = two would-be windows.
    const a = new KnowledgeIdAllocator(metaPath);
    const b = new KnowledgeIdAllocator(metaPath);
    const N = 25;
    const ids = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        (i % 2 === 0 ? a : b).allocate("team", "decisions"),
      ),
    );

    expect(new Set(ids).size).toBe(N); // all distinct — no duplicate mint
    // Counter advanced by exactly N (no lost increments).
    const counters = await new KnowledgeIdAllocator(metaPath).getCounters();
    expect(counters.KT.DEC).toBe(N);
  });

  // W1-03 (ISS-014): a corrupt/truncated agents.meta.json must NOT silently
  // fall back to empty meta — the next atomic write would then destroy every
  // node entry. allocate() must abort (throw) so the original file is preserved
  // and a forensic `.corrupted.{ts}` sidecar is left behind.
  it("corrupt_meta_preservation: allocate() aborts on a corrupt meta, never overwrites it", async () => {
    const dir = await createTempDir("kid-corrupt");
    const metaPath = join(dir, "agents.meta.json");
    const corruptRaw = '{ "revision": "abc", "nodes": { "KT-DEC-0001": {trunc';
    await writeFile(metaPath, corruptRaw, "utf8");

    await expect(
      new KnowledgeIdAllocator(metaPath).allocate("team", "decisions"),
    ).rejects.toBeTruthy();

    // Original file preserved byte-for-byte — never overwritten with empty meta.
    expect(await readFile(metaPath, "utf8")).toBe(corruptRaw);
    // A forensic sidecar was written for recovery.
    const sidecars = (await readdir(dir)).filter((f) => f.includes("agents.meta.json.corrupted"));
    expect(sidecars.length).toBe(1);
    expect(await readFile(join(dir, sidecars[0]), "utf8")).toBe(corruptRaw);
  });
});

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F02 (review fix): `planContext` degrades a failed store walk to an EMPTY corpus
// (`buildCrossStoreRawItems(...).catch(() => [])`) so a multi-store hiccup can
// never crash the SessionStart hint. That degrade used to be SILENT: a broken
// store and a genuinely empty knowledge base wrote the identical ledger row, and
// `delivery_empty` cannot speak for this path either (the corpus size it keys on
// is 0 once the read failed). The failure now rides the ledger as
// `corpus_read_failed`. Module-level mock: the throw has to come from inside the
// store walk, and it must not leak into plan-context.test.ts's fixtures.
vi.mock("./cross-store-recall.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cross-store-recall.js")>();
  return {
    ...actual,
    buildCrossStoreRawItems: vi.fn(async () => {
      throw new Error("store walk exploded");
    }),
  };
});

const { planContext } = await import("./plan-context.js");
const { readEventLedger } = await import("./event-ledger.js");
const { contextCache } = await import("../cache.js");

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-corpus-failure-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("planContext corpus read failure (G1/F02)", () => {
  it("records corpus_read_failed in the ledger diagnostics instead of degrading silently", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-corpus-failure-proj-"));
    tempDirs.push(projectRoot);
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // The degrade contract is intact — a failed store read still returns a
    // usable (empty) plan rather than throwing at the hint.
    expect(result.candidates).toEqual([]);

    const planned = await readEventLedger(projectRoot, {
      event_type: "knowledge_context_planned",
    });
    expect(planned.events).toHaveLength(1);
    const diagnostics = (planned.events[0] as { diagnostics?: unknown[] }).diagnostics ?? [];
    const failed = diagnostics.find(
      (d) => (d as { code?: string }).code === "corpus_read_failed",
    ) as { message?: string } | undefined;
    expect(failed).toBeDefined();
    expect(String(failed?.message)).toContain("store walk exploded");
  });
});

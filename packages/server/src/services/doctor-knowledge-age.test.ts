import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTranslator,
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  createOrphanDemoteCheck,
  createStaleArchiveCheck,
  inspectStoreKnowledgeAge,
} from "./doctor-knowledge-age.js";
import { runDoctorReport } from "./doctor.js";

// v2.2 Goal B (G-AGE) — knowledge decay lints. Fixture mirrors
// doctor-scope-lint.test.ts. Age is measured from the injected last-active
// index (events.jsonl-derived). Each case is a producer-consumer round-trip:
// seed an entry + an old "last active" → inspect / run doctor → assert the
// decay lint actually fires (anti-false-green oracle, KT-PIT-0010).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = 1_900_000_000_000; // fixed reference clock for deterministic ages.

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function freshHome(): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-age-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-age-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  return projectRoot;
}

function entryMd(id: string, maturity: "proven" | "verified" | "draft"): string {
  return [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    `maturity: ${maturity}`,
    "summary: fixture entry",
    "---",
    "",
    "# Fixture",
    "",
  ].join("\n");
}

async function seedEntry(fileName: string, id: string, maturity: "proven" | "verified" | "draft"): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE, personal: false }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), entryMd(id, maturity));
}

function mountTeam(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

function ageDaysAgo(days: number): number {
  return NOW - days * MS_PER_DAY;
}

describe("inspectStoreKnowledgeAge — orphan_demote (G-AGE)", () => {
  it("FIRES orphan_demote for a proven entry inactive beyond 90d", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--x.md", "KT-DEC-0001", "proven");
    mountTeam();

    const index = new Map([["KT-DEC-0001", ageDaysAgo(100)]]);
    const result = await inspectStoreKnowledgeAge(projectRoot, NOW, index);
    expect(result.orphanDemote.candidates).toHaveLength(1);
    expect(result.orphanDemote.candidates[0].stable_id).toBe("team:KT-DEC-0001");
    expect(result.orphanDemote.candidates[0].maturity).toBe("proven");
    expect(result.orphanDemote.candidates[0].next_maturity).toBe("verified");
    expect(result.orphanDemote.candidates[0].age_days).toBe(100);
  });

  it("does NOT fire for a proven entry within the 90d threshold", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--x.md", "KT-DEC-0001", "proven");
    mountTeam();

    const index = new Map([["KT-DEC-0001", ageDaysAgo(50)]]);
    const result = await inspectStoreKnowledgeAge(projectRoot, NOW, index);
    expect(result.orphanDemote.candidates).toEqual([]);
  });

  it("uses the verified tier (30d) threshold for verified entries", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0002--y.md", "KT-DEC-0002", "verified");
    mountTeam();

    const fired = await inspectStoreKnowledgeAge(projectRoot, NOW, new Map([["KT-DEC-0002", ageDaysAgo(40)]]));
    expect(fired.orphanDemote.candidates).toHaveLength(1);
    expect(fired.orphanDemote.candidates[0].next_maturity).toBe("draft");

    const clean = await inspectStoreKnowledgeAge(projectRoot, NOW, new Map([["KT-DEC-0002", ageDaysAgo(20)]]));
    expect(clean.orphanDemote.candidates).toEqual([]);
  });

  it("SKIPS entries with no event history (no staleness evidence)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0003--z.md", "KT-DEC-0003", "proven");
    mountTeam();

    const result = await inspectStoreKnowledgeAge(projectRoot, NOW, new Map());
    expect(result.orphanDemote.candidates).toEqual([]);
    expect(result.staleArchive.candidates).toEqual([]);
  });
});

describe("inspectStoreKnowledgeAge — stale_archive (G-AGE)", () => {
  it("FIRES stale_archive for a draft entry quiet beyond demote+90d (>104d)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0004--w.md", "KT-DEC-0004", "draft");
    mountTeam();

    const result = await inspectStoreKnowledgeAge(projectRoot, NOW, new Map([["KT-DEC-0004", ageDaysAgo(120)]]));
    expect(result.staleArchive.candidates).toHaveLength(1);
    expect(result.staleArchive.candidates[0].stable_id).toBe("team:KT-DEC-0004");
    expect(result.staleArchive.candidates[0].archive_path).toContain(".fabric/.archive/decisions/");
  });

  it("does NOT archive a draft within the 104d window (but it IS an orphan)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0005--v.md", "KT-DEC-0005", "draft");
    mountTeam();

    const result = await inspectStoreKnowledgeAge(projectRoot, NOW, new Map([["KT-DEC-0005", ageDaysAgo(50)]]));
    expect(result.staleArchive.candidates).toEqual([]);
    // 50d > draft demote threshold (14d) → still an orphan_demote candidate (terminal draft).
    expect(result.orphanDemote.candidates).toHaveLength(1);
    expect(result.orphanDemote.candidates[0].next_maturity).toBeNull();
  });
});

describe("runDoctorReport round-trip (G-AGE consumer)", () => {
  it("surfaces knowledge_orphan_demote_required as a warning, age from events.jsonl", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--x.md", "KT-DEC-0001", "proven");
    mountTeam();

    // Seed events.jsonl with an old knowledge event so buildLastActiveIndex
    // dates the entry ~200d back (well past the 90d proven threshold).
    const oldTs = Date.now() - 200 * MS_PER_DAY;
    const eventLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:old",
      ts: oldTs,
      schema_version: 1,
      event_type: "knowledge_promoted",
      stable_id: "KT-DEC-0001",
      timestamp: new Date(oldTs).toISOString(),
    });
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), `${eventLine}\n`);

    const report = await runDoctorReport(projectRoot);
    const warning = report.warnings.find((w) => w.code === "knowledge_orphan_demote_required");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("KT-DEC-0001");
  });
});

describe("knowledge-age renderers", () => {
  const t = createTranslator("en");

  it("orphan_demote renderer: ok when empty, warning when populated", () => {
    const thresholds = { proven: 90, verified: 30, draft: 14 };
    expect(createOrphanDemoteCheck(t, { candidates: [], thresholds }).status).toBe("ok");
    const fired = createOrphanDemoteCheck(t, {
      candidates: [{ stable_id: "team:KT-DEC-0001", path: "store:team:KT-DEC-0001", age_days: 100, maturity: "proven", next_maturity: "verified" }],
      thresholds,
    });
    expect(fired.status).toBe("warn");
    expect(fired.code).toBe("knowledge_orphan_demote_required");
  });

  it("stale_archive renderer: ok when empty, warning when populated", () => {
    expect(createStaleArchiveCheck(t, { candidates: [] }).status).toBe("ok");
    const fired = createStaleArchiveCheck(t, {
      candidates: [{ stable_id: "team:KT-DEC-0004", path: "store:team:KT-DEC-0004", age_days: 120, archive_path: ".fabric/.archive/decisions/KT-DEC-0004.md" }],
    });
    expect(fired.status).toBe("warn");
    expect(fired.code).toBe("knowledge_stale_archive_required");
  });
});

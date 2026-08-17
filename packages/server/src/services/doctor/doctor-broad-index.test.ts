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
  createBroadIndexDriftCheck,
  inspectBroadIndexDrift,
} from "./doctor-broad-index.js";
import { runDoctorReport } from "./doctor.js";
import { resolveWriteTargetStoreDir } from "../cross-store-write.js";

// W4-2 (KT-DEC-0028) — broad-index-drift. Producer-consumer round-trip: seed N
// broad-scope store entries + a backstop, inspect / run doctor, assert the
// per-store warning fires exactly at the 80% threshold (anti-false-green, KT-PIT-0014).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
let originalBackstopEnv: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  originalBackstopEnv = process.env.FABRIC_BROAD_INDEX_BACKSTOP;
  delete process.env.FABRIC_BROAD_INDEX_BACKSTOP;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  if (originalBackstopEnv === undefined) {
    delete process.env.FABRIC_BROAD_INDEX_BACKSTOP;
  } else {
    process.env.FABRIC_BROAD_INDEX_BACKSTOP = originalBackstopEnv;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function freshHome(): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-broad-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

// `broad_index_backstop` is a CORPUS-class knob: `env > store > default`, the
// same order `knowledge-hint-broad.cjs` implements and `store-config-cascade.test.ts`
// pins. It describes how many broad entries a STORE holds, so the store is its
// only home — a value left in the repo config is deliberately inert. These
// fixtures therefore mount the store FIRST and write the backstop there; the
// optional `projectBackstop` exists only to prove the repo layer stays inert.
//
// backstop is clamped to [20, 500]; 20 → threshold floor(20*0.8) = 16.
async function createProject(
  backstop?: number,
  opts: { projectBackstop?: number } = {},
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-broad-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(
      {
        project_id: "proj-44444444-4444-4444-8444-444444444444",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
        ...(opts.projectBackstop !== undefined
          ? { broad_index_backstop: opts.projectBackstop }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(projectRoot, "README.md"), "# fixture project\n");
  if (backstop !== undefined) {
    const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
    await mkdir(storeRoot, { recursive: true });
    await writeFile(
      join(storeRoot, STORE_LAYOUT.configFile),
      `${JSON.stringify({ broad_index_backstop: backstop }, null, 2)}\n`,
    );
  }
  return projectRoot;
}

function entryMd(id: string, scope: "narrow" | "broad"): string {
  return [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    "maturity: proven",
    `relevance_scope: ${scope}`,
    scope === "narrow" ? "relevance_paths: [src/x.ts]" : "relevance_paths: []",
    "summary: fixture entry",
    "---",
    "",
    "# Fixture",
    "",
  ].join("\n");
}

async function seedBroadEntries(count: number, scope: "narrow" | "broad" = "broad"): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE, personal: false }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  for (let i = 1; i <= count; i += 1) {
    const id = `KT-DEC-${String(i).padStart(4, "0")}`;
    await writeFile(join(dir, `${id}--x.md`), entryMd(id, scope));
  }
}

function mountTeam(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git", writable: true }],
  });
}

describe("inspectBroadIndexDrift — W4-2 (KT-DEC-0028)", () => {
  it("reads backstop from the store config and computes the 80% threshold", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(20);
    await seedBroadEntries(1);

    const result = await inspectBroadIndexDrift(projectRoot);
    expect(result.backstop).toBe(20);
    expect(result.threshold).toBe(16);
    expect(result.drifted_stores).toHaveLength(0);
  });

  it("FIRES per-store when broad count reaches the threshold (16 of backstop 20)", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(20);
    await seedBroadEntries(16);

    const result = await inspectBroadIndexDrift(projectRoot);
    expect(result.drifted_stores).toHaveLength(1);
    expect(result.drifted_stores[0].store).toBe("team");
    expect(result.drifted_stores[0].broad_count).toBe(16);
  });

  it("does NOT fire just below threshold (15 of backstop 20)", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(20);
    await seedBroadEntries(15);

    const result = await inspectBroadIndexDrift(projectRoot);
    expect(result.drifted_stores).toHaveLength(0);
  });

  it("counts only broad-scope entries (narrow excluded from the index)", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(20);
    await seedBroadEntries(16, "narrow");

    const result = await inspectBroadIndexDrift(projectRoot);
    expect(result.drifted_stores).toHaveLength(0);
  });

  it("falls back to the default backstop 50 when no layer supplies the key", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject();
    await seedBroadEntries(1);

    const result = await inspectBroadIndexDrift(projectRoot);
    expect(result.backstop).toBe(50);
    expect(result.threshold).toBe(40);
  });
});

// 2.5.1 defect #2 — doctor read this CORPUS knob `project > store > default`,
// the inverse of the hook's tested `env > store > default`. Because
// `saveProjectConfig` materializes every zod `.default()` into
// `.fabric/fabric-config.json` on first write, the project layer is never
// absent in practice: doctor therefore always saw 50 and a team store's
// deliberate `broad_index_backstop` could never take effect here, while the hook
// honoured it. Two consumers, same key, opposite answers.
describe("readBroadIndexBackstop cascade — env > store > default (KT-DEC-0028)", () => {
  it("ignores a value left in the repo config (the project layer is inert)", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(undefined, { projectBackstop: 80 });
    await seedBroadEntries(1);

    expect((await inspectBroadIndexDrift(projectRoot)).backstop).toBe(50);
  });

  it("lets the store win over a stale repo value", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(40, { projectBackstop: 80 });
    await seedBroadEntries(1);

    expect((await inspectBroadIndexDrift(projectRoot)).backstop).toBe(40);
  });

  it("lets env override the store", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(40);
    await seedBroadEntries(1);
    process.env.FABRIC_BROAD_INDEX_BACKSTOP = "120";

    expect((await inspectBroadIndexDrift(projectRoot)).backstop).toBe(120);
  });

  it("falls through to the store when env is malformed or out of range", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(40);
    await seedBroadEntries(1);

    process.env.FABRIC_BROAD_INDEX_BACKSTOP = "not-a-number";
    expect((await inspectBroadIndexDrift(projectRoot)).backstop).toBe(40);

    process.env.FABRIC_BROAD_INDEX_BACKSTOP = "5";
    expect((await inspectBroadIndexDrift(projectRoot)).backstop).toBe(40);
  });
});

describe("runDoctorReport round-trip (W4-2 consumer)", () => {
  it("surfaces knowledge_broad_index_drift as a warning", async () => {
    await freshHome();
    mountTeam();
    const projectRoot = await createProject(20);
    await seedBroadEntries(16);

    const report = await runDoctorReport(projectRoot);
    const warning = report.warnings.find((w) => w.code === "knowledge_broad_index_drift");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("team");
  });
});

describe("broad_index_drift renderer", () => {
  const t = createTranslator("en");

  it("ok when no store drifted, warning when populated", () => {
    expect(
      createBroadIndexDriftCheck(t, { backstop: 50, threshold: 40, drifted_stores: [] }).status,
    ).toBe("ok");
    const fired = createBroadIndexDriftCheck(t, {
      backstop: 50,
      threshold: 40,
      drifted_stores: [{ store: "team", broad_count: 42 }],
    });
    expect(fired.status).toBe("warn");
    expect(fired.code).toBe("knowledge_broad_index_drift");
    expect(fired.actionHint).toContain("fabric-review");
  });
});

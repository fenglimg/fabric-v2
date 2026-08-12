import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  computeRelatedInDegree,
  inspectStoreKnowledgePromotion,
} from "./doctor-knowledge-promotion.js";

// v2.2 C1 — knowledge PROMOTION lint. Fixture mirrors doctor-knowledge-age.test.ts.
// Each case is a producer-consumer round-trip (KT-PIT-0014): seed entries that
// POINT at a verified target via `related` (producer) → inspect → assert the
// target IS / IS NOT surfaced as a proven candidate (consumer) so the lint
// cannot false-green on missing wiring.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";

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
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-promo-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-promo-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  return projectRoot;
}

function entryMd(
  id: string,
  maturity: "proven" | "verified" | "draft",
  related: string[] = [],
): string {
  const lines = [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    `maturity: ${maturity}`,
  ];
  if (related.length > 0) {
    lines.push(`related: [${related.join(", ")}]`);
  }
  lines.push("summary: fixture entry", "---", "", "# Fixture", "");
  return lines.join("\n");
}

async function seedEntry(
  fileName: string,
  id: string,
  maturity: "proven" | "verified" | "draft",
  related: string[] = [],
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE, personal: false }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), entryMd(id, maturity, related));
}

function mountTeam(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

// Seed K draft "source" entries each pointing at `target` via related, so the
// target accrues `related` in-degree K.
async function seedInboundEdges(target: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const src = `KT-DEC-90${i}${i}`;
    await seedEntry(`${src}--src.md`, src, "draft", [target]);
  }
}

describe("computeRelatedInDegree", () => {
  it("counts inbound edges and normalizes the optional store-alias prefix", () => {
    const indegree = computeRelatedInDegree([
      { description: { related: ["KT-DEC-0001", "team:KT-DEC-0001"] } },
      { description: { related: ["KT-DEC-0001"] } },
      { description: {} }, // no related → contributes nothing
    ]);
    expect(indegree.get("KT-DEC-0001")).toBe(3);
  });
});

describe("inspectStoreKnowledgePromotion (C1 promotion lint)", () => {
  it("SURFACES a verified entry once its related in-degree reaches the threshold (round-trip)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--target.md", "KT-DEC-0001", "verified");
    await seedInboundEdges("KT-DEC-0001", 3);
    mountTeam();

    const result = await inspectStoreKnowledgePromotion(projectRoot, 3);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].stable_id).toBe("team:KT-DEC-0001");
    expect(result.candidates[0].related_indegree).toBe(3);
  });

  it("does NOT surface a verified entry below the in-degree threshold (anti-false-green)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--target.md", "KT-DEC-0001", "verified");
    await seedInboundEdges("KT-DEC-0001", 2);
    mountTeam();

    const result = await inspectStoreKnowledgePromotion(projectRoot, 3);
    expect(result.candidates).toEqual([]);
  });

  it("does NOT surface a draft entry even when structurally central", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--target.md", "KT-DEC-0001", "draft");
    await seedInboundEdges("KT-DEC-0001", 5);
    mountTeam();

    const result = await inspectStoreKnowledgePromotion(projectRoot, 3);
    expect(result.candidates).toEqual([]);
  });

  it("does NOT surface an already-proven entry", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--target.md", "KT-DEC-0001", "proven");
    await seedInboundEdges("KT-DEC-0001", 5);
    mountTeam();

    const result = await inspectStoreKnowledgePromotion(projectRoot, 3);
    expect(result.candidates).toEqual([]);
  });
});

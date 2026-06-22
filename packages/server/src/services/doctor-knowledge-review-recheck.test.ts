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

import { inspectStoreBroadReviewRecheck } from "./doctor-knowledge-review-recheck.js";

// v2.2 C1 — broad REVIEW-RECHECK lint. Fixture mirrors
// doctor-knowledge-promotion.test.ts. Each case seeds canonical store entries
// carrying a review/created timestamp (producer shape) → inspect → assert the
// broad entry IS / IS NOT surfaced for recheck (consumer), so the lint cannot
// false-green on missing wiring (KT-PIT-0014).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "55555555-5555-5555-8555-555555555555";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-22T00:00:00.000Z");

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
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-recheck-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-recheck-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  return projectRoot;
}

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * MS_PER_DAY).toISOString();
}

// Seed a canonical entry with explicit relevance_scope + optional review/created
// timestamps. summary is required so extractRuleDescription yields a description.
async function seedEntry(
  fileName: string,
  id: string,
  opts: {
    scope: "broad" | "narrow";
    lastReview?: string;
    created?: string;
  },
): Promise<void> {
  const lines = [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    "maturity: verified",
    `relevance_scope: ${opts.scope}`,
  ];
  if (opts.created !== undefined) lines.push(`created_at: ${opts.created}`);
  if (opts.lastReview !== undefined) lines.push(`last_review_confirmed_at: ${opts.lastReview}`);
  lines.push("summary: fixture entry", "---", "", "# Fixture", "");
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE, personal: false }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), lines.join("\n"));
}

function mountTeam(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

describe("inspectStoreBroadReviewRecheck (C1 broad review-recheck lint)", () => {
  it("SURFACES a broad entry whose last_review_confirmed_at is older than the threshold (round-trip)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--stale.md", "KT-DEC-0001", { scope: "broad", lastReview: iso(200) });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].stable_id).toBe("team:KT-DEC-0001");
    expect(result.candidates[0].clock_source).toBe("review");
    expect(result.candidates[0].age_days).toBe(200);
  });

  it("does NOT surface a broad entry re-confirmed within the threshold (anti-false-green)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--fresh.md", "KT-DEC-0001", { scope: "broad", lastReview: iso(30) });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toEqual([]);
  });

  it("does NOT surface a NARROW entry even when long unconfirmed (narrow runs the usage-age clock)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--narrow.md", "KT-DEC-0001", { scope: "narrow", lastReview: iso(400) });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toEqual([]);
  });

  it("falls back to created_at when last_review_confirmed_at is absent (legacy broad entry)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--legacy.md", "KT-DEC-0001", { scope: "broad", created: iso(365) });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].clock_source).toBe("created");
    expect(result.candidates[0].age_days).toBe(365);
  });

  it("prefers last_review_confirmed_at over created_at when BOTH are present", async () => {
    await freshHome();
    const projectRoot = await createProject();
    // created long ago, but recently re-confirmed → the review clock wins → not stale.
    await seedEntry("KT-DEC-0001--both.md", "KT-DEC-0001", {
      scope: "broad",
      created: iso(900),
      lastReview: iso(10),
    });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toEqual([]);
  });

  it("SKIPS a broad entry with NEITHER timestamp (no recheck evidence — conservative)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--undated.md", "KT-DEC-0001", { scope: "broad" });
    mountTeam();

    const result = await inspectStoreBroadReviewRecheck(projectRoot, NOW, 180);
    expect(result.candidates).toEqual([]);
  });
});

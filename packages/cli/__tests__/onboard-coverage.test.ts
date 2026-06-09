/**
 * Unit tests for `fabric onboard-coverage` (rc.23 TASK-014 / F8c).
 *
 * Coverage matrix:
 *   1. Empty workspace → all 5 S5 slots in `missing`, none filled, none opted-out.
 *   2. Fixture with an `onboard_slot` frontmatter line → that slot in `filled`.
 *   3. Fixture with multiple slots filled → only remaining slots in `missing`.
 *   4. fabric-config.json with `onboard_slots_opted_out` → those slots in
 *      `opted_out` AND excluded from `missing`.
 *   5. Off-spec slot value in frontmatter → silently ignored (neither fills
 *      nor counts as missing).
 *   6. `--json` output shape is exactly `{filled, missing, opted_out, total}`
 *      and stable across runs (sorted within filled).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";
import {
  runOnboardCoverage,
  type OnboardCoverageReport,
} from "../src/commands/onboard-coverage.js";

const tempRoots: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = mkdtempSync(join(tmpdir(), "onboard-coverage-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(() => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "onboard-coverage-"));
  tempRoots.push(root);
  return root;
}

function bindTeamStore(root: string): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      {
        store_uuid: TEAM_STORE_UUID,
        alias: "team",
        remote: "git@example.com:team-store.git",
      },
    ],
  });
  writeConfig(root, {
    required_stores: [{ id: "team" }],
  });
}

function seedMountedStoreFile(
  root: string,
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  filename: string,
  frontmatter: Record<string, string>,
): void {
  bindTeamStore(root);
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePath(TEAM_STORE_UUID),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  mkdirSync(dir, { recursive: true });
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("# stub body");
  lines.push("");
  writeFileSync(join(dir, filename), lines.join("\n"), "utf8");
}

function seedKnowledgeFile(
  root: string,
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  filename: string,
  frontmatter: Record<string, string>,
): void {
  const dir = join(root, ".fabric", "knowledge", type);
  mkdirSync(dir, { recursive: true });
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("# stub body");
  lines.push("");
  writeFileSync(join(dir, filename), lines.join("\n"), "utf8");
}

function writeConfig(root: string, content: Record<string, unknown>): void {
  const dir = join(root, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "fabric-config.json"),
    JSON.stringify(content, null, 2),
    "utf8",
  );
}

describe("runOnboardCoverage", () => {
  it("reports all 5 slots missing on an empty workspace", async () => {
    const root = createProject();
    const report = await runOnboardCoverage(root);
    expect(report.total).toBe(5);
    expect(report.missing).toEqual([
      "tech-stack-decision",
      "architecture-pattern",
      "code-style-tone",
      "build-system-idiom",
      "domain-vocabulary",
    ]);
    expect(report.opted_out).toEqual([]);
    for (const slot of [
      "tech-stack-decision",
      "architecture-pattern",
      "code-style-tone",
      "build-system-idiom",
      "domain-vocabulary",
    ] as const) {
      expect(report.filled[slot]).toEqual([]);
    }
  });

  it("places a knowledge file with onboard_slot frontmatter into filled[slot]", async () => {
    const root = createProject();
    seedMountedStoreFile(root, "decisions", "KT-DEC-0042--ts-stack.md", {
      id: "KT-DEC-0042",
      type: "decisions",
      onboard_slot: "tech-stack-decision",
    });
    const report = await runOnboardCoverage(root);
    expect(report.filled["tech-stack-decision"]).toEqual(["team:KT-DEC-0042"]);
    expect(report.missing).not.toContain("tech-stack-decision");
    expect(report.missing).toContain("architecture-pattern");
    expect(report.missing).toHaveLength(4);
  });

  it("aggregates multiple files across all type dirs", async () => {
    const root = createProject();
    seedMountedStoreFile(root, "decisions", "KT-DEC-0001--stack.md", {
      id: "KT-DEC-0001",
      onboard_slot: "tech-stack-decision",
    });
    seedMountedStoreFile(root, "models", "KT-MOD-0001--layout.md", {
      id: "KT-MOD-0001",
      onboard_slot: "architecture-pattern",
    });
    seedMountedStoreFile(root, "guidelines", "KT-GLD-0001--style.md", {
      id: "KT-GLD-0001",
      onboard_slot: "code-style-tone",
    });
    seedMountedStoreFile(root, "processes", "KT-PRO-0001--build.md", {
      id: "KT-PRO-0001",
      onboard_slot: "build-system-idiom",
    });
    const report = await runOnboardCoverage(root);
    expect(report.filled["tech-stack-decision"]).toEqual(["team:KT-DEC-0001"]);
    expect(report.filled["architecture-pattern"]).toEqual(["team:KT-MOD-0001"]);
    expect(report.filled["code-style-tone"]).toEqual(["team:KT-GLD-0001"]);
    expect(report.filled["build-system-idiom"]).toEqual(["team:KT-PRO-0001"]);
    expect(report.filled["domain-vocabulary"]).toEqual([]);
    expect(report.missing).toEqual(["domain-vocabulary"]);
  });

  it("excludes opted-out slots from missing AND surfaces them in opted_out", async () => {
    const root = createProject();
    writeConfig(root, {
      onboard_slots_opted_out: ["architecture-pattern", "domain-vocabulary"],
    });
    const report = await runOnboardCoverage(root);
    expect(report.opted_out).toEqual(["architecture-pattern", "domain-vocabulary"]);
    expect(report.missing).toEqual([
      "tech-stack-decision",
      "code-style-tone",
      "build-system-idiom",
    ]);
  });

  it("silently ignores an off-spec onboard_slot value (not in locked S5 set)", async () => {
    const root = createProject();
    seedMountedStoreFile(root, "decisions", "KT-DEC-9999--bogus.md", {
      id: "KT-DEC-9999",
      onboard_slot: "release-process", // not in S5
    });
    const report = await runOnboardCoverage(root);
    // Off-spec value neither fills any slot nor reduces missing.
    expect(report.missing).toHaveLength(5);
    for (const slot of [
      "tech-stack-decision",
      "architecture-pattern",
      "code-style-tone",
      "build-system-idiom",
      "domain-vocabulary",
    ] as const) {
      expect(report.filled[slot]).toEqual([]);
    }
  });

  it("tolerates a missing fabric-config.json (treats opted_out as empty)", async () => {
    const root = createProject();
    // No fabric-config.json at all.
    const report = await runOnboardCoverage(root);
    expect(report.opted_out).toEqual([]);
    expect(report.missing).toHaveLength(5);
  });

  it("tolerates a malformed fabric-config.json (treats opted_out as empty)", async () => {
    const root = createProject();
    const dir = join(root, ".fabric");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fabric-config.json"), "{ not: valid json", "utf8");
    const report = await runOnboardCoverage(root);
    expect(report.opted_out).toEqual([]);
  });

  it("falls back to the bare filename (without .md) when the id: line is absent", async () => {
    const root = createProject();
    seedMountedStoreFile(root, "decisions", "noid-fallback.md", {
      onboard_slot: "tech-stack-decision",
    });
    const report = await runOnboardCoverage(root);
    expect(report.filled["tech-stack-decision"]).toEqual(["team:noid-fallback"]);
  });

  it("returns a deterministic shape (sorted filled lists, stable slot order)", async () => {
    const root = createProject();
    seedMountedStoreFile(root, "decisions", "z-late.md", {
      id: "KT-DEC-0099",
      onboard_slot: "tech-stack-decision",
    });
    seedMountedStoreFile(root, "decisions", "a-early.md", {
      id: "KT-DEC-0001",
      onboard_slot: "tech-stack-decision",
    });
    const report = await runOnboardCoverage(root);
    // Sorted alphabetically by stable_id.
    expect(report.filled["tech-stack-decision"]).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0099",
    ]);
  });

  it("payload shape matches the documented contract", async () => {
    const root = createProject();
    const report: OnboardCoverageReport = await runOnboardCoverage(root);
    expect(Object.keys(report).sort()).toEqual([
      "filled",
      "missing",
      "opted_out",
      "total",
    ]);
    expect(report.total).toBe(5);
    expect(Object.keys(report.filled).sort()).toEqual([
      "architecture-pattern",
      "build-system-idiom",
      "code-style-tone",
      "domain-vocabulary",
      "tech-stack-decision",
    ]);
  });

  it("does not throw when .fabric/knowledge subtree is entirely absent", async () => {
    const root = createProject();
    // No .fabric/ at all.
    expect(existsSync(join(root, ".fabric"))).toBe(false);
    const report = await runOnboardCoverage(root);
    expect(report.missing).toHaveLength(5);
  });

  it("does not count retired project-local .fabric/knowledge files", async () => {
    const root = createProject();
    seedKnowledgeFile(root, "decisions", "KT-DEC-7777--legacy.md", {
      id: "KT-DEC-7777",
      onboard_slot: "tech-stack-decision",
    });

    const report = await runOnboardCoverage(root);

    expect(report.filled["tech-stack-decision"]).toEqual([]);
    expect(report.missing).toContain("tech-stack-decision");
  });
});

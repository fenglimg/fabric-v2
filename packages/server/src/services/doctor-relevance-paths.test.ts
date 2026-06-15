import { execFileSync } from "node:child_process";
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
  createRelevancePathsDanglingCheck,
  createRelevancePathsDriftCheck,
  inspectStoreRelevancePaths,
} from "./doctor-relevance-paths.js";
import { runDoctorReport } from "./doctor.js";

// v2.2 Goal B (G-RELEVANCE) — store relevance_paths hygiene. Fixture mirrors
// doctor-scope-lint.test.ts. Each case is a producer-consumer round-trip: seed
// a store entry whose relevance_paths SHOULD trip dangling / drift → inspect /
// run doctor → assert it actually fires (anti-false-green oracle, KT-PIT-0010).

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
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-rel-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-rel-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  // A real workspace always has non-ignored files; the dangling lint skips a
  // workspace whose scan yields nothing (defensive against an unscannable root),
  // so seed a baseline file to make the fixture representative.
  await writeFile(join(projectRoot, "README.md"), "# fixture project\n");
  return projectRoot;
}

function entryMd(id: string, scope: "narrow" | "broad", relevancePaths: string[]): string {
  return [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    "maturity: proven",
    `relevance_scope: ${scope}`,
    `relevance_paths: [${relevancePaths.join(", ")}]`,
    "summary: fixture entry",
    "---",
    "",
    "# Fixture",
    "",
  ].join("\n");
}

async function seedEntry(
  fileName: string,
  id: string,
  scope: "narrow" | "broad",
  relevancePaths: string[],
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE, personal: false }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), entryMd(id, scope, relevancePaths));
}

function mountTeam(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

function git(projectRoot: string, args: string[]): void {
  execFileSync("git", args, { cwd: projectRoot, stdio: "ignore" });
}

// Initialize a git repo and commit one file so `git log --since` has history.
async function initGitWithCommit(projectRoot: string, committedFile: string): Promise<void> {
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "t@e.com"]);
  git(projectRoot, ["config", "user.name", "t"]);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, committedFile), "export const a = 1;\n");
  git(projectRoot, ["add", "."]);
  git(projectRoot, ["commit", "-m", "seed", "--no-gpg-sign"]);
}

describe("inspectStoreRelevancePaths — dangling (G-RELEVANCE)", () => {
  it("FIRES dangling when a relevance_paths glob matches zero workspace files", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--x.md", "KT-DEC-0001", "narrow", ["src/ghost.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.dangling.entries).toHaveLength(1);
    expect(result.dangling.entries[0].stable_id).toBe("team:KT-DEC-0001");
    expect(result.dangling.entries[0].dangling_glob).toBe("src/ghost.ts");
  });

  it("does NOT flag dangling when the glob resolves to an existing file", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "real.ts"), "export const r = 1;\n");
    await seedEntry("KT-DEC-0002--y.md", "KT-DEC-0002", "narrow", ["src/real.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.dangling.entries).toEqual([]);
  });
});

describe("inspectStoreRelevancePaths — drift (G-RELEVANCE)", () => {
  it("FIRES drift for a narrow entry whose anchors exist but weren't touched in git", async () => {
    await freshHome();
    const projectRoot = await createProject();
    // committed file = recently touched; quiet file exists on disk but is
    // untracked → not in `git log --name-only`, so the anchor has drifted.
    await initGitWithCommit(projectRoot, "src/active.ts");
    await writeFile(join(projectRoot, "src", "quiet.ts"), "export const q = 1;\n");
    await seedEntry("KT-DEC-0003--z.md", "KT-DEC-0003", "narrow", ["src/quiet.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.drift.git_available).toBe(true);
    const candidate = result.drift.candidates.find((c) => c.stable_id === "team:KT-DEC-0003");
    expect(candidate).toBeDefined();
    expect(candidate?.globs).toEqual(["src/quiet.ts"]);
  });

  it("does NOT flag drift when an anchor matches a recently-touched file", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await initGitWithCommit(projectRoot, "src/active.ts");
    await seedEntry("KT-DEC-0004--w.md", "KT-DEC-0004", "narrow", ["src/active.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.drift.git_available).toBe(true);
    expect(result.drift.candidates.find((c) => c.stable_id === "team:KT-DEC-0004")).toBeUndefined();
  });

  it("downgrades drift to git_available=false when the workspace is not a git repo", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0005--v.md", "KT-DEC-0005", "narrow", ["src/whatever.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.drift.git_available).toBe(false);
    expect(result.drift.candidates).toEqual([]);
  });

  it("ignores broad-scope entries for drift (only narrow anchors decay)", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await initGitWithCommit(projectRoot, "src/active.ts");
    await seedEntry("KT-DEC-0006--b.md", "KT-DEC-0006", "broad", ["src/quiet.ts"]);
    mountTeam();

    const result = await inspectStoreRelevancePaths(projectRoot);
    expect(result.drift.candidates.find((c) => c.stable_id === "team:KT-DEC-0006")).toBeUndefined();
  });
});

describe("runDoctorReport round-trip (G-RELEVANCE consumer)", () => {
  it("surfaces knowledge_relevance_paths_dangling as a warning", async () => {
    await freshHome();
    const projectRoot = await createProject();
    await seedEntry("KT-DEC-0001--x.md", "KT-DEC-0001", "narrow", ["src/ghost.ts"]);
    mountTeam();

    const report = await runDoctorReport(projectRoot);
    const warning = report.warnings.find((w) => w.code === "knowledge_relevance_paths_dangling");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("src/ghost.ts");
  });
});

describe("relevance renderers", () => {
  const t = createTranslator("en");

  it("dangling renderer: ok when empty, warning when populated", () => {
    expect(createRelevancePathsDanglingCheck(t, { entries: [] }).status).toBe("ok");
    const fired = createRelevancePathsDanglingCheck(t, {
      entries: [{ stable_id: "team:KT-DEC-0001", path: "store:team:KT-DEC-0001", dangling_glob: "src/ghost.ts" }],
    });
    expect(fired.status).toBe("warn");
    expect(fired.code).toBe("knowledge_relevance_paths_dangling");
  });

  it("drift renderer: skipped when git unavailable, info when populated", () => {
    expect(createRelevancePathsDriftCheck(t, { candidates: [], git_available: false }).status).toBe("ok");
    const fired = createRelevancePathsDriftCheck(t, {
      candidates: [{ stable_id: "team:KT-DEC-0001", path: "store:team:KT-DEC-0001", globs: ["src/quiet.ts"] }],
      git_available: true,
    });
    expect(fired.kind).toBe("info");
    expect(fired.code).toBe("knowledge_relevance_paths_drift");
  });
});

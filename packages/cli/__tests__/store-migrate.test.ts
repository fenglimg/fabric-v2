import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storeRelativePathForMount } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { runGlobalInstall } from "../src/install/run-global-install.js";
import { storeCreate } from "../src/store/store-ops.js";
import { migrateProjectKnowledge } from "../src/store/store-migrate.js";

// v2.2 全砍 Stage 1 — `fabric store migrate` (project dual-root → store).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function entry(id: string, type: string, body = "x"): string {
  return `---\nid: ${id}\ntype: ${type}\nmaturity: proven\nlayer: team\nlayer_reason: t\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n# ${id}\n\n${body}\n`;
}

// Scaffold: a global home with a team store + personal store, and a project
// whose dual-root .fabric/knowledge holds team entries to migrate.
async function scaffold(opts: { seedTeamId?: string } = {}): Promise<{
  globalRoot: string;
  projectRoot: string;
  teamDir: string;
}> {
  const globalRoot = join(tmp("fabric-mig-"), ".fabric");
  await runGlobalInstall(
    { uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-01-01T00:00:00.000Z" },
    globalRoot,
  );
  storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
  const teamDir = join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM, mount_name: "team" }));
  if (opts.seedTeamId !== undefined) {
    writeFileSync(
      join(teamDir, "knowledge", "decisions", `${opts.seedTeamId}.md`),
      entry(opts.seedTeamId, "decision", "pre-existing"),
      "utf8",
    );
  }

  const projectRoot = tmp("fabric-proj-");
  mkdirSync(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2),
    "utf8",
  );
  return { globalRoot, projectRoot, teamDir };
}

function writeSource(projectRoot: string, id: string): void {
  writeFileSync(
    join(projectRoot, ".fabric", "knowledge", "decisions", `${id}.md`),
    entry(id, "decision"),
    "utf8",
  );
}

describe("store migrate", () => {
  it("dry-run plans the move but writes nothing", async () => {
    const { globalRoot, projectRoot, teamDir } = await scaffold();
    writeSource(projectRoot, "KT-DEC-0001");

    const report = migrateProjectKnowledge(projectRoot, { globalRoot, dryRun: true, git: false });

    expect(report.dryRun).toBe(true);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].oldId).toBe("KT-DEC-0001");
    // Nothing written: source intact, target store decisions dir still empty.
    expect(existsSync(join(projectRoot, ".fabric", "knowledge", "decisions", "KT-DEC-0001.md"))).toBe(
      true,
    );
    expect(readdirSync(join(teamDir, "knowledge", "decisions"))).toHaveLength(0);
  });

  it("moves entries into the store and removes the source (no collision keeps id)", async () => {
    const { globalRoot, projectRoot, teamDir } = await scaffold();
    writeSource(projectRoot, "KT-DEC-0001");
    writeSource(projectRoot, "KT-DEC-0002");

    const report = migrateProjectKnowledge(projectRoot, { globalRoot, git: false });

    expect(report.items).toHaveLength(2);
    expect(report.remap).toEqual({});
    // Source removed, target populated with ids preserved.
    expect(existsSync(join(projectRoot, ".fabric", "knowledge", "decisions", "KT-DEC-0001.md"))).toBe(
      false,
    );
    expect(existsSync(join(teamDir, "knowledge", "decisions", "KT-DEC-0001.md"))).toBe(true);
    expect(existsSync(join(teamDir, "knowledge", "decisions", "KT-DEC-0002.md"))).toBe(true);
  });

  it("is idempotent — a second run finds nothing to migrate", async () => {
    const { globalRoot, projectRoot } = await scaffold();
    writeSource(projectRoot, "KT-DEC-0001");

    migrateProjectKnowledge(projectRoot, { globalRoot, git: false });
    const second = migrateProjectKnowledge(projectRoot, { globalRoot, git: false });

    expect(second.items).toHaveLength(0);
  });

  it("remaps stable_id on target-store collision and rewrites frontmatter", async () => {
    const { globalRoot, projectRoot, teamDir } = await scaffold({ seedTeamId: "KT-DEC-0001" });
    writeSource(projectRoot, "KT-DEC-0001");

    const report = migrateProjectKnowledge(projectRoot, { globalRoot, git: false });

    expect(report.items[0].newId).toBe("KT-DEC-0002");
    expect(report.remap).toEqual({ "KT-DEC-0001": "KT-DEC-0002" });
    // Both entries now live in the store, the pre-existing one untouched.
    expect(readFileSync(join(teamDir, "knowledge", "decisions", "KT-DEC-0001.md"), "utf8")).toContain(
      "pre-existing",
    );
    const migrated = readFileSync(
      join(teamDir, "knowledge", "decisions", "KT-DEC-0002.md"),
      "utf8",
    );
    expect(migrated).toContain("id: KT-DEC-0002");
    expect(migrated).not.toContain("id: KT-DEC-0001");
  });

  it("skips when no write-target store is resolvable", async () => {
    const { globalRoot, projectRoot } = await scaffold();
    // Remove the active_write_store so team scope has no target.
    writeFileSync(
      join(projectRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2),
      "utf8",
    );
    writeSource(projectRoot, "KT-DEC-0001");

    const report = migrateProjectKnowledge(projectRoot, { globalRoot, git: false });

    expect(report.items).toHaveLength(0);
    expect(report.skips).toHaveLength(1);
    expect(report.skips[0].reason).toContain("no team write-target store");
  });
});

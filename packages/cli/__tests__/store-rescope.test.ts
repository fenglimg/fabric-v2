import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { STORE_LAYOUT } from "@fenglimg/fabric-shared";

import { promoteProjectToTeam, rescopeStore } from "../src/store/store-rescope.js";

// v2.2 W4 (G-GUARD / A7) — re-scope + promote. Tests operate on a tmpdir store
// fixture (knowledge/<type>/*.md + projects.json); no global state.

const created: string[] = [];

function makeStoreDir(): string {
  const dir = mkdtempSync(join(os.tmpdir(), "fabric-rescope-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function seedEntry(storeDir: string, id: string, semanticScope: string): string {
  const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, "decisions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}--fixture.md`);
  writeFileSync(
    file,
    [
      "---",
      `id: ${id}`,
      "type: decision",
      "layer: team",
      `semantic_scope: ${semanticScope}`,
      'visibility_store: "team"',
      "maturity: proven",
      "---",
      "",
      "# Fixture",
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

function registerProjects(storeDir: string, ids: string[]): void {
  writeFileSync(
    join(storeDir, STORE_LAYOUT.projectsFile),
    JSON.stringify({ projects: ids.map((id) => ({ id, created_at: "2026-06-04T00:00:00.000Z" })) }),
    "utf8",
  );
}

function scopeOf(file: string): string | undefined {
  return /^semantic_scope:\s*(\S+)\s*$/mu.exec(readFileSync(file, "utf8"))?.[1];
}

describe("rescopeStore / promoteProjectToTeam (G-GUARD / A7)", () => {
  it("re-scopes a single entry by id and rewrites the frontmatter in place", async () => {
    const dir = makeStoreDir();
    registerProjects(dir, ["alpha"]);
    const file = seedEntry(dir, "KT-DEC-9001", "project:alpha");

    const report = await rescopeStore(dir, "team", { id: "KT-DEC-9001", storeVisibility: "shared" });
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toMatchObject({ fromScope: "project:alpha", toScope: "team" });
    expect(scopeOf(file)).toBe("team");
  });

  it("promote absorbs every project:* entry into team scope", async () => {
    const dir = makeStoreDir();
    registerProjects(dir, ["alpha", "beta"]);
    const a = seedEntry(dir, "KT-DEC-9001", "project:alpha");
    const b = seedEntry(dir, "KT-DEC-9002", "project:beta");
    const t = seedEntry(dir, "KT-DEC-9003", "team"); // already team — untouched

    const report = await promoteProjectToTeam(dir, { storeVisibility: "shared" });
    expect(report.changes).toHaveLength(2);
    expect(scopeOf(a)).toBe("team");
    expect(scopeOf(b)).toBe("team");
    expect(scopeOf(t)).toBe("team");
  });

  it("promote can target a single project, leaving other projects untouched", async () => {
    const dir = makeStoreDir();
    registerProjects(dir, ["alpha", "beta"]);
    const a = seedEntry(dir, "KT-DEC-9001", "project:alpha");
    const b = seedEntry(dir, "KT-DEC-9002", "project:beta");

    const report = await promoteProjectToTeam(dir, { projectId: "alpha", storeVisibility: "shared" });
    expect(report.changes).toHaveLength(1);
    expect(scopeOf(a)).toBe("team");
    expect(scopeOf(b)).toBe("project:beta");
  });

  it("refuses re-scoping to personal inside a shared store (R5#3) and leaves the file intact", async () => {
    const dir = makeStoreDir();
    const file = seedEntry(dir, "KT-DEC-9001", "team");

    const report = await rescopeStore(dir, "personal", { id: "KT-DEC-9001", storeVisibility: "shared" });
    expect(report.changes).toHaveLength(0);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0].reason).toContain("R5#3");
    expect(scopeOf(file)).toBe("team");
  });

  it("refuses creating a dangling project ref (target project not registered)", async () => {
    const dir = makeStoreDir();
    registerProjects(dir, ["alpha"]);
    const file = seedEntry(dir, "KT-DEC-9001", "team");

    const report = await rescopeStore(dir, "project:ghost", { id: "KT-DEC-9001", storeVisibility: "shared" });
    expect(report.changes).toHaveLength(0);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0].reason).toContain("ghost");
    expect(scopeOf(file)).toBe("team");
  });

  it("dry-run reports the change but writes nothing", async () => {
    const dir = makeStoreDir();
    registerProjects(dir, ["alpha"]);
    const file = seedEntry(dir, "KT-DEC-9001", "project:alpha");

    const report = await rescopeStore(dir, "team", { id: "KT-DEC-9001", storeVisibility: "shared", dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.changes).toHaveLength(1);
    expect(scopeOf(file)).toBe("project:alpha"); // untouched on disk
  });

  it("counts entries already at the target scope as unchanged", async () => {
    const dir = makeStoreDir();
    seedEntry(dir, "KT-DEC-9001", "team");

    const report = await rescopeStore(dir, "team", { storeVisibility: "shared" });
    expect(report.changes).toHaveLength(0);
    expect(report.unchanged).toBe(1);
  });
});

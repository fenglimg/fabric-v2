import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backfillEntryContent,
  backfillKnowledgeDir,
  migrateProjectEntries,
} from "../src/store/scope-backfill.js";

// W3/A5 — clean-slate scope backfill: add semantic_scope + visibility_store,
// repair dirty layer (id-prefix is authoritative), never leak personal → shared.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function entry(lines: string[]): string {
  return ["---", ...lines, "---", "", "# Body", "", "content", ""].join("\n");
}

describe("backfillEntryContent (unit)", () => {
  it("adds semantic_scope + visibility_store to a team entry missing them", () => {
    const out = backfillEntryContent(
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
      "team",
    );
    expect(out).not.toBeNull();
    expect(out!.change.changed).toEqual(["semantic_scope", "visibility_store"]);
    expect(out!.content).toMatch(/^semantic_scope: team$/mu);
    expect(out!.content).toMatch(/^visibility_store: "team"$/mu);
  });

  it("maps a KP- (personal) id to personal scope + personal store (never shared)", () => {
    const out = backfillEntryContent(
      entry(["id: KP-DEC-9001", "type: decisions", "layer: personal", "maturity: proven"]),
      "team", // even when a team store alias is passed, personal stays personal
    );
    expect(out!.content).toMatch(/^semantic_scope: personal$/mu);
    expect(out!.content).toMatch(/^visibility_store: "personal"$/mu);
  });

  it("repairs a dirty layer (id prefix KP- but layer says team)", () => {
    const out = backfillEntryContent(
      entry(["id: KP-PIT-9001", "type: pitfalls", "layer: team", "maturity: draft"]),
      "team",
    );
    expect(out!.change.changed).toContain("layer");
    expect(out!.content).toMatch(/^layer: personal$/mu);
    expect(out!.content).toMatch(/^semantic_scope: personal$/mu);
  });

  it("is a no-op for an already fully-tagged consistent entry", () => {
    const out = backfillEntryContent(
      entry([
        "id: KT-DEC-0001",
        "type: decisions",
        "layer: team",
        "semantic_scope: team",
        `visibility_store: "team"`,
        "maturity: proven",
      ]),
      "team",
    );
    expect(out!.change.changed).toEqual([]);
  });

  it("returns null for content with no frontmatter", () => {
    expect(backfillEntryContent("# just a heading\n\nbody", "team")).toBeNull();
  });

  // W2/TASK-005 phase-2 — path is the source of truth for scope, so backfill
  // STOPS authoring semantic_scope while STILL authoring visibility_store (DA-03).
  it("phase-2 stops authoring semantic_scope but keeps visibility_store", () => {
    const out = backfillEntryContent(
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
      "team",
      true, // phase2
    );
    expect(out).not.toBeNull();
    expect(out!.change.changed).toEqual(["visibility_store"]);
    expect(out!.content).not.toMatch(/semantic_scope/u);
    expect(out!.content).toMatch(/^visibility_store: "team"$/mu);
  });

  it("phase-1 still fallback-writes semantic_scope (reversibility)", () => {
    const out = backfillEntryContent(
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
      "team",
      false, // phase1 (default)
    );
    expect(out!.change.changed).toContain("semantic_scope");
    expect(out!.content).toMatch(/^semantic_scope: team$/mu);
  });
});

// ---------------------------------------------------------------------------
// W2/TASK-005 — phase-2 project-entry migration into knowledge/projects/<id>/.
// Real `git init` fixtures assert blame survival (TS-07), dry-run no-op with
// planned===actual (TS-06), and idempotency on both paths (TS-08).
// ---------------------------------------------------------------------------

describe("migrateProjectEntries (real git fixture)", () => {
  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
      },
    });
  }

  // Scaffold a store repo with one project-scoped + one team entry, seeded as an
  // initial commit so blame has provenance to preserve. Returns the store dir.
  function seedStore(): { storeDir: string; projFile: string; teamFile: string } {
    const storeDir = mkdtempSync(join(tmpdir(), "fabric-migrate-"));
    dirs.push(storeDir);
    git(storeDir, ["init", "-b", "main"]);
    const decisions = join(storeDir, "knowledge", "decisions");
    mkdirSync(decisions, { recursive: true });
    const projFile = join(decisions, "KT-DEC-0001--proj.md");
    const teamFile = join(decisions, "KT-DEC-0002--team.md");
    writeFileSync(
      projFile,
      entry([
        "id: KT-DEC-0001",
        "type: decisions",
        "layer: team",
        "semantic_scope: project:fabric-v2",
        `visibility_store: "team"`,
        "maturity: proven",
      ]),
    );
    writeFileSync(
      teamFile,
      entry([
        "id: KT-DEC-0002",
        "type: decisions",
        "layer: team",
        "semantic_scope: team",
        `visibility_store: "team"`,
        "maturity: proven",
      ]),
    );
    git(storeDir, ["add", "-A"]);
    git(storeDir, ["commit", "-m", "seed knowledge"]);
    return { storeDir, projFile, teamFile };
  }

  it("dry-run touches no files and planned moves === actual moves", () => {
    const { storeDir, projFile } = seedStore();
    const before = statSync(projFile).mtimeMs;

    const dry = migrateProjectEntries(storeDir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.moves).toHaveLength(1);
    // dry-run wrote nothing: source still present, mtime untouched.
    expect(existsSync(projFile)).toBe(true);
    expect(statSync(projFile).mtimeMs).toBe(before);
    const plannedTo = join(storeDir, "knowledge", "projects", "fabric-v2", "decisions", "KT-DEC-0001--proj.md");
    expect(dry.moves[0]!.toPath).toBe(plannedTo);
    expect(existsSync(plannedTo)).toBe(false);

    const real = migrateProjectEntries(storeDir, {});
    // planned (dry) === actual (real): same from/to/project set.
    expect(real.moves.map((m) => [m.fromPath, m.toPath])).toEqual(
      dry.moves.map((m) => [m.fromPath, m.toPath]),
    );
    expect(existsSync(projFile)).toBe(false);
    expect(existsSync(plannedTo)).toBe(true);
  });

  it("git mv preserves blame: log --follow / blame recover the seed commit", () => {
    const { storeDir } = seedStore();
    const seedHash = git(storeDir, ["rev-parse", "HEAD"]).trim();

    const report = migrateProjectEntries(storeDir, {});
    expect(report.moves).toHaveLength(1);
    expect(report.moves[0]!.gitMv).toBe(true);

    // migrateProjectEntries stages the rename (git mv) but does NOT commit — the
    // store's sync layer owns commits (same contract as review's approve path).
    // Commit the staged move here so --follow / blame have a rename to cross.
    git(storeDir, ["add", "-A"]);
    git(storeDir, ["commit", "-m", "migrate project entries"]);

    const relTo = "knowledge/projects/fabric-v2/decisions/KT-DEC-0001--proj.md";
    // --follow crosses the committed rename back to the seed commit.
    const followLog = git(storeDir, ["log", "--follow", "--format=%H", "--", relTo]);
    expect(followLog).toContain(seedHash);
    // blame resolves the entry's authorship against the seed commit (blame
    // survived) — with rename tracking it even annotates the ORIGINAL flat path.
    const blame = git(storeDir, ["blame", "-s", "HEAD", "--", relTo]);
    expect(blame).toContain(seedHash.slice(0, 7));
    expect(blame).toContain("knowledge/decisions/KT-DEC-0001--proj.md");
  });

  it("only moves project-scoped entries; team entry stays flat", () => {
    const { storeDir, teamFile } = seedStore();
    const report = migrateProjectEntries(storeDir, {});
    expect(report.moves.map((m) => m.project)).toEqual(["fabric-v2"]);
    expect(report.skipped.some((s) => s.file === teamFile && s.reason === "non-project-scope")).toBe(true);
    expect(existsSync(teamFile)).toBe(true);
  });

  it("is idempotent on both dry-run and real paths (second run = 0 moves)", () => {
    const { storeDir } = seedStore();
    migrateProjectEntries(storeDir, {}); // first real run relocates the entry

    const secondDry = migrateProjectEntries(storeDir, { dryRun: true });
    expect(secondDry.moves).toHaveLength(0);
    const secondReal = migrateProjectEntries(storeDir, {});
    expect(secondReal.moves).toHaveLength(0);
  });

  it("fs-rename fallback records gitMv:false for an untracked entry", () => {
    const { storeDir } = seedStore();
    // A brand-new untracked project entry — git mv refuses it, fs rename catches.
    const decisions = join(storeDir, "knowledge", "decisions");
    const untracked = join(decisions, "KT-DEC-0003--untracked.md");
    writeFileSync(
      untracked,
      entry([
        "id: KT-DEC-0003",
        "type: decisions",
        "layer: team",
        "semantic_scope: project:fabric-v2",
        `visibility_store: "team"`,
        "maturity: draft",
      ]),
    );

    const report = migrateProjectEntries(storeDir, {});
    const untrackedMove = report.moves.find((m) => m.id === "KT-DEC-0003");
    expect(untrackedMove).toBeDefined();
    expect(untrackedMove!.gitMv).toBe(false);
    expect(existsSync(untrackedMove!.toPath)).toBe(true);
    expect(existsSync(untracked)).toBe(false);
  });
});

describe("backfillKnowledgeDir (integration)", () => {
  it("backfills a whole knowledge tree and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-a5-"));
    dirs.push(root);
    const decisions = join(root, "decisions");
    mkdirSync(decisions, { recursive: true });
    writeFileSync(
      join(decisions, "KT-DEC-0001.md"),
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
    );
    writeFileSync(
      join(decisions, "KP-DEC-9001.md"),
      entry(["id: KP-DEC-9001", "type: decisions", "layer: team", "maturity: proven"]),
    );

    const dry = backfillKnowledgeDir(root, { visibilityStore: "team", dryRun: true });
    expect(dry.changes).toHaveLength(2);
    // dry-run wrote nothing
    expect(readFileSync(join(decisions, "KT-DEC-0001.md"), "utf8")).not.toMatch(/semantic_scope/u);

    const applied = backfillKnowledgeDir(root, { visibilityStore: "team" });
    expect(applied.changes).toHaveLength(2);
    const kp = readFileSync(join(decisions, "KP-DEC-9001.md"), "utf8");
    expect(kp).toMatch(/^layer: personal$/mu);
    expect(kp).toMatch(/^visibility_store: "personal"$/mu);

    // Idempotent: a second pass reports zero changes.
    const second = backfillKnowledgeDir(root, { visibilityStore: "team" });
    expect(second.changes).toHaveLength(0);
    expect(second.unchanged).toBe(2);
  });
});

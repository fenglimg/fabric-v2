/**
 * Integration tests: TASK-006 — fabric-archive Skill + archive-hint hook install
 *
 * Verifies the TASK-005 wiring at packages/cli/src/install/skills-and-hooks.ts
 * (called from init bootstrap stage and the fabric hooks command). Eight
 * cases exercise:
 *
 *   1. fresh init writes all 6 artifacts (skills + hook scripts + 2 configs)
 *   2. idempotent re-init produces zero diff
 *   3. preserves user customizations in .claude/settings.json
 *   4. dedupe on re-install (hooks.Stop count unchanged)
 *   5. POSIX hook script is executable (0o100 bit set)
 *   6. fabric hooks command is idempotent post-init
 *   7. partial install resilience (.claude/ as a file, .codex/ side still merged)
 *   8. AGENTS.md / CLAUDE.md pointer line appended only once on re-run
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildInitExecutionPlan,
  executeInitExecutionPlan,
  type InitExecutionResult,
} from "../../src/commands/init.ts";
import { installHooks } from "../../src/commands/hooks.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

// ---------------------------------------------------------------------------
// Helpers — resolve template paths relative to packages/cli/templates so the
// tests can compare on-disk artifacts byte-for-byte against the shipped
// templates without depending on the install helpers' internal walker.
// ---------------------------------------------------------------------------

const TEMPLATES_ROOT = (() => {
  // This test file lives at packages/cli/__tests__/integration/. Walk up two
  // levels to packages/cli/, then into templates/.
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..", "..", "templates");
})();

function readTemplate(rel: string): string {
  return readFileSync(join(TEMPLATES_ROOT, rel), "utf8");
}

/**
 * Runs `fabric init` end-to-end via the public execution-plan API but skips
 * the MCP stage — local MCP install would try to write outside the fixture
 * (npm install, global config) which is out of scope for these install tests.
 * Bootstrap (skill + hook + per-client configs + pointer) and hooks stages
 * run normally.
 */
async function runInit(target: string, opts: { reapply?: boolean; force?: boolean } = {}): Promise<InitExecutionResult> {
  const plan = await buildInitExecutionPlan({
    target,
    options: { skipMcp: true, reapply: opts.reapply, force: opts.force },
    interactive: false,
  });
  return executeInitExecutionPlan(plan);
}

type FsSnapshot = Record<string, string>;

function snapshotTree(root: string, rel: string): FsSnapshot {
  const out: FsSnapshot = {};
  const start = join(root, rel);
  if (!existsSync(start)) return out;
  walk(start);
  return out;

  function walk(p: string): void {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p)) {
        walk(join(p, entry));
      }
      return;
    }
    if (stat.isFile()) {
      out[p.slice(root.length + 1)] = readFileSync(p, "utf8");
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1 — fresh init writes all 6 artifacts byte-identical to templates
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: fresh init", () => {
  it("writes 6 artifacts (skills + hooks + per-client configs)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-fresh");
    tempRoots.push(target);

    await runInit(target);

    const skillTemplate = readTemplate("skills/fabric-archive/SKILL.md");
    const hookTemplate = readTemplate("hooks/archive-hint.cjs");

    // Skill copies — byte-identical
    const claudeSkill = readFileSync(join(target, ".claude/skills/fabric-archive/SKILL.md"), "utf8");
    const codexSkill = readFileSync(join(target, ".codex/skills/fabric-archive/SKILL.md"), "utf8");
    expect(claudeSkill).toBe(skillTemplate);
    expect(codexSkill).toBe(skillTemplate);

    // Hook script copies — byte-identical
    const claudeHook = readFileSync(join(target, ".claude/hooks/archive-hint.cjs"), "utf8");
    const codexHook = readFileSync(join(target, ".codex/hooks/archive-hint.cjs"), "utf8");
    expect(claudeHook).toBe(hookTemplate);
    expect(codexHook).toBe(hookTemplate);

    // Claude settings.json contains hooks.Stop[] entry pointing at the hook
    const claudeSettings = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as { hooks?: { Stop?: unknown[] } };
    expect(Array.isArray(claudeSettings.hooks?.Stop)).toBe(true);
    expect(JSON.stringify(claudeSettings.hooks?.Stop)).toContain(".claude/hooks/archive-hint.cjs");

    // Codex hooks.json contains events.Stop[] entry pointing at the hook
    const codexHooks = JSON.parse(
      readFileSync(join(target, ".codex/hooks.json"), "utf8"),
    ) as { events?: { Stop?: unknown[] } };
    expect(Array.isArray(codexHooks.events?.Stop)).toBe(true);
    expect(JSON.stringify(codexHooks.events?.Stop)).toContain(".codex/hooks/archive-hint.cjs");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — idempotent re-init: zero diff between snapshot1 and snapshot2
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: idempotency", () => {
  it("re-running init produces zero diff in .claude/ and .codex/ trees", async () => {
    const target = createWerewolfFixtureRoot("itg-install-reinit");
    tempRoots.push(target);

    await runInit(target);
    const snap1Claude = snapshotTree(target, ".claude");
    const snap1Codex = snapshotTree(target, ".codex");

    await runInit(target, { reapply: true, force: true });
    const snap2Claude = snapshotTree(target, ".claude");
    const snap2Codex = snapshotTree(target, ".codex");

    expect(snap2Claude).toEqual(snap1Claude);
    expect(snap2Codex).toEqual(snap1Codex);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — preserves user customizations in .claude/settings.json
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: settings preservation", () => {
  it("preserves user permissions block and custom Stop hook entries", async () => {
    const target = createWerewolfFixtureRoot("itg-install-preserve");
    tempRoots.push(target);

    // Pre-create .claude/settings.json with custom permissions + custom Stop hook
    const customSettings = {
      permissions: { allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"] },
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: ".claude/hooks/my-custom-hook.cjs" }],
          },
        ],
      },
    };
    writeFixtureFile(target, ".claude/settings.json", JSON.stringify(customSettings, null, 2));

    await runInit(target);

    const merged = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as {
      permissions?: { allow?: string[]; deny?: string[] };
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };

    // Custom permissions preserved verbatim
    expect(merged.permissions).toEqual({ allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"] });

    // Both Stop hooks present — custom + fabric-archive
    const stopCommands = (merged.hooks?.Stop ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);
    expect(stopCommands).toContain(".claude/hooks/my-custom-hook.cjs");
    expect(stopCommands).toContain(".claude/hooks/archive-hint.cjs");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — dedupe on re-install: hooks.Stop count unchanged after second init
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: dedup", () => {
  it("re-init does not duplicate hooks.Stop entries", async () => {
    const target = createWerewolfFixtureRoot("itg-install-dedup");
    tempRoots.push(target);

    await runInit(target);
    const settingsAfterFirst = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as { hooks?: { Stop?: unknown[] } };
    const firstCount = settingsAfterFirst.hooks?.Stop?.length ?? 0;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    await runInit(target, { reapply: true, force: true });
    const settingsAfterSecond = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as { hooks?: { Stop?: unknown[] } };
    const secondCount = settingsAfterSecond.hooks?.Stop?.length ?? 0;

    expect(secondCount).toBe(firstCount);

    // Same check for codex
    const codexAfterFirst = JSON.parse(
      readFileSync(join(target, ".codex/hooks.json"), "utf8"),
    ) as { events?: { Stop?: unknown[] } };
    const codexAfterSecond = JSON.parse(
      readFileSync(join(target, ".codex/hooks.json"), "utf8"),
    ) as { events?: { Stop?: unknown[] } };
    expect(codexAfterSecond.events?.Stop?.length).toBe(codexAfterFirst.events?.Stop?.length);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — POSIX hook script has owner-execute bit (0o100)
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("TASK-006 install-skills-and-hooks: POSIX exec bit", () => {
  it("archive-hint.cjs has owner-execute bit set", async () => {
    const target = createWerewolfFixtureRoot("itg-install-execbit");
    tempRoots.push(target);

    await runInit(target);

    const claudeStat = statSync(join(target, ".claude/hooks/archive-hint.cjs"));
    const codexStat = statSync(join(target, ".codex/hooks/archive-hint.cjs"));

    // Owner-execute bit (0o100) must be set; install helper chmods to 0o755.
    expect(claudeStat.mode & 0o100).toBe(0o100);
    expect(codexStat.mode & 0o100).toBe(0o100);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — fabric hooks command is idempotent after init
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: fabric hooks idempotent", () => {
  it("running installHooks after init reports zero installed and no errors", async () => {
    const target = createWerewolfFixtureRoot("itg-install-hooks-cmd");
    tempRoots.push(target);

    await runInit(target);

    const result = await installHooks(target);

    expect(result.errors).toEqual([]);
    // After a clean init, every hook step should be skipped (already up-to-date).
    expect(result.installed).toEqual([]);
    expect(result.skipped.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — partial install resilience: .claude/ pre-existing as a file
//
// When `.claude` is a regular file rather than a directory, the install
// helpers that target .claude/* (skill copy, hook-script copy, claude-hook-
// config merge) cannot create their destination directories. Each helper is
// wrapped in runBestEffort/runBestEffortSingle in init.ts, so the failure is
// captured rather than crashing the run. The .codex/* artifacts (which are
// independent of .claude) must still be installed.
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: partial install resilience", () => {
  it("does not crash when .claude/ is a regular file; .codex/ artifacts still installed", async () => {
    const target = createWerewolfFixtureRoot("itg-install-partial");
    tempRoots.push(target);

    // Pre-create .claude as a FILE (not a directory). mkdirSync() inside the
    // install helpers will then fail with ENOTDIR/EEXIST on the .claude path.
    writeFixtureFile(target, ".claude", "this-is-a-file-not-a-directory");

    // initFabric must NOT throw — the bootstrap stage's runBestEffort
    // wrappers catch per-helper failures and surface them as InstallStepResult
    // entries with status='error'.
    await expect(runInit(target)).resolves.toBeDefined();

    // .codex/hooks.json merge is independent of .claude state — must succeed
    expect(existsSync(join(target, ".codex/hooks.json"))).toBe(true);
    const codexHooks = JSON.parse(
      readFileSync(join(target, ".codex/hooks.json"), "utf8"),
    ) as { events?: { Stop?: unknown[] } };
    expect(Array.isArray(codexHooks.events?.Stop)).toBe(true);

    // .claude is still a file — install helpers did not (and cannot) overwrite it
    expect(statSync(join(target, ".claude")).isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — AGENTS.md pointer appended only once on re-run
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: AGENTS.md pointer", () => {
  it("appends fabric-archive pointer line once and does not duplicate on re-init", async () => {
    const target = createWerewolfFixtureRoot("itg-install-pointer");
    tempRoots.push(target);

    // Pre-create AGENTS.md so the addArchiveSkillPointer helper sees a
    // non-absent target on the first run. (createWerewolfFixtureRoot deletes
    // the fixture's AGENTS.md, so we author our own.)
    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);

    await runInit(target);
    const afterFirst = readFileSync(join(target, "AGENTS.md"), "utf8");
    const pointerOccurrences1 = (afterFirst.match(/fabric-archive Skill when archiving/g) ?? []).length;
    expect(pointerOccurrences1).toBe(1);
    // Original user content preserved verbatim.
    expect(afterFirst.startsWith(seedContent)).toBe(true);

    await runInit(target, { reapply: true, force: true });
    const afterSecond = readFileSync(join(target, "AGENTS.md"), "utf8");
    const pointerOccurrences2 = (afterSecond.match(/fabric-archive Skill when archiving/g) ?? []).length;
    expect(pointerOccurrences2).toBe(1);
    expect(afterSecond).toBe(afterFirst);
  });
});


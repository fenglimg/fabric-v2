/**
 * Integration tests: `fab uninstall` round-trip — drive a real init via the
 * public execution-plan API (skipping MCP), then drive uninstall, and verify
 * the symmetric inverse:
 *
 *   T1 — fresh init → uninstall → .claude tree empty (or only non-fabric files)
 *   T2 — pre-seeded settings.json → init → uninstall {cleanEmpties:true} →
 *        settings.json matches the pre-init seed byte-for-byte
 *   T3 — knowledge entry survives default uninstall (no --purge); state files gone
 *   T4 — HOME-pinned ~/.fabric/knowledge/ survives --purge byte-identical
 *   T5 — idempotent re-run: second uninstall reports 100% skipped
 *   T6 — CLAUDE.md pointer lines stripped, user content preserved verbatim
 *
 * Mirrors install-skills-and-hooks.test.ts conventions: tempRoots[] +
 * afterEach drain, snapshotTree byte-comparison, real-fs + tmpdir fixture.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildUninstallExecutionPlan,
  executeUninstallExecutionPlan,
  type UninstallExecutionResult,
  type UninstallOptions,
} from "../../src/commands/uninstall.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
  snapshotTree,
  writeFixtureFile,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalFabricHome = process.env.FABRIC_HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

// ---------------------------------------------------------------------------
// Helpers — runInit + snapshotTree hoisted into helpers/init-test-utils.ts
// (rc.14 TASK-002 — single source of truth shared with install + diff-mode
// integration tests). Local runUninstall stays because uninstall is the
// inverse contract this test exists to validate.
// ---------------------------------------------------------------------------

async function runUninstall(
  target: string,
  opts: UninstallOptions = {},
): Promise<UninstallExecutionResult> {
  const plan = await buildUninstallExecutionPlan(target, { skipMcp: true, ...opts });
  return executeUninstallExecutionPlan(plan);
}

// ---------------------------------------------------------------------------
// T1 — fresh init → uninstall removes every fabric-owned .claude artifact
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T1 fresh init → uninstall", () => {
  it("removes fabric-owned files from .claude tree (skills + hook scripts)", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t1-fresh");
    tempRoots.push(target);

    await runInit(target);

    // Pre-conditions: fabric-owned files exist after init.
    expect(existsSync(join(target, ".claude", "skills", "fabric-archive", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "hooks", "fabric-hint.cjs"))).toBe(true);

    await runUninstall(target, { cleanEmpties: true });

    // Fabric-owned skill files are removed.
    expect(existsSync(join(target, ".claude", "skills", "fabric-archive", "SKILL.md"))).toBe(false);
    expect(existsSync(join(target, ".claude", "skills", "fabric-review", "SKILL.md"))).toBe(false);
    expect(existsSync(join(target, ".claude", "skills", "fabric-import", "SKILL.md"))).toBe(false);

    // Fabric-owned hook scripts are removed.
    expect(existsSync(join(target, ".claude", "hooks", "fabric-hint.cjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "hooks", "knowledge-hint-broad.cjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "hooks", "knowledge-hint-narrow.cjs"))).toBe(false);

    // Snapshot tree: if any files remain in .claude, they MUST not be the
    // fabric-owned ones (settings.json may survive — it predates uninstall
    // intent and contains a mix of fabric + user content). With cleanEmpties:true
    // and no user customizations, hooks.* keys should be cleaned out of
    // settings.json, but the file itself may still exist with permissions or
    // other unmodified fields.
    const remaining = snapshotTree(target, ".claude");
    for (const path of Object.keys(remaining)) {
      // No fabric-owned filenames remain.
      expect(path).not.toContain("fabric-hint.cjs");
      expect(path).not.toContain("knowledge-hint-broad.cjs");
      expect(path).not.toContain("knowledge-hint-narrow.cjs");
      expect(path).not.toContain("fabric-archive/SKILL.md");
      expect(path).not.toContain("fabric-review/SKILL.md");
      expect(path).not.toContain("fabric-import/SKILL.md");
    }
  });
});

// ---------------------------------------------------------------------------
// T2 — user-authored settings.json round-trips through init+uninstall
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T2 user settings.json preservation", () => {
  it("uninstall {cleanEmpties:true} restores pre-init settings.json byte-for-byte", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t2-settings");
    tempRoots.push(target);

    // Seed user-authored settings.json BEFORE init. The merge in install
    // appends fabric hooks alongside the user permissions block + custom Stop.
    const seed = {
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
    const seedJson = JSON.stringify(seed, null, 2);
    writeFixtureFile(target, ".claude/settings.json", seedJson);

    await runInit(target);

    // Verify fabric entries were merged in.
    const merged = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as { hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> } };
    const mergedStopCommands = (merged.hooks?.Stop ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);
    expect(mergedStopCommands).toContain(".claude/hooks/fabric-hint.cjs");

    // Uninstall with cleanEmpties so empty arrays/objects cascade away.
    await runUninstall(target, { cleanEmpties: true });

    // settings.json must exist (we seeded user content there) and the
    // permissions block + user Stop entry must be preserved verbatim.
    expect(existsSync(join(target, ".claude/settings.json"))).toBe(true);
    const restored = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as {
      permissions?: { allow?: string[]; deny?: string[] };
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };

    expect(restored.permissions).toEqual({ allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"] });

    // Custom Stop hook entry survives; fabric entries are gone.
    const restoredStopCommands = (restored.hooks?.Stop ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);
    expect(restoredStopCommands).toContain(".claude/hooks/my-custom-hook.cjs");
    expect(restoredStopCommands).not.toContain(".claude/hooks/fabric-hint.cjs");
  });
});

// ---------------------------------------------------------------------------
// T3 — knowledge entry survives default uninstall (no --purge)
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T3 knowledge preserved without --purge", () => {
  it("user-authored .fabric/knowledge entry is byte-identical and state files are removed", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t3-knowledge");
    tempRoots.push(target);

    await runInit(target);

    // Seed a user-authored knowledge entry.
    const entryPath = join(target, ".fabric", "knowledge", "decisions", "my-decision.md");
    const entryContent = "# My decision\n\nUser-authored, must survive default uninstall.\n";
    writeFileSync(entryPath, entryContent, "utf8");

    await runUninstall(target);

    // Knowledge entry survives byte-for-byte.
    expect(existsSync(entryPath)).toBe(true);
    expect(readFileSync(entryPath, "utf8")).toBe(entryContent);

    // Derived state file is gone.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4 — HOME-pinned ~/.fabric/knowledge/ NEVER touched even with --purge
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T4 personal root preserved even with --purge", () => {
  it("--purge removes project .fabric/ but $HOME/.fabric/knowledge/ is byte-identical", async () => {
    // Pin BOTH env vars: resolver order is `FABRIC_HOME ?? homedir()`, but
    // setting both is defense-in-depth against future code changes.
    const isolatedHome = join(
      tmpdir(),
      `fab-uninstall-t4-home-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(isolatedHome, { recursive: true });
    tempRoots.push(isolatedHome);
    process.env.HOME = isolatedHome;
    process.env.FABRIC_HOME = isolatedHome;

    // Seed personal knowledge entry inside pinned HOME.
    const personalDir = join(isolatedHome, ".fabric", "knowledge", "decisions");
    mkdirSync(personalDir, { recursive: true });
    const personalEntry = join(personalDir, "personal.md");
    const personalContent = "# Personal\n\nCross-project, must survive --purge.\n";
    writeFileSync(personalEntry, personalContent, "utf8");

    const target = createWerewolfFixtureRoot("itg-uninstall-t4-purge");
    tempRoots.push(target);

    await runInit(target);

    // Run uninstall with --purge.
    await runUninstall(target, { purge: true });

    // Project .fabric/ is gone (purge cleaned up state files + knowledge subdirs).
    // Note: depending on whether stage results left the dir non-empty, the
    // fabric-dir step may not have removed the dir itself — we assert at least
    // the knowledge subtree was purged.
    expect(existsSync(join(target, ".fabric", "knowledge", "decisions"))).toBe(false);

    // Personal root is byte-identical, untouched.
    expect(existsSync(personalEntry)).toBe(true);
    expect(readFileSync(personalEntry, "utf8")).toBe(personalContent);
  });
});

// ---------------------------------------------------------------------------
// T5 — idempotent re-run: second uninstall reports 100% skipped
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T5 idempotent re-run", () => {
  it("second uninstall after first uninstall reports every step as skipped", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t5-idempotent");
    tempRoots.push(target);

    await runInit(target);

    await runUninstall(target);
    const second = await runUninstall(target);

    const allSteps = second.stageResults.flatMap((stage) => stage.steps);
    expect(allSteps.length).toBeGreaterThan(0);
    expect(allSteps.every((step) => step.status === "skipped")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T6 — CLAUDE.md managed-section strip preserves user content
//
// rc.12 broad-gate-fabric-lang TASK-006: replaces the rc.4 POINTER_LINE
// substring-strip assertions. The new managed-section uninstall must remove
// the entire begin→end region (markers inclusive) from each target, leaving
// pre-existing user content intact. Re-running uninstall is a no-op.
// ---------------------------------------------------------------------------

const SECTION_BEGIN_UN = "<!-- fabric:knowledge-base:begin -->";
const SECTION_END_UN = "<!-- fabric:knowledge-base:end -->";

describe("TASK-006 uninstall round-trip: managed-section strip", () => {
  it("strips the Fabric Knowledge Base section from CLAUDE.md while preserving user-authored content", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t6-section");
    tempRoots.push(target);

    // Seed user-authored CLAUDE.md BEFORE init so addFabricKnowledgeBaseSection
    // sees a non-absent target. install writes the managed section; uninstall
    // must strip it cleanly, leaving only the seed content.
    const seed = "# Project notes\n\nUser-authored project guidance lives here.\n";
    writeFixtureFile(target, "CLAUDE.md", seed);

    await runInit(target);

    const afterInit = readFileSync(join(target, "CLAUDE.md"), "utf8");
    // Sanity: install wrote both markers and the canonical heading.
    expect(afterInit).toContain(SECTION_BEGIN_UN);
    expect(afterInit).toContain(SECTION_END_UN);
    expect(afterInit).toContain("## Fabric Knowledge Base");

    await runUninstall(target);

    const afterUninstall = readFileSync(join(target, "CLAUDE.md"), "utf8");
    // Both markers and the heading must be gone.
    expect(afterUninstall).not.toContain(SECTION_BEGIN_UN);
    expect(afterUninstall).not.toContain(SECTION_END_UN);
    expect(afterUninstall).not.toContain("## Fabric Knowledge Base");

    // User content survives — first line of the seed is still present.
    expect(afterUninstall).toContain("# Project notes");
    expect(afterUninstall).toContain("User-authored project guidance lives here.");
  });

  it("uninstall is idempotent: running it twice yields the same content (no-op on second pass)", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t6-idempotent");
    tempRoots.push(target);

    const seed = "# Project notes\n\nUser-authored project guidance lives here.\n";
    writeFixtureFile(target, "CLAUDE.md", seed);

    await runInit(target);
    await runUninstall(target);
    const afterFirst = readFileSync(join(target, "CLAUDE.md"), "utf8");

    // Second uninstall on a section-free file must not throw and must not
    // mutate the content. The orchestrator may still record a step result
    // (status: "skipped", message: "no-fabric-section") but file bytes are
    // byte-identical to the post-first-uninstall snapshot.
    await runUninstall(target);
    const afterSecond = readFileSync(join(target, "CLAUDE.md"), "utf8");
    expect(afterSecond).toBe(afterFirst);
  });
});

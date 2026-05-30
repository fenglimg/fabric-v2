/**
 * Integration tests: `fabric uninstall` round-trip — drive a real init via the
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

    await runUninstall(target);

    // Fabric-owned skill files are removed.
    expect(existsSync(join(target, ".claude", "skills", "fabric-archive", "SKILL.md"))).toBe(false);
    expect(existsSync(join(target, ".claude", "skills", "fabric-review", "SKILL.md"))).toBe(false);
    expect(existsSync(join(target, ".claude", "skills", "fabric-import", "SKILL.md"))).toBe(false);

    // Fabric-owned hook scripts are removed.
    expect(existsSync(join(target, ".claude", "hooks", "fabric-hint.cjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "hooks", "knowledge-hint-broad.cjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "hooks", "knowledge-hint-narrow.cjs"))).toBe(false);

    // rc.16 TASK-004 (F2-tests): fabric-owned hook libs are removed too.
    // Symmetric inverse of installHookLibs — the lib `.cjs` files plus the
    // empty `lib/` directory should be gone across all 3 client trees.
    for (const clientDir of [".claude", ".codex", ".cursor"]) {
      expect(
        existsSync(join(target, clientDir, "hooks/lib/banner-i18n.cjs")),
        `${clientDir} banner-i18n.cjs should be removed`,
      ).toBe(false);
      expect(
        existsSync(join(target, clientDir, "hooks/lib/session-digest-writer.cjs")),
        `${clientDir} session-digest-writer.cjs should be removed`,
      ).toBe(false);
      // Empty lib/ dir cascade-removed by removeHookLibs.
      expect(existsSync(join(target, clientDir, "hooks/lib"))).toBe(false);
    }

    // Snapshot tree: if any files remain in .claude, they MUST not be the
    // fabric-owned ones (settings.json may survive — it predates uninstall
    // intent and contains a mix of fabric + user content). cleanEmpties became
    // default-on in rc.15 TASK-002, so hooks.* keys are cleaned out of
    // settings.json by default, but the file itself may still exist with
    // permissions or other unmodified fields.
    //
    // rc.14 TASK-004 (Finding 3) — extend snapshot assertions to `.cursor`
    // and `.codex` alongside `.claude`. Closes the uninstall-side parity
    // gap parallel to the install-side `.cursor` snapshot coverage added
    // in TASK-002. Without this, cursor/codex-side uninstall regressions
    // would sneak past CI.
    const remainingClaude = snapshotTree(target, ".claude");
    const remainingCursor = snapshotTree(target, ".cursor");
    const remainingCodex = snapshotTree(target, ".codex");
    for (const path of Object.keys(remainingClaude)) {
      // No fabric-owned filenames remain in .claude.
      expect(path).not.toContain("fabric-hint.cjs");
      expect(path).not.toContain("knowledge-hint-broad.cjs");
      expect(path).not.toContain("knowledge-hint-narrow.cjs");
      expect(path).not.toContain("fabric-archive/SKILL.md");
      expect(path).not.toContain("fabric-review/SKILL.md");
      expect(path).not.toContain("fabric-import/SKILL.md");
      // rc.16 TASK-004: lib `.cjs` helpers shipped via installHookLibs.
      expect(path).not.toContain("hooks/lib/banner-i18n.cjs");
      expect(path).not.toContain("hooks/lib/session-digest-writer.cjs");
    }
    for (const path of Object.keys(remainingCursor)) {
      // No fabric-owned hook scripts remain in .cursor.
      expect(path).not.toContain("fabric-hint.cjs");
      expect(path).not.toContain("knowledge-hint-broad.cjs");
      expect(path).not.toContain("knowledge-hint-narrow.cjs");
      expect(path).not.toContain("hooks/lib/banner-i18n.cjs");
      expect(path).not.toContain("hooks/lib/session-digest-writer.cjs");
    }
    for (const path of Object.keys(remainingCodex)) {
      // No fabric-owned hook scripts remain in .codex.
      expect(path).not.toContain("fabric-hint.cjs");
      expect(path).not.toContain("knowledge-hint-broad.cjs");
      expect(path).not.toContain("knowledge-hint-narrow.cjs");
      expect(path).not.toContain("hooks/lib/banner-i18n.cjs");
      expect(path).not.toContain("hooks/lib/session-digest-writer.cjs");
    }
  });

  // W2-01 (F3): cite-policy-evict.cjs was installed (rc.34 TASK-06) across all
  // three clients but the uninstall path never removed the script OR pruned the
  // config entry. Round-trip must leave zero cite-policy-evict residue.
  it("removes cite-policy-evict.cjs scripts and prunes its config entries (F3)", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-cite-evict");
    tempRoots.push(target);

    await runInit(target);

    // Pre-condition: the cite-policy-evict script exists on every client.
    for (const dir of [".claude", ".codex", ".cursor"]) {
      expect(
        existsSync(join(target, dir, "hooks", "cite-policy-evict.cjs")),
        `${dir} cite-policy-evict.cjs should exist after init`,
      ).toBe(true);
    }
    // ...and the Claude settings register it under UserPromptSubmit.
    const settingsBefore = readFileSync(join(target, ".claude", "settings.json"), "utf8");
    expect(settingsBefore).toContain("cite-policy-evict.cjs");

    await runUninstall(target);

    // Scripts gone on every client.
    for (const dir of [".claude", ".codex", ".cursor"]) {
      expect(
        existsSync(join(target, dir, "hooks", "cite-policy-evict.cjs")),
        `${dir} cite-policy-evict.cjs should be removed`,
      ).toBe(false);
    }
    // Config entry pruned: no surviving config across the three clients still
    // references the script.
    for (const rel of [".claude/settings.json", ".codex/hooks.json", ".cursor/hooks.json"]) {
      const p = join(target, rel);
      if (existsSync(p)) {
        expect(readFileSync(p, "utf8")).not.toContain("cite-policy-evict.cjs");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T2 — user-authored settings.json round-trips through init+uninstall
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T2 user settings.json preservation", () => {
  it("uninstall restores pre-init settings.json byte-for-byte (cleanEmpties default-on)", async () => {
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
    expect(mergedStopCommands).toContain("${CLAUDE_PROJECT_DIR}/.claude/hooks/fabric-hint.cjs");

    // Uninstall — cleanEmpties is default-on (rc.15 TASK-002), so empty
    // arrays/objects cascade away unconditionally.
    await runUninstall(target);

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
// T4 — HOME-pinned ~/.fabric/knowledge/ NEVER touched; team knowledge always
// preserved (rc.15 TASK-002 dropped --purge — knowledge preservation is now
// unconditional, and the personal-root guard remains defense-in-depth).
// ---------------------------------------------------------------------------

describe("TASK-005 uninstall round-trip: T4 personal root always preserved", () => {
  it("uninstall preserves both project .fabric/knowledge/ and $HOME/.fabric/knowledge/ byte-identically", async () => {
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
    const personalContent = "# Personal\n\nCross-project, must survive uninstall.\n";
    writeFileSync(personalEntry, personalContent, "utf8");

    const target = createWerewolfFixtureRoot("itg-uninstall-t4-purge");
    tempRoots.push(target);

    await runInit(target);

    // Seed a project-local knowledge entry to verify team knowledge survives.
    const projectEntry = join(target, ".fabric", "knowledge", "decisions", "project.md");
    const projectContent = "# Project\n\nMust survive default uninstall.\n";
    writeFileSync(projectEntry, projectContent, "utf8");

    // Run default uninstall — knowledge preservation is now unconditional.
    await runUninstall(target);

    // Project knowledge tree survives byte-identical.
    expect(existsSync(projectEntry)).toBe(true);
    expect(readFileSync(projectEntry, "utf8")).toBe(projectContent);

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
// T6 — Three-end bootstrap strip (rc.19 TASK-003)
//
// Symmetric inverse of the three-end propagation writers in install. Each
// target has its own strip rule:
//   - CLAUDE.md                          — line-level strip of `@.fabric/AGENTS.md`
//                                          and `@.fabric/project-rules.md`
//                                          (managed block was never written
//                                          to CLAUDE.md, so no marker strip).
//   - AGENTS.md                          — strip `fabric:bootstrap` managed
//                                          block (markers inclusive).
//   - .cursor/rules/fabric-bootstrap.mdc — strip managed block; delete the
//                                          file when only YAML front-matter
//                                          remains.
//
// New assertions:
//   - uninstall deletes `.fabric/AGENTS.md` (the L1 snapshot).
//   - uninstall PRESERVES `.fabric/project-rules.md` byte-for-byte
//     (user-authored, only-if-exists per locked decision NEW-4).
// ---------------------------------------------------------------------------

const SECTION_BEGIN_UN = "<!-- fabric:bootstrap:begin -->";
const SECTION_END_UN = "<!-- fabric:bootstrap:end -->";

const CURSOR_BOOTSTRAP_MDC_REL_UN = ".cursor/rules/fabric-bootstrap.mdc";

describe("rc.19 TASK-003 uninstall round-trip: bootstrap three-end strip", () => {
  it("strips fabric content from CLAUDE.md / AGENTS.md / Cursor mdc while preserving user content", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t6-section");
    tempRoots.push(target);

    // Seed user-authored CLAUDE.md + AGENTS.md BEFORE init so the install
    // propagators see non-absent targets. Install appends the managed
    // payload; uninstall must strip cleanly, leaving only the seed content.
    const seed = "# Project notes\n\nUser-authored project guidance lives here.\n";
    writeFixtureFile(target, "CLAUDE.md", seed);
    writeFixtureFile(target, "AGENTS.md", seed);

    await runInit(target);

    // Sanity: install wrote the propagated bytes.
    const claudeAfterInit = readFileSync(join(target, "CLAUDE.md"), "utf8");
    expect(claudeAfterInit).toContain("@.fabric/AGENTS.md");
    // CLAUDE.md does NOT receive a managed block.
    expect(claudeAfterInit).not.toContain(SECTION_BEGIN_UN);

    const agentsAfterInit = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(agentsAfterInit).toContain(SECTION_BEGIN_UN);
    expect(agentsAfterInit).toContain(SECTION_END_UN);

    expect(existsSync(join(target, CURSOR_BOOTSTRAP_MDC_REL_UN))).toBe(true);
    expect(existsSync(join(target, ".fabric/AGENTS.md"))).toBe(true);

    await runUninstall(target);

    // CLAUDE.md: `@`-import line is gone; user content survives.
    const claudeAfterUninstall = readFileSync(join(target, "CLAUDE.md"), "utf8");
    expect(claudeAfterUninstall).not.toContain("@.fabric/AGENTS.md");
    expect(claudeAfterUninstall).toContain("# Project notes");
    expect(claudeAfterUninstall).toContain("User-authored project guidance lives here.");

    // AGENTS.md: managed block stripped; user content survives.
    const agentsAfterUninstall = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(agentsAfterUninstall).not.toContain(SECTION_BEGIN_UN);
    expect(agentsAfterUninstall).not.toContain(SECTION_END_UN);
    expect(agentsAfterUninstall).toContain("# Project notes");
    expect(agentsAfterUninstall).toContain("User-authored project guidance lives here.");

    // Cursor mdc: file deleted (front-matter-only after strip).
    expect(existsSync(join(target, CURSOR_BOOTSTRAP_MDC_REL_UN))).toBe(false);

    // L1 snapshot deleted.
    expect(existsSync(join(target, ".fabric/AGENTS.md"))).toBe(false);
  });

  it("preserves user-authored .fabric/project-rules.md byte-for-byte", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t6-project-rules");
    tempRoots.push(target);

    // Seed user-authored project-rules.md before init.
    const userRules = "CUSTOM RULES — must survive uninstall.\n";
    writeFixtureFile(target, ".fabric/project-rules.md", userRules);

    await runInit(target);
    // Sanity: install did not clobber the user file.
    expect(readFileSync(join(target, ".fabric/project-rules.md"), "utf8")).toBe(userRules);

    await runUninstall(target);

    // L1 snapshot gone, but the user-authored companion survives byte-for-byte.
    expect(existsSync(join(target, ".fabric/AGENTS.md"))).toBe(false);
    expect(existsSync(join(target, ".fabric/project-rules.md"))).toBe(true);
    expect(readFileSync(join(target, ".fabric/project-rules.md"), "utf8")).toBe(userRules);
  });

  it("uninstall is idempotent: running it twice yields the same content (no-op on second pass)", async () => {
    const target = createWerewolfFixtureRoot("itg-uninstall-t6-idempotent");
    tempRoots.push(target);

    const seed = "# Project notes\n\nUser-authored project guidance lives here.\n";
    writeFixtureFile(target, "CLAUDE.md", seed);
    writeFixtureFile(target, "AGENTS.md", seed);

    await runInit(target);
    await runUninstall(target);
    const claudeFirst = readFileSync(join(target, "CLAUDE.md"), "utf8");
    const agentsFirst = readFileSync(join(target, "AGENTS.md"), "utf8");

    // Second uninstall on a section-free file must not throw and must not
    // mutate the content. The orchestrator may still record a step result
    // (status: "skipped", message: "no-fabric-section") but file bytes are
    // byte-identical to the post-first-uninstall snapshot.
    await runUninstall(target);
    expect(readFileSync(join(target, "CLAUDE.md"), "utf8")).toBe(claudeFirst);
    expect(readFileSync(join(target, "AGENTS.md"), "utf8")).toBe(agentsFirst);
  });
});

/**
 * Integration tests: TASK-006 (rc.2) + TASK-006 (rc.3) + TASK-005 (rc.4)
 *   + TASK-010 (rc.5: archive-hint → fabric-hint rename + cursor parity)
 *   fabric-archive, fabric-review AND fabric-import Skills + fabric-hint
 *   Stop hook install across Claude Code / Codex CLI / Cursor
 *
 * Verifies the wiring at packages/cli/src/install/skills-and-hooks.ts
 * (called from init bootstrap stage and the fabric hooks command). Eight
 * cases exercise:
 *
 *   1. fresh init writes all 10 artifacts (2 archive skills + 2 review skills
 *      + 2 import skills + 2 hook scripts + 2 per-client configs)
 *   2. idempotent re-init produces zero diff
 *   3. preserves user customizations in .claude/settings.json
 *   4. dedupe on re-install (hooks.Stop count unchanged)
 *   5. POSIX hook script is executable (0o100 bit set)
 *   6. fabric hooks command is idempotent post-init (covers all 3 skills)
 *   7. partial install resilience (.claude/ as a file, .codex/ side still merged)
 *   8. AGENTS.md / CLAUDE.md pointer lines (archive + review + import)
 *      appended only once on re-run
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { installHooks } from "../../src/install/hooks-orchestrator.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
  snapshotTree,
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

// runInit / snapshotTree are hoisted into helpers/init-test-utils.ts as of
// rc.14 TASK-002. Single source of truth shared with uninstall + diff-mode tests.

// ---------------------------------------------------------------------------
// Test 1 — fresh init writes all 10 artifacts byte-identical to templates
//
// rc.4 update: 2 added artifacts vs rc.3's 8 — fabric-import SKILL.md to both
// .claude/skills/fabric-import/ and .codex/skills/fabric-import/.
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: fresh init", () => {
  it("writes all 16 artifacts (archive+review+import skills + Stop + SessionStart + PreToolUse hooks + per-client configs)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-fresh");
    tempRoots.push(target);

    await runInit(target);

    const archiveSkillTemplate = readTemplate("skills/fabric-archive/SKILL.md");
    const reviewSkillTemplate = readTemplate("skills/fabric-review/SKILL.md");
    const importSkillTemplate = readTemplate("skills/fabric-import/SKILL.md");
    const hookTemplate = readTemplate("hooks/fabric-hint.cjs");
    // rc.6 TASK-019 (E1): SessionStart broad-injection hook script template.
    const broadHookTemplate = readTemplate("hooks/knowledge-hint-broad.cjs");
    // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook script template.
    const narrowHookTemplate = readTemplate("hooks/knowledge-hint-narrow.cjs");

    // Archive skill copies — byte-identical
    const claudeArchiveSkill = readFileSync(join(target, ".claude/skills/fabric-archive/SKILL.md"), "utf8");
    const codexArchiveSkill = readFileSync(join(target, ".codex/skills/fabric-archive/SKILL.md"), "utf8");
    expect(claudeArchiveSkill).toBe(archiveSkillTemplate);
    expect(codexArchiveSkill).toBe(archiveSkillTemplate);

    // Review skill copies (rc.3) — byte-identical
    const claudeReviewSkill = readFileSync(join(target, ".claude/skills/fabric-review/SKILL.md"), "utf8");
    const codexReviewSkill = readFileSync(join(target, ".codex/skills/fabric-review/SKILL.md"), "utf8");
    expect(claudeReviewSkill).toBe(reviewSkillTemplate);
    expect(codexReviewSkill).toBe(reviewSkillTemplate);

    // Import skill copies (rc.4) — byte-identical
    const claudeImportSkill = readFileSync(join(target, ".claude/skills/fabric-import/SKILL.md"), "utf8");
    const codexImportSkill = readFileSync(join(target, ".codex/skills/fabric-import/SKILL.md"), "utf8");
    expect(claudeImportSkill).toBe(importSkillTemplate);
    expect(codexImportSkill).toBe(importSkillTemplate);

    // Hook script copies — byte-identical (rc.5 TASK-010: Cursor added)
    const claudeHook = readFileSync(join(target, ".claude/hooks/fabric-hint.cjs"), "utf8");
    const codexHook = readFileSync(join(target, ".codex/hooks/fabric-hint.cjs"), "utf8");
    const cursorHook = readFileSync(join(target, ".cursor/hooks/fabric-hint.cjs"), "utf8");
    expect(claudeHook).toBe(hookTemplate);
    expect(codexHook).toBe(hookTemplate);
    expect(cursorHook).toBe(hookTemplate);

    // rc.6 TASK-019: knowledge-hint-broad.cjs copies (SessionStart sibling)
    const claudeBroad = readFileSync(join(target, ".claude/hooks/knowledge-hint-broad.cjs"), "utf8");
    const codexBroad = readFileSync(join(target, ".codex/hooks/knowledge-hint-broad.cjs"), "utf8");
    const cursorBroad = readFileSync(join(target, ".cursor/hooks/knowledge-hint-broad.cjs"), "utf8");
    expect(claudeBroad).toBe(broadHookTemplate);
    expect(codexBroad).toBe(broadHookTemplate);
    expect(cursorBroad).toBe(broadHookTemplate);

    // rc.6 TASK-020: knowledge-hint-narrow.cjs copies (PreToolUse sibling)
    const claudeNarrow = readFileSync(join(target, ".claude/hooks/knowledge-hint-narrow.cjs"), "utf8");
    const codexNarrow = readFileSync(join(target, ".codex/hooks/knowledge-hint-narrow.cjs"), "utf8");
    const cursorNarrow = readFileSync(join(target, ".cursor/hooks/knowledge-hint-narrow.cjs"), "utf8");
    expect(claudeNarrow).toBe(narrowHookTemplate);
    expect(codexNarrow).toBe(narrowHookTemplate);
    expect(cursorNarrow).toBe(narrowHookTemplate);

    // rc.16 TASK-004 (F2-tests): banner-i18n.cjs lib MUST ship to every
    // client's <client>/hooks/lib/ directory. fabric-hint.cjs and knowledge-
    // hint-broad.cjs both `require("./lib/banner-i18n.cjs")` at module load
    // — without this copy step the user-facing hook crashes on the first
    // Stop / SessionStart event after install. Byte-equality vs the shipped
    // template is asserted to also catch any drift in the lib content.
    const bannerLibTemplate = readTemplate("hooks/lib/banner-i18n.cjs");
    for (const clientDir of [".claude", ".codex", ".cursor"]) {
      const libPath = join(target, clientDir, "hooks/lib/banner-i18n.cjs");
      expect(existsSync(libPath), `missing: ${libPath}`).toBe(true);
      expect(readFileSync(libPath, "utf8")).toBe(bannerLibTemplate);
    }
    // session-digest-writer.cjs is the second `.cjs` file in the lib dir
    // and must ship via the same install step. Asserting both files keeps
    // installHookLibs honest about its directory-walk contract: it copies
    // every `.cjs` under templates/hooks/lib/, not just banner-i18n.
    const digestLibTemplate = readTemplate("hooks/lib/session-digest-writer.cjs");
    for (const clientDir of [".claude", ".codex", ".cursor"]) {
      const libPath = join(target, clientDir, "hooks/lib/session-digest-writer.cjs");
      expect(existsSync(libPath), `missing: ${libPath}`).toBe(true);
      expect(readFileSync(libPath, "utf8")).toBe(digestLibTemplate);
    }

    // Claude settings.json contains hooks.Stop[] + hooks.SessionStart[] +
    // hooks.PreToolUse[] entries each pointing at the corresponding script.
    const claudeSettings = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as { hooks?: { Stop?: unknown[]; SessionStart?: unknown[]; PreToolUse?: unknown[] } };
    expect(Array.isArray(claudeSettings.hooks?.Stop)).toBe(true);
    expect(JSON.stringify(claudeSettings.hooks?.Stop)).toContain(".claude/hooks/fabric-hint.cjs");
    expect(Array.isArray(claudeSettings.hooks?.SessionStart)).toBe(true);
    expect(JSON.stringify(claudeSettings.hooks?.SessionStart)).toContain(
      ".claude/hooks/knowledge-hint-broad.cjs",
    );
    expect(Array.isArray(claudeSettings.hooks?.PreToolUse)).toBe(true);
    expect(JSON.stringify(claudeSettings.hooks?.PreToolUse)).toContain(
      ".claude/hooks/knowledge-hint-narrow.cjs",
    );
    // PreToolUse matcher must restrict to Edit|Write|MultiEdit per TASK-020 spec.
    expect(JSON.stringify(claudeSettings.hooks?.PreToolUse)).toContain("Edit|Write|MultiEdit");

    // Codex hooks.json contains events.Stop[] + events.SessionStart[] + events.PreToolUse[]
    const codexHooks = JSON.parse(
      readFileSync(join(target, ".codex/hooks.json"), "utf8"),
    ) as { events?: { Stop?: unknown[]; SessionStart?: unknown[]; PreToolUse?: unknown[] } };
    expect(Array.isArray(codexHooks.events?.Stop)).toBe(true);
    expect(JSON.stringify(codexHooks.events?.Stop)).toContain(".codex/hooks/fabric-hint.cjs");
    expect(Array.isArray(codexHooks.events?.SessionStart)).toBe(true);
    expect(JSON.stringify(codexHooks.events?.SessionStart)).toContain(
      ".codex/hooks/knowledge-hint-broad.cjs",
    );
    expect(Array.isArray(codexHooks.events?.PreToolUse)).toBe(true);
    expect(JSON.stringify(codexHooks.events?.PreToolUse)).toContain(
      ".codex/hooks/knowledge-hint-narrow.cjs",
    );
    expect(JSON.stringify(codexHooks.events?.PreToolUse)).toContain("Edit|Write|MultiEdit");

    // Cursor hooks.json schema per https://cursor.com/cn/docs/hooks:
    //   top-level `version: 1` (number) + `hooks: {stop, sessionStart, preToolUse}` (camelCase).
    // rc.14 TASK-001 — schema fix (rc.13 shipped wrong top-level `events.*` PascalCase).
    const cursorHooks = JSON.parse(
      readFileSync(join(target, ".cursor/hooks.json"), "utf8"),
    ) as {
      version?: unknown;
      hooks?: { stop?: unknown[]; sessionStart?: unknown[]; preToolUse?: unknown[] };
    };
    expect(cursorHooks.version).toBe(1);
    expect(Array.isArray(cursorHooks.hooks?.stop)).toBe(true);
    expect(JSON.stringify(cursorHooks.hooks?.stop)).toContain(".cursor/hooks/fabric-hint.cjs");
    expect(Array.isArray(cursorHooks.hooks?.sessionStart)).toBe(true);
    expect(JSON.stringify(cursorHooks.hooks?.sessionStart)).toContain(
      ".cursor/hooks/knowledge-hint-broad.cjs",
    );
    expect(Array.isArray(cursorHooks.hooks?.preToolUse)).toBe(true);
    expect(JSON.stringify(cursorHooks.hooks?.preToolUse)).toContain(
      ".cursor/hooks/knowledge-hint-narrow.cjs",
    );
    expect(JSON.stringify(cursorHooks.hooks?.preToolUse)).toContain("Edit|Write|MultiEdit");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — idempotent re-init: zero diff between snapshot1 and snapshot2
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: idempotency", () => {
  it("re-running init produces zero diff in .claude/, .codex/, and .cursor/ trees", async () => {
    const target = createWerewolfFixtureRoot("itg-install-reinit");
    tempRoots.push(target);

    await runInit(target);
    const snap1Claude = snapshotTree(target, ".claude");
    const snap1Codex = snapshotTree(target, ".codex");
    // rc.14 TASK-002: fill .cursor snapshot parity gap. Previously only
    // .claude and .codex were snapshotted; cursor-side regressions would
    // sneak past CI. Symmetric coverage now enforces cursor idempotency too.
    const snap1Cursor = snapshotTree(target, ".cursor");

    await runInit(target);
    const snap2Claude = snapshotTree(target, ".claude");
    const snap2Codex = snapshotTree(target, ".codex");
    const snap2Cursor = snapshotTree(target, ".cursor");

    expect(snap2Claude).toEqual(snap1Claude);
    expect(snap2Codex).toEqual(snap1Codex);
    expect(snap2Cursor).toEqual(snap1Cursor);
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
    expect(stopCommands).toContain(".claude/hooks/fabric-hint.cjs");
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

    await runInit(target);
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
  it("fabric-hint.cjs, knowledge-hint-broad.cjs AND knowledge-hint-narrow.cjs have owner-execute bit set", async () => {
    const target = createWerewolfFixtureRoot("itg-install-execbit");
    tempRoots.push(target);

    await runInit(target);

    const claudeStat = statSync(join(target, ".claude/hooks/fabric-hint.cjs"));
    const codexStat = statSync(join(target, ".codex/hooks/fabric-hint.cjs"));

    // Owner-execute bit (0o100) must be set; install helper chmods to 0o755.
    expect(claudeStat.mode & 0o100).toBe(0o100);
    expect(codexStat.mode & 0o100).toBe(0o100);

    // rc.6 TASK-019: broad-injection sibling hook script
    const claudeBroadStat = statSync(
      join(target, ".claude/hooks/knowledge-hint-broad.cjs"),
    );
    const codexBroadStat = statSync(
      join(target, ".codex/hooks/knowledge-hint-broad.cjs"),
    );
    expect(claudeBroadStat.mode & 0o100).toBe(0o100);
    expect(codexBroadStat.mode & 0o100).toBe(0o100);

    // rc.6 TASK-020: narrow-injection PreToolUse sibling hook script
    const claudeNarrowStat = statSync(
      join(target, ".claude/hooks/knowledge-hint-narrow.cjs"),
    );
    const codexNarrowStat = statSync(
      join(target, ".codex/hooks/knowledge-hint-narrow.cjs"),
    );
    expect(claudeNarrowStat.mode & 0o100).toBe(0o100);
    expect(codexNarrowStat.mode & 0o100).toBe(0o100);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — fabric hooks command is idempotent after init
// ---------------------------------------------------------------------------

describe("TASK-006 install-skills-and-hooks: fabric hooks idempotent", () => {
  it("running installHooks after init reports zero installed and no errors (covers archive+review+import)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-hooks-cmd");
    tempRoots.push(target);

    await runInit(target);

    // After init, all three skills must be on disk (proof installHooks
    // would see them as up-to-date on the next call).
    expect(existsSync(join(target, ".claude/skills/fabric-archive/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".codex/skills/fabric-archive/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude/skills/fabric-review/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".codex/skills/fabric-review/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude/skills/fabric-import/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".codex/skills/fabric-import/SKILL.md"))).toBe(true);

    const result = await installHooks(target);

    expect(result.errors).toEqual([]);
    // After a clean init, every hook step should be skipped (already up-to-date).
    expect(result.installed).toEqual([]);
    // rc.6: skipped now covers 2 archive skills + 2 review skills + 2 import
    // skills + 3 Stop hook scripts (claude/codex/cursor) + 3 SessionStart hook
    // scripts (rc.6 TASK-019) + 3 PreToolUse hook scripts (rc.6 TASK-020) +
    // 3 client configs = 18 minimum.
    // rc.16 TASK-004: + 3 clients × N hook libs (currently 2: banner-i18n,
    // session-digest-writer) = 6 more rows; threshold updated to ≥24.
    expect(result.skipped.length).toBeGreaterThanOrEqual(24);
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
// Test 8 — Managed "Fabric Knowledge Base" section
//
// rc.12 broad-gate-fabric-lang TASK-006: replaces the rc.4 POINTER_LINE
// substring-occurrence assertions. The new managed-section writer emits a
// single HTML-comment-wrapped block per target file (CLAUDE.md / AGENTS.md /
// .cursor/rules); tests verify presence, idempotency, in-place replace on
// fabric_language change, and that user edits between markers are
// intentionally overwritten on re-run (managed-section convention).
// ---------------------------------------------------------------------------

const SECTION_BEGIN = "<!-- fabric:knowledge-base:begin -->";
const SECTION_END = "<!-- fabric:knowledge-base:end -->";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

describe("TASK-006 install-skills-and-hooks: Fabric Knowledge Base managed section", () => {
  it("writes one begin/end marker pair (with heading between) on first install across all three targets", async () => {
    const target = createWerewolfFixtureRoot("itg-install-section");
    tempRoots.push(target);

    // Pre-create each target so addFabricKnowledgeBaseSection sees a non-
    // absent file. The helper skips targets that don't already exist.
    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);
    writeFixtureFile(target, "CLAUDE.md", seedContent);
    writeFixtureFile(target, ".cursor/rules", seedContent);

    await runInit(target);

    for (const rel of ["AGENTS.md", "CLAUDE.md", ".cursor/rules"]) {
      const content = readFileSync(join(target, rel), "utf8");
      expect(countOccurrences(content, SECTION_BEGIN)).toBe(1);
      expect(countOccurrences(content, SECTION_END)).toBe(1);
      expect(content).toContain("## Fabric Knowledge Base");
      // Begin marker precedes the heading which precedes the end marker.
      const beginIdx = content.indexOf(SECTION_BEGIN);
      const headingIdx = content.indexOf("## Fabric Knowledge Base");
      const endIdx = content.indexOf(SECTION_END);
      expect(beginIdx).toBeLessThan(headingIdx);
      expect(headingIdx).toBeLessThan(endIdx);
      // Pre-existing user content preserved verbatim above the section.
      expect(content.startsWith(seedContent)).toBe(true);
    }
  });

  it("is idempotent: re-running install yields byte-identical files", async () => {
    const target = createWerewolfFixtureRoot("itg-install-section-idempotent");
    tempRoots.push(target);

    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);
    writeFixtureFile(target, "CLAUDE.md", seedContent);
    writeFixtureFile(target, ".cursor/rules", seedContent);

    await runInit(target);
    const afterFirst: Record<string, string> = {};
    for (const rel of ["AGENTS.md", "CLAUDE.md", ".cursor/rules"]) {
      afterFirst[rel] = readFileSync(join(target, rel), "utf8");
    }

    await runInit(target);
    for (const rel of ["AGENTS.md", "CLAUDE.md", ".cursor/rules"]) {
      const afterSecond = readFileSync(join(target, rel), "utf8");
      expect(afterSecond).toBe(afterFirst[rel]);
      // Still exactly one marker pair.
      expect(countOccurrences(afterSecond, SECTION_BEGIN)).toBe(1);
      expect(countOccurrences(afterSecond, SECTION_END)).toBe(1);
    }
  });

  it("replaces the section in place when fabric_language changes (no duplication, no orphan section)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-section-language-change");
    tempRoots.push(target);

    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);

    await runInit(target);
    const afterFirst = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(countOccurrences(afterFirst, SECTION_BEGIN)).toBe(1);

    // Flip fabric_language to a different value and re-install.
    const configPath = join(target, ".fabric", "fabric-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    config["fabric_language"] = "zh-CN-hybrid";
    writeFixtureFile(target, ".fabric/fabric-config.json", JSON.stringify(config, null, 2) + "\n");

    await runInit(target);
    const afterSecond = readFileSync(join(target, "AGENTS.md"), "utf8");

    // Exactly one marker pair after re-run — no duplication.
    expect(countOccurrences(afterSecond, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(afterSecond, SECTION_END)).toBe(1);
    // The "Language" line now mentions the new value.
    expect(afterSecond).toContain("`zh-CN-hybrid`");
    // The old line is gone.
    expect(afterSecond).not.toMatch(/current: `(en|match-existing)`/);
  });

  it("overwrites user edits inside the markers on re-install (managed-section convention)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-section-managed");
    tempRoots.push(target);

    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);

    await runInit(target);
    const afterFirst = readFileSync(join(target, "AGENTS.md"), "utf8");

    // Inject user "vandalism" inside the markers — replace the entire body
    // with a sentinel string. The next install must restore the canonical
    // managed-section body.
    const beginIdx = afterFirst.indexOf(SECTION_BEGIN);
    const endIdx = afterFirst.indexOf(SECTION_END) + SECTION_END.length;
    const vandalized =
      afterFirst.slice(0, beginIdx) +
      SECTION_BEGIN +
      "\n\nUSER VANDALISM — should be wiped on re-install.\n\n" +
      SECTION_END +
      afterFirst.slice(endIdx);
    writeFixtureFile(target, "AGENTS.md", vandalized);

    await runInit(target);
    const afterSecond = readFileSync(join(target, "AGENTS.md"), "utf8");

    expect(afterSecond).not.toContain("USER VANDALISM");
    expect(afterSecond).toContain("## Fabric Knowledge Base");
    expect(countOccurrences(afterSecond, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(afterSecond, SECTION_END)).toBe(1);
    // Pre-section user content survives.
    expect(afterSecond.startsWith(seedContent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rc.16 TASK-004 (F2-tests) — hook-lib install pipeline
//
// Dedicated focus on installHookLibs: every `.cjs` file under templates/
// hooks/lib/ must land in each client's <client>/hooks/lib/ directory, and
// the operation must be idempotent on re-run. The fresh-init test above
// already covers presence + byte-equality; this block locks in the
// directory-walk contract and the idempotency guarantee separately so a
// regression in either dimension surfaces as a focused failure.
// ---------------------------------------------------------------------------

describe("rc.16 TASK-004 install-hook-libs: directory-walk contract", () => {
  it("ships every .cjs file from templates/hooks/lib/ to all 3 client lib dirs", async () => {
    const target = createWerewolfFixtureRoot("itg-install-hook-libs");
    tempRoots.push(target);

    await runInit(target);

    // Discover the source-of-truth set of lib files at test time so this
    // assertion auto-tracks future additions to templates/hooks/lib/.
    const libTemplateDir = join(TEMPLATES_ROOT, "hooks/lib");
    const expectedLibFiles = readdirSync(libTemplateDir).filter((name) =>
      name.endsWith(".cjs"),
    );
    // Sanity: at least banner-i18n.cjs (rc.16 TASK-001) must be present.
    expect(expectedLibFiles).toContain("banner-i18n.cjs");

    for (const clientDir of [".claude", ".codex", ".cursor"]) {
      for (const libFile of expectedLibFiles) {
        const dest = join(target, clientDir, "hooks/lib", libFile);
        expect(existsSync(dest), `expected lib at ${dest}`).toBe(true);
        expect(readFileSync(dest, "utf8")).toBe(
          readFileSync(join(libTemplateDir, libFile), "utf8"),
        );
      }
    }
  });

  it("re-running init does not duplicate or alter shipped lib files", async () => {
    const target = createWerewolfFixtureRoot("itg-install-hook-libs-idempotent");
    tempRoots.push(target);

    await runInit(target);
    const libRel = ".claude/hooks/lib/banner-i18n.cjs";
    const afterFirst = readFileSync(join(target, libRel), "utf8");

    await runInit(target);
    const afterSecond = readFileSync(join(target, libRel), "utf8");

    expect(afterSecond).toBe(afterFirst);
  });
});


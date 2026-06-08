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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { BOOTSTRAP_CANONICAL } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import { installHooks } from "../../src/install/hooks-orchestrator.ts";
import { buildInitExecutionPlan, executeInitExecutionPlan } from "../../src/commands/install.ts";
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
  it("writes fabric skills + Stop + SessionStart + PreToolUse hooks + per-client configs", async () => {
    const target = createWerewolfFixtureRoot("itg-install-fresh");
    tempRoots.push(target);

    await runInit(target);

    const fabricSkillTemplate = readTemplate("skills/fabric/SKILL.md");
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

    // Fabric entry router copies — byte-identical
    const claudeFabricSkill = readFileSync(join(target, ".claude/skills/fabric/SKILL.md"), "utf8");
    const codexFabricSkill = readFileSync(join(target, ".codex/skills/fabric/SKILL.md"), "utf8");
    expect(claudeFabricSkill).toBe(fabricSkillTemplate);
    expect(codexFabricSkill).toBe(fabricSkillTemplate);

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

    // v2.2 SK1-audit (W2-T5): fabric-audit skill copies — byte-identical to template.
    const auditSkillTemplate = readTemplate("skills/fabric-audit/SKILL.md");
    const claudeAuditSkill = readFileSync(join(target, ".claude/skills/fabric-audit/SKILL.md"), "utf8");
    const codexAuditSkill = readFileSync(join(target, ".codex/skills/fabric-audit/SKILL.md"), "utf8");
    expect(claudeAuditSkill).toBe(auditSkillTemplate);
    expect(codexAuditSkill).toBe(auditSkillTemplate);

    // v2.2 SK2-connect (W3-T2): fabric-connect skill copies — byte-identical to template.
    const connectSkillTemplate = readTemplate("skills/fabric-connect/SKILL.md");
    const claudeConnectSkill = readFileSync(join(target, ".claude/skills/fabric-connect/SKILL.md"), "utf8");
    const codexConnectSkill = readFileSync(join(target, ".codex/skills/fabric-connect/SKILL.md"), "utf8");
    expect(claudeConnectSkill).toBe(connectSkillTemplate);
    expect(codexConnectSkill).toBe(connectSkillTemplate);

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
    expect(stopCommands).toContain("${CLAUDE_PROJECT_DIR}/.claude/hooks/fabric-hint.cjs");
  });

  // W2-02 (F4): the bootstrap stage merges hook CONFIGS that reference
  // cite-policy-evict.cjs, but previously never copied the SCRIPT — only the
  // downstream `hooks` stage did. A bootstrap-only install (skipHooks) thus
  // left configs pointing at a missing file. The script must now be copied by
  // the bootstrap stage too.
  it("bootstrap-only install copies cite-policy-evict.cjs the config references (F4)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-only-cite");
    tempRoots.push(target);

    const plan = await buildInitExecutionPlan({
      target,
      options: { skipMcp: true, skipHooks: true },
      interactive: false,
    });
    await executeInitExecutionPlan(plan);

    // The Claude config (written by the bootstrap stage) references the script...
    const settings = readFileSync(join(target, ".claude/settings.json"), "utf8");
    expect(settings).toContain("cite-policy-evict.cjs");
    // ...and the bootstrap stage must have copied the actual script too.
    expect(existsSync(join(target, ".claude/hooks/cite-policy-evict.cjs"))).toBe(true);
  });

  // W2-03 (F7): the bootstrap stage installed only 3 skills
  // (archive/review/import); sync/store/audit/connect + the shared skill lib
  // came only from the downstream hooks stage. A bootstrap-only install must
  // ship the complete skill set.
  it("bootstrap-only install ships all 8 skills + shared skill lib (F7)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-only-skills");
    tempRoots.push(target);

    const plan = await buildInitExecutionPlan({
      target,
      options: { skipMcp: true, skipHooks: true },
      interactive: false,
    });
    await executeInitExecutionPlan(plan);

    for (const skill of [
      "fabric",
      "fabric-archive",
      "fabric-review",
      "fabric-import",
      "fabric-sync",
      "fabric-store",
      "fabric-audit",
      "fabric-connect",
    ]) {
      expect(
        existsSync(join(target, ".claude/skills", skill, "SKILL.md")),
        `${skill}/SKILL.md should be installed by the bootstrap stage`,
      ).toBe(true);
    }
    // Shared skill lib the skills depend on.
    expect(existsSync(join(target, ".claude/skills/lib"))).toBe(true);
  });

  // W1-08 (F2): HOOK_CONFIG_ARRAY_PATHS.claudeCode lists "hooks.UserPromptSubmit"
  // so a user-defined UserPromptSubmit hook is append-with-dedupe-preserved on
  // install (never array-REPLACEd). The fabric template no longer ships a
  // UserPromptSubmit hook (v2.1 ⑤ moved cite-policy-evict to PreToolUse), so the
  // user entry survives untouched AND the cite-policy hook now lands under
  // hooks.PreToolUse alongside the narrow hint (one matcher, two hooks).
  it("preserves a user UserPromptSubmit hook entry + cite-policy moved to PreToolUse (F2)", async () => {
    const target = createWerewolfFixtureRoot("itg-install-ups");
    tempRoots.push(target);

    const customSettings = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: ".claude/hooks/my-ups-hook.cjs" }],
          },
        ],
      },
    };
    writeFixtureFile(target, ".claude/settings.json", JSON.stringify(customSettings, null, 2));

    await runInit(target);

    const merged = JSON.parse(
      readFileSync(join(target, ".claude/settings.json"), "utf8"),
    ) as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>;
        PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };

    const upsCommands = (merged.hooks?.UserPromptSubmit ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);
    // User entry preserved (not clobbered by array-REPLACE)...
    expect(upsCommands).toContain(".claude/hooks/my-ups-hook.cjs");
    // ...and the fabric template no longer adds anything to UserPromptSubmit.
    expect(upsCommands).not.toContain("${CLAUDE_PROJECT_DIR}/.claude/hooks/cite-policy-evict.cjs");

    // cite-policy-evict now rides PreToolUse (recall-based nudge).
    const preToolCommands = (merged.hooks?.PreToolUse ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);
    expect(preToolCommands).toContain("${CLAUDE_PROJECT_DIR}/.claude/hooks/cite-policy-evict.cjs");
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

  // v2.0.0-rc.27 TASK-004 (audit §2.6): legacy archive-hint.cjs is swept on
  // install. Pre-rc.5 workspaces registered hooks under the old
  // `archive-hint.cjs` name; the rc.5 TASK-010 rename to `fabric-hint.cjs`
  // did not retroactively remove those entries — re-running `fabric install`
  // would deepMerge the new entry alongside the legacy one and both fired
  // for every Stop event. rc.27 introduces stripStaleHookEntries to drop
  // any entry whose hook command basename is in FABRIC_HOOK_SCRIPT_BASENAMES
  // before the merge, so the canonical template entry becomes the sole
  // survivor.
  it("rc27 §2.6: install sweeps legacy archive-hint.cjs and any path-form duplicates", async () => {
    const target = createWerewolfFixtureRoot("itg-install-rc27-sweep");
    tempRoots.push(target);

    // First install establishes the canonical state.
    await runInit(target);
    const settingsPath = join(target, ".claude/settings.json");

    // Inject a legacy archive-hint.cjs entry alongside the canonical fabric-hint
    // entry, plus a sibling sigil-prefix duplicate of fabric-hint (simulating
    // an upgrade-time path-form drift).
    const polluted = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { Stop?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    if (!polluted.hooks) polluted.hooks = {};
    if (!polluted.hooks.Stop) polluted.hooks.Stop = [];
    polluted.hooks.Stop.push({
      matcher: "*",
      hooks: [{ type: "command", command: ".claude/hooks/archive-hint.cjs" }],
    });
    polluted.hooks.Stop.push({
      matcher: "*",
      hooks: [{ type: "command", command: ".claude/hooks/fabric-hint.cjs" }],
    });
    writeFileSync(settingsPath, JSON.stringify(polluted, null, 2), "utf8");

    // Re-run install — sweep should drop both injected entries before merge.
    await runInit(target);

    const settingsFinal = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks: Array<{ command: string }> }> };
    };
    const stopEntries = settingsFinal.hooks?.Stop ?? [];

    // Count entries whose any hook command basename ends in archive-hint.cjs.
    const archiveHintCount = stopEntries.filter((entry) =>
      entry.hooks.some((h) => h.command.endsWith("archive-hint.cjs")),
    ).length;
    expect(archiveHintCount).toBe(0);

    // Exactly one canonical fabric-hint entry remains (matched on basename).
    const fabricHintCount = stopEntries.filter((entry) =>
      entry.hooks.some((h) => {
        const m = /([^/\\]+\.cjs)$/u.exec(h.command);
        return m !== null && m[1] === "fabric-hint.cjs";
      }),
    ).length;
    expect(fabricHintCount).toBe(1);
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
// Test 8 — Three-end bootstrap propagation (rc.19 TASK-003)
//
// The legacy single-writer `addFabricKnowledgeBaseSection` (which emitted one
// HTML-comment-wrapped block per CLAUDE.md / AGENTS.md / .cursor/rules) was
// split into three per-client thin-shell writers backed by the L1 snapshot at
// `.fabric/AGENTS.md`. New propagation targets:
//
//   - CLAUDE.md                          — thin shell with `@.fabric/AGENTS.md`
//                                          `@`-import line (no managed block)
//   - AGENTS.md                          — Codex managed block, body byte-equal
//                                          to `.fabric/AGENTS.md`
//   - .cursor/rules/fabric-bootstrap.mdc — Cursor directory rule with YAML
//                                          front-matter (alwaysApply: true)
//                                          and a managed block, body byte-
//                                          equal to `.fabric/AGENTS.md`
//
// Marker constants moved to the new `fabric:bootstrap` pair. The legacy
// `fabric:knowledge-base` marker is intentionally never written by install;
// any pre-existing legacy region is stripped on first install (clean-slate
// migration; see memory feedback_clean_slate.md).
// ---------------------------------------------------------------------------

const SECTION_BEGIN = "<!-- fabric:bootstrap:begin -->";
const SECTION_END = "<!-- fabric:bootstrap:end -->";

const CURSOR_BOOTSTRAP_MDC_REL = ".cursor/rules/fabric-bootstrap.mdc";

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

/**
 * Extract the body of the BOOTSTRAP managed block from `content` (between but
 * excluding the markers and the marker-trailing newlines). Returns null if no
 * marker pair is present.
 */
function extractManagedBlockBody(content: string): string | null {
  const beginIdx = content.indexOf(SECTION_BEGIN);
  const endIdx = content.indexOf(SECTION_END);
  if (beginIdx === -1 || endIdx === -1) return null;
  // Body lives between `<begin>\n` and `\n<end>`.
  const innerStart = beginIdx + SECTION_BEGIN.length + 1; // skip newline after begin
  const innerEnd = endIdx - 1; // drop the newline before end
  return content.slice(innerStart, innerEnd);
}

describe("rc.19 TASK-003 bootstrap propagation: three-end managed block + thin shell", () => {
  it("writes .fabric/AGENTS.md byte-equal to BOOTSTRAP_CANONICAL + propagates to all three clients", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-propagation");
    tempRoots.push(target);

    await runInit(target);

    // L1 snapshot: .fabric/AGENTS.md exists with content byte-equal to canonical.
    const snapshotPath = join(target, ".fabric/AGENTS.md");
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = readFileSync(snapshotPath, "utf8");
    expect(snapshot).toBe(BOOTSTRAP_CANONICAL);

    // Codex: AGENTS.md at project root contains exactly one bootstrap marker
    // pair; the body between markers byte-equals the snapshot.
    const agentsMd = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(countOccurrences(agentsMd, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(agentsMd, SECTION_END)).toBe(1);
    const codexBody = extractManagedBlockBody(agentsMd);
    expect(codexBody).toBe(snapshot);

    // Cursor: directory rule file exists with YAML front-matter
    // (alwaysApply: true) + managed block byte-equal to snapshot.
    const cursorRulePath = join(target, CURSOR_BOOTSTRAP_MDC_REL);
    expect(existsSync(cursorRulePath)).toBe(true);
    const cursorRule = readFileSync(cursorRulePath, "utf8");
    expect(cursorRule).toContain("alwaysApply: true");
    // Front-matter sits at the head of the file (well before the marker).
    expect(cursorRule.indexOf("alwaysApply: true")).toBeLessThan(
      cursorRule.indexOf(SECTION_BEGIN),
    );
    expect(countOccurrences(cursorRule, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(cursorRule, SECTION_END)).toBe(1);
    const cursorBody = extractManagedBlockBody(cursorRule);
    expect(cursorBody).toBe(snapshot);

    // Claude: CLAUDE.md is a thin shell with `@.fabric/AGENTS.md` exactly once
    // and NO managed block (no `<!-- fabric:bootstrap:* -->` markers).
    const claudeMd = readFileSync(join(target, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain(SECTION_BEGIN);
    expect(claudeMd).not.toContain(SECTION_END);
    // Exactly one `@.fabric/AGENTS.md` line (whitespace-tolerant match per
    // install-side hasExactLine semantics).
    const importLines = claudeMd
      .split(/\r?\n/)
      .filter((l) => l.replace(/\s+$/, "") === "@.fabric/AGENTS.md");
    expect(importLines).toHaveLength(1);
  });

  it("is idempotent: re-running install yields byte-identical files across all targets", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-idempotent");
    tempRoots.push(target);

    await runInit(target);
    const afterFirst: Record<string, string> = {};
    for (const rel of [
      ".fabric/AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
      CURSOR_BOOTSTRAP_MDC_REL,
    ]) {
      afterFirst[rel] = readFileSync(join(target, rel), "utf8");
    }

    await runInit(target);
    for (const rel of [
      ".fabric/AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
      CURSOR_BOOTSTRAP_MDC_REL,
    ]) {
      const afterSecond = readFileSync(join(target, rel), "utf8");
      expect(afterSecond, `${rel} drifted on second install`).toBe(afterFirst[rel]);
    }
    // Codex + Cursor still have exactly one marker pair after re-run.
    const agentsMd = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(countOccurrences(agentsMd, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(agentsMd, SECTION_END)).toBe(1);
    const cursorRule = readFileSync(join(target, CURSOR_BOOTSTRAP_MDC_REL), "utf8");
    expect(countOccurrences(cursorRule, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(cursorRule, SECTION_END)).toBe(1);
  });

  it("preserves pre-existing user content above managed block in AGENTS.md", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-preserve-user");
    tempRoots.push(target);

    const seedContent = "# Project Notes\n\nUser-authored content here.\n";
    writeFixtureFile(target, "AGENTS.md", seedContent);

    await runInit(target);

    const content = readFileSync(join(target, "AGENTS.md"), "utf8");
    // User content survives above the managed block.
    expect(content.startsWith(seedContent)).toBe(true);
    // Single marker pair appended after.
    expect(countOccurrences(content, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(content, SECTION_END)).toBe(1);
    // Body byte-equals canonical.
    expect(extractManagedBlockBody(content)).toBe(BOOTSTRAP_CANONICAL);
  });

  it("overwrites user vandalism inside fabric:bootstrap markers on re-install", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-vandalism");
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
      "\nUSER VANDALISM - should be wiped on re-install.\n" +
      SECTION_END +
      afterFirst.slice(endIdx);
    writeFixtureFile(target, "AGENTS.md", vandalized);

    await runInit(target);
    const afterSecond = readFileSync(join(target, "AGENTS.md"), "utf8");

    expect(afterSecond).not.toContain("USER VANDALISM");
    // Body byte-equals canonical content again.
    expect(extractManagedBlockBody(afterSecond)).toBe(BOOTSTRAP_CANONICAL);
    expect(countOccurrences(afterSecond, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(afterSecond, SECTION_END)).toBe(1);
    // Pre-section user content survives.
    expect(afterSecond.startsWith(seedContent)).toBe(true);
  });

  it("migrates legacy .cursor/rules flat-file to .cursor/rules/fabric-bootstrap.mdc directory rule", async () => {
    const target = createWerewolfFixtureRoot("itg-install-bootstrap-cursor-migrate");
    tempRoots.push(target);

    // Seed the legacy state: `.cursor/rules` is a flat file (not a directory)
    // containing a stale legacy `fabric:knowledge-base` managed section.
    // Mirrors the rc.12-rc.18 install output that rc.19 now migrates away from.
    const legacyContent =
      "# User notes\n\n" +
      "<!-- fabric:knowledge-base:begin -->\n" +
      "## Fabric Knowledge Base\n\nLegacy body that must vanish.\n" +
      "<!-- fabric:knowledge-base:end -->\n";
    writeFixtureFile(target, ".cursor/rules", legacyContent);

    // Sanity: legacy flat file present BEFORE install.
    expect(existsSync(join(target, ".cursor/rules"))).toBe(true);
    expect(statSync(join(target, ".cursor/rules")).isFile()).toBe(true);

    await runInit(target);

    // Post-install: legacy flat file is gone — `.cursor/rules` is now a
    // DIRECTORY (the parent of the new `.mdc` directory rule), not the
    // legacy single-file blob.
    const cursorRulesPath = join(target, ".cursor/rules");
    expect(existsSync(cursorRulesPath)).toBe(true);
    expect(statSync(cursorRulesPath).isDirectory()).toBe(true);
    expect(statSync(cursorRulesPath).isFile()).toBe(false);

    // New directory rule exists at the canonical path.
    const newPath = join(target, CURSOR_BOOTSTRAP_MDC_REL);
    expect(existsSync(newPath)).toBe(true);
    const newContent = readFileSync(newPath, "utf8");

    // New file uses the new bootstrap marker and NOT the legacy marker.
    expect(newContent).toContain(SECTION_BEGIN);
    expect(newContent).toContain(SECTION_END);
    expect(newContent).not.toContain("fabric:knowledge-base");
    // Exactly one bootstrap marker pair.
    expect(countOccurrences(newContent, SECTION_BEGIN)).toBe(1);
    expect(countOccurrences(newContent, SECTION_END)).toBe(1);
    // Front-matter is present.
    expect(newContent).toContain("alwaysApply: true");
    // Body byte-equals canonical (no project-rules.md present in this scenario).
    expect(extractManagedBlockBody(newContent)).toBe(BOOTSTRAP_CANONICAL);
  });

  describe("project-rules.md only-if-exists concat behavior", () => {
    it("Scenario A: without .fabric/project-rules.md — Codex block body byte-equals .fabric/AGENTS.md", async () => {
      const target = createWerewolfFixtureRoot("itg-install-bootstrap-project-rules-absent");
      tempRoots.push(target);

      await runInit(target);

      const snapshot = readFileSync(join(target, ".fabric/AGENTS.md"), "utf8");
      const agentsMd = readFileSync(join(target, "AGENTS.md"), "utf8");
      // No separator, no concat — body byte-equals snapshot alone.
      expect(extractManagedBlockBody(agentsMd)).toBe(snapshot);
      expect(snapshot).toBe(BOOTSTRAP_CANONICAL);

      // Idempotent re-run: same bytes.
      const before = readFileSync(join(target, "AGENTS.md"), "utf8");
      await runInit(target);
      const after = readFileSync(join(target, "AGENTS.md"), "utf8");
      expect(after).toBe(before);
    });

    it("Scenario B: with .fabric/project-rules.md — Codex block body = snapshot + '\\n---\\n' + rules", async () => {
      const target = createWerewolfFixtureRoot("itg-install-bootstrap-project-rules-present");
      tempRoots.push(target);

      // Seed the user-authored project-rules.md BEFORE init so the propagator
      // picks it up on first run.
      writeFixtureFile(target, ".fabric/project-rules.md", "CUSTOM RULES\n");

      await runInit(target);

      const snapshot = readFileSync(join(target, ".fabric/AGENTS.md"), "utf8");
      const agentsMd = readFileSync(join(target, "AGENTS.md"), "utf8");

      const expectedBody = `${snapshot}\n---\nCUSTOM RULES\n`;
      expect(extractManagedBlockBody(agentsMd)).toBe(expectedBody);

      // Cursor block body uses the same concat.
      const cursorRule = readFileSync(join(target, CURSOR_BOOTSTRAP_MDC_REL), "utf8");
      expect(extractManagedBlockBody(cursorRule)).toBe(expectedBody);

      // Idempotent re-run: same bytes across both targets.
      const beforeAgents = readFileSync(join(target, "AGENTS.md"), "utf8");
      const beforeCursor = readFileSync(join(target, CURSOR_BOOTSTRAP_MDC_REL), "utf8");
      await runInit(target);
      expect(readFileSync(join(target, "AGENTS.md"), "utf8")).toBe(beforeAgents);
      expect(readFileSync(join(target, CURSOR_BOOTSTRAP_MDC_REL), "utf8")).toBe(beforeCursor);

      // user-authored project-rules.md is preserved byte-for-byte.
      expect(readFileSync(join(target, ".fabric/project-rules.md"), "utf8")).toBe("CUSTOM RULES\n");
    });
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


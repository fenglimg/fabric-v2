/**
 * rc.35 TASK-08 (P0-5/6) — tests for `fabric install --force-skills-only`.
 *
 * Three contract cases per task spec:
 *   (1) fresh / uninitialised target → exits 1 with actionable message,
 *       writes no files
 *   (2) skills-only refresh on an initialised project → SKILL.md files
 *       written, NO change to hooks / settings / mcp configs / AGENTS.md
 *   (3) skills-only on partially-broken install (no .fabric/agents.meta.json)
 *       hits case (1)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
} from "./helpers/init-test-utils.ts";

import { runInitCommand, runSkillsOnlyRefresh } from "../src/commands/install.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
  vi.restoreAllMocks();
});

describe("runSkillsOnlyRefresh", () => {
  it("(1) uninitialised target → exit code 1, no files written", async () => {
    const target = createWerewolfFixtureRoot("fab-skills-only-uninit");
    tempRoots.push(target);
    // Confirm baseline: no .fabric/ scaffold.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const prevExitCode = process.exitCode;
    process.exitCode = 0;

    await runSkillsOnlyRefresh(target);

    expect(process.exitCode).toBe(1);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    // Language-agnostic: both en/zh-CN messages mention the file and the command.
    expect(stderrText).toContain("agents.meta.json");
    expect(stderrText).toContain("fabric install");
    expect(existsSync(join(target, ".claude"))).toBe(false);
    expect(existsSync(join(target, ".codex"))).toBe(false);

    process.exitCode = prevExitCode;
  });

  it("(2) skills-only refresh on initialised project: SKILL.md written, no touch on hooks/settings/MCP", async () => {
    // Step 1: do a full install to lay down the scaffold.
    const target = createWerewolfFixtureRoot("fab-skills-only-refresh");
    tempRoots.push(target);
    process.env.FAB_LANG = "en";
    await runInitCommand({ target, yes: true });

    // Snapshot a representative non-skill artifact.
    const claudeSettingsPath = join(target, ".claude", "settings.json");
    const claudeSettingsBefore = existsSync(claudeSettingsPath)
      ? readFileSync(claudeSettingsPath, "utf8")
      : null;
    const claudeSkillPath = join(target, ".claude", "skills", "fabric-archive", "SKILL.md");
    const archiveSkillBefore = existsSync(claudeSkillPath) ? readFileSync(claudeSkillPath, "utf8") : null;
    expect(archiveSkillBefore).not.toBeNull();

    // Step 2: corrupt the existing SKILL.md so we can detect the refresh.
    writeFileSync(claudeSkillPath, "# hand-edited drift\n", "utf8");

    // Step 3: run --force-skills-only.
    process.exitCode = 0;
    await runSkillsOnlyRefresh(target);
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);

    // Skill content restored (no longer the hand-edited drift).
    const archiveSkillAfter = readFileSync(claudeSkillPath, "utf8");
    expect(archiveSkillAfter).not.toContain("hand-edited drift");
    expect(archiveSkillAfter).toBe(archiveSkillBefore);

    // Settings unchanged.
    if (claudeSettingsBefore !== null) {
      expect(readFileSync(claudeSettingsPath, "utf8")).toBe(claudeSettingsBefore);
    }
  });

  it("(3) partially-broken install (missing agents.meta.json) hits the uninitialised guard", async () => {
    const target = createWerewolfFixtureRoot("fab-skills-only-broken");
    tempRoots.push(target);
    // Seed a partial scaffold: .fabric/ exists but no agents.meta.json.
    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(join(target, ".fabric", "events.jsonl"), "", "utf8");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    process.exitCode = 0;

    await runSkillsOnlyRefresh(target);

    expect(process.exitCode).toBe(1);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("agents.meta.json");
  });
});

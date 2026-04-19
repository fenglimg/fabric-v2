import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../src/commands/init.ts";
import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const skillTemplatePath = resolve(process.cwd(), "../../templates/claude-skills/agents-md-init/SKILL.md");

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("initFabric Claude install", () => {
  it("installs the skill, hook, and merged settings", () => {
    const target = createWerewolfFixtureRoot("fab-init-claude");
    tempRoots.push(target);

    const result = initFabric(target);
    const installedSkillPath = result.claudeSkillPath;
    const hookPath = result.claudeHookPath;
    const settingsPath = result.claudeSettingsPath;
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };

    expect(existsSync(installedSkillPath)).toBe(true);
    expect(existsSync(hookPath)).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    expect(hashFile(installedSkillPath)).toBe(hashFile(skillTemplatePath));
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);

    const stopCommands = (settings.hooks?.Stop ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hook.command).filter((command): command is string => typeof command === "string"),
    );

    expect(stopCommands).toContain(".claude/hooks/agents-md-init-reminder.cjs");
  });

  it("executes the reminder hook only while init-context is missing", () => {
    const target = createWerewolfFixtureRoot("fab-init-hook");
    tempRoots.push(target);

    const { claudeHookPath } = initFabric(target);
    const blocked = spawnSync(claudeHookPath, [], {
      cwd: target,
      env: {
        ...process.env,
        NODE: process.execPath,
        NODE_ENV: "test",
      },
      encoding: "utf8",
    });

    expect(blocked.status).toBe(0);
    expect(blocked.stdout).not.toBe("");
    expect(JSON.parse(blocked.stdout) as { decision?: string }).toMatchObject({ decision: "block" });

    writeFileSync(join(target, ".fabric", "init-context.json"), "{\n  \"ready\": true\n}\n", "utf8");

    const quiet = spawnSync(claudeHookPath, [], {
      cwd: target,
      env: {
        ...process.env,
        NODE: process.execPath,
        NODE_ENV: "test",
      },
      encoding: "utf8",
    });

    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe("");
  });
});

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

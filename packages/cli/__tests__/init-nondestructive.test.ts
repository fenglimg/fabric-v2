import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../src/commands/init.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  readFixtureFile,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("initFabric non-destructive behavior", () => {
  it("aborts when AGENTS.md already exists and keeps the file intact", () => {
    const target = createWerewolfFixtureRoot("fab-init-agents-guard");
    tempRoots.push(target);
    const original = "# custom agents\n";

    writeFixtureFile(target, "AGENTS.md", original);

    expect(() => initFabric(target)).toThrowError(`${target}/AGENTS.md`);
    expect(readFixtureFile(target, "AGENTS.md")).toBe(original);
    expect(existsSync(`${target}/.fabric`)).toBe(false);
  });

  it("aborts when forensic.json already exists and does not overwrite it", () => {
    const target = createWerewolfFixtureRoot("fab-init-forensic-guard");
    tempRoots.push(target);
    const original = "{\n  \"existing\": true\n}\n";

    writeFixtureFile(target, ".fabric/forensic.json", original);

    expect(() => initFabric(target)).toThrowError(
      `${target}/.fabric/forensic.json`,
    );
    expect(readFixtureFile(target, ".fabric/forensic.json")).toBe(original);
  });

  it("merges the Claude Stop hook with an existing settings file", () => {
    const target = createWerewolfFixtureRoot("fab-init-settings-merge");
    tempRoots.push(target);

    writeFixtureFile(
      target,
      ".claude/settings.json",
      `${JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: ".claude/hooks/existing-stop-hook.cjs" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = initFabric(target);
    const settings = JSON.parse(readFileSync(result.claudeSettingsPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const stopCommands = (settings.hooks?.Stop ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hook.command).filter((command): command is string => typeof command === "string"),
    );

    expect(stopCommands).toContain(".claude/hooks/existing-stop-hook.cjs");
    expect(stopCommands).toContain(".claude/hooks/agents-md-init-reminder.cjs");
    expect(stopCommands).toHaveLength(2);
  });

  it("keeps a pre-existing custom skill file unchanged while finishing init", () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-skill");
    tempRoots.push(target);
    const original = "# custom skill\n";

    writeFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md", original);

    const result = initFabric(target);

    expect(result.claudeSkillAction).toBe("skipped");
    expect(readFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md")).toBe(original);
    expect(existsSync(result.forensicPath)).toBe(true);
  });
});

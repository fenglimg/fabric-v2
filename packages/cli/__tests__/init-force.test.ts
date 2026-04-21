import { readFileSync } from "node:fs";

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

describe("initFabric force behavior", () => {
  it("overwrites an existing AGENTS.md when force is enabled", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-agents");
    const control = createWerewolfFixtureRoot("fab-init-force-agents-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, "AGENTS.md", "# custom agents\n");

    const result = initFabric(target, { force: true });
    initFabric(control);

    expect(result.agentsAction).toBe("overwritten");
    expect(readFixtureFile(target, "AGENTS.md")).toBe(readFixtureFile(control, "AGENTS.md"));
  });

  it("overwrites a pre-existing Claude skill file when force is enabled", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-skill");
    const control = createWerewolfFixtureRoot("fab-init-force-skill-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md", "# custom skill\n");

    const result = initFabric(target, { force: true });
    initFabric(control);

    expect(result.claudeSkillAction).toBe("overwritten");
    expect(readFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md")).toBe(
      readFixtureFile(control, ".claude/skills/agents-md-init/SKILL.md"),
    );
  });

  it("overwrites a pre-existing Claude reminder hook when force is enabled", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-hook");
    const control = createWerewolfFixtureRoot("fab-init-force-hook-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".claude/hooks/agents-md-init-reminder.cjs", "console.log('custom');\n");

    const result = initFabric(target, { force: true });
    initFabric(control);

    expect(result.claudeHookAction).toBe("overwritten");
    expect(readFixtureFile(target, ".claude/hooks/agents-md-init-reminder.cjs")).toBe(
      readFixtureFile(control, ".claude/hooks/agents-md-init-reminder.cjs"),
    );
  });

  it("replaces only the Fabric Claude Stop hook while preserving user settings", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-settings");
    tempRoots.push(target);

    writeFixtureFile(
      target,
      ".claude/settings.json",
      `${JSON.stringify(
        {
          permissions: {
            allow: ["Bash(git status)"],
          },
          hooks: {
            Stop: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: ".claude/hooks/agents-md-init-reminder.cjs --old" }],
              },
              {
                matcher: "manual",
                hooks: [{ type: "command", command: ".claude/hooks/user-stop-hook.cjs" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = initFabric(target, { force: true });
    const settings = JSON.parse(readFileSync(result.claudeSettingsPath, "utf8")) as {
      permissions?: { allow?: string[] };
      hooks?: { Stop?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    const stopCommands = (settings.hooks?.Stop ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hook.command).filter((command): command is string => typeof command === "string"),
    );

    expect(result.claudeSettingsAction).toBe("overwritten");
    expect(settings.permissions).toEqual({
      allow: ["Bash(git status)"],
    });
    expect(stopCommands.filter((command) => command.includes("agents-md-init-reminder.cjs"))).toEqual([
      ".claude/hooks/agents-md-init-reminder.cjs",
    ]);
    expect(stopCommands).toContain(".claude/hooks/user-stop-hook.cjs");
  });

  it("still aborts on a pre-existing guard file when force is not enabled", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-guard");
    tempRoots.push(target);
    const original = "# custom agents\n";

    writeFixtureFile(target, "AGENTS.md", original);

    expect(() => initFabric(target)).toThrowError(`ABORT: ${target}/AGENTS.md already exists. fab init is non-destructive.`);
    expect(readFixtureFile(target, "AGENTS.md")).toBe(original);
  });

  it("remains non-destructive for an already initialized project without options", () => {
    const target = createWerewolfFixtureRoot("fab-init-force-regression");
    tempRoots.push(target);

    initFabric(target);

    expect(() => initFabric(target)).toThrowError(
      `ABORT: ${target}/.fabric/forensic.json already exists. fab init is non-destructive.`,
    );
  });
});

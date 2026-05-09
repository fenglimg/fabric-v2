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
  it("overwrites an existing internal bootstrap guide when force is enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-agents");
    const control = createWerewolfFixtureRoot("fab-init-force-agents-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".fabric/bootstrap/README.md", "# custom bootstrap\n");

    const result = await initFabric(target, { force: true });
    await initFabric(control);

    expect(result.bootstrapAction).toBe("overwritten");
    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).toBe(
      readFixtureFile(control, ".fabric/bootstrap/README.md"),
    );
  });

  it("overwrites a pre-existing Claude skill file when force is enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-skill");
    const control = createWerewolfFixtureRoot("fab-init-force-skill-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".claude/skills/fabric-init/SKILL.md", "# custom skill\n");

    const result = await initFabric(target, { force: true });
    await initFabric(control);

    expect(result.claudeSkillAction).toBe("overwritten");
    expect(readFixtureFile(target, ".claude/skills/fabric-init/SKILL.md")).toBe(
      readFixtureFile(control, ".claude/skills/fabric-init/SKILL.md"),
    );
  });

  it("overwrites a pre-existing Claude reminder hook when force is enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-hook");
    const control = createWerewolfFixtureRoot("fab-init-force-hook-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".claude/hooks/fabric-init-reminder.cjs", "console.log('custom');\n");

    const result = await initFabric(target, { force: true });
    await initFabric(control);

    expect(result.claudeHookAction).toBe("overwritten");
    expect(readFixtureFile(target, ".claude/hooks/fabric-init-reminder.cjs")).toBe(
      readFixtureFile(control, ".claude/hooks/fabric-init-reminder.cjs"),
    );
  });

  it("overwrites a pre-existing Codex repo skill when force is enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-codex-skill");
    const control = createWerewolfFixtureRoot("fab-init-force-codex-skill-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".agents/skills/fabric-init/SKILL.md", "# custom codex skill\n");

    const result = await initFabric(target, { force: true });
    await initFabric(control);

    expect(result.codexSkillAction).toBe("overwritten");
    expect(readFixtureFile(target, ".agents/skills/fabric-init/SKILL.md")).toBe(
      readFixtureFile(control, ".agents/skills/fabric-init/SKILL.md"),
    );
  });

  it("overwrites a pre-existing Codex hooks config when force is enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-codex-hooks");
    const control = createWerewolfFixtureRoot("fab-init-force-codex-hooks-control");
    tempRoots.push(target, control);

    writeFixtureFile(target, ".codex/hooks.json", '{\n  "hooks": { "Stop": [] }\n}\n');

    const result = await initFabric(target, { force: true });
    await initFabric(control);

    expect(result.codexHooksConfigAction).toBe("overwritten");
    expect(readFixtureFile(target, ".codex/hooks.json")).toBe(
      readFixtureFile(control, ".codex/hooks.json"),
    );
  });

  it("replaces only the Fabric Claude Stop hook while preserving user settings", async () => {
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
                hooks: [{ type: "command", command: ".claude/hooks/fabric-init-reminder.cjs --old" }],
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

    const result = await initFabric(target, { force: true });
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
    expect(stopCommands.filter((command) => command.includes("fabric-init-reminder.cjs"))).toEqual([
      ".claude/hooks/fabric-init-reminder.cjs",
    ]);
    expect(stopCommands).toContain(".claude/hooks/user-stop-hook.cjs");
  });

  it("still aborts on a pre-existing guard file when force is not enabled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-guard");
    tempRoots.push(target);
    const original = "# custom bootstrap\n";

    writeFixtureFile(target, ".fabric/bootstrap/README.md", original);

    await expect(initFabric(target)).rejects.toThrowError(`${target}/.fabric/bootstrap/README.md`);
    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).toBe(original);
  });

  it("remains non-destructive for an already initialized project without options", async () => {
    const target = createWerewolfFixtureRoot("fab-init-force-regression");
    tempRoots.push(target);

    await initFabric(target);

    await expect(initFabric(target)).rejects.toThrowError(
      `${target}/.fabric/bootstrap/README.md`,
    );
  });
});

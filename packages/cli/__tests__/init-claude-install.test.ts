import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../src/commands/init.ts";
import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const skillTemplatePath = resolve(process.cwd(), "../../templates/claude-skills/fabric-init/SKILL.md");
const codexSkillTemplatePath = resolve(process.cwd(), "../../templates/codex-skills/fabric-init/SKILL.md");

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("initFabric Claude install", () => {
  it("installs the skill, hook, and merged settings", async () => {
    const target = createWerewolfFixtureRoot("fab-init-claude");
    tempRoots.push(target);

    const result = await initFabric(target);
    const installedSkillPath = result.claudeSkillPath;
    const installedCodexSkillPath = result.codexSkillPath;
    const installedCodexHooksPath = result.codexHooksConfigPath;
    const installedCodexSessionStartHookPath = result.codexSessionStartHookPath;
    const installedCodexStopHookPath = result.codexStopHookPath;
    const hookPath = result.claudeHookPath;
    const settingsPath = result.claudeSettingsPath;
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };

    expect(existsSync(installedSkillPath)).toBe(true);
    expect(existsSync(installedCodexSkillPath)).toBe(true);
    expect(existsSync(installedCodexHooksPath)).toBe(true);
    expect(existsSync(installedCodexSessionStartHookPath)).toBe(true);
    expect(existsSync(installedCodexStopHookPath)).toBe(true);
    expect(existsSync(hookPath)).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    expect(existsSync(join(target, ".fabric", "bootstrap", "README.md"))).toBe(true);
    expect(hashFile(installedSkillPath)).toBe(hashFile(skillTemplatePath));
    expect(hashFile(installedCodexSkillPath)).toBe(hashFile(codexSkillTemplatePath));
    expect(statSync(installedCodexSessionStartHookPath).mode & 0o111).not.toBe(0);
    expect(statSync(installedCodexStopHookPath).mode & 0o111).not.toBe(0);
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);

    const stopCommands = (settings.hooks?.Stop ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hook.command).filter((command): command is string => typeof command === "string"),
    );

    expect(stopCommands).toContain(".claude/hooks/fabric-init-reminder.cjs");
    expect(readFileSync(installedCodexHooksPath, "utf8")).toContain(".codex/hooks/fabric-session-start.cjs");
    expect(readFileSync(installedCodexHooksPath, "utf8")).toContain(".codex/hooks/fabric-stop-reminder.cjs");
    expect(readFileSync(join(target, ".fabric", "bootstrap", "README.md"), "utf8")).toContain("Fabric Bootstrap Protocol");
  });

  it("keeps bootstrap content internal instead of writing a root Claude file", async () => {
    const target = createWerewolfFixtureRoot("fab-init-claude-bootstrap-thin");
    tempRoots.push(target);

    const { installBootstrap } = await import("../src/commands/bootstrap.ts");
    await installBootstrap(target, { clients: ["ClaudeCodeCLI"] });

    const guidePath = join(target, ".fabric", "bootstrap", "README.md");
    expect(existsSync(guidePath)).toBe(true);
    expect(existsSync(join(target, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(target, "GEMINI.md"))).toBe(false);
    expect(existsSync(join(target, "AGENTS.md"))).toBe(false);
    expect(readFileSync(guidePath, "utf8")).toContain("Fabric Bootstrap Protocol");
  });

  it("executes the reminder hook only while init-context is missing", async () => {
    const target = createWerewolfFixtureRoot("fab-init-hook");
    tempRoots.push(target);

    const { claudeHookPath } = await initFabric(target);
    const blocked = spawnSync(process.execPath, [claudeHookPath], {
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

    const quiet = spawnSync(process.execPath, [claudeHookPath], {
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

  it("executes the Codex stop hook only while init-context is missing", async () => {
    const target = createWerewolfFixtureRoot("fab-init-codex-hook");
    tempRoots.push(target);

    const { codexStopHookPath } = await initFabric(target);
    const blocked = spawnSync(process.execPath, [codexStopHookPath], {
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

    const quiet = spawnSync(process.execPath, [codexStopHookPath], {
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

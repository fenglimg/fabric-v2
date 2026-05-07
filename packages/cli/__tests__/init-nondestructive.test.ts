import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { buildInitExecutionPlan, buildInitFabricPlan, initFabric } from "../src/commands/init.ts";
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
  it("builds a scaffold plan without writing files before execution", async () => {
    const target = createWerewolfFixtureRoot("fab-init-plan-only");
    tempRoots.push(target);

    const plan = await buildInitFabricPlan(target);

    expect(plan.bootstrapAction).toBe("created");
    expect(plan.metaAction).toBe("created");
    expect((plan as { taxonomyAction?: string }).taxonomyAction).toBe("created");
    expect((plan as { taxonomyContent?: string }).taxonomyContent).toContain("Fabric Initial Taxonomy");
    expect((plan as { taxonomyContent?: string }).taxonomyContent).toContain("L0");
    expect((plan as { taxonomyContent?: string }).taxonomyContent).toContain("L1");
    expect((plan as { taxonomyContent?: string }).taxonomyContent).toContain("L2");
    expect(existsSync(`${target}/.fabric/bootstrap/README.md`)).toBe(false);
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/INITIAL_TAXONOMY.md`)).toBe(false);
    expect(plan.codexHooksConfig.action).toBe("created");
  });

  it("writes a Markdown-only initial taxonomy artifact during init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-taxonomy");
    tempRoots.push(target);

    const result = await initFabric(target);
    const taxonomyPath = `${target}/.fabric/INITIAL_TAXONOMY.md`;
    const taxonomy = readFixtureFile(target, ".fabric/INITIAL_TAXONOMY.md");

    expect((result as { taxonomyPath?: string }).taxonomyPath).toBe(taxonomyPath);
    expect((result as { taxonomyAction?: string }).taxonomyAction).toBe("created");
    expect(taxonomy).toContain("# Fabric Initial Taxonomy");
    expect(taxonomy).toContain("L0");
    expect(taxonomy).toContain("L1");
    expect(taxonomy).toContain("L2");
    expect(taxonomy).toContain("Evolution Guide");
    expect(existsSync(`${target}/.fabric/INITIAL_TAXONOMY.json`)).toBe(false);
  });

  it("builds an execution plan that preserves staged init order without writing files", async () => {
    const target = createWerewolfFixtureRoot("fab-init-execution-plan");
    tempRoots.push(target);

    const plan = await buildInitExecutionPlan({
      target,
      options: { skipBootstrap: true },
      mcpInstallMode: "local",
      interactive: true,
    });

    expect(plan.steps.map((step) => step.name)).toEqual([
      "preflight",
      "scaffold",
      "bootstrap",
      "mcp",
      "hooks",
      "post-setup",
    ]);
    expect(plan.stages).toEqual([
      { name: "bootstrap", skipped: true },
      {
        name: "mcp",
        skipped: false,
        installMode: "local",
        claudeMcpScope: "project",
        localServerPath: "node_modules/@fenglimg/fabric-server/dist/index.js",
        packageManager: "npm",
      },
      { name: "hooks", skipped: false },
    ]);
    expect(existsSync(`${target}/.fabric/bootstrap/README.md`)).toBe(false);
  });

  it("aborts when the internal bootstrap guide already exists and keeps the file intact", async () => {
    const target = createWerewolfFixtureRoot("fab-init-agents-guard");
    tempRoots.push(target);
    const original = "# custom bootstrap\n";

    writeFixtureFile(target, ".fabric/bootstrap/README.md", original);

    await expect(initFabric(target)).rejects.toThrowError(`${target}/.fabric/bootstrap/README.md`);
    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).toBe(original);
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(false);
  });

  it("aborts when forensic.json already exists and does not overwrite it", async () => {
    const target = createWerewolfFixtureRoot("fab-init-forensic-guard");
    tempRoots.push(target);
    const original = "{\n  \"existing\": true\n}\n";

    writeFixtureFile(target, ".fabric/forensic.json", original);

    await expect(initFabric(target)).rejects.toThrowError(
      `${target}/.fabric/forensic.json`,
    );
    expect(readFixtureFile(target, ".fabric/forensic.json")).toBe(original);
  });

  it("merges the Claude Stop hook with an existing settings file", async () => {
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

    const result = await initFabric(target);
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

  it("keeps a pre-existing custom skill file unchanged while finishing init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-skill");
    tempRoots.push(target);
    const original = "# custom skill\n";

    writeFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md", original);

    const result = await initFabric(target);

    expect(result.claudeSkillAction).toBe("skipped");
    expect(readFixtureFile(target, ".claude/skills/agents-md-init/SKILL.md")).toBe(original);
    expect(existsSync(result.forensicPath)).toBe(true);
  });

  it("keeps a pre-existing custom Codex repo skill unchanged while finishing init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-codex-skill");
    tempRoots.push(target);
    const original = "# custom codex skill\n";

    writeFixtureFile(target, ".agents/skills/fabric-init/SKILL.md", original);

    const result = await initFabric(target);

    expect(result.codexSkillAction).toBe("skipped");
    expect(readFixtureFile(target, ".agents/skills/fabric-init/SKILL.md")).toBe(original);
    expect(existsSync(result.forensicPath)).toBe(true);
  });

  it("keeps a pre-existing Codex hooks config unchanged while finishing init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-codex-hooks");
    tempRoots.push(target);
    const original = '{\n  "hooks": {}\n}\n';

    writeFixtureFile(target, ".codex/hooks.json", original);

    const result = await initFabric(target);

    expect(result.codexHooksConfigAction).toBe("skipped");
    expect(readFixtureFile(target, ".codex/hooks.json")).toBe(original);
    expect(existsSync(result.forensicPath)).toBe(true);
  });
});

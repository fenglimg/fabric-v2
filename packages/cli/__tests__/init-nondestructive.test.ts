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

    // v2.0: scaffold plans target the knowledge layout + agents.meta + ledger.
    expect(plan.knowledgeDirAction).toBe("created");
    expect(plan.metaAction).toBe("created");
    // Legacy v1.x bootstrap/taxonomy fields no longer exist on the plan.
    expect((plan as { bootstrapAction?: string }).bootstrapAction).toBeUndefined();
    expect((plan as { taxonomyAction?: string }).taxonomyAction).toBeUndefined();
    expect(existsSync(`${target}/.fabric/bootstrap/README.md`)).toBe(false);
    expect(existsSync(`${target}/.fabric/knowledge`)).toBe(false);
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/INITIAL_TAXONOMY.md`)).toBe(false);
    expect(plan.codexHooksConfig.action).toBe("created");
  });

  it("does NOT generate the legacy INITIAL_TAXONOMY.md artifact during init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-no-taxonomy");
    tempRoots.push(target);

    await initFabric(target);

    // v2.0: knowledge entries (frontmatter `layer:`/`type:`) replace the
    // monolithic INITIAL_TAXONOMY.md. The legacy file must not be created.
    expect(existsSync(`${target}/.fabric/INITIAL_TAXONOMY.md`)).toBe(false);
    expect(existsSync(`${target}/.fabric/INITIAL_TAXONOMY.json`)).toBe(false);
    // Knowledge subdirs are present instead.
    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      expect(existsSync(`${target}/.fabric/knowledge/${sub}`)).toBe(true);
    }
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

  it("does NOT overwrite a pre-existing legacy `.fabric/bootstrap/README.md` (v2.0 leaves it untouched)", async () => {
    const target = createWerewolfFixtureRoot("fab-init-legacy-bootstrap-untouched");
    tempRoots.push(target);
    const original = "# legacy bootstrap\n";

    writeFixtureFile(target, ".fabric/bootstrap/README.md", original);

    // v2.0 init does not produce or touch the legacy bootstrap file. doctor's
    // legacy_v1_artifacts_present check (warn-only) handles surface visibility.
    await initFabric(target);
    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).toBe(original);
    // The v2.0 layout is created alongside the untouched legacy file.
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(true);
    expect(existsSync(`${target}/.fabric/knowledge/decisions`)).toBe(true);
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
    expect(stopCommands).toContain(".claude/hooks/fabric-init-reminder.cjs");
    expect(stopCommands).toHaveLength(2);
  });

  it("keeps a pre-existing custom skill file unchanged while finishing init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-skill");
    tempRoots.push(target);
    const original = "# custom skill\n";

    writeFixtureFile(target, ".claude/skills/fabric-init/SKILL.md", original);

    const result = await initFabric(target);

    expect(result.claudeSkillAction).toBe("skipped");
    expect(readFixtureFile(target, ".claude/skills/fabric-init/SKILL.md")).toBe(original);
    expect(existsSync(result.forensicPath)).toBe(true);
  });

  it("keeps a pre-existing custom Codex repo skill unchanged while finishing init", async () => {
    const target = createWerewolfFixtureRoot("fab-init-custom-codex-skill");
    tempRoots.push(target);
    const original = "# custom codex skill\n";

    writeFixtureFile(target, ".codex/skills/fabric-init/SKILL.md", original);

    const result = await initFabric(target);

    expect(result.codexSkillAction).toBe("skipped");
    expect(readFixtureFile(target, ".codex/skills/fabric-init/SKILL.md")).toBe(original);
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

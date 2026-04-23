import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildInitExecutionPlan,
  executeInitExecutionPlan,
  resolveInitExecutionPlanWithWizard,
  shouldUseInitWizard,
} from "../src/commands/init.ts";
import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  vi.restoreAllMocks();
});

describe("init wizard planning", () => {
  it("enables the wizard by default in TTY mode unless --yes is set", async () => {
    expect(shouldUseInitWizard({ interactive: true, yes: false }, true)).toBe(true);
    expect(shouldUseInitWizard({ interactive: undefined, yes: undefined }, true)).toBe(true);
    expect(shouldUseInitWizard({ interactive: false, yes: false }, true)).toBe(false);
    expect(shouldUseInitWizard({ interactive: true, yes: true }, true)).toBe(false);
    expect(shouldUseInitWizard({ interactive: true, yes: false }, false)).toBe(false);
  });

  it("rewrites the execution plan from wizard selections", async () => {
    const target = createWerewolfFixtureRoot("fab-init-wizard-plan");
    tempRoots.push(target);

    const basePlan = await buildInitExecutionPlan({
      target,
      options: {},
      mcpInstallMode: "global",
      interactive: false,
    });

    const nextPlan = await resolveInitExecutionPlanWithWizard(
      basePlan,
      {},
      {
        run: vi.fn().mockResolvedValue({
          bootstrap: true,
          mcp: true,
          hooks: false,
          mcpInstallMode: "local",
        }),
      },
    );

    expect(nextPlan).not.toBeNull();
    expect(nextPlan?.interactive).toBe(false);
    expect(nextPlan?.options).toMatchObject({
      skipBootstrap: false,
      skipMcp: false,
      skipHooks: true,
    });
    expect(nextPlan?.mcpInstallMode).toBe("local");
    expect(nextPlan?.stages).toEqual([
      { name: "bootstrap", skipped: false },
      {
        name: "mcp",
        skipped: false,
        installMode: "local",
        localServerPath: "node_modules/@fenglimg/fabric-server/dist/index.js",
        packageManager: "npm",
      },
      { name: "hooks", skipped: true },
    ]);
  });

  it("preserves explicit no-* flags as locked wizard stages", async () => {
    const target = createWerewolfFixtureRoot("fab-init-wizard-locked");
    tempRoots.push(target);

    const basePlan = await buildInitExecutionPlan({
      target,
      options: { skipBootstrap: true, skipHooks: true },
      mcpInstallMode: "global",
      interactive: false,
    });

    const adapter = {
      run: vi.fn().mockResolvedValue({
        bootstrap: true,
        mcp: false,
        hooks: true,
        mcpInstallMode: "global",
      }),
    };

    await resolveInitExecutionPlanWithWizard(
      basePlan,
      { bootstrap: false, hooks: false },
      adapter,
    );

    expect(adapter.run).toHaveBeenCalledWith(expect.objectContaining({
      lockedStages: ["bootstrap", "hooks"],
    }));
  });

  it("returns null when the wizard is cancelled", async () => {
    const target = createWerewolfFixtureRoot("fab-init-wizard-cancel");
    tempRoots.push(target);

    const basePlan = await buildInitExecutionPlan({
      target,
      options: {},
      mcpInstallMode: "global",
      interactive: false,
    });

    const nextPlan = await resolveInitExecutionPlanWithWizard(
      basePlan,
      {},
      { run: vi.fn().mockResolvedValue(null) },
    );

    expect(nextPlan).toBeNull();
  });

  it("returns a dry-run result for plan-only mode without writing files", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-plan-mode");
    tempRoots.push(target);

    const plan = await buildInitExecutionPlan({
      target,
      options: { planOnly: true, reapply: true },
      mcpInstallMode: "global",
      interactive: false,
    });

    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdout.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    const result = await executeInitExecutionPlan(plan);

    expect(result.stageResults).toEqual([
      { name: "bootstrap", disposition: "skipped" },
      { name: "mcp", disposition: "skipped" },
      { name: "hooks", disposition: "skipped" },
    ]);
    expect(stdout.length).toBeGreaterThan(0);
    expect(existsSync(`${target}/.fabric/bootstrap/README.md`)).toBe(false);
  });
});

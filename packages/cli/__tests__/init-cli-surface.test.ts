import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  readFixtureFile,
  setProcessTty,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const restoreTtyMocks: Array<() => void> = [];

afterEach(() => {
  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  vi.restoreAllMocks();
  vi.resetModules();
});

describe("init CLI surface", () => {
  it("treats --reapply as a canonical forceful rerun", async () => {
    const target = createWerewolfFixtureRoot("fab-init-reapply");
    tempRoots.push(target);

    const { buildInitExecutionPlan } = await import("../src/commands/init.ts");
    const plan = await buildInitExecutionPlan({
      target,
      options: { force: true, reapply: true },
      mcpInstallMode: "global",
      interactive: false,
    });

    expect(plan.options.force).toBe(true);
    expect(plan.options.reapply).toBe(true);
  });

  it("does not write scaffold files when --plan is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-plan-acceptance");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    await initCommand.run?.({
      args: {
        target,
        plan: true,
        yes: true,
      },
    } as never);

    expect(existsSync(`${target}/.fabric/bootstrap/README.md`)).toBe(false);
    expect(existsSync(`${target}/.fabric/forensic.json`)).toBe(false);
  });

  it("reapplies managed scaffold files over an existing init when --reapply is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-reapply-acceptance");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    await initCommand.run?.({
      args: {
        target,
        yes: true,
        bootstrap: false,
        mcp: false,
        hooks: false,
      },
    } as never);

    writeFixtureFile(target, ".fabric/bootstrap/README.md", "# reapply me\n");

    await initCommand.run?.({
      args: {
        target,
        reapply: true,
        yes: true,
        bootstrap: false,
        mcp: false,
        hooks: false,
      },
    } as never);

    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).not.toBe("# reapply me\n");
    expect(readFileSync(`${target}/.fabric/bootstrap/README.md`, "utf8")).toContain("Fabric Bootstrap Protocol");
  });

  it("prints compatibility notices for legacy flags and skips wizard when --plan is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-cli-surface");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdout.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stderr.write);
    restoreTtyMocks.push(setProcessTty(true));

    await initCommand.run?.({
      args: {
        target,
        plan: true,
        interactive: false,
        bootstrap: false,
      },
    } as never);

    expect(stderr.some((line) => line.includes("Using canonical --plan mode"))).toBe(true);
    expect(stderr.some((line) => line.includes("Compatibility: --interactive=false"))).toBe(true);
    expect(stderr.some((line) => line.includes("legacy --no-* flags"))).toBe(true);
    expect(stdout.some((line) => line.includes("Fabric init dry run"))).toBe(true);
    expect(stdout.some((line) => line.includes("Install bootstrap templates?"))).toBe(false);
  });
});

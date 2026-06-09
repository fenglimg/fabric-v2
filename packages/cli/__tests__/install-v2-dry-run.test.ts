import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runInitCommand } from "../src/commands/install-v2.js";
import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import { EnvStage } from "../src/install/pipeline/env.stage.js";
import { StoreStage } from "../src/install/pipeline/store.stage.js";
import { PreflightStage } from "../src/install/pipeline/preflight.stage.js";
import { HooksStage } from "../src/install/pipeline/hooks.stage.js";
import { McpStage } from "../src/install/pipeline/mcp.stage.js";
import { ValidateStage } from "../src/install/pipeline/validate.stage.js";
import { InstallPipeline } from "../src/install/pipeline/pipeline.js";
import type { InstallContext } from "../src/install/pipeline/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function baseContext(target: string): InstallContext {
  return {
    target,
    args: {
      target,
      "dry-run": true,
      url: "https://example.com/team.git",
    },
    options: { planOnly: true, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
  };
}

describe("install-v2 dry-run no-write contract", () => {
  it("does not write project or global artifacts during project dry-run", async () => {
    const home = await tempDir("fabric-install-v2-home-");
    vi.stubEnv("HOME", home);
    vi.stubEnv("FABRIC_HOME", home);

    const target = await tempDir("fabric-install-v2-target-");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    const context = baseContext(target);
    const result = await new InstallPipeline()
      .addStage(new PreflightStage())
      .addStage(new EnvStage())
      .addStage(new StoreStage())
      .addStage(new HooksStage())
      .addStage(new McpStage())
      .addStage(new ValidateStage())
      .addStage(new GuidanceStage())
      .execute(context);

    expect(result.success, result.error?.message).toBe(true);
    expect(existsSync(join(target, ".fabric"))).toBe(false);
    expect(existsSync(join(home, ".fabric"))).toBe(false);
    expect(context.stageResults.map((stage) => [stage.name, stage.disposition])).toEqual([
      ["preflight", "ran"],
      ["env", "skipped"],
      ["store", "skipped"],
      ["hooks", "skipped"],
      ["mcp", "skipped"],
      ["validate", "skipped"],
      ["guidance", "ran"],
    ]);
  });

  it("does not run global install or clone during global dry-run", async () => {
    const home = await tempDir("fabric-install-v2-global-home-");
    vi.stubEnv("HOME", home);
    vi.stubEnv("FABRIC_HOME", home);

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    await runInitCommand({
      global: true,
      "dry-run": true,
      url: "https://example.com/team.git",
    });

    expect(existsSync(join(home, ".fabric"))).toBe(false);
    expect(lines.some((line) => line.includes("no global files will be written"))).toBe(true);
    expect(lines.some((line) => line.includes("https://example.com/team.git"))).toBe(true);
  });
});

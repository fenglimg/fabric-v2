// TASK-004/Bug-A: the validate stage VERIFIES, it never installs. Present
// artifacts must be reported in skipped[] (so the per-phase display honestly
// shows 0 installed) and the stage must be changed=false so it never blocks the
// end-pass health-check collapse on a settled re-install.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTranslator } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidateStage } from "../src/install/pipeline/validate.stage.ts";
import type { InstallContext } from "../src/install/pipeline/types.ts";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function baseContext(target: string): InstallContext {
  return {
    target,
    args: {},
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
    translate: createTranslator("en"),
  } as InstallContext;
}

function makeValidWorkspace(): string {
  const target = mkdtempSync(join(tmpdir(), "fabric-validate-"));
  tempRoots.push(target);
  const fabricDir = join(target, ".fabric");
  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(join(fabricDir, "fabric-config.json"), "{}\n", "utf8");
  writeFileSync(join(fabricDir, "events.jsonl"), "", "utf8");
  return target;
}

describe("ValidateStage — verify-only, never installs (TASK-004/Bug-A)", () => {
  it("reports present .fabric artifacts in skipped[] (not installed[]) and changed=false", async () => {
    const target = makeValidWorkspace();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await new ValidateStage().execute(baseContext(target));

    expect(result.disposition).toBe("ran");
    // Verify-only: nothing is reported as installed.
    expect(result.installed).toHaveLength(0);
    // The present artifacts are reported as skipped instead.
    expect(result.skipped).toContain(join(target, ".fabric"));
    expect(result.skipped).toContain(join(target, ".fabric", "fabric-config.json"));
    expect(result.skipped).toContain(join(target, ".fabric", "events.jsonl"));
    // Never a material change → does not block the end-pass collapse.
    expect(result.changed).toBe(false);
  });
});

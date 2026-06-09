import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import type { InstallContext } from "../src/install/pipeline/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-install-guidance-"));
  tempRoots.push(root);
  return root;
}

function baseContext(target: string): InstallContext {
  return {
    target,
    args: { "enable-embed": true, "embed-model": "dedupe-test-model" },
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
  };
}

describe("install-v2 semantic-search guidance", () => {
  it("prints enablement guidance once when --enable-embed is handled by GuidanceStage", async () => {
    const target = await tempProject();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    const result = await new GuidanceStage().execute(baseContext(target));

    expect(result.disposition).toBe("ran");
    expect(lines.filter((line) => line.includes("语义搜索已启用"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("npm i -g fastembed"))).toHaveLength(1);
  });
});

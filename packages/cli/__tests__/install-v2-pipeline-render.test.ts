// TASK-001 (grill GRL-20260625-install-flatness): once shouldUseInstallRenderer
// returns true for every interactive install, the pipeline drives the unified
// renderer. These tests pin the two behaviours that fix matter:
//   C-13 — exactly ONE header per phase (the pipeline's renderSection); stages
//          no longer print a second "下一步 …" header.
//   C-18 — a failed stage renders the error box on the renderer path (which the
//          interactive install now always has), not just a bare console.error.
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import { InstallPipeline, stageRan, stageFailed } from "../src/install/pipeline/pipeline.js";
import type { InstallContext, Stage } from "../src/install/pipeline/types.js";
import type { OutputRenderer } from "../src/tui/types.js";

function stubRenderer(): OutputRenderer & Record<string, ReturnType<typeof vi.fn>> {
  return {
    renderStep: vi.fn(),
    renderSuccess: vi.fn(),
    renderError: vi.fn(),
    renderWarning: vi.fn(),
    renderInfo: vi.fn(),
    renderSummaryCard: vi.fn(),
    renderSection: vi.fn(),
    renderComplete: vi.fn(),
    cleanup: vi.fn(async () => {}),
  } as OutputRenderer & Record<string, ReturnType<typeof vi.fn>>;
}

function rendererContext(renderer: OutputRenderer): InstallContext {
  return {
    target: "/tmp/fabric-render-test",
    args: {},
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: true,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
    translate: createTranslator("en"),
    renderer,
  };
}

describe("install-v2 pipeline — renderer path (TASK-001)", () => {
  it("renders exactly one header per phase via renderSection (no stage-level second header)", async () => {
    const renderer = stubRenderer();
    const fakePreflight: Stage = { name: "preflight", async execute() { return stageRan("preflight"); } };
    const fakeHooks: Stage = { name: "hooks", async execute() { return stageRan("hooks"); } };

    const result = await new InstallPipeline()
      .addStage(fakePreflight)
      .addStage(fakeHooks)
      .execute(rendererContext(renderer));

    expect(result.success).toBe(true);
    // 1 intro section + 1 section header per stage = 3 renderSection calls total.
    // The key invariant: one header per phase, owned solely by the pipeline.
    const sectionTitles = renderer.renderSection.mock.calls.map((c) => String(c[0]));
    const stageHeaders = sectionTitles.filter((t) => /preflight|hooks/i.test(t));
    expect(stageHeaders).toHaveLength(2);
  });

  it("renders the error box on a failed stage (renderer path, C-18)", async () => {
    const renderer = stubRenderer();
    const failing: Stage = {
      name: "hooks",
      async execute() { return stageFailed("hooks", ["boom"]); },
    };

    const result = await new InstallPipeline()
      .addStage(failing)
      .execute(rendererContext(renderer));

    expect(result.success).toBe(false);
    expect(renderer.renderError).toHaveBeenCalledTimes(1);
  });
});

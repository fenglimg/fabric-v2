// TASK-001 (grill GRL-20260625-install-flatness): once shouldUseInstallRenderer
// returns true for every interactive install, the pipeline drives the unified
// renderer. These tests pin the two behaviours that fix matter:
//   C-13 — exactly ONE header per phase (the pipeline's renderSection); stages
//          no longer print a second "下一步 …" header.
//   C-18 — a failed stage renders the error box on the renderer path (which the
//          interactive install now always has), not just a bare console.error.
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import { InstallPipeline, stageRan, stageFailed, stageSkipped } from "../src/install/pipeline/pipeline.js";
import type { InstallContext, Stage } from "../src/install/pipeline/types.js";
import type { OutputRenderer } from "../src/tui/types.js";
import { t } from "../src/i18n.js";

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

function rendererContext(
  renderer: OutputRenderer,
  overrides: Partial<InstallContext> = {},
): InstallContext {
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
    ...overrides,
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

// TASK-004: first-install vs re-install — onboarding tone + smart collapse.
describe("install-v2 pipeline — first-install vs re-install collapse (TASK-004)", () => {
  it("collapses an all-idempotent re-install to a single health-check card (per-phase streaming suppressed)", async () => {
    const renderer = stubRenderer();
    // firstInstall=false + every stage skipped / ran-with-zero-installed.
    const skipped: Stage = { name: "preflight", async execute() { return stageSkipped("preflight", "nothing to do"); } };
    const zeroInstall: Stage = { name: "hooks", async execute() { return stageRan("hooks", [], []); } };

    const result = await new InstallPipeline()
      .addStage(skipped)
      .addStage(zeroInstall)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    // Exactly one card — the health-check card — and its title is the collapse copy.
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.healthcheck.title", { count: "2" }));
    // Per-phase streaming is suppressed: no step badges, no per-stage section headers.
    expect(renderer.renderStep).not.toHaveBeenCalled();
    expect(renderer.renderSection).not.toHaveBeenCalled();
  });

  it("does NOT collapse when any stage installed something (normal per-phase output)", async () => {
    const renderer = stubRenderer();
    const installed: Stage = { name: "hooks", async execute() { return stageRan("hooks", ["a-hook"], []); } };
    const skipped: Stage = { name: "preflight", async execute() { return stageSkipped("preflight"); } };

    const result = await new InstallPipeline()
      .addStage(skipped)
      .addStage(installed)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    // Normal path: per-phase visuals replayed + the standard summary card (not the
    // health-check title).
    expect(renderer.renderStep).toHaveBeenCalled();
    expect(renderer.renderSection).toHaveBeenCalled();
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.pipeline.complete"));
  });

  it("first install uses the onboarding intro string and never collapses", async () => {
    const renderer = stubRenderer();
    // Even with all-idempotent stages, a first install must stream normally.
    const skipped: Stage = { name: "preflight", async execute() { return stageSkipped("preflight"); } };
    const zeroInstall: Stage = { name: "hooks", async execute() { return stageRan("hooks", [], []); } };

    const result = await new InstallPipeline()
      .addStage(skipped)
      .addStage(zeroInstall)
      .execute(rendererContext(renderer, { state: { firstInstall: true } }));

    expect(result.success).toBe(true);
    // Onboarding intro tone, not the terse "running N stages" line.
    const infoLines = renderer.renderInfo.mock.calls.map((c) => String(c[0]));
    expect(infoLines).toContain(t("cli.install.pipeline.intro.firstRun", { count: "2" }));
    // Never collapses: per-phase streaming present + standard summary card.
    expect(renderer.renderStep).toHaveBeenCalled();
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.pipeline.complete"));
  });
});

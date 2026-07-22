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
    mcpRootPolicy: { mode: "dynamic" },
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
  it("renders ONE command-title section, no per-stage header — stages via renderStep (flat-design §0.4)", async () => {
    const renderer = stubRenderer();
    const fakePreflight: Stage = { name: "preflight", async execute() { return stageRan("preflight"); } };
    const fakeHooks: Stage = { name: "hooks", async execute() { return stageRan("hooks"); } };

    const result = await new InstallPipeline()
      .addStage(fakePreflight)
      .addStage(fakeHooks)
      .execute(rendererContext(renderer));

    expect(result.success).toBe(true);
    // flat-design: exactly ONE renderSection (the command-level B-横线 title). A
    // stage NEVER owns a section header any more — it surfaces as a flat
    // renderStep line instead, so no section title mentions a stage name.
    expect(renderer.renderSection).toHaveBeenCalledTimes(1);
    const sectionTitles = renderer.renderSection.mock.calls.map((c) => String(c[0]));
    expect(sectionTitles.some((s) => /preflight|hooks/i.test(s))).toBe(false);
    // The stages still surface — through renderStep, carrying their labels.
    const stepNames = renderer.renderStep.mock.calls.map((c) => String((c[0] as { name?: string }).name ?? ""));
    expect(stepNames.some((n) => /preflight/i.test(n))).toBe(true);
    expect(stepNames.some((n) => /hooks/i.test(n))).toBe(true);
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

  it("does NOT collapse when any stage materially changed something (normal per-phase output)", async () => {
    const renderer = stubRenderer();
    // Bug-A fix: collapse keys off the explicit `changed` flag, not installed.length.
    // A stage that materially changed something (changed=true) blocks the collapse.
    const installed: Stage = { name: "hooks", async execute() { return stageRan("hooks", ["a-hook"], [], undefined, true); } };
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

  it("TASK-003 (G2 root a): the ● stage line reads 'up to date' for a ran-but-unchanged stage, not 'N installed'", async () => {
    const renderer = stubRenderer();
    // A run that does NOT collapse (one stage changed=true) so the per-phase `●`
    // lines stream. The OTHER stage ran with installed[] listing already-present
    // artifacts but changed=false — its inline detail must read the uptodate word
    // (the allIdempotent truth source), NEVER "N installed". flat-design moved this
    // detail OFF the summary card (which is now an aggregate-only roll-up) and ONTO
    // the `● <stage> ✓ <detail>` line, so we assert on the renderStep detail.
    const changedStage: Stage = { name: "hooks", async execute() { return stageRan("hooks", ["a-hook"], [], undefined, true); } };
    const unchangedStage: Stage = { name: "validate", async execute() { return stageRan("validate", ["present-1", "present-2", "present-3"], [], undefined, false); } };

    const result = await new InstallPipeline()
      .addStage(unchangedStage)
      .addStage(changedStage)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    const stepDetails = renderer.renderStep.mock.calls
      .map((c) => c[0] as { status: string; detail?: string })
      .filter((s) => s.status === "success")
      .map((s) => s.detail);
    // The unchanged ran-stage shows the uptodate word, not its installed.length.
    expect(stepDetails).toContain(t("cli.install.stage.uptodate"));
    expect(stepDetails).not.toContain("3 installed");
    // The genuinely-changed stage still reports its installed count.
    expect(stepDetails).toContain(t("cli.install.stage.installed-count", { count: "1" }));
    // And the summary card is now an aggregate-only roll-up — no per-stage rows.
    expect(renderer.renderSummaryCard.mock.calls[0][0].details ?? []).toEqual([]);
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

  it("Bug-A: a re-install collapses even when stages report installed>0, as long as changed=false", async () => {
    const renderer = stubRenderer();
    // The exact Bug-A shape: stages list already-present artifacts in installed[]
    // for display (validate/env/mcp do this), but nothing materially changed.
    const present: Stage = { name: "env", async execute() { return stageRan("env", ["/x/.fabric", "/x/events.jsonl"], [], undefined, false); } };
    const mcpish: Stage = { name: "mcp", async execute() { return stageRan("mcp", ["ClaudeCodeCLI"], [], undefined, false); } };

    const result = await new InstallPipeline()
      .addStage(present)
      .addStage(mcpish)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    // Collapsed: a single health-check card, per-phase streaming suppressed.
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.healthcheck.title", { count: "2" }));
    expect(renderer.renderStep).not.toHaveBeenCalled();
  });

  it("TASK-003 (G2 root b): a fully-idempotent re-install STILL collapses even when a mid-run prompt flushed the buffer", async () => {
    const renderer = stubRenderer();
    // A stage that flushes the buffer (simulating a flush-before-prompt — the store
    // stage flushes so slot status is visible ahead of a clack select) before
    // returning a no-change result. Every stage is changed=false, so the run is
    // fully idempotent — the collapse must FIRE regardless of buffer.flushed (the
    // flush is driven by a legitimate prompt, not by a material change). This
    // reverses the former Bug-B behaviour where any flush abandoned collapse.
    const flushing: Stage = {
      name: "store",
      async execute(ctx) {
        ctx.flushRenderBuffer?.();
        return stageRan("store", [], [], undefined, false);
      },
    };
    const idle: Stage = { name: "preflight", async execute() { return stageRan("preflight", [], [], undefined, false); } };

    const result = await new InstallPipeline()
      .addStage(idle)
      .addStage(flushing)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    // Exactly one card — the health-check card — even though the buffer was flushed.
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.healthcheck.title", { count: "2" }));
    // No '... installed' detail rows on the health card (G2 misreport fix).
    expect(renderer.renderSummaryCard.mock.calls[0][0].details ?? []).toEqual([]);
  });

  it("flushTo replays buffered calls in order, then passes subsequent calls through live", async () => {
    const renderer = stubRenderer();
    // Stage 1 emits a buffered line; stage 2 emits another buffered line, then
    // flushes, then emits a post-flush line that must passthrough live. The live
    // renderer must observe all three in original order with no duplication.
    const buffered1: Stage = {
      name: "preflight",
      async execute(ctx) {
        ctx.renderer?.renderInfo("buffered-1");
        return stageRan("preflight", [], [], undefined, false);
      },
    };
    const flushAndPassthrough: Stage = {
      name: "store",
      async execute(ctx) {
        ctx.renderer?.renderInfo("buffered-2");
        ctx.flushRenderBuffer?.();
        ctx.renderer?.renderInfo("post-flush-3");
        return stageRan("store", [], [], undefined, false);
      },
    };

    const result = await new InstallPipeline()
      .addStage(buffered1)
      .addStage(flushAndPassthrough)
      .execute(rendererContext(renderer, { state: { firstInstall: false } }));

    expect(result.success).toBe(true);
    const infoLines = renderer.renderInfo.mock.calls.map((c) => String(c[0]));
    const idx1 = infoLines.indexOf("buffered-1");
    const idx2 = infoLines.indexOf("buffered-2");
    const idx3 = infoLines.indexOf("post-flush-3");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    // No duplication of the buffered lines (flush replays once, then passthrough).
    // TASK-003: this also proves the collapse-after-flush path does NOT double-emit
    // — the all-idempotent collapse branch early-returns before flushBuffer, so the
    // already-flushed (passthrough) buffer is never replayed a second time.
    expect(infoLines.filter((l) => l === "buffered-1")).toHaveLength(1);
    expect(infoLines.filter((l) => l === "buffered-2")).toHaveLength(1);
    expect(infoLines.filter((l) => l === "post-flush-3")).toHaveLength(1);
    // TASK-003 (G2 root b): all stages changed=false ⇒ collapses to the health card
    // even though the buffer was flushed mid-run; exactly one card, no duplicate.
    expect(renderer.renderSummaryCard).toHaveBeenCalledTimes(1);
    const cardTitle = String(renderer.renderSummaryCard.mock.calls[0][0].title);
    expect(cardTitle).toBe(t("cli.install.healthcheck.title", { count: "2" }));
  });
});

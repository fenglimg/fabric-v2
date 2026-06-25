import { t } from "../../i18n.js";

import type { Stage, InstallContext, StageResult, PipelineResult, StageName } from "./types.js";
import type { StepInfo, SummaryInfo, SummaryDetailRow, ErrorInfo, OutputRenderer } from "../../tui/types.js";

// ---------------------------------------------------------------------------
// Stage visual anchors (EPIC-005)
// ---------------------------------------------------------------------------

/**
 * Localized human-readable stage label. The `StageName` (preflight/env/…) is a
 * routing key and stays English; only the displayed copy is translated, per
 * [[askuserquestion-i18n-value-vs-label]] (translate display text, keep keys).
 * Resolved through the live `t` binding so it honors the language picked mid-run
 * by the store stage's language selector (refreshLocale).
 */
function stageLabel(name: StageName): string {
  return t(`cli.install.pipeline.label.${name}`);
}

/** i18n keys for the optional one-line stage description (plain path only). */
const STAGE_DESCRIPTION_KEYS: Partial<Record<StageName, string>> = {
  store: "cli.install.pipeline.desc.store",
};

/** Stage icons for visual anchors (locale-independent) */
const STAGE_ICONS: Record<StageName, string> = {
  preflight: "🔍",
  env: "🏗️",
  store: "📦",
  hooks: "🪝",
  mcp: "🔌",
  validate: "✅",
  guidance: "📖",
};

// ---------------------------------------------------------------------------
// Recording Renderer (TASK-004)
// ---------------------------------------------------------------------------

/**
 * TASK-004 (R13): a buffering OutputRenderer that records every render call made
 * during the stage loop instead of emitting it, so the smart-collapse decision
 * can be made END-PASS — once every stage has run and idempotency is known. On a
 * normal (non-collapsed) run the recording is `replay`ed verbatim to the live
 * renderer, preserving the interleaved order of pipeline visuals and stage-emitted
 * lines. On a collapsed all-idempotent re-install the recording is simply dropped
 * in favour of a single health-check card. Only constructed for re-installs
 * (firstInstall===false) with a live renderer; a first install streams live.
 */
class RecordingRenderer implements OutputRenderer {
  private readonly calls: Array<(target: OutputRenderer) => void> = [];

  constructor(private readonly live: OutputRenderer) {}

  renderStep(step: StepInfo): void {
    this.calls.push((t) => t.renderStep(step));
  }
  renderSuccess(message: string): void {
    this.calls.push((t) => t.renderSuccess(message));
  }
  renderError(error: ErrorInfo | Error): void {
    this.calls.push((t) => t.renderError(error));
  }
  renderWarning(message: string): void {
    this.calls.push((t) => t.renderWarning(message));
  }
  renderInfo(message: string): void {
    this.calls.push((t) => t.renderInfo(message));
  }
  renderSummaryCard(summary: SummaryInfo): void {
    this.calls.push((t) => t.renderSummaryCard(summary));
  }
  renderSection(title: string): void {
    this.calls.push((t) => t.renderSection(title));
  }
  renderComplete(): void {
    this.calls.push((t) => t.renderComplete());
  }
  cleanup(): Promise<void> {
    return this.live.cleanup?.() ?? Promise.resolve();
  }

  /** Replay every recorded call against the live renderer, in order. */
  replay(target: OutputRenderer): void {
    for (const call of this.calls) {
      call(target);
    }
  }
}

// ---------------------------------------------------------------------------
// Install Pipeline
// ---------------------------------------------------------------------------

/**
 * Install pipeline orchestrator.
 *
 * Manages a sequence of stages that execute in order.
 * Each stage can:
 * - Perform work and return results
 * - Register rollback actions for cleanup on failure
 * - Skip if preconditions are not met
 *
 * The pipeline supports:
 * - Ordered stage execution
 * - Rollback on failure (executes rollback actions in reverse order)
 * - Stage result accumulation in context
 * - TUI rendering via OutputRenderer (EPIC-005/006/007/008)
 */
export class InstallPipeline {
  private stages: Stage[] = [];

  /**
   * Add a stage to the pipeline.
   * Stages execute in the order they are added.
   */
  addStage(stage: Stage): this {
    this.stages.push(stage);
    return this;
  }

  /**
   * Execute all stages in order.
   * On failure, executes rollback actions in reverse order.
   */
  async execute(initialContext: InstallContext): Promise<PipelineResult> {
    const context = initialContext;
    const totalStages = this.stages.length;
    const liveRenderer = context.renderer;

    // TASK-004 (R13): the smart-collapse decision is END-PASS — we cannot know a
    // re-install is fully idempotent until every stage has run. So we BUFFER the
    // per-phase streaming visuals through a recording proxy during the loop, then
    // at the end either FLUSH them (normal per-phase output) or DISCARD them in
    // favour of a single health-check card (collapsed re-install). Buffering the
    // whole renderer (not just pipeline visuals) preserves the interleaved order
    // of stage-emitted lines on replay. A first install never buffers — it always
    // streams live and never collapses.
    const buffer = liveRenderer !== undefined && context.state.firstInstall === false
      ? new RecordingRenderer(liveRenderer)
      : undefined;
    const renderer = buffer ?? liveRenderer;
    // Swap the context renderer so stages emit through the buffer too while it is
    // active; restored before the end-pass card render.
    if (buffer !== undefined) {
      context.renderer = buffer;
    }

    // EPIC-005: Render pipeline intro. TASK-004: a first-ever install gets an
    // onboarding-tone intro (welcoming, sets up the one-time setup); a re-install
    // keeps the terse "running N stages" line.
    const introLine = context.state.firstInstall === true
      ? t("cli.install.pipeline.intro.firstRun", { count: String(totalStages) })
      : t("cli.install.pipeline.running", { count: String(totalStages) });
    if (renderer) {
      renderer.renderSection(t("cli.install.pipeline.title"));
      renderer.renderInfo(introLine);
    } else {
      console.log(introLine);
    }

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      const stepNum = i + 1;
      const stageName = stage.name;

      // EPIC-005: Visual anchor — section header with icon
      if (renderer) {
        renderer.renderSection(`${STAGE_ICONS[stageName]} ${stageLabel(stageName)}`);
      } else {
        console.log(`[${stepNum}/${totalStages}] ${stageLabel(stageName)}`);
        const descriptionKey = STAGE_DESCRIPTION_KEYS[stageName];
        if (descriptionKey !== undefined) {
          console.log(`  ${t(descriptionKey)}`);
        }
      }

      // EPIC-008: Progress feedback — step counter + spinner
      if (renderer) {
        renderer.renderStep({
          name: stageLabel(stageName),
          current: stepNum,
          total: totalStages,
          status: "running",
        });
      }

      try {
        const result = await stage.execute(context);
        context.stageResults.push(result);

        // EPIC-005/008: Update step status based on result
        if (renderer) {
          if (result.disposition === "ran") {
            renderer.renderStep({
              name: stageLabel(stageName),
              current: stepNum,
              total: totalStages,
              status: "success",
              detail: result.installed.length > 0
                ? `${result.installed.length} installed, ${result.skipped.length} skipped`
                : undefined,
            });
          } else if (result.disposition === "skipped") {
            renderer.renderStep({
              name: stageLabel(stageName),
              current: stepNum,
              total: totalStages,
              status: "skipped",
              detail: result.payload && typeof result.payload === "object" && "reason" in (result.payload as Record<string, unknown>)
                ? String((result.payload as { reason: unknown }).reason)
                : undefined,
            });
          } else if (result.disposition === "failed") {
            renderer.renderStep({
              name: stageLabel(stageName),
              current: stepNum,
              total: totalStages,
              status: "error",
              detail: result.errors.join(", "),
            });
          }
        }

        // If a stage fails, trigger rollback
        if (result.disposition === "failed") {
          // Any failure cancels collapse: flush buffered per-phase visuals so the
          // user sees the progress leading up to the error, then restore the live
          // renderer for the error box / rollback feedback.
          this.flushBuffer(context, buffer, liveRenderer);
          await this.rollback(context);

          // EPIC-007: Render error box
          if (liveRenderer) {
            const errorInfo: ErrorInfo = {
              title: `${stageLabel(stageName)} ${t("cli.install.stages.failed")}`,
              message: result.errors.join(", "),
              hint: "Check the error details above. Run with --debug for more information.",
            };
            liveRenderer.renderError(errorInfo);
          }

          return {
            success: false,
            context,
            error: new Error(`Stage ${stageName} failed: ${result.errors.join(", ")}`),
          };
        }
      } catch (error) {
        this.flushBuffer(context, buffer, liveRenderer);
        await this.rollback(context);
        const err = error instanceof Error ? error : new Error(String(error));

        // EPIC-007: Render error box for uncaught errors
        if (liveRenderer) {
          liveRenderer.renderError(err);
        }

        return {
          success: false,
          context,
          error: err,
        };
      }
    }

    // TASK-004 end-pass: with all stages succeeded, decide between the collapsed
    // health-check card and the normal per-phase output. Collapse only when this
    // is a re-install (buffer was set ⇒ firstInstall===false) AND every stage was
    // idempotent (skipped, or ran with nothing installed). Any install at all, or
    // a first install (no buffer), falls through to the normal per-phase replay +
    // summary card.
    if (buffer !== undefined && this.allIdempotent(context)) {
      context.renderer = liveRenderer;
      if (liveRenderer) {
        liveRenderer.renderSummaryCard(this.buildHealthCheckSummary(context, totalStages));
        liveRenderer.renderComplete();
      }
      return { success: true, context };
    }

    // Normal path: flush any buffered per-phase visuals to the live renderer,
    // then render the standard summary card.
    this.flushBuffer(context, buffer, liveRenderer);
    if (liveRenderer) {
      const summary = this.buildSummary(context);
      liveRenderer.renderSummaryCard(summary);
      liveRenderer.renderComplete();
    }

    return {
      success: true,
      context,
    };
  }

  /**
   * TASK-004: replay any buffered renderer calls to the live renderer and restore
   * the context renderer. No-op when buffering was never active (first install /
   * non-renderer path).
   */
  private flushBuffer(
    context: InstallContext,
    buffer: RecordingRenderer | undefined,
    liveRenderer: OutputRenderer | undefined,
  ): void {
    if (buffer === undefined) {
      return;
    }
    context.renderer = liveRenderer;
    if (liveRenderer) {
      buffer.replay(liveRenderer);
    }
  }

  /**
   * TASK-004: an all-idempotent run is one where every stage either skipped or ran
   * without installing anything — the "nothing changed" re-install that the
   * flatness grill flagged as 7×"installed=0" noise.
   */
  private allIdempotent(context: InstallContext): boolean {
    return context.stageResults.every(
      (r) => r.disposition === "skipped" || (r.disposition === "ran" && r.installed.length === 0),
    );
  }

  /**
   * TASK-004: the single reassurance card for a fully-idempotent re-install —
   * "✓ Fabric 已是最新 · N 阶段就绪 · 无改动". No per-stage detail rows; the title
   * carries the whole message.
   */
  private buildHealthCheckSummary(context: InstallContext, totalStages: number): SummaryInfo {
    return {
      title: t("cli.install.healthcheck.title", { count: String(totalStages) }),
      successCount: context.stageResults.length,
      skippedCount: 0,
      errorCount: 0,
    };
  }

  /**
   * Build summary info from accumulated stage results.
   */
  private buildSummary(context: InstallContext): SummaryInfo {
    const results = context.stageResults;
    const successCount = results.filter((r) => r.disposition === "ran").length;
    const skippedCount = results.filter((r) => r.disposition === "skipped").length;
    const errorCount = results.filter((r) => r.disposition === "failed").length;

    const details: SummaryDetailRow[] = results.map((r) => ({
      label: stageLabel(r.name),
      value: r.disposition === "ran"
        ? `${r.installed.length} installed`
        : r.disposition === "skipped"
          ? "skipped"
          : `${r.errors.length} error(s)`,
      status: r.disposition === "ran"
        ? "success"
        : r.disposition === "skipped"
          ? "skipped"
          : "error",
    }));

    return {
      title: t("cli.install.pipeline.complete"),
      successCount,
      skippedCount,
      errorCount,
      details,
    };
  }

  /**
   * Execute rollback actions in reverse order.
   */
  private async rollback(context: InstallContext): Promise<void> {
    // Execute rollback actions in reverse order
    const rollbackStack = [...context.rollbackStack].reverse();

    let rolledBack = 0;
    for (const { action } of rollbackStack) {
      try {
        await action();
        rolledBack++;
      } catch {
        // Swallow rollback errors - best effort cleanup
      }
    }

    // Also call stage rollback methods if available
    for (const stage of [...this.stages].reverse()) {
      if (stage.rollback) {
        try {
          await stage.rollback(context);
        } catch {
          // Swallow rollback errors - best effort cleanup
        }
      }
    }

    // grill C-19: rollback is no longer a silent swallow — tell the user what
    // happened (count of reverted changes + project left unchanged), WITHOUT
    // leaking stack traces or filesystem paths (R15).
    const feedback = t("cli.install.rollback.feedback", { count: String(rolledBack) });
    if (context.renderer) {
      context.renderer.renderWarning(feedback);
    } else {
      console.log(feedback);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage Result Helpers
// ---------------------------------------------------------------------------

/**
 * Create a successful stage result.
 */
export function stageRan(
  name: StageName,
  installed: string[] = [],
  skipped: string[] = [],
  payload?: unknown,
): StageResult {
  return {
    name,
    disposition: "ran",
    installed,
    skipped,
    errors: [],
    payload,
  };
}

/**
 * Create a skipped stage result.
 */
export function stageSkipped(name: StageName, reason?: string): StageResult {
  return {
    name,
    disposition: "skipped",
    installed: [],
    skipped: [],
    errors: [],
    payload: reason ? { reason } : undefined,
  };
}

/**
 * Create a failed stage result.
 */
export function stageFailed(name: StageName, errors: string[]): StageResult {
  return {
    name,
    disposition: "failed",
    installed: [],
    skipped: [],
    errors,
  };
}

/**
 * Create a failed stage result from an error.
 */
export function stageFailedFromError(name: StageName, error: unknown): StageResult {
  const message = error instanceof Error ? error.message : String(error);
  return stageFailed(name, [message]);
}

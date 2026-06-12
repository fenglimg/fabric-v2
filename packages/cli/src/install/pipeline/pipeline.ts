import { t } from "../../i18n.js";

import type { Stage, InstallContext, StageResult, PipelineResult, StageName } from "./types.js";
import type { StepInfo, SummaryInfo, SummaryDetailRow, ErrorInfo } from "../../tui/types.js";

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
    const renderer = context.renderer;

    // EPIC-005: Render pipeline intro
    if (renderer) {
      renderer.renderSection(t("cli.install.pipeline.title"));
      renderer.renderInfo(t("cli.install.pipeline.running", { count: String(totalStages) }));
    } else {
      console.log(t("cli.install.pipeline.running", { count: String(totalStages) }));
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
          await this.rollback(context);

          // EPIC-007: Render error box
          if (renderer) {
            const errorInfo: ErrorInfo = {
              title: `${stageLabel(stageName)} ${t("cli.install.stages.failed")}`,
              message: result.errors.join(", "),
              hint: "Check the error details above. Run with --debug for more information.",
            };
            renderer.renderError(errorInfo);
          }

          return {
            success: false,
            context,
            error: new Error(`Stage ${stageName} failed: ${result.errors.join(", ")}`),
          };
        }
      } catch (error) {
        await this.rollback(context);
        const err = error instanceof Error ? error : new Error(String(error));

        // EPIC-007: Render error box for uncaught errors
        if (renderer) {
          renderer.renderError(err);
        }

        return {
          success: false,
          context,
          error: err,
        };
      }
    }

    // EPIC-006: Render summary card on success
    if (renderer) {
      const summary = this.buildSummary(context);
      renderer.renderSummaryCard(summary);
      renderer.renderComplete();
    }

    return {
      success: true,
      context,
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

    for (const { action } of rollbackStack) {
      try {
        await action();
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

import type { Stage, InstallContext, StageResult, PipelineResult, StageName } from "./types.js";
import type { SummaryInfo, SummaryDetailRow, ErrorInfo } from "../../tui/types.js";

// ---------------------------------------------------------------------------
// Stage visual anchors (EPIC-005)
// ---------------------------------------------------------------------------

/** Human-readable stage labels for visual anchors */
const STAGE_LABELS: Record<StageName, string> = {
  preflight: "全局与项目预检",
  env: "项目身份与环境",
  store: "知识库拓扑",
  hooks: "Hooks 与 Skills",
  mcp: "MCP 客户端",
  validate: "安装校验",
  guidance: "下一步",
};

const STAGE_DESCRIPTIONS: Record<StageName, string> = {
  preflight: "确认目标目录、全局 Fabric home 与写入权限。",
  env: "扫描客户端特征，准备 .fabric/ 配置与项目运行文件。",
  store: "检查 global stores，绑定当前项目的 read/write store 与 project 坐标。",
  hooks: "安装跨客户端 hooks、skills 与 bootstrap managed block。",
  mcp: "写入 Claude Code / Cursor / Codex CLI 的 MCP 配置。",
  validate: "确认 hooks、.fabric 与运行配置可用。",
  guidance: "可选功能、重启提示与客户端能力摘要。",
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

    if (renderer) {
      renderer.renderSection("Fabric Install");
      renderer.renderInfo(`Running ${totalStages} stages...`);
    } else {
      this.renderPlainIntro(totalStages);
    }

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      const stepNum = i + 1;
      const stageName = stage.name;

      if (renderer) {
        renderer.renderSection(STAGE_LABELS[stageName]);
      } else {
        this.renderPlainStageHeader(stageName, stepNum, totalStages);
      }

      // EPIC-008: Progress feedback — step counter + spinner
      if (renderer) {
        renderer.renderStep({
          name: STAGE_LABELS[stageName],
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
              name: STAGE_LABELS[stageName],
              current: stepNum,
              total: totalStages,
              status: "success",
              detail: result.installed.length > 0
                ? `${result.installed.length} installed, ${result.skipped.length} skipped`
                : undefined,
            });
          } else if (result.disposition === "skipped") {
            renderer.renderStep({
              name: STAGE_LABELS[stageName],
              current: stepNum,
              total: totalStages,
              status: "skipped",
              detail: result.payload && typeof result.payload === "object" && "reason" in (result.payload as Record<string, unknown>)
                ? String((result.payload as { reason: unknown }).reason)
                : undefined,
            });
          } else if (result.disposition === "failed") {
            renderer.renderStep({
              name: STAGE_LABELS[stageName],
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
              title: `${STAGE_LABELS[stageName]} failed`,
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
      label: STAGE_LABELS[r.name],
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
      title: "Fabric Install Complete",
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

  private renderPlainIntro(totalStages: number): void {
    console.log("");
    console.log(`Fabric install 将按 ${totalStages} 个阶段执行`);
  }

  private renderPlainStageHeader(stageName: StageName, current: number, total: number): void {
    console.log("");
    console.log(`[${current}/${total}] ${STAGE_LABELS[stageName]}`);
    console.log(`    ${STAGE_DESCRIPTIONS[stageName]}`);
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

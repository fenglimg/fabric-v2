import { ANSI, PALETTE, paint, symbol, isColorEnabled } from "@fenglimg/fabric-shared/theme";
import type {
  OutputRenderer,
  OutputRendererConfig,
  StepInfo,
  SummaryInfo,
  SummaryDetailRow,
  ErrorInfo,
} from "./types.js";

/**
 * ConsoleOutputRenderer — theme.ts-backed OutputRenderer (W3-A 退 Ink).
 *
 * Replaces the former Ink/React renderer with pure string composition over
 * the shared theme palette (packages/shared/src/theme.ts). The OutputRenderer
 * interface (the seam consumed by install/pipeline/pipeline.ts) is unchanged;
 * only the rendering engine moves from mounted React components to console
 * output.
 *
 * Equivalence bar (C-007): content + wording + semantic color-role equivalence,
 * NOT byte-identical glyphs/animation. theme.ts exposes a narrower vocabulary
 * (3 SYMBOL kinds + 7 role tokens, no cyan/gray) than the former Ink components
 * (○ ● ✓ ✗ ! ℹ 💡 + rounded box borders + literal cyan/blue/gray/white), so the
 * old glyphs/colors are mapped down deterministically: live spinner animation →
 * static in-progress line, box-drawing borders → multi-line plain-text blocks.
 * Richer visual structure is W3-B (焕然一新), out of scope here.
 */
export class ConsoleOutputRenderer implements OutputRenderer {
  private config: OutputRendererConfig;
  private colorOn: boolean;
  private currentStep: StepInfo | null = null;

  constructor(config: OutputRendererConfig = {}) {
    this.config = {
      colors: true,
      verbose: false,
      timestamps: false,
      ...config,
    };
    // Honor an explicit `colors: false` opt-out, otherwise defer to the shared
    // env/TTY detection (NO_COLOR / FORCE_COLOR / isTTY) at construction time.
    this.colorOn =
      this.config.colors === false
        ? false
        : isColorEnabled(process.env, process.stdout.isTTY);
  }

  private write(line: string): void {
    console.log(line);
  }

  /** Bold + accent header styling (replaces SectionHeader's bold cyan title). */
  private boldAccent(text: string): string {
    return this.colorOn ? `${ANSI.bold}${PALETTE.accent}${text}${ANSI.reset}` : text;
  }

  /** Step marker by status (StepCounter/Spinner glyph + role color, mapped down). */
  private stepMarker(status: StepInfo["status"]): string {
    switch (status) {
      case "success":
        return symbol("ok", this.colorOn);
      case "error":
        return symbol("error", this.colorOn);
      case "running":
        return paint("ai", "●", this.colorOn);
      case "skipped":
        return paint("warn", "○", this.colorOn);
      case "pending":
      default:
        return paint("muted", "○", this.colorOn);
    }
  }

  /** Status-message marker by type (StatusMessage glyph + role color, mapped down). */
  private statusMarker(type: "success" | "error" | "warning" | "info"): string {
    switch (type) {
      case "success":
        return symbol("ok", this.colorOn);
      case "error":
        return symbol("error", this.colorOn);
      case "warning":
        return symbol("warn", this.colorOn);
      case "info":
      default:
        return paint("ai", "ℹ", this.colorOn);
    }
  }

  /** Detail-row marker (SummaryCard DetailStatus; null status → no marker). */
  private detailMarker(status?: SummaryDetailRow["status"]): string | null {
    switch (status) {
      case "success":
        return paint("success", "✓", this.colorOn);
      case "error":
        return paint("error", "✗", this.colorOn);
      case "skipped":
        return paint("warn", "○", this.colorOn);
      case "info":
        return paint("ai", "ℹ", this.colorOn);
      default:
        return null;
    }
  }

  private renderStatus(message: string, type: "success" | "error" | "warning" | "info"): void {
    const marker = this.statusMarker(type);
    const body = type === "error" ? paint("error", message, this.colorOn) : message;
    this.write(`${marker} ${body}`);
  }

  renderStep(step: StepInfo): void {
    this.currentStep = step;

    if (step.status === "running") {
      // Spinner equivalent: a single static in-progress line (no animation).
      const marker = paint("ai", "●", this.colorOn);
      this.write(`${marker} ${step.name || "Loading..."}`);
    } else {
      // StepCounter equivalent: marker (current/total) label.
      const marker = this.stepMarker(step.status);
      const counter = paint("muted", `(${step.current}/${step.total})`, this.colorOn);
      this.write(`${marker} ${counter} ${step.name}`);
    }

    if (step.detail) {
      this.renderStatus(step.detail, step.status === "error" ? "error" : "info");
    }
  }

  renderSuccess(message: string): void {
    this.renderStatus(message, "success");
  }

  renderError(error: ErrorInfo | Error): void {
    const info = error instanceof Error ? toErrorInfo(error) : error;
    const title = info.title || "Error";
    const code = "code" in info ? info.code : undefined;
    const hint = "hint" in info ? info.hint : undefined;
    const stack = "stack" in info ? info.stack : undefined;

    // ErrorBox equivalent: multi-line plain-text block (no box-drawing border).
    const titleLine = paint("error", `✗ ${title}`, this.colorOn);
    this.write(code ? `${titleLine} ${paint("muted", `(${code})`, this.colorOn)}` : titleLine);
    this.write(paint("error", info.message, this.colorOn));

    if (hint) {
      this.write(paint("muted", `💡 ${hint}`, this.colorOn));
    }

    if (this.config.verbose && stack) {
      this.write(paint("muted", "Stack trace:", this.colorOn));
      for (const frame of stack.split("\n").slice(0, 5)) {
        this.write(paint("muted", `  ${frame}`, this.colorOn));
      }
    }
  }

  renderWarning(message: string): void {
    this.renderStatus(message, "warning");
  }

  renderInfo(message: string): void {
    this.renderStatus(message, "info");
  }

  renderSummaryCard(summary: SummaryInfo): void {
    const { title, successCount, skippedCount = 0, errorCount = 0, details = [] } = summary;
    const totalCount = successCount + skippedCount + errorCount;

    // SummaryCard equivalent: title + counts + detail rows + summary line, as a
    // multi-line plain-text block (no box-drawing border).
    this.write(this.boldAccent(title));

    const counts: string[] = [];
    if (successCount > 0) {
      counts.push(`${paint("success", "✓", this.colorOn)} ${successCount} succeeded`);
    }
    if (skippedCount > 0) {
      counts.push(`${paint("warn", "○", this.colorOn)} ${skippedCount} skipped`);
    }
    if (errorCount > 0) {
      counts.push(`${paint("error", "✗", this.colorOn)} ${errorCount} failed`);
    }
    if (counts.length > 0) {
      this.write(counts.join("   "));
    }

    for (const detail of details) {
      const marker = this.detailMarker(detail.status);
      const label = paint("muted", `${detail.label}:`, this.colorOn);
      this.write(marker ? `${marker} ${label} ${detail.value}` : `${label} ${detail.value}`);
    }

    const summaryLine =
      totalCount === successCount
        ? "All steps completed successfully"
        : errorCount > 0
          ? `${errorCount} step${errorCount > 1 ? "s" : ""} failed`
          : `${successCount}/${totalCount} steps completed`;
    this.write(paint("muted", summaryLine, this.colorOn));
  }

  renderSection(title: string): void {
    // SectionHeader equivalent: a bold accent header line (no box border).
    this.write("");
    this.write(this.boldAccent(title));
  }

  renderComplete(): void {
    this.renderStatus("Done!", "success");
  }

  async cleanup(): Promise<void> {
    // No Ink instances to unmount; nothing to flush for synchronous console output.
    this.currentStep = null;
  }
}

/**
 * Convert an Error to ErrorInfo (inlined from the former ErrorBox.tsx helper so
 * the renderer no longer depends on any .tsx module).
 */
export function toErrorInfo(error: Error | ErrorInfo): ErrorInfo {
  if ("title" in error) {
    return error;
  }
  return {
    title: error.name || "Error",
    message: error.message,
    stack: error.stack,
  };
}

/**
 * Create the install wizard's output renderer (theme.ts-backed, non-Ink).
 * Same signature semantics as the former Ink renderer factory (config?).
 */
export function createInstallRenderer(config?: OutputRendererConfig): ConsoleOutputRenderer {
  return new ConsoleOutputRenderer(config);
}

import { paint, symbol, sectionBar, isColorEnabled } from "@fenglimg/fabric-shared/theme";
import { tree, grid, headerRule } from "./structure.js";
import type {
  OutputRenderer,
  OutputRendererConfig,
  StepInfo,
  SummaryInfo,
  SummaryDetailRow,
  ErrorInfo,
} from "./types.js";

/**
 * ConsoleOutputRenderer — theme.ts-backed OutputRenderer (W3-B 焕然一新 reskin).
 *
 * Pure string composition over the shared theme palette
 * (packages/shared/src/theme.ts) plus the W3-B structural primitives
 * (sectionBar from theme.ts; tree/grid/headerRule from ./structure.ts). The
 * OutputRenderer interface (the seam consumed by install/pipeline/pipeline.ts) is
 * unchanged; only what the render* methods EMIT changes — flat coloured lines
 * become section-bar / B-横线 headers + tree-branch steps + a grid summary + a
 * gutter-free (no `│` wall, spec §0.4) plain-indented error block.
 *
 * Visual structure is carried by the primitives; colour stays the accent layer.
 * The ASCII fallback (NO_COLOR / non-TTY) degrades each primitive deterministically
 * — `├─`/`└─`→`+-`/`` `- ``, the B-横线 rule `─`→`-` — so log scrapers and
 * snapshots stay stable.
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

  private renderStatus(message: string, type: "success" | "error" | "warning" | "info"): void {
    const marker = this.statusMarker(type);
    const body = type === "error" ? paint("error", message, this.colorOn) : message;
    this.write(`${marker} ${body}`);
  }

  renderStep(step: StepInfo): void {
    this.currentStep = step;
    // Mockup #2: each step is a tree branch with a status badge + (current/total).
    // renderStep is called per-step (streaming), so emit one branch line per call
    // (`└─` when current===total, `├─` otherwise) rather than buffering — the
    // streaming contract of the OutputRenderer seam is preserved.
    this.write(buildStepLine(step, this.colorOn));

    if (step.detail) {
      this.renderStatus(step.detail, step.status === "error" ? "error" : "info");
    }
  }

  renderSuccess(message: string): void {
    this.renderStatus(message, "success");
  }

  renderError(error: ErrorInfo | Error): void {
    const info = error instanceof Error ? toErrorInfo(error) : error;
    // spec §0.4: a B-横线 `[err] <Title>` header, then a plain-indented (no `│`)
    // grouped block of message / 💡 hint / ↳ stack.
    this.write(buildErrorBlock(info, Boolean(this.config.verbose), this.colorOn));
  }

  renderWarning(message: string): void {
    this.renderStatus(message, "warning");
  }

  renderInfo(message: string): void {
    this.renderStatus(message, "info");
  }

  renderSummaryCard(summary: SummaryInfo): void {
    // Mockup #2: `▌ Summary` section bar + a grid of ✓/○/× counts + summary line.
    // The provided title is kept as-is so callers that pass a custom heading are
    // honoured (wording preserved); the bar replaces the old bold-accent line.
    this.write(sectionBar(summary.title, this.colorOn));
    this.write(buildSummaryBlock(summary, this.colorOn));
  }

  renderSection(title: string): void {
    // SectionHeader equivalent: a section bar header (▌ / `# `), blank line above.
    this.write("");
    this.write(sectionBar(title, this.colorOn));
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
 * Pure builders (W3-B) — string composition with NO side effects, so the
 * snapshot test can pin install steps / summary / error block deterministically.
 * Each takes an explicit `colorOn`; the structure primitives (tree/grid) read the
 * live env, which under NO_COLOR agrees with `colorOn=false`.
 */

/** Step badge by status — mockup #2 `[ok]` / role-painted glyph (ASCII-stable core). */
function stepBadge(status: StepInfo["status"], colorOn: boolean): string {
  switch (status) {
    case "success":
      return symbol("ok", colorOn);
    case "error":
      return symbol("error", colorOn);
    case "skipped":
      return symbol("warn", colorOn);
    case "running":
      return paint("ai", "[..]", colorOn);
    case "pending":
    default:
      return paint("muted", "[--]", colorOn);
  }
}

/**
 * Mockup #2: one step as a tree branch — `├─ [ok] Preflight (1/7)` (`└─` on the
 * final step). renderStep is streaming, so each call emits a single branch row;
 * the last branch glyph is inferred from current===total.
 */
export function buildStepLine(step: StepInfo, colorOn: boolean): string {
  const badge = stepBadge(step.status, colorOn);
  const counter = paint("muted", `(${step.current}/${step.total})`, colorOn);
  const name = step.name || (step.status === "running" ? "Loading..." : "");
  const last = step.total > 0 && step.current >= step.total;
  // tree() infers branch glyph from list position; a single-row list is always
  // "last" (└─), so to render `├─` for non-final steps we feed a 2-row list and
  // keep the first row. This reuses the primitive's glyph + ASCII gating verbatim.
  const text = `${badge} ${name} ${counter}`.replace(/\s+$/u, "");
  if (last) {
    return tree([{ text }]);
  }
  return tree([{ text }, { text: "" }]).split("\n")[0];
}

/** Detail-row marker (SummaryCard DetailStatus; null status → no marker). */
function detailMarker(status: SummaryDetailRow["status"] | undefined, colorOn: boolean): string | null {
  switch (status) {
    case "success":
      return paint("success", "✓", colorOn);
    case "error":
      return paint("error", "✗", colorOn);
    case "skipped":
      return paint("warn", "○", colorOn);
    case "info":
      return paint("ai", "ℹ", colorOn);
    default:
      return null;
  }
}

/**
 * Mockup #2: the summary body under a `▌ Summary` bar — a grid of
 * `✓ N succeeded   ○ N skipped   × N failed`, optional detail rows, and the
 * status line. Wording is preserved from the W3-A renderer.
 */
export function buildSummaryBlock(summary: SummaryInfo, colorOn: boolean): string {
  const { successCount, skippedCount = 0, errorCount = 0, details = [] } = summary;
  const totalCount = successCount + skippedCount + errorCount;
  const lines: string[] = [];

  // Counts as a single grid row (always show all three so the grid is stable).
  const countCells = [
    `${paint("success", "✓", colorOn)} ${successCount} succeeded`,
    `${paint("warn", "○", colorOn)} ${skippedCount} skipped`,
    `${paint("error", "✗", colorOn)} ${errorCount} failed`,
  ];
  lines.push(`  ${grid([countCells], { gap: 4 })}`);

  for (const detail of details) {
    const marker = detailMarker(detail.status, colorOn);
    const label = paint("muted", `${detail.label}:`, colorOn);
    lines.push(`  ${marker ? `${marker} ` : ""}${label} ${detail.value}`);
  }

  const summaryLine =
    totalCount === successCount
      ? "All steps completed successfully"
      : errorCount > 0
        ? `${errorCount} step${errorCount > 1 ? "s" : ""} failed`
        : `${successCount}/${totalCount} steps completed`;
  lines.push(`  ${paint("muted", summaryLine, colorOn)}`);

  return lines.join("\n");
}

/**
 * spec §0.4: error rendered as a B-横线 `[err] <Title>` header + a plain-indented
 * grouped block. message / blank / 💡 hint / ↳ stack-frame are two-space indented
 * with NO `│` wall. Code, hint and stack are optional; stack only renders when
 * verbose. headerRule reads live env, which under NO_COLOR agrees with colorOn=false.
 */
export function buildErrorBlock(info: ErrorInfo, verbose: boolean, colorOn: boolean): string {
  const title = info.title || "Error";
  const code = info.code;
  const hint = info.hint;
  const stack = info.stack;

  const header = headerRule(`[err] ${title}`);
  const lines: string[] = [header, ""];

  const message = code ? `${info.message} ${paint("muted", `(${code})`, colorOn)}` : info.message;
  lines.push(`  ${paint("error", message, colorOn)}`);

  if (hint) {
    lines.push("");
    lines.push(`  ${paint("muted", `💡 ${hint}`, colorOn)}`);
  }

  if (verbose && stack) {
    for (const frame of stack.split("\n").slice(0, 5)) {
      lines.push(`  ${paint("muted", `↳ ${frame.trim()}`, colorOn)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Create the install wizard's output renderer (theme.ts-backed, non-Ink).
 * Same signature semantics as the former Ink renderer factory (config?).
 */
export function createInstallRenderer(config?: OutputRendererConfig): ConsoleOutputRenderer {
  return new ConsoleOutputRenderer(config);
}

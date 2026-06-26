import { paint, symbol, sectionBar, isColorEnabled } from "@fenglimg/fabric-shared/theme";
import { t } from "../i18n.js";
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
  /**
   * TASK-003 (G5): true once a "running" placeholder line for the current step has
   * been written to a TTY and is still on screen — so the next terminal status for
   * the same step can overwrite it in place (`\x1b[1A\x1b[2K`) instead of stacking a
   * second line. Reset whenever the terminal line is emitted (or on a non-TTY path,
   * where the running placeholder is never written at all).
   */
  private runningLineOnScreen = false;

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
    // TASK-003 (G5): a step used to emit a "running" placeholder line AND a later
    // "success/skipped/error" line, both persisting — a stacked double line. Now the
    // two collapse into ONE line:
    //   • TTY + color: the running placeholder is written, then the terminal status
    //     overwrites it in place via `\x1b[1A\x1b[2K` (cursor up + clear line).
    //   • non-TTY (logs/pipes): the running placeholder is SUPPRESSED entirely so
    //     scrapers see only the final terminal line — and the cursor escapes (which
    //     would corrupt a log) are never written (strictly gated behind isTTY).
    const isTTY = this.colorOn && process.stdout.isTTY === true;
    const isRunning = step.status === "running";

    if (isRunning) {
      // Non-TTY: never write the placeholder — wait for the terminal status.
      if (!isTTY) {
        return;
      }
      this.write(buildStepLine(step, this.colorOn));
      this.runningLineOnScreen = true;
      return;
    }

    // Terminal status (success / skipped / error / pending). On a TTY where a
    // running placeholder is still on screen, overwrite it in place; otherwise just
    // print the line. The escape is emitted on the same console.log as the new line
    // so the redraw is atomic.
    if (isTTY && this.runningLineOnScreen) {
      this.write(`\x1b[1A\x1b[2K${buildStepLine(step, this.colorOn)}`);
    } else {
      this.write(buildStepLine(step, this.colorOn));
    }
    this.runningLineOnScreen = false;

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
    // TASK-002 (G6): the summary card title now uses the B-横线 headerRule
    // primitive (TASK-001) instead of the shared `▌` sectionBar — spec §0.4
    // makes the command-level heading a dim-rule underline, no solid block.
    // The provided title is kept as-is so callers that pass a custom heading are
    // honoured (wording preserved). headerRule reads live env / its own ASCII gate.
    this.write(headerRule(summary.title));
    this.write(buildSummaryBlock(summary, this.colorOn));
  }

  renderSection(title: string): void {
    // SectionHeader equivalent: a section bar header (▌ / `# `), blank line above.
    this.write("");
    this.write(sectionBar(title, this.colorOn));
  }

  renderComplete(): void {
    this.renderStatus(t("cli.summary.done"), "success");
  }

  async cleanup(): Promise<void> {
    // No Ink instances to unmount; nothing to flush for synchronous console output.
    this.currentStep = null;
    this.runningLineOnScreen = false;
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
  // TASK-002 (G1): the count words flow through t() (no hardcoded English).
  const countCells = [
    `${paint("success", "✓", colorOn)} ${successCount} ${t("cli.summary.count.succeeded")}`,
    `${paint("warn", "○", colorOn)} ${skippedCount} ${t("cli.summary.count.skipped")}`,
    `${paint("error", "✗", colorOn)} ${errorCount} ${t("cli.summary.count.failed")}`,
  ];
  lines.push(`  ${grid([countCells], { gap: 4 })}`);

  for (const detail of details) {
    const marker = detailMarker(detail.status, colorOn);
    const label = paint("muted", `${detail.label}:`, colorOn);
    lines.push(`  ${marker ? `${marker} ` : ""}${label} ${detail.value}`);
  }

  // TASK-002 (G1): the status line is localized via t() — all-ok / n-failed /
  // n-of-total. {count}/{done}/{total} are interpolated by the translator.
  const summaryLine =
    totalCount === successCount
      ? t("cli.summary.all-ok")
      : errorCount > 0
        ? t("cli.summary.n-failed", { count: String(errorCount) })
        : t("cli.summary.n-of-total", { done: String(successCount), total: String(totalCount) });
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

import { paint, symbol, isColorEnabled } from "@fenglimg/fabric-shared/theme";
import { t } from "../i18n.js";
import { displayWidth } from "../colors.js";
import { grid, headerRule } from "./structure.js";
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
    // flat-design: each stage renders EXACTLY ONCE — on its terminal status
    // (success / skipped / error), with the detail folded inline into the line
    // (`● name   ✓ detail`). The earlier design wrote a dim "running" placeholder
    // first and tried to overwrite it in place via `\x1b[1A\x1b[2K`, but that
    // cursor-up assumes the placeholder is the line DIRECTLY above. Any
    // interstitial output a stage prints (store-slot info lines, clack prompts)
    // pushes the placeholder up, so the overwrite clears the wrong line and the
    // placeholder survives as a doubled `● name` row. A static placeholder (no
    // spinner) buys no real progress feedback, so we drop it: the "running" call
    // is a no-op and the settled line is printed once — robust regardless of any
    // interstitial output, on TTY and non-TTY alike.
    if (step.status === "running") {
      // ISS-20260712-001: one-shot non-destructive progress on TTY so long stages
      // are not silent. Avoid cursor-up overwrite (interstitial output breaks it).
      if (process.stdout.isTTY === true && !(this as { _runningAnnounced?: Set<string> })._runningAnnounced?.has(step.name)) {
        const bag = (this as { _runningAnnounced?: Set<string> });
        bag._runningAnnounced ??= new Set();
        bag._runningAnnounced.add(step.name);
        this.write(buildStepLine({ ...step, detail: step.detail ?? "…" }, this.colorOn));
      }
      return;
    }
    this.write(buildStepLine(step, this.colorOn));
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
    // Blank line above — same breathing room as renderSection — so the summary
    // title ("Fabric 安装完成" / "卸载摘要") is not cramped flush against the last
    // stage line above it.
    this.write("");
    this.write(headerRule(summary.title));
    this.write(buildSummaryBlock(summary, this.colorOn));
  }

  renderSection(title: string): void {
    // SectionHeader: B-横线 header (headerRule, TASK-001) instead of the shared
    // `▌` sectionBar — spec §0.4 (delete the heavy block from CLI output). Blank
    // line above. The shared sectionBar stays for the .cjs hook / SessionStart
    // surface; CLI output uses the flat primitive.
    this.write("");
    this.write(headerRule(title));
  }

  renderComplete(): void {
    this.renderStatus(t("cli.summary.done"), "success");
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

/** Flat-design name column: stage names left-pad to this display width so the
 * status glyphs line up into a clean column (CJK-aware via displayWidth). */
const STEP_NAME_COL = 16;

/**
 * Flat-design status marker for a step line.
 * ISS-20260713-065/066: always include a text role so NO_COLOR / screen-reader
 * capture remains self-describing; glyph is an optional accent.
 */
function statusGlyph(status: StepInfo["status"], colorOn: boolean): string {
  switch (status) {
    case "success":
      return paint("success", "[ok] ✓", colorOn);
    case "error":
      return paint("error", "[error] ✗", colorOn);
    case "skipped":
      return paint("warn", "[skip] ○", colorOn);
    case "pending":
    default:
      return paint("muted", "[..]", colorOn);
  }
}

/**
 * Flat-design step line (spec §0.4): `● <name>   ✓ <detail>` — a dim `●` group
 * marker, the padded stage name, the status glyph, and the detail INLINE (muted).
 * Replaces the former tree-branch `├─ [ok] ✓ name (1/7)` row: no branch glyphs,
 * no `(n/total)` counter (the total lives in the closing summary card), and the
 * detail folded onto the same line instead of a separate `ℹ` row. A `running`
 * step is just the dim dot + name — a TTY placeholder overwritten in place once
 * the stage settles.
 */
export function buildStepLine(step: StepInfo, colorOn: boolean): string {
  const dot = paint("muted", "●", colorOn);
  const name = step.name || "";
  if (step.status === "running") {
    return `${dot} ${name}`;
  }
  const gap = Math.max(2, STEP_NAME_COL - displayWidth(name));
  const glyph = statusGlyph(step.status, colorOn);
  const detail = step.detail ? ` ${paint("muted", step.detail, colorOn)}` : "";
  return `${dot} ${name}${" ".repeat(gap)}${glyph}${detail}`;
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
  // all-resolved. Counts are interpolated by the translator.
  // Terminal-state framing: success AND skipped are both resolved outcomes (a
  // skipped step is done, not pending), so a `done/total` fraction wrongly reads
  // as "incomplete" whenever the only gap is skips. Three real states: any
  // failure → n-failed; clean but some skips → all-resolved (with breakdown);
  // everything succeeded → all-ok.
  const summaryLine =
    errorCount > 0
      ? t("cli.summary.n-failed", { count: String(errorCount) })
      : skippedCount > 0
        ? t("cli.summary.all-resolved", { done: String(successCount), skipped: String(skippedCount) })
        : t("cli.summary.all-ok");
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

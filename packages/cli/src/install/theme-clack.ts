// W3-B (F-002): a thin theme wrap of the @clack CONTEXT surface — intro / outro /
// log / note — re-rendered through the shared W3-B structural primitives so
// `fabric install` context output matches the rest of Fabric's vivid palette.
//
// C-006 SCOPE LOCK: this wraps CONTEXT output ONLY. The @clack PROMPT controls
// (text / select / confirm / multiselect) stay @clack-default and are NEVER
// imported or wrapped here — restyling them is an explicit non-goal. The wrap
// and the raw controls deliberately coexist (two call styles).
//
// Each public fn is a thin void wrapper over a pure `build*` string builder; the
// builders are exported so the NO_COLOR snapshot test can pin output without
// spying on stdout.

import { paint, symbol } from "../colors.js";
import { t } from "../i18n.js";
import { headerRule } from "../tui/structure.js";

// ── pure string builders ───────────────────────────────────────────────────

/** Intro: 平铺风 B-横线 命令级大标题(标题 + 一条 dim 细横线,spec §0.4). */
export function buildIntro(title: string): string {
  return headerRule(title);
}

/** Outro: a single success-painted closing line. */
export function buildOutro(msg: string): string {
  return paint.success(msg);
}

export type LogLevel = "info" | "success" | "warn" | "error";

// info → ai (no status glyph; ai-painted), the three status levels carry a badge.
function buildLogLine(level: LogLevel, msg: string): string {
  switch (level) {
    case "info":
      return paint.ai(msg);
    case "success":
      return `${symbol.ok} ${paint.success(msg)}`;
    case "warn":
      return `${symbol.warn} ${paint.warn(msg)}`;
    case "error":
      return `${symbol.error} ${paint.error(msg)}`;
  }
}

export const buildLog = {
  info: (msg: string): string => buildLogLine("info", msg),
  success: (msg: string): string => buildLogLine("success", msg),
  warn: (msg: string): string => buildLogLine("warn", msg),
  error: (msg: string): string => buildLogLine("error", msg),
} as const;

/**
 * Note(spec §0.2 去竖墙):可选的 B-横线标题 + 纯两空格缩进的正文块 —
 * 不再带逐行 `│`/`| ` 竖墙,靠缩进 + 留白分层。
 */
export function buildNote(body: string, title?: string): string {
  const block = body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return title ? `${headerRule(title)}\n${block}` : block;
}

// ── prompt receipt (flat-design-system Wave4 / TASK-004) ─────────────────────
//
// C-006 SCOPE LOCK still holds: this does NOT wrap or restyle the @clack PROMPT
// controls (select / multiselect / confirm / text). It only prints a SEPARATE,
// flat (gutter-free, no `│`) acknowledgement line AFTER a control has resolved,
// so the transient clack `│` question block gives way to a留白 ✓/x receipt —
// the "提问有沟槽 / 输出无沟槽" rhythm from spec §0.2–0.3.

export type PromptReceiptKind = "selected" | "set" | "cancelled";

/**
 * Build a gutter-free receipt line for a resolved prompt:
 *   selected/set → `✓ <已选|已设置> · <value>`  (success-painted symbol + value)
 *   cancelled     → `x <已取消>`                 (error-painted symbol + label)
 * No `│` gutter — the line stands in the flat output zone, not the clack block.
 */
export function buildPromptReceipt(kind: PromptReceiptKind, value?: string): string {
  if (kind === "cancelled") {
    return `${symbol.error} ${paint.error(t("cli.prompt.receipt.cancelled"))}`;
  }
  const label = t(kind === "selected" ? "cli.prompt.receipt.selected" : "cli.prompt.receipt.set");
  const head = `${symbol.ok} ${paint.success(label)}`;
  return value === undefined || value.length === 0 ? head : `${head} · ${value}`;
}

// ── thin stdout wrappers ────────────────────────────────────────────────────

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

/**
 * Print the flat ✓/x receipt for a just-resolved clack prompt. Call this AFTER
 * the control (and, inside `install-wizard`, AFTER the enclosing clack `group`)
 * has fully resolved — printing mid-group interleaves with clack's group render.
 */
export function promptReceipt(kind: PromptReceiptKind, value?: string): void {
  writeLine(buildPromptReceipt(kind, value));
}

/** Themed @clack `intro` replacement. */
export function themeIntro(title: string): void {
  writeLine(buildIntro(title));
}

/** Themed @clack `outro` replacement. */
export function themeOutro(msg: string): void {
  writeLine(buildOutro(msg));
}

/** Themed @clack `log.{info,success,warn,error}` replacement. */
export const themeLog = {
  info: (msg: string): void => writeLine(buildLog.info(msg)),
  success: (msg: string): void => writeLine(buildLog.success(msg)),
  warn: (msg: string): void => writeLine(buildLog.warn(msg)),
  error: (msg: string): void => writeLine(buildLog.error(msg)),
} as const;

/** Themed @clack `note` replacement. */
export function themeNote(body: string, title?: string): void {
  writeLine(buildNote(body, title));
}

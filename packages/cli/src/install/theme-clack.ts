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

// ── thin stdout wrappers ────────────────────────────────────────────────────

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
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

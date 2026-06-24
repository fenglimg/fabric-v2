// rc.15 TASK-007: render FabricError-shaped failures to stderr with BOTH the
// main message AND the structured actionHint. Citty's default error handler
// prints `err.message` but NOT custom fields like `err.actionHint`, so the
// verbose lock-held guidance from TASK-003 (PID + Ctrl-C/kill instructions)
// was being silently dropped at every CLI surface that hits a lock.
//
// Call sites wrap acquireLock / checkLockOrThrow in try/catch and delegate
// here so the UX wording reaches the user's terminal before process.exit(1).

import type { Writable } from "node:stream";
import { hasActionHint, type FabricErrorShape } from "@fenglimg/fabric-shared/errors";

import { paint, symbol } from "../colors.js";

export { hasActionHint };
export type { FabricErrorShape };

/**
 * Render a FabricError-shaped failure to a writable stream (defaults to
 * process.stderr). Format: the main message on its own line, followed by an
 * indented action-hint arrow on the next line:
 *
 *     serve lock held by live PID 12345
 *       -> Stop the running 'fabric serve' (Ctrl-C in its terminal, or 'kill 12345')
 *
 * The arrow uses ASCII "-> " (not Unicode →) for GBK terminal compatibility.
 */
export function renderFabricError(
  err: FabricErrorShape,
  stream: Writable = process.stderr,
): void {
  stream.write(`${err.message}\n`);
  stream.write(`  -> ${err.actionHint}\n`);
}

/**
 * ISS-030: top-level CLI error renderer. citty's default handler prints only
 * `err.message`, silently dropping a FabricError's structured `actionHint` at
 * every command surface. The CLI entrypoint (index.ts `run`) routes thrown
 * errors here so any FabricError-shaped failure surfaces its recovery guidance.
 *
 * Returns a discriminant so the caller can decide follow-up handling:
 *   - "fabric-error": rendered message + actionHint here; caller just exits 1.
 *   - "other":        not a FabricError — caller falls back to citty's own
 *                     usage/error rendering (unknown-command, arg-parse, etc.).
 */
export function renderTopLevelError(
  err: unknown,
  stream: Writable = process.stderr,
): "fabric-error" | "other" {
  if (hasActionHint(err)) {
    renderFabricError(err, stream);
    return "fabric-error";
  }
  return "other";
}

/**
 * W3-I ③: render a genuinely-unexpected failure (NOT a FabricError, NOT a citty
 * usage error) for humans. The top-level catch in index.ts previously dumped the
 * raw error object + full stack via `console.error(err, "\n")`, which surfaces a
 * wall of internal stack noise to a user who can do nothing with it.
 *
 * This renders a single themed error line (`symbol.error` + the human message);
 * the full stack is kept for the maintainer path and only printed when
 * `showStack` is set (`--debug` flag / `FABRIC_DEBUG=1`). When the stack is
 * withheld, a muted one-liner tells the user how to get it. Stream is injectable
 * so the renderer stays pure and unit-testable (no color codes asserted — color
 * degrades to ASCII when stdout is not a TTY).
 */
export function renderUnexpectedError(
  err: unknown,
  showStack: boolean,
  stream: Writable = process.stderr,
): void {
  const message = err instanceof Error ? err.message : String(err);
  stream.write(`${symbol.error} ${paint.error(message)}\n`);
  if (showStack && err instanceof Error && err.stack) {
    stream.write(`${err.stack}\n`);
  } else if (!showStack) {
    stream.write(
      `${paint.muted("  Run with --debug (or FABRIC_DEBUG=1) for the full stack trace.")}\n`,
    );
  }
}

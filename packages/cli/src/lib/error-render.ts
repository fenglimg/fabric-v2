// rc.15 TASK-007: render FabricError-shaped failures to stderr with BOTH the
// main message AND the structured actionHint. Citty's default error handler
// prints `err.message` but NOT custom fields like `err.actionHint`, so the
// verbose lock-held guidance from TASK-003 (PID + Ctrl-C/kill instructions)
// was being silently dropped at every CLI surface that hits a lock.
//
// Call sites wrap acquireLock / checkLockOrThrow in try/catch and delegate
// here so the UX wording reaches the user's terminal before process.exit(1).

import type { Writable } from "node:stream";

/**
 * Structural duck-typing for any FabricError-shaped value: the base class
 * (packages/shared/src/errors/fabric-error.ts) guarantees `message` (from
 * Error) and `actionHint` (own field). We intentionally avoid `instanceof`
 * checks against the FabricError class symbol because errors thrown by the
 * server package cross workspace boundaries — the CLI sees them as
 * structurally-shaped objects, not necessarily the same class identity.
 */
export type FabricErrorShape = {
  message: string;
  actionHint: string;
};

/**
 * Type guard: returns true when `err` carries both a non-empty `message` and
 * a non-empty `actionHint` string. False for plain Errors, citty errors, or
 * any other thrown value.
 */
export function hasActionHint(err: unknown): err is FabricErrorShape {
  if (err === null || typeof err !== "object") return false;
  const candidate = err as { message?: unknown; actionHint?: unknown };
  return (
    typeof candidate.message === "string" &&
    candidate.message.length > 0 &&
    typeof candidate.actionHint === "string" &&
    candidate.actionHint.length > 0
  );
}

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

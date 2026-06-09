import fs from "node:fs";
import path from "node:path";

import { createTranslator, resolveFabricLocale } from "@fenglimg/fabric-shared";
import { IOFabricError } from "@fenglimg/fabric-shared/errors";
import {
  isAlive,
  readServeLockState,
  serveLockPath,
  type ServeLockState,
} from "@fenglimg/fabric-shared/node";

export { isAlive };

// rc.15 TASK-003: i18n action-hint message for ServeLockHeldError. Replaces
// the previous hardcoded "or run with --force to override" guidance — --force
// is gone, so the message now surfaces the PID and concrete stop steps.
//
// rc.26 TASK-01: switched from module-level env-detected locale to a per-call
// `resolveFabricLocale(projectRoot)` factory so the serve-lock error honors
// the user's fabric_language config (KT-DEC-9004 invariant). `acquireLock`
// and `checkLockOrThrow` now construct `t` themselves; release and read paths
// don't surface user-facing messages and stay translator-free.

export class ServeLockHeldError extends IOFabricError {
  readonly code = "SERVE_LOCK_HELD";
  readonly httpStatus = 423;
}

export type LockState = ServeLockState;

export interface AcquireOptions {
  force?: boolean;
}

export function acquireLock(projectRoot: string, opts?: AcquireOptions): void {
  const p = serveLockPath(projectRoot);
  if (fs.existsSync(p)) {
    let state: LockState | null = null;
    try {
      state = JSON.parse(fs.readFileSync(p, "utf8")) as LockState;
    } catch {
      // malformed — treat as stale
    }
    if (state && state.pid && state.pid !== process.pid && isAlive(state.pid) && !opts?.force) {
      const t = createTranslator(resolveFabricLocale(projectRoot));
      throw new ServeLockHeldError(
        `serve lock held by live PID ${state.pid}`,
        {
          actionHint: t("cli.serve.lock-held.action-hint", { pid: String(state.pid) }),
          details: state,
        },
      );
    }
    if (state && state.pid && !isAlive(state.pid)) {
      process.stderr.write(`[serve-lock] stale lock from PID ${state.pid} — overwriting\n`);
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), host: process.env.HOSTNAME }),
  );
}

export function releaseLock(projectRoot: string): void {
  const p = serveLockPath(projectRoot);
  try {
    if (fs.existsSync(p)) {
      const state = JSON.parse(fs.readFileSync(p, "utf8")) as LockState;
      if (state.pid === process.pid) {
        fs.unlinkSync(p);
      }
    }
  } catch {
    // best-effort
  }
}

export function readLockState(projectRoot: string): LockState | null {
  return readServeLockState(projectRoot);
}

export function checkLockOrThrow(projectRoot: string, opts?: AcquireOptions): void {
  const state = readLockState(projectRoot);
  if (state === null) return;
  if (state.pid === process.pid) return;
  if (!isAlive(state.pid)) {
    process.stderr.write(`[serve-lock] stale lock from PID ${state.pid} — ignoring\n`);
    return;
  }
  if (opts?.force) return;
  const t = createTranslator(resolveFabricLocale(projectRoot));
  throw new ServeLockHeldError(
    `serve lock held by live PID ${state.pid}`,
    {
      actionHint: t("cli.serve.lock-held.action-hint", { pid: String(state.pid) }),
      details: state,
    },
  );
}

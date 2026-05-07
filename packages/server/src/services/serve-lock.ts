import fs from "node:fs";
import path from "node:path";

import { IOFabricError } from "@fenglimg/fabric-shared/errors";

const LOCK_FILENAME = ".serve.lock";

export class ServeLockHeldError extends IOFabricError {
  readonly code = "SERVE_LOCK_HELD";
  readonly httpStatus = 423;
}

export interface LockState {
  pid: number;
  acquiredAt: number;
  host?: string;
}

export interface AcquireOptions {
  force?: boolean;
}

function lockPath(projectRoot: string): string {
  return path.join(projectRoot, ".fabric", LOCK_FILENAME);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = liveness check
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ESRCH") return false; // no such process
    if (err.code === "EPERM") return true; // process alive but not ours — be conservative
    throw e;
  }
}

export function acquireLock(projectRoot: string, opts?: AcquireOptions): void {
  const p = lockPath(projectRoot);
  if (fs.existsSync(p)) {
    let state: LockState | null = null;
    try {
      state = JSON.parse(fs.readFileSync(p, "utf8")) as LockState;
    } catch {
      // malformed — treat as stale
    }
    if (state && state.pid && state.pid !== process.pid && isAlive(state.pid) && !opts?.force) {
      throw new ServeLockHeldError(
        `serve lock held by live PID ${state.pid}`,
        {
          actionHint: `Stop the other process (PID ${state.pid}) or run with --force to override`,
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
  const p = lockPath(projectRoot);
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
  const p = lockPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as LockState;
  } catch {
    return null;
  }
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
  throw new ServeLockHeldError(
    `serve lock held by live PID ${state.pid}`,
    {
      actionHint: `Stop the other serve process (PID ${state.pid}) before running this command, or pass --force to override`,
      details: state,
    },
  );
}

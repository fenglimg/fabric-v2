// v2.0.0-rc.37 Wave A2 Part 2: read-only probe split from serve-lock.ts.
//
// The full lock implementation (acquire / release / throw) was quarantined to
// packages/server-http-experimental/ alongside `fabric serve` per KB
// [[fabric-serve-quarantine-not-delete]]. Main-line code no longer writes the
// `.fabric/.serve.lock` file, but doctor still inspects legacy lock files left
// behind by rc ≤36 `fabric serve` invocations so users can reap them via
// `doctor --fix`. This module exposes ONLY the read-side primitives that the
// doctor needs — no writer, no throw, no i18n surface.
import fs from "node:fs";
import path from "node:path";

const LOCK_FILENAME = ".serve.lock";

export interface LockState {
  pid: number;
  acquiredAt: number;
  host?: string;
}

function lockPath(projectRoot: string): string {
  return path.join(projectRoot, ".fabric", LOCK_FILENAME);
}

export function isAlive(pid: number): boolean {
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

export function readLockState(projectRoot: string): LockState | null {
  const p = lockPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as LockState;
  } catch {
    return null;
  }
}

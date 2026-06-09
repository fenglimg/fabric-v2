import fs from "node:fs";
import path from "node:path";

const SERVE_LOCK_FILENAME = ".serve.lock";

export interface ServeLockState {
  pid: number;
  acquiredAt: number;
  host?: string;
}

export function serveLockPath(projectRoot: string): string {
  return path.join(projectRoot, ".fabric", SERVE_LOCK_FILENAME);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ESRCH") return false;
    if (err.code === "EPERM") return true;
    throw e;
  }
}

export function readServeLockState(projectRoot: string): ServeLockState | null {
  const p = serveLockPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ServeLockState;
  } catch {
    return null;
  }
}

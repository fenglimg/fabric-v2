import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireLock, AcquireOptions, checkLockOrThrow, LockState, readLockState, releaseLock, ServeLockHeldError } from "./serve-lock.js";

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "serve-lock-test-"));
}

describe("serve-lock", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("acquireLock writes lockfile with current PID and timestamp", () => {
    const before = Date.now();
    acquireLock(projectRoot);
    const after = Date.now();

    const lockFile = path.join(projectRoot, ".fabric", ".serve.lock");
    expect(fs.existsSync(lockFile)).toBe(true);

    const state = JSON.parse(fs.readFileSync(lockFile, "utf8")) as LockState;
    expect(state.pid).toBe(process.pid);
    expect(state.acquiredAt).toBeGreaterThanOrEqual(before);
    expect(state.acquiredAt).toBeLessThanOrEqual(after);
  });

  it("stale lock (PID does not exist) is auto-recovered and overwritten", () => {
    // Write a lock with a PID that is almost certainly dead
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const stalePid = 999999999;
    const lockFile = path.join(fabricDir, ".serve.lock");
    const staleState: LockState = { pid: stalePid, acquiredAt: Date.now() - 60000 };
    fs.writeFileSync(lockFile, JSON.stringify(staleState));

    // Mock process.kill so that stalePid throws ESRCH (no such process)
    vi.spyOn(process, "kill").mockImplementation((pid: number, _signal?: string | number) => {
      if (pid === stalePid) {
        const err = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        throw err;
      }
      return true;
    });

    expect(() => acquireLock(projectRoot)).not.toThrow();

    const newState = JSON.parse(fs.readFileSync(lockFile, "utf8")) as LockState;
    expect(newState.pid).toBe(process.pid);
  });

  it("live lock held by different PID throws ServeLockHeldError", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const livePid = process.pid + 1; // different PID
    const lockFile = path.join(fabricDir, ".serve.lock");
    fs.writeFileSync(lockFile, JSON.stringify({ pid: livePid, acquiredAt: Date.now() } satisfies LockState));

    // Mock process.kill to NOT throw — simulating alive PID
    vi.spyOn(process, "kill").mockReturnValue(true);

    expect(() => acquireLock(projectRoot)).toThrow(ServeLockHeldError);
  });

  it("force option overrides live lock and acquires successfully", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const livePid = process.pid + 1;
    const lockFile = path.join(fabricDir, ".serve.lock");
    fs.writeFileSync(lockFile, JSON.stringify({ pid: livePid, acquiredAt: Date.now() } satisfies LockState));

    vi.spyOn(process, "kill").mockReturnValue(true);

    expect(() => acquireLock(projectRoot, { force: true })).not.toThrow();

    const state = JSON.parse(fs.readFileSync(lockFile, "utf8")) as LockState;
    expect(state.pid).toBe(process.pid);
  });

  it("releaseLock removes lockfile when PID matches", () => {
    acquireLock(projectRoot);
    const lockFile = path.join(projectRoot, ".fabric", ".serve.lock");
    expect(fs.existsSync(lockFile)).toBe(true);

    releaseLock(projectRoot);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("releaseLock leaves lockfile alone when owned by foreign PID", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const foreignPid = process.pid + 1;
    const lockFile = path.join(fabricDir, ".serve.lock");
    const foreignState: LockState = { pid: foreignPid, acquiredAt: Date.now() };
    fs.writeFileSync(lockFile, JSON.stringify(foreignState));

    releaseLock(projectRoot);

    expect(fs.existsSync(lockFile)).toBe(true);
    const remaining = JSON.parse(fs.readFileSync(lockFile, "utf8")) as LockState;
    expect(remaining.pid).toBe(foreignPid);
  });

  it("isAlive returns false on ESRCH and true on EPERM via acquireLock behavior", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const lockFile = path.join(fabricDir, ".serve.lock");

    // ESRCH: stale lock should be overwritten (no throw)
    const pidForEsrch = process.pid + 2;
    fs.writeFileSync(lockFile, JSON.stringify({ pid: pidForEsrch, acquiredAt: Date.now() } satisfies LockState));

    vi.spyOn(process, "kill").mockImplementation((pid: number | NodeJS.Signals) => {
      if (pid === pidForEsrch) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    });

    expect(() => acquireLock(projectRoot)).not.toThrow(); // stale → overwritten

    // EPERM: conservative — treat as alive → should throw ServeLockHeldError
    const pidForEperm = process.pid + 3;
    fs.writeFileSync(lockFile, JSON.stringify({ pid: pidForEperm, acquiredAt: Date.now() } satisfies LockState));

    vi.spyOn(process, "kill").mockImplementation((pid: number | NodeJS.Signals) => {
      if (pid === pidForEperm) {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      return true;
    });

    expect(() => acquireLock(projectRoot)).toThrow(ServeLockHeldError);
  });

  it("checkLockOrThrow does not throw when no lockfile exists", () => {
    expect(() => checkLockOrThrow(projectRoot)).not.toThrow();
  });

  it("checkLockOrThrow throws ServeLockHeldError when live lock held by other PID", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const livePid = process.pid + 1;
    fs.writeFileSync(
      path.join(fabricDir, ".serve.lock"),
      JSON.stringify({ pid: livePid, acquiredAt: Date.now() } satisfies LockState),
    );

    vi.spyOn(process, "kill").mockReturnValue(true);

    expect(() => checkLockOrThrow(projectRoot)).toThrow(ServeLockHeldError);
  });

  it("checkLockOrThrow does not throw with --force even when live lock held", () => {
    const fabricDir = path.join(projectRoot, ".fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const livePid = process.pid + 1;
    fs.writeFileSync(
      path.join(fabricDir, ".serve.lock"),
      JSON.stringify({ pid: livePid, acquiredAt: Date.now() } satisfies LockState),
    );

    vi.spyOn(process, "kill").mockReturnValue(true);

    expect(() => checkLockOrThrow(projectRoot, { force: true })).not.toThrow();
  });
});

/**
 * Integration tests: serve command lock behavior
 * Covers: I9 (EADDRINUSE releases lock), I10 (lock prevents duplicate serve)
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireLock, checkLockOrThrow, releaseLock, ServeLockHeldError } from "@fenglimg/fabric-server";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `itg-serve-lock-${prefix}-`));
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

// I9 — EADDRINUSE causes releaseLock before throwing (no orphan lock)
describe("I9: serve releases lock on EADDRINUSE", () => {
  it("serveCommand releases lock and throws port-in-use error on EADDRINUSE", async () => {
    vi.doMock("@fenglimg/fabric-server", async () => {
      const actual = await import("@fenglimg/fabric-server");
      return {
        ...actual,
        startHttpServer: vi.fn().mockRejectedValue(Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" })),
      };
    });

    const { serveCommand } = await import("../../src/commands/serve.ts");
    const projectRoot = makeTempDir("eaddrinuse");

    await expect(
      serveCommand.run?.({
        args: {
          target: projectRoot,
          port: "19999",
          host: "127.0.0.1",
          debug: false,
        },
      } as never),
    ).rejects.toThrow(/port|next|19999|20000/i);

    // Lock file must be gone after EADDRINUSE
    const lockPath = join(projectRoot, ".fabric", ".serve.lock");
    expect(existsSync(lockPath)).toBe(false);
  });
});

// I10 — lock prevents duplicate serves (rc.15: --force removed; engine-side
// force option still validated as a server-internal escape hatch for unit
// tests + future programmatic callers).
describe("I10: serve-lock prevents duplicate run", () => {
  it("acquireLock throws ServeLockHeldError when a live lock from another PID is present", () => {
    const dir = makeTempDir("lock-held");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    // Write a lock that looks like a LIVE process (PID 1 is almost always alive on POSIX)
    writeFileSync(lockPath, JSON.stringify({ pid: 1, acquiredAt: Date.now() }), "utf8");

    expect(() => acquireLock(dir, { force: false })).toThrow(ServeLockHeldError);
  });

  it("checkLockOrThrow throws ServeLockHeldError for a live PID lock without --force", () => {
    const dir = makeTempDir("check-lock");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 1, acquiredAt: Date.now() }), "utf8");

    expect(() => checkLockOrThrow(dir, { force: false })).toThrow(ServeLockHeldError);
  });

  it("checkLockOrThrow passes through when --force=true even with live lock", () => {
    const dir = makeTempDir("check-force");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 1, acquiredAt: Date.now() }), "utf8");

    // Should NOT throw when force=true
    expect(() => checkLockOrThrow(dir, { force: true })).not.toThrow();
  });

  it("acquireLock passes through when --force=true even with live lock", () => {
    const dir = makeTempDir("acquire-force");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 1, acquiredAt: Date.now() }), "utf8");

    // Should NOT throw when force=true, and should overwrite the lock
    expect(() => acquireLock(dir, { force: true })).not.toThrow();

    // Cleanup: release what we just acquired
    releaseLock(dir);
  });

  it("stale lock (dead PID) is silently overwritten and acquire succeeds", () => {
    const dir = makeTempDir("stale-lock");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    // Write a lock with a non-existent PID (very large number that cannot be alive)
    writeFileSync(lockPath, JSON.stringify({ pid: 9999999, acquiredAt: Date.now() }), "utf8");

    // Should NOT throw (stale lock)
    expect(() => acquireLock(dir, { force: false })).not.toThrow();
    releaseLock(dir);
  });

  it("doctor is blocked by active serve lock", () => {
    const dir = makeTempDir("doctor-lock");
    const lockPath = join(dir, ".fabric", ".serve.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 1, acquiredAt: Date.now() }), "utf8");

    expect(() => checkLockOrThrow(dir, { force: false })).toThrow(ServeLockHeldError);
    // rc.15: --force was removed from the CLI; engine-side force option
    // is still honoured for programmatic callers and unit tests.
    expect(() => checkLockOrThrow(dir, { force: true })).not.toThrow();
  });
});

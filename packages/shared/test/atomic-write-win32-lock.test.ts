import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Windows lock-contention semantics.
//
// POSIX signals "someone else holds this lock" as EEXIST. Windows does not:
// unlinking a file another handle still has open only marks it DELETE-PENDING,
// and opening a delete-pending file yields EPERM (or EBUSY). The concurrency
// test in atomic-write.test.ts hits that window routinely on Windows CI and
// failed intermittently with `EPERM: operation not permitted, open '...x.lock'`.
//
// These two cases pin the platform split. They mock `open` because the EPERM
// path is unreachable on the machine this suite normally runs on (macOS/Linux)
// — without the mock the win32 branch would be shipped with zero executed
// assertions, which is indistinguishable from not writing it.
// ---------------------------------------------------------------------------

const openMock = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: (...args: unknown[]) => openMock(...args) };
});

const tempRoots: string[] = [];
let realPlatform: PropertyDescriptor | undefined;

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

beforeEach(() => {
  realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  openMock.mockReset();
});

afterEach(() => {
  if (realPlatform) Object.defineProperty(process, "platform", realPlatform);
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "wfl-win32-"));
  tempRoots.push(dir);
  return join(dir, "x.lock");
}

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: mocked`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("withFileLock — win32 contention codes", () => {
  it("treats EPERM as contention on win32 (retries, then times out naming the cause)", async () => {
    const { withFileLock } = await import("../src/node/atomic-write");
    setPlatform("win32");
    openMock.mockRejectedValue(errno("EPERM"));

    const body = vi.fn();
    await expect(
      withFileLock(makeLockPath(), body, { maxWaitMs: 60, retryDelayMs: 5, staleMs: 10_000 }),
    ).rejects.toThrow(/timed out .* \(last error: EPERM\)/s);

    // Retried rather than giving up on the first EPERM — that IS the fix.
    expect(openMock.mock.calls.length).toBeGreaterThan(1);
    expect(body).not.toHaveBeenCalled();
  });

  it("does NOT swallow EPERM off win32 — a real permission error surfaces at once", async () => {
    const { withFileLock } = await import("../src/node/atomic-write");
    setPlatform("linux");
    openMock.mockRejectedValue(errno("EPERM"));

    await expect(
      withFileLock(makeLockPath(), vi.fn(), { maxWaitMs: 60, retryDelayMs: 5 }),
    ).rejects.toThrow(/EPERM/);

    // Exactly one attempt: no spin-until-timeout for a genuine permission fault.
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("EBUSY is contention on win32 too", async () => {
    const { withFileLock } = await import("../src/node/atomic-write");
    setPlatform("win32");
    openMock.mockRejectedValue(errno("EBUSY"));

    await expect(
      withFileLock(makeLockPath(), vi.fn(), { maxWaitMs: 60, retryDelayMs: 5 }),
    ).rejects.toThrow(/last error: EBUSY/);
    expect(openMock.mock.calls.length).toBeGreaterThan(1);
  });
});

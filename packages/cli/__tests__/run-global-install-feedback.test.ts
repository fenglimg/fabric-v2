import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// W3-04 (ISS-031/032/037) — `fabric install --global <url>` UX:
//   031: emit a progress line before the (potentially slow) network clone.
//   032: surface git's own stderr on clone failure, not a bare "Command failed".
//   037: internal store/config invariants throw actionable FabricErrors.
// We mock node:child_process so the clone is observable without real network.

let cloneShouldThrow = false;
const cloneCalls: string[][] = [];

vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], optionsOrCallback: unknown, maybeCallback?: (error: Error | null) => void) => {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    callback?.(null);
  },
  execFileSync: (file: string, args: string[]) => {
    if (file === "git" && args[0] === "clone") {
      cloneCalls.push(args);
      if (cloneShouldThrow) {
        const err = new Error("Command failed: git clone") as Error & { stderr?: string };
        err.stderr = "fatal: repository 'x' not found";
        throw err;
      }
    }
    return Buffer.from("");
  },
}));

const { runGlobalInstall } = await import("../src/install/run-global-install.js");
const { hasActionHint } = await import("../src/lib/error-render.js");

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  cloneShouldThrow = false;
  cloneCalls.splice(0);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("install --global UX feedback", () => {
  it("emits a progress line before the network clone (ISS-031)", async () => {
    const globalRoot = join(tmp("fabric-fb1-"), ".fabric");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // clone is a no-op → cloned dir has no store.json → mount throws afterwards.
      await runGlobalInstall(
        { url: "https://example.com/store.git", uid: "u", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
        globalRoot,
      ).catch(() => {});
    } finally {
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      logSpy.mockRestore();
      expect(logged).toMatch(/clon/i);
    }
  });

  it("wraps a git clone failure in an actionable FabricError (ISS-032/037)", async () => {
    cloneShouldThrow = true;
    const globalRoot = join(tmp("fabric-fb2-"), ".fabric");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = await runGlobalInstall(
      { url: "https://example.com/missing.git", uid: "u", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
      globalRoot,
    ).catch((e: unknown) => e);
    expect(hasActionHint(err)).toBe(true);
  });

  it("surfaces a remedy when the cloned repo is not a Fabric store (ISS-037)", async () => {
    const globalRoot = join(tmp("fabric-fb3-"), ".fabric");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = await runGlobalInstall(
      { url: "https://example.com/not-fabric.git", uid: "u", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
      globalRoot,
    ).catch((e: unknown) => e);
    expect(hasActionHint(err)).toBe(true);
  });
});

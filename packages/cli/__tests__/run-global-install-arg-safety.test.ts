import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// W3-02 (ISS-002) — `git clone` must place `--` before the url so an
// option-like remote (e.g. `--upload-pack=...`, `-evil`, `ext::sh -c ...`)
// is treated as a positional repository argument, never parsed as a git
// option. We mock node:child_process to capture the argv handed to git.

const cloneCalls: string[][] = [];

vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], optionsOrCallback: unknown, maybeCallback?: (error: Error | null) => void) => {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    callback?.(null);
  },
  execFileSync: (file: string, args: string[]) => {
    if (file === "git" && args[0] === "clone") {
      cloneCalls.push(args);
    }
    return Buffer.from("");
  },
}));

const { runGlobalInstall } = await import("../src/install/run-global-install.js");

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dirs: string[] = [];

afterEach(() => {
  cloneCalls.splice(0);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe("install --global git clone arg safety", () => {
  it("inserts `--` before an option-like url so it is treated as a repo path", async () => {
    const globalRoot = join(tmp("fabric-gi-argsafe-"), ".fabric");
    const maliciousUrl = "--upload-pack=touch /tmp/pwned";

    // The mocked clone is a no-op → cloned dir has no store.json → mount throws.
    // We only care that the argv handed to git was safe.
    await expect(
      runGlobalInstall(
        { url: maliciousUrl, uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
        globalRoot,
      ),
    ).rejects.toThrow();

    const cloneCall = cloneCalls.find((a) => a[0] === "clone");
    expect(cloneCall).toBeDefined();
    // argv must be: ["clone", "--", <url>, <dest>] — `--` immediately before url.
    expect(cloneCall?.[1]).toBe("--");
    expect(cloneCall?.[2]).toBe(maliciousUrl);
    expect(cloneCall?.indexOf(maliciousUrl)).toBeGreaterThan(cloneCall?.indexOf("--") ?? -1);
  });
});

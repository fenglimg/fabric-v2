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
  it("inserts `--` before an allowed https url (option-injection hardening)", async () => {
    const globalRoot = join(tmp("fabric-gi-argsafe-"), ".fabric");
    const url = "https://example.com/org/fabric-store.git";

    // The mocked clone is a no-op → cloned dir has no store.json → mount throws.
    // We only care that the argv handed to git was safe.
    await expect(
      runGlobalInstall(
        { url, uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
        globalRoot,
      ),
    ).rejects.toThrow();

    const cloneCall = cloneCalls.find((a) => a[0] === "clone");
    expect(cloneCall).toBeDefined();
    // argv must be: ["clone", "--", <url>, <dest>] — `--` immediately before url.
    expect(cloneCall?.[1]).toBe("--");
    expect(cloneCall?.[2]).toBe(url);
    expect(cloneCall?.indexOf(url)).toBeGreaterThan(cloneCall?.indexOf("--") ?? -1);
  });

  it("rejects option-like urls before git clone (allowlist + dash prefix)", async () => {
    const globalRoot = join(tmp("fabric-gi-dash-"), ".fabric");
    await expect(
      runGlobalInstall(
        {
          url: "--upload-pack=touch /tmp/pwned",
          uid: "u-x",
          personalStoreUuid: PERSONAL,
          now: "2026-05-30T00:00:00.000Z",
        },
        globalRoot,
      ),
    ).rejects.toThrow(/not allowlisted|option-like/i);
    expect(cloneCalls.length).toBe(0);
  });
});

describe("install --global git remote protocol allowlist (ISS-20260713-005)", () => {
  it("rejects ext:: remotes before git clone", async () => {
    const globalRoot = join(tmp("fabric-gi-ext-"), ".fabric");
    await expect(
      runGlobalInstall(
        {
          url: "ext::sh -c \"touch /tmp/pwned\"",
          uid: "u-x",
          personalStoreUuid: PERSONAL,
          now: "2026-05-30T00:00:00.000Z",
        },
        globalRoot,
      ),
    ).rejects.toThrow(/not allowlisted|ext::/i);
    expect(cloneCalls.length).toBe(0);
  });

  it("rejects file:// remotes before git clone", async () => {
    const globalRoot = join(tmp("fabric-gi-file-"), ".fabric");
    await expect(
      runGlobalInstall(
        {
          url: "file:///tmp/evil.git",
          uid: "u-x",
          personalStoreUuid: PERSONAL,
          now: "2026-05-30T00:00:00.000Z",
        },
        globalRoot,
      ),
    ).rejects.toThrow(/not allowlisted|file:/i);
    expect(cloneCalls.length).toBe(0);
  });
});

/**
 * F27: `warnUnknownFlags` surfaces unrecognized `--flags` that citty (mri-based)
 * would otherwise silently swallow on the arg-less read-only commands
 * (whoami / status). It is a non-blocking stderr nudge — the command still runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { warnUnknownFlags } from "../src/lib/unknown-flags.js";

const origArgv = process.argv;

afterEach(() => {
  process.argv = origArgv;
  vi.restoreAllMocks();
});

function capture(argv: string[]): string {
  process.argv = ["node", "fabric", ...argv];
  let out = "";
  vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    out += String(s);
    return true;
  });
  return (warnUnknownFlags(["json"]), out);
}

describe("warnUnknownFlags", () => {
  it("stays silent when every flag is known", () => {
    expect(capture(["whoami", "--json"])).toBe("");
  });

  it("warns on an unknown long flag", () => {
    const out = capture(["whoami", "--jsno"]);
    expect(out).toContain("unknown flag");
    expect(out).toContain("--jsno");
  });

  it("ignores positionals and the subcommand name", () => {
    expect(capture(["status"])).toBe("");
  });

  it("treats --no-<known> negation as known", () => {
    expect(capture(["whoami", "--no-json"])).toBe("");
  });

  it("strips =value before matching", () => {
    expect(capture(["whoami", "--json=true"])).toBe("");
    expect(capture(["whoami", "--depth=3"])).toContain("--depth");
  });

  it("treats --help / --version as always-known", () => {
    expect(capture(["whoami", "--help"])).toBe("");
    expect(capture(["status", "--version"])).toBe("");
  });
});

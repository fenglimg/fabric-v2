import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/index.js";

// Regression: a bare `fabric` (no args) must render the root help (citty's
// standard usage, the SINGLE renderer shared with `fabric --help` and every
// subcommand help) and return cleanly — NOT citty's "No command specified."
// error with a non-zero exit, and NOT a bespoke grouped renderer (retired).
describe("bare `fabric` (no args) routing", () => {
  const realArgv = process.argv;
  const realNoColor = process.env.NO_COLOR;
  let lines: string[];

  beforeEach(() => {
    process.env.NO_COLOR = "1"; // strip ANSI so substring asserts are stable
    lines = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });
    vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });
  });

  afterEach(() => {
    process.argv = realArgv;
    if (realNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = realNoColor;
    vi.restoreAllMocks();
  });

  it("renders citty's root usage (COMMANDS table + i18n descriptions), no error", async () => {
    process.argv = ["node", "/path/to/fabric"]; // rawArgs = []

    await run();
    const out = lines.join("\n");

    // citty's standard usage structure.
    expect(out).toMatch(/USAGE/);
    expect(out).toMatch(/COMMANDS/);

    // The public commands surface with their i18n'd one-line descriptions
    // (FAB_LANG=en is pinned by vitest.setup.ts).
    expect(out).toContain("install");
    expect(out).toContain("store");
    expect(out).toContain("Manage mounted knowledge stores"); // cli.store.description

    // Internal RPC commands carry meta.hidden:true → citty omits them.
    expect(out).not.toContain("plan-context-hint");
    expect(out).not.toContain("onboard-coverage");

    // The bug signature: citty's "no command" error must NOT leak to the user.
    expect(out).not.toContain("No command specified");
  });
});

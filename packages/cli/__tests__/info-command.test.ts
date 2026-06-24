import { afterEach, describe, expect, it, vi } from "vitest";

import infoCommand from "../src/commands/info.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

// W3-F (NS-01 §1/I1): `info scope` was a positional-detected pseudo-subcommand;
// it is now a real citty subCommand so `fabric info scope --help` works and the
// coordinate is a citty-validated required positional (the old hand-rolled
// "missing scope" branch is gone — citty enforces it).
describe("info command — scope as a real subcommand (W3-F)", () => {
  it("registers a real `scope` subcommand", () => {
    const sub = infoCommand.subCommands as Record<string, unknown> | undefined;
    expect(sub).toBeDefined();
    expect(sub?.scope).toBeDefined();
  });

  it("the scope subcommand requires a `coord` positional", () => {
    const scope = (infoCommand.subCommands as Record<string, { args: Record<string, { type: string; required?: boolean }> }>)
      .scope;
    expect(scope.args.coord.type).toBe("positional");
    expect(scope.args.coord.required).toBe(true);
  });

  it("parent `info` no longer detects a positional `subcommand` arg", () => {
    // Scope routing is citty's job now; the parent only does status / whoami.
    const args = infoCommand.args as Record<string, unknown> | undefined;
    expect(args?.subcommand).toBeUndefined();
    expect(args?.scope).toBeUndefined();
  });

  it("parent `info` run resolves a mode without throwing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => infoCommand.run?.({ args: {} } as never)).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import infoCommand from "../src/commands/info.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("info command", () => {
  it("rejects `info scope` without a scope argument before calling the resolver", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
      errors.push(value === undefined ? "" : String(value));
    });

    expect(() => {
      infoCommand.run?.({ args: { subcommand: "scope" } } as never);
    }).not.toThrow();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("fabric info scope <scope>");
  });
});

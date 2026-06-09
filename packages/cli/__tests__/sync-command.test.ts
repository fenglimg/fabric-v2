import { afterEach, describe, expect, it, vi } from "vitest";

import { syncCommand } from "../src/commands/sync.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("sync command flags", () => {
  it("rejects --continue and --abort together before resuming a session", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
      errors.push(value === undefined ? "" : String(value));
    });

    expect(() => {
      syncCommand.run?.({ args: { continue: true, abort: true } } as never);
    }).not.toThrow();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--continue and --abort cannot be used together");
  });
});

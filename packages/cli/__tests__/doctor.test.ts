import { afterEach, describe, expect, it, vi } from "vitest";

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
});

describe("doctor command", () => {
  it("sets a non-zero exit code when strict audit mode finds violations", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      runDoctorReport: vi.fn().mockResolvedValue({
        status: "warn",
        checks: [
          {
            name: "Intent ledger",
            status: "ok",
            message: "Last ledger entry is 1m old (1 total entry).",
          },
        ],
        summary: {
          target: "/tmp/fabric-target",
          framework: {
            kind: "vite",
            version: "^7.0.0",
            subkind: "vite-application",
          },
          entryPoints: [],
          driftCount: 0,
          protectedPathCount: 0,
          protectedPathsIntact: true,
          lastLedgerEntryTs: null,
          lastLedgerEntryAgeMs: null,
          metaRevision: null,
          audit: null,
        },
        audit: null,
      }),
      runDoctorAuditReport: vi.fn().mockResolvedValue({
        mode: "strict",
        skipped: false,
        windowMs: 5 * 60 * 1000,
        checkedPathCount: 1,
        violationCount: 1,
        violations: [
          {
            editTs: Date.parse("2026-04-19T00:00:00.000Z"),
            entryId: "ledger:audit",
            intent: "touch src/app.ts",
            lastGetRulesTs: null,
            path: "src/app.ts",
          },
        ],
      }),
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const errors: string[] = [];

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stdout.write);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stderr.write);
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });

    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/fabric-target",
          audit: true,
          "window-minutes": "5",
        },
      } as never);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(stdout.some((line) => line.includes("fab doctor"))).toBe(true);
    expect(stderr.some((line) => line.includes("src/app.ts"))).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cli\.doctor\.audit\.violations|fab_get_rules/);
    expect(process.exitCode).toBe(1);
  });
});

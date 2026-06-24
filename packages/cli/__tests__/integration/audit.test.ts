/**
 * Integration tests: the `fabric audit` group (W3-D).
 *
 * The telemetry/audit surfaces that used to ride on `fabric doctor --<flag>`
 * (cite / conflicts / history / descriptions / metrics / retired) moved into a
 * dedicated `fabric audit <sub>` group. cite has its own focused suite
 * (audit-cite.test.ts); this file covers history / conflicts / descriptions /
 * retired dispatch + argument validation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
});

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write);
  return { lines, restore: () => spy.mockRestore() };
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stderr.write);
  return { lines, restore: () => spy.mockRestore() };
}

function mockServer(overrides: Record<string, unknown>): void {
  vi.doMock("@fenglimg/fabric-server", () => ({
    runDoctorArchiveHistory: vi.fn(),
    runDoctorHistoryAll: vi.fn(),
    runDoctorConflictLint: vi.fn(),
    enrichDescriptions: vi.fn(),
    inspectRetiredReferences: vi.fn(),
    runDoctorCiteCoverage: vi.fn(),
    ...overrides,
  }));
}

describe("fabric audit (W3-D group)", () => {
  describe("audit history", () => {
    it("archive mode invokes runDoctorArchiveHistory with the default 7d window", async () => {
      const archiveSpy = vi.fn().mockResolvedValue({
        entries: [],
        total: 0,
        since_ms: 0,
        generated_at: new Date().toISOString(),
      });
      mockServer({ runDoctorArchiveHistory: archiveSpy });

      const { historyCommand } = await import("../../src/commands/audit.ts");
      const now = Date.now();
      const stdout = captureStdout();
      try {
        await historyCommand.run?.({
          args: { mode: "archive", target: "/tmp/itg-audit", since: "7d", json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(archiveSpy).toHaveBeenCalledTimes(1);
      const [, opts] = archiveSpy.mock.calls[0] as [string, { since: number }];
      expect(Math.abs(opts.since - (now - 7 * 86_400_000))).toBeLessThan(5_000);
    });

    it("defaults to all mode → runDoctorHistoryAll (no positional mode)", async () => {
      const historyAllSpy = vi.fn().mockResolvedValue({ rows: [] });
      mockServer({ runDoctorHistoryAll: historyAllSpy });

      const { historyCommand } = await import("../../src/commands/audit.ts");
      const stdout = captureStdout();
      try {
        await historyCommand.run?.({
          args: { target: "/tmp/itg-audit", since: "14d", json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(historyAllSpy).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid mode with exit 1", async () => {
      const archiveSpy = vi.fn();
      const historyAllSpy = vi.fn();
      mockServer({ runDoctorArchiveHistory: archiveSpy, runDoctorHistoryAll: historyAllSpy });

      const { historyCommand } = await import("../../src/commands/audit.ts");
      const stderr = captureStderr();
      try {
        await historyCommand.run?.({
          args: { mode: "bogus", target: "/tmp/itg-audit", json: false },
        } as never);
      } finally {
        stderr.restore();
      }

      expect(archiveSpy).not.toHaveBeenCalled();
      expect(historyAllSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("rejects a bogus --since with exit 1", async () => {
      const historyAllSpy = vi.fn();
      mockServer({ runDoctorHistoryAll: historyAllSpy });

      const { historyCommand } = await import("../../src/commands/audit.ts");
      const stderr = captureStderr();
      try {
        await historyCommand.run?.({
          args: { mode: "all", target: "/tmp/itg-audit", since: "not-a-window", json: false },
        } as never);
      } finally {
        stderr.restore();
      }

      expect(historyAllSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.lines.join("\n")).toContain("not-a-window");
    });
  });

  describe("audit conflicts", () => {
    it("invokes runDoctorConflictLint and passes --deep through", async () => {
      const conflictSpy = vi.fn().mockResolvedValue({
        candidate_count: 0,
        conflict_count: 0,
        threshold: 0.8,
        deep: false,
        pairs: [],
      });
      mockServer({ runDoctorConflictLint: conflictSpy });

      const { conflictsCommand } = await import("../../src/commands/audit.ts");
      const stdout = captureStdout();
      try {
        await conflictsCommand.run?.({
          args: { target: "/tmp/itg-audit", deep: true, json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(conflictSpy).toHaveBeenCalledTimes(1);
      expect(conflictSpy.mock.calls[0][1]).toEqual({ deep: true });
    });
  });

  describe("audit descriptions", () => {
    it("invokes enrichDescriptions with auto + dry-run flags", async () => {
      const enrichSpy = vi.fn().mockResolvedValue({
        mode: "auto",
        dryRun: true,
        scanned: 0,
        modified: 0,
        skipped: 0,
        candidates: [],
      });
      mockServer({ enrichDescriptions: enrichSpy });

      const { descriptionsCommand } = await import("../../src/commands/audit.ts");
      const stdout = captureStdout();
      try {
        await descriptionsCommand.run?.({
          args: { target: "/tmp/itg-audit", auto: true, "dry-run": true, json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(enrichSpy).toHaveBeenCalledTimes(1);
      expect(enrichSpy.mock.calls[0][1]).toEqual({ auto: true, dryRun: true });
    });
  });

  describe("audit retired", () => {
    it("renders hits and exits 1 when the scan finds retired references", async () => {
      const inspectSpy = vi.fn().mockResolvedValue({
        status: "warn",
        scannedFiles: 3,
        hits: [{ path: "x.md", token: "fab_plan_context", line: 5, replacement: "fab_recall" }],
      });
      mockServer({ inspectRetiredReferences: inspectSpy });

      const { retiredCommand } = await import("../../src/commands/audit.ts");
      const stdout = captureStdout();
      try {
        await retiredCommand.run?.({
          args: { target: "/tmp/itg-audit", json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(inspectSpy).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
      const blob = stdout.lines.join("\n");
      expect(blob).toContain("fab_plan_context");
      expect(blob).toContain("fab_recall");
    });

    it("exits 0 with a clean message when there are no retired references", async () => {
      const inspectSpy = vi.fn().mockResolvedValue({ status: "ok", scannedFiles: 4, hits: [] });
      mockServer({ inspectRetiredReferences: inspectSpy });

      const { retiredCommand } = await import("../../src/commands/audit.ts");
      const stdout = captureStdout();
      try {
        await retiredCommand.run?.({
          args: { target: "/tmp/itg-audit", json: false },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(process.exitCode).toBe(originalExitCode);
      expect(stdout.lines.join("\n")).toContain("no retired references");
    });
  });
});

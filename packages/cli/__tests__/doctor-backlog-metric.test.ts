/**
 * G4 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * fabric doctor emits a `backlog: N high-value, oldest Xd` metric line.
 *
 * Purpose: silent-default nudge_mode (G1/G2) mutes the Stop hook's human
 * breadcrumb. To keep backlog visibility (C-008: observable input) the doctor
 * output surfaces the same number via a NEUTRAL METRIC line — no color, no
 * severity/lint, no exit-code effect. Data source is the SAME shared SST
 * (isHighValueArchiveCandidate, G3) so hook backlog and doctor backlog agree
 * byte-for-byte.
 *
 * Line grammar (verbatim):
 *   `  backlog: N high-value, oldest Xd`
 *   where N = high-value session count, X = oldest candidate's days-since-now
 *   floor(). Two-space indent to align with store-health rows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
});

// Stub matching the real `renderBacklogAgeLine` semantics from
// packages/server/src/services/doctor-health.ts. Real function is trivial
// (count === 0 → "  backlog: 0 high-value"; else "  backlog: N high-value,
// oldest Xd") — we mirror it here so the CLI mock stays byte-parity with the
// production render path without importing the real one (which would defeat
// the vi.doMock isolation).
const renderBacklogAgeLineStub = (m: {
  count: number;
  oldest_days: number | null;
}): string => {
  if (m.count === 0) return "  backlog: 0 high-value";
  return `  backlog: ${m.count} high-value, oldest ${m.oldest_days}d`;
};

function baseServerMock(overrides: Record<string, unknown> = {}) {
  return {
    checkLockOrThrow: vi.fn(),
    runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
    runDoctorFix: vi.fn(),
    runDoctorApplyLint: vi.fn(),
    renderBacklogAgeLine: renderBacklogAgeLineStub,
    ...overrides,
  };
}

describe("G4 doctor backlog-age metric", () => {
  it("stdout contains the backlog metric line 'backlog: N high-value, oldest Xd'", async () => {
    const checkBacklogAgeSpy = vi.fn().mockResolvedValue({
      count: 2,
      oldest_days: 3,
      median_age_days: 2,
      ages_days: [1, 3],
    });

    vi.doMock("@fenglimg/fabric-server", () =>
      baseServerMock({ checkBacklogAge: checkBacklogAgeSpy }),
    );

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();

    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/fabric-target",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const out = stdout.lines.join("\n");
    expect(out).toMatch(/backlog:\s+2\s+high-value,\s+oldest\s+3d/);
    // NOT wired into store-diagnostics / lint list — pure metric.
    expect(out).not.toMatch(/backlog.*chalk|backlog.*severity/);
    // exit code unchanged (0 in the baseline "ok" report).
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("count=0 → 'backlog: 0 high-value' with no oldest suffix", async () => {
    const checkBacklogAgeSpy = vi.fn().mockResolvedValue({
      count: 0,
      oldest_days: null,
      median_age_days: 0,
      ages_days: [],
    });

    vi.doMock("@fenglimg/fabric-server", () =>
      baseServerMock({ checkBacklogAge: checkBacklogAgeSpy }),
    );

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();

    try {
      await doctorCommand.run?.({
        args: { target: "/tmp/fabric-target", json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
    }

    const out = stdout.lines.join("\n");
    expect(out).toContain("backlog: 0 high-value");
    // no "oldest" suffix when count=0 (per convergence.criteria)
    expect(out).not.toMatch(/backlog:\s+0.*oldest/);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("does not change doctor exit code when backlog count is high", async () => {
    // 99 stale backlog sessions must still exit 0 (no other lint fails).
    const checkBacklogAgeSpy = vi.fn().mockResolvedValue({
      count: 99,
      oldest_days: 90,
      median_age_days: 30,
      ages_days: Array.from({ length: 99 }, (_, i) => i + 1),
    });

    vi.doMock("@fenglimg/fabric-server", () =>
      baseServerMock({ checkBacklogAge: checkBacklogAgeSpy }),
    );

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target: "/tmp/fabric-target", json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
    }

    // Should still be the baseline exit (undefined/0 for ok report), NOT elevated.
    expect(process.exitCode).toBe(originalExitCode);
    expect(stdout.lines.join("\n")).toContain("backlog: 99 high-value, oldest 90d");
  });

  it("gracefully degrades when checkBacklogAge throws (never-throw contract)", async () => {
    const checkBacklogAgeSpy = vi
      .fn()
      .mockRejectedValue(new Error("events.jsonl unreadable"));

    vi.doMock("@fenglimg/fabric-server", () =>
      baseServerMock({ checkBacklogAge: checkBacklogAgeSpy }),
    );

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target: "/tmp/fabric-target", json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
    }

    // Doctor still exits normally; backlog line simply omitted.
    expect(process.exitCode).toBe(originalExitCode);
  });
});

// -------------------------------- helpers ------------------------------------

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write);
  return { lines, restore: () => spy.mockRestore() };
}

function createReport(status: "ok" | "warn" | "error") {
  return {
    status,
    checks: [{ name: "Agents metadata", status, message: status === "ok" ? "aligned" : "not aligned" }],
    fixable_errors: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    manual_errors: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    warnings: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    infos: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    summary: {
      target: "/tmp/fabric-target",
      framework: { kind: "vite", version: "^7.0.0", subkind: "vite-application" },
      entryPoints: [],
      metaRevision: "sha256:old",
      computedMetaRevision: "sha256:new",
      ruleCount: 1,
      eventLedgerPath: "/tmp/fabric-target/.fabric/events.jsonl",
    },
  };
}

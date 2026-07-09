/**
 * G5 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * doctor appends a `{ts, kind:'backlog', count, median_age_days}` line to
 * `.fabric/metrics.jsonl` on every invocation.
 *
 * Purpose: 4-week rollback baseline (C-011). A median_age_days that ramps
 * more than 1.5× baseline is the signal that silent-default backlog is
 * accumulating stale work and should be reverted (or that FABRIC_NUDGE_MODE
 * should be flipped back to visible).
 *
 * Contract:
 *   - Never-throw: an append failure MUST NOT change doctor's exit semantics.
 *   - Append-only jsonl: one JSON record per line (writer terminates each
 *     record with a newline).
 *   - Record shape frozen: `{ts:ISO8601, kind:'backlog', count:number,
 *     median_age_days:number}`. New fields may be added; existing fields MUST
 *     stay backward-compatible for 4-week analyses to remain comparable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalExitCode = process.exitCode;
const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTargetRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-doctor-metrics-"));
  tempRoots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  return root;
}

describe("G5 doctor metrics.jsonl append", () => {
  it("appends ONE {ts, kind:'backlog', count, median_age_days} record per doctor run", async () => {
    const target = makeTargetRoot();

    // Stub checkBacklogAge / renderBacklogAgeLine on the server export. checkBacklogAge
    // is the READ side — the WRITE side (appendMetric) lives in the SAME service so we
    // do not stub it; the real doctor-health module handles the append via its own
    // internal helper. The RED marker is: metrics.jsonl file does NOT exist yet after
    // a doctor run (because doctor currently never writes it).
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(minimalReport(target)),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      checkBacklogAge: vi.fn().mockResolvedValue({
        count: 2,
        oldest_days: 3,
        median_age_days: 2,
        ages_days: [1, 3],
      }),
      renderBacklogAgeLine: (m: { count: number; oldest_days: number | null }) =>
        m.count === 0 ? "  backlog: 0 high-value" : `  backlog: ${m.count} high-value, oldest ${m.oldest_days}d`,
      // G5: append helper delegated back into the real doctor-health service via
      // this mocked stub — the test asserts the CALLER wrote to metrics.jsonl,
      // NOT the internals. So we let it use the REAL fs.appendFileSync via the
      // CLI's own path (the CLI drives the append; no separate mock function).
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target, json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
    }

    const metricsPath = join(target, ".fabric", "metrics.jsonl");
    expect(existsSync(metricsPath)).toBe(true);
    const lines = readFileSync(metricsPath, "utf8").trim().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({
      kind: "backlog",
      count: 2,
      median_age_days: 2,
    });
    expect(typeof record.ts).toBe("string");
    // ISO 8601 shape: `YYYY-MM-DDTHH:MM:SS.sssZ`
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("two runs → two lines (append-only, no truncate)", async () => {
    const target = makeTargetRoot();
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(minimalReport(target)),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      checkBacklogAge: vi.fn().mockResolvedValue({
        count: 1,
        oldest_days: 5,
        median_age_days: 5,
        ages_days: [5],
      }),
      renderBacklogAgeLine: (m: { count: number; oldest_days: number | null }) =>
        m.count === 0 ? "  backlog: 0 high-value" : `  backlog: ${m.count} high-value, oldest ${m.oldest_days}d`,
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target, json: false, strict: false, fix: false },
      } as never);
      await doctorCommand.run?.({
        args: { target, json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
    }

    const metricsPath = join(target, ".fabric", "metrics.jsonl");
    const lines = readFileSync(metricsPath, "utf8").trim().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("write failure does NOT change doctor exit code (never-throw)", async () => {
    // Point target at a directory whose .fabric/ we make un-writable so the
    // append fails. Doctor MUST still complete normally.
    const target = makeTargetRoot();
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(minimalReport(target)),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      checkBacklogAge: vi.fn().mockResolvedValue({
        count: 0,
        oldest_days: null,
        median_age_days: 0,
        ages_days: [],
      }),
      renderBacklogAgeLine: () => "  backlog: 0 high-value",
    }));

    // Chmod the fabric dir readonly. On some CIs this is a no-op — the test
    // primarily locks the INTENT: even when count=0 the append still happens
    // AND any thrown error is swallowed.
    const { chmodSync } = await import("node:fs");
    try {
      chmodSync(join(target, ".fabric"), 0o500);
    } catch {
      // ignore; not all filesystems honor chmod
    }

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target, json: false, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
      try {
        chmodSync(join(target, ".fabric"), 0o755);
      } catch {
        // ignore
      }
    }

    expect(process.exitCode).toBe(originalExitCode);
  });
});

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write);
  return { lines, restore: () => spy.mockRestore() };
}

function minimalReport(target: string) {
  return {
    status: "ok",
    checks: [{ name: "Agents metadata", status: "ok", message: "aligned" }],
    fixable_errors: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    manual_errors: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    warnings: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    infos: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    summary: {
      target,
      framework: { kind: "vite", version: "^7.0.0", subkind: "vite-application" },
      entryPoints: [],
      metaRevision: "sha256:old",
      computedMetaRevision: "sha256:new",
      ruleCount: 1,
      eventLedgerPath: `${target}/.fabric/events.jsonl`,
    },
  };
}

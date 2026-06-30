/**
 * Integration tests: doctor command exit codes
 * Covers: I1 (exit-code contract), T2 (i18n section headers)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";

const t = createTranslator(detectNodeLocale());

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

function makeReport(status: "ok" | "warn" | "error") {
  return {
    status,
    checks: [
      { name: "Agents metadata", status, message: status === "ok" ? "ok" : "problem" },
    ],
    fixable_errors: status === "error" ? [{ code: "agents_meta_stale", name: "Agents metadata", message: "stale" }] : [],
    manual_errors: [],
    warnings: status === "warn" ? [{ code: "knowledge_drift_detected", name: "Knowledge drift", message: "warn msg" }] : [],
    summary: {
      target: "/tmp/itg-doctor",
      framework: { kind: "vite", version: "1", subkind: "app" },
      entryPoints: [],
      metaRevision: "sha:a",
      computedMetaRevision: "sha:b",
      ruleCount: 0,
      eventLedgerPath: "/tmp/itg-doctor/.fabric/events.jsonl",
      fixableErrorCount: status === "error" ? 1 : 0,
      manualErrorCount: 0,
      warningCount: status === "warn" ? 1 : 0,
      targetFiles: {},
    },
  };
}

// I1 — exitCode=0 when all checks ok
describe("I1: doctor exit codes", () => {
  it("exits 0 when all checks are ok", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("ok")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: false, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 when status=error", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("error")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: false, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    expect(process.exitCode).toBe(1);
  });

  it("exits 0 when status=warn and strict=false", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("warn")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: false, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    // strict=false, status=warn → should NOT set exitCode to 1
    expect(process.exitCode).toBeUndefined();
  });

  // I1 §strict: warn also exits 1 under --strict
  it("exits 1 when status=warn and strict=true", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("warn")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: true, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    expect(process.exitCode).toBe(1);
  });
});

// T2 — i18n section headers come from t() not hardcoded strings. flat-design
// (doctor reskin): the default surface is the actionable digest, so the i18n
// header to assert is the `To fix (N)` digest group title — the retired
// `doctor.section.fixable`/`warnings` sub-section titles no longer render. The
// actionable issue is still surfaced by name under that group.
describe("T2: doctor digest header i18n", () => {
  it("renders the digest todo header (i18n) for a fixable error", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("error")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: false, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("doctor.digest.todo", { count: "1" }));
    expect(blob).toContain("Agents metadata"); // fixable issue surfaced by name
  });

  it("renders the digest todo header (i18n) for a warning", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(makeReport("warn")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({ args: { target: "/tmp/itg-doctor", json: false, strict: false, fix: false } } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("doctor.digest.todo", { count: "1" }));
    expect(blob).toContain("Knowledge drift"); // warning surfaced by name
  });
});

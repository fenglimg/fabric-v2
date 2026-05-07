import { afterEach, describe, expect, it, vi } from "vitest";

import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";

const t = createTranslator(detectNodeLocale());

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
});

describe("doctor command", () => {
  it("prints JSON reports and exits non-zero on errors", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(createReport("error")),
      runDoctorFix: vi.fn(),
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();

    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/fabric-target",
          json: true,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    expect(JSON.parse(stdout.lines.join("\n")).status).toBe("error");
    expect(process.exitCode).toBe(1);
  });

  it("treats warnings as failures in strict mode", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(createReport("warn")),
      runDoctorFix: vi.fn(),
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();

    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/fabric-target",
          json: false,
          strict: true,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    expect(stdout.lines.some((line) => line.includes(t("doctor.section.warnings")))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("runs doctor --fix and prints deterministic fix summary", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn().mockResolvedValue({
        changed: true,
        fixed: [{ code: "agents_meta_stale", name: "Agents metadata", message: "stale" }],
        remaining_manual_errors: [],
        warnings: [],
        message: "Applied 1 deterministic doctor fix. No manual errors remain.",
        report: createReport("ok"),
      }),
    }));

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();

    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/fabric-target",
          fix: true,
          json: false,
          strict: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    expect(stdout.lines.some((line) => line.includes("Applied 1 deterministic doctor fix"))).toBe(true);
    expect(process.exitCode).toBe(originalExitCode);
  });
});

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write);

  return {
    lines,
    restore: () => spy.mockRestore(),
  };
}

function createReport(status: "ok" | "warn" | "error") {
  return {
    status,
    checks: [
      {
        name: "Agents metadata",
        status,
        message: status === "ok" ? "aligned" : "not aligned",
      },
    ],
    fixable_errors: status === "error" ? [{ code: "agents_meta_stale", name: "Agents metadata", message: "not aligned" }] : [],
    manual_errors: [],
    warnings: status === "warn" ? [{ code: "derived_identity", name: "Rule identity", message: "derived identity" }] : [],
    summary: {
      target: "/tmp/fabric-target",
      framework: { kind: "vite", version: "^7.0.0", subkind: "vite-application" },
      entryPoints: [],
      metaRevision: "sha256:old",
      computedMetaRevision: "sha256:new",
      ruleCount: 1,
      eventLedgerPath: "/tmp/fabric-target/.fabric/events.jsonl",
      fixableErrorCount: status === "error" ? 1 : 0,
      manualErrorCount: 0,
      warningCount: status === "warn" ? 1 : 0,
      targetFiles: {},
    },
  };
}

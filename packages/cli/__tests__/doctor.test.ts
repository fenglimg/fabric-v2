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
      runDoctorApplyLint: vi.fn(),
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
      runDoctorApplyLint: vi.fn(),
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
      runDoctorApplyLint: vi.fn(),
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

  // rc.4 TASK-003: --apply-lint flag plumbing.
  describe("--apply-lint flag", () => {
    it("default invocation does NOT call runDoctorApplyLint (apply-lint flag absent)", async () => {
      const applyLintSpy = vi.fn();
      const reportSpy = vi.fn().mockResolvedValue(createReport("ok"));
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: reportSpy,
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: applyLintSpy,
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "apply-lint": false,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(applyLintSpy).not.toHaveBeenCalled();
      expect(reportSpy).toHaveBeenCalledTimes(1);
    });

    it("--apply-lint flag invokes runDoctorApplyLint and prints mutation summary", async () => {
      const applyLintReport = {
        changed: true,
        mutations: [
          {
            kind: "knowledge_orphan_demote_required" as const,
            path: ".fabric/knowledge/decisions/KT-DEC-1101--ancient.md",
            detail: "stable -> endorsed",
            applied: true,
          },
        ],
        manual_errors: [],
        aborted: false,
        message: "Applied 1 apply-lint mutation. No manual errors remain.",
        report: createReport("ok"),
      };
      const applyLintSpy = vi.fn().mockResolvedValue(applyLintReport);
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: applyLintSpy,
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "apply-lint": true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(applyLintSpy).toHaveBeenCalledTimes(1);
      expect(applyLintSpy).toHaveBeenCalledWith("/tmp/fabric-target");
      expect(stdout.lines.some((line) => line.includes("Applied 1 apply-lint mutation"))).toBe(true);
      expect(stdout.lines.some((line) => line.includes("knowledge_orphan_demote_required"))).toBe(true);
      expect(stdout.lines.some((line) => line.includes("stable -> endorsed"))).toBe(true);
      expect(process.exitCode).toBe(originalExitCode);
    });

    it("--apply-lint with manual_error blocker (aborted=true) sets exit code 1 and writes abort_reason to stderr", async () => {
      const applyLintReport = {
        changed: false,
        mutations: [],
        manual_errors: [
          {
            code: "knowledge_stable_id_duplicate",
            name: "Knowledge stable_id duplicate",
            message: "duplicate detected",
          },
        ],
        aborted: true,
        abort_reason:
          "Manual repair required for knowledge_stable_id_duplicate: duplicate detected - apply-lint cannot resolve this safely; triage by hand.",
        message: "apply-lint aborted: knowledge_stable_id_duplicate requires manual repair.",
        report: createReport("error"),
      };
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: vi.fn().mockResolvedValue(applyLintReport),
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();
      const stderrLines: string[] = [];
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(((chunk: string | Uint8Array) => {
          stderrLines.push(String(chunk).replace(/\n$/, ""));
          return true;
        }) as typeof process.stderr.write);

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "apply-lint": true,
          },
        } as never);
      } finally {
        stdout.restore();
        stderrSpy.mockRestore();
      }

      expect(stderrLines.some((line) => line.includes("Manual repair required"))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it("--apply-lint combined with --fix errors out and does NOT invoke either repair function", async () => {
      const applyLintSpy = vi.fn();
      const fixSpy = vi.fn();
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: fixSpy,
        runDoctorApplyLint: applyLintSpy,
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();
      const stderrLines: string[] = [];
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(((chunk: string | Uint8Array) => {
          stderrLines.push(String(chunk).replace(/\n$/, ""));
          return true;
        }) as typeof process.stderr.write);

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: true,
            json: false,
            strict: false,
            "apply-lint": true,
          },
        } as never);
      } finally {
        stdout.restore();
        stderrSpy.mockRestore();
      }

      expect(applyLintSpy).not.toHaveBeenCalled();
      expect(fixSpy).not.toHaveBeenCalled();
      expect(
        stderrLines.some((line) => line.toLowerCase().includes("apply-lint")),
      ).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it("--apply-lint with failing mutation (applied=false) sets exit code 1", async () => {
      const applyLintReport = {
        changed: false,
        mutations: [
          {
            kind: "knowledge_stale_archive_required" as const,
            path: ".fabric/knowledge/decisions/KT-DEC-1110--stale.md",
            detail: ".fabric/.archive/decisions/KT-DEC-1110--stale.md",
            applied: false,
            error: "EACCES: permission denied",
          },
        ],
        manual_errors: [],
        aborted: false,
        message: "Applied 0 apply-lint mutations. 1 mutation failed. No manual errors remain.",
        report: createReport("ok"),
      };
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: vi.fn().mockResolvedValue(applyLintReport),
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "apply-lint": true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(process.exitCode).toBe(1);
      expect(stdout.lines.some((line) => line.includes("EACCES"))).toBe(true);
    });
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

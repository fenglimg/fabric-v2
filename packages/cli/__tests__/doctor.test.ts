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

  it("surfaces multi-store health diagnostics (S10) in the JSON report", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    // Isolated FABRIC_HOME with no global config → no_global_config diagnostic.
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = mkdtempSync(join(tmpdir(), "fabric-doctor-store-"));
    const prevHome = process.env.FABRIC_HOME;
    process.env.FABRIC_HOME = home;

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target: "/tmp/fabric-target", json: true, strict: false, fix: false },
      } as never);
    } finally {
      stdout.restore();
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }

    const parsed = JSON.parse(stdout.lines.join("\n"));
    expect(Array.isArray(parsed.store_diagnostics)).toBe(true);
    expect(parsed.store_diagnostics.map((d: { code: string }) => d.code)).toContain(
      "no_global_config",
    );
  });

  it("renders store diagnostic error, warn, and info severities distinctly", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));
    vi.doMock("../src/store/doctor-checks.js", () => ({
      storeDoctorChecks: vi.fn(() => [
        { code: "missing_required_store", severity: "error", ref: "team", message: "required store is missing" },
        { code: "no_global_config", severity: "warn", message: "global config is missing" },
        { code: "local_only_store", severity: "info", ref: "personal", message: "store is local-only" },
      ]),
    }));

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
    expect(out).toContain("[error] [team] required store is missing");
    expect(out).toContain("[warn] global config is missing");
    expect(out).toContain("[info] [personal] store is local-only");
  });

  it("--debug-bundle emits a redacted bundle (S40, no plaintext secrets)", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
    }));

    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = mkdtempSync(join(tmpdir(), "fabric-doctor-bundle-"));
    const prevHome = process.env.FABRIC_HOME;
    process.env.FABRIC_HOME = home;
    // Global config carrying a secret-shaped remote — must be redacted.
    mkdirSync(join(home, ".fabric"), { recursive: true });
    writeFileSync(
      join(home, ".fabric", "fabric-global.json"),
      JSON.stringify({ uid: "u", stores: [{ store_uuid: "b0000000-0000-4000-8000-000000000000", alias: "team", remote: "https://AKIA1234567890ABCDEF@h/r.git" }] }),
      "utf8",
    );

    const { doctorCommand } = await import("../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: { target: "/tmp/fabric-target", json: false, strict: false, fix: false, "debug-bundle": true },
      } as never);
    } finally {
      stdout.restore();
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }

    const out = stdout.lines.join("\n");
    expect(out).not.toContain("AKIA1234567890ABCDEF");
    expect(out).toContain("[REDACTED:");
    const parsed = JSON.parse(out);
    expect(parsed.redacted).toBe(true);
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

  // rc.4 TASK-003 (rc.15 rename): --fix-knowledge flag plumbing.
  describe("--fix-knowledge flag", () => {
    it("default invocation does NOT call runDoctorApplyLint (fix-knowledge flag absent)", async () => {
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
            "fix-knowledge": false,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(applyLintSpy).not.toHaveBeenCalled();
      expect(reportSpy).toHaveBeenCalledTimes(1);
    });

    it("--fix-knowledge flag invokes runDoctorApplyLint and prints mutation summary", async () => {
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
      // rc.7 T11: doctor now runs a preflight runDoctorReport call to derive
      // the fix-knowledge mutation plan for the safety confirm. With an "ok"
      // report (no apply-lint findings), plan.totalCount === 0 and the
      // confirm is skipped — mutations proceed straight through.
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
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
            "fix-knowledge": true,
            yes: true,
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

    // W1-11 (F8): --fix-knowledge --dry-run must NOT mutate. The mutating
    // service (runDoctorApplyLint = runDoctorFixKnowledge) is the only thing
    // that writes frontmatter / runs git mv, so "no mutation" ⟺ that spy is
    // never called. A read-only runDoctorReport runs instead (preview).
    it("--fix-knowledge --dry-run does NOT invoke runDoctorApplyLint (no frontmatter write / git mv)", async () => {
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
            "fix-knowledge": true,
            "dry-run": true,
            yes: true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      // The mutating arm is never reached under --dry-run...
      expect(applyLintSpy).not.toHaveBeenCalled();
      // ...and a read-only report is produced instead.
      expect(reportSpy).toHaveBeenCalled();
    });

    it("--fix-knowledge with manual_error blocker (aborted=true) sets exit code 1 and writes abort_reason to stderr", async () => {
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
        runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
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
            "fix-knowledge": true,
            yes: true,
          },
        } as never);
      } finally {
        stdout.restore();
        stderrSpy.mockRestore();
      }

      expect(stderrLines.some((line) => line.includes("Manual repair required"))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it("--fix-knowledge combined with --fix errors out and does NOT invoke either repair function", async () => {
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
            "fix-knowledge": true,
          },
        } as never);
      } finally {
        stdout.restore();
        stderrSpy.mockRestore();
      }

      expect(applyLintSpy).not.toHaveBeenCalled();
      expect(fixSpy).not.toHaveBeenCalled();
      expect(
        stderrLines.some((line) => line.toLowerCase().includes("fix-knowledge")),
      ).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it("--fix-knowledge with failing mutation (applied=false) sets exit code 1", async () => {
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
        runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
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
            "fix-knowledge": true,
            yes: true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(process.exitCode).toBe(1);
      expect(stdout.lines.some((line) => line.includes("EACCES"))).toBe(true);
    });

    // -----------------------------------------------------------------------
    // rc.7 T11: --apply-lint safety prompt
    // -----------------------------------------------------------------------

    it("--fix-knowledge with --yes skips the confirm even when mutations are pending", async () => {
      // Pre-flight report carries an apply-lint finding (orphan_demote warning)
      // so plan.totalCount > 0 and the prompt would normally appear. --yes
      // must bypass it.
      const preReport = createReport("ok");
      preReport.warnings.push({
        code: "knowledge_orphan_demote_required",
        name: "Orphan demote",
        message: "demote candidate",
        path: ".fabric/knowledge/decisions/KT-DEC-2001--orphan.md",
      });
      const applyReport = {
        changed: true,
        mutations: [{
          kind: "knowledge_orphan_demote_required" as const,
          path: ".fabric/knowledge/decisions/KT-DEC-2001--orphan.md",
          detail: "stable -> endorsed",
          applied: true,
        }],
        manual_errors: [],
        aborted: false,
        message: "Applied 1 apply-lint mutation.",
        report: createReport("ok"),
      };
      const applyLintSpy = vi.fn().mockResolvedValue(applyReport);
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(preReport),
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
            "fix-knowledge": true,
            yes: true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(applyLintSpy).toHaveBeenCalledTimes(1);
      expect(stdout.lines.some((line) => line.includes("fix-knowledge mutation plan"))).toBe(true);
    });

    it("--fix-knowledge with FABRIC_NONINTERACTIVE=1 (no --yes) skips the confirm", async () => {
      const preReport = createReport("ok");
      preReport.warnings.push({
        code: "knowledge_orphan_demote_required",
        name: "Orphan demote",
        message: "demote candidate",
        path: "x.md",
      });
      const applyReport = {
        changed: true,
        mutations: [],
        manual_errors: [],
        aborted: false,
        message: "ok",
        report: createReport("ok"),
      };
      const applyLintSpy = vi.fn().mockResolvedValue(applyReport);
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(preReport),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: applyLintSpy,
      }));

      const originalEnv = process.env.FABRIC_NONINTERACTIVE;
      process.env.FABRIC_NONINTERACTIVE = "1";
      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();
      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "fix-knowledge": true,
          },
        } as never);
      } finally {
        stdout.restore();
        if (originalEnv === undefined) {
          delete process.env.FABRIC_NONINTERACTIVE;
        } else {
          process.env.FABRIC_NONINTERACTIVE = originalEnv;
        }
      }

      expect(applyLintSpy).toHaveBeenCalledTimes(1);
    });

    it("--fix-knowledge without --yes and non-tty stdin exits 1 without mutating", async () => {
      const preReport = createReport("ok");
      preReport.warnings.push({
        code: "knowledge_orphan_demote_required",
        name: "Orphan demote",
        message: "demote candidate",
        path: "x.md",
      });
      const applyLintSpy = vi.fn();
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(preReport),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: applyLintSpy,
      }));

      // Force non-tty.
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
      // Ensure env bypass is not set for this test.
      const originalEnv = process.env.FABRIC_NONINTERACTIVE;
      delete process.env.FABRIC_NONINTERACTIVE;

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
            "fix-knowledge": true,
          },
        } as never);
      } finally {
        stdout.restore();
        stderrSpy.mockRestore();
        Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
        if (originalEnv !== undefined) {
          process.env.FABRIC_NONINTERACTIVE = originalEnv;
        }
      }

      expect(applyLintSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderrLines.some((line) => line.toLowerCase().includes("not a tty"))).toBe(true);
    });

    it("--fix-knowledge with NO pending mutations skips the confirm and runs the mutation arm", async () => {
      // plan.totalCount === 0 → confirm is bypassed; runDoctorApplyLint is
      // still called so the no-op message is rendered.
      const preReport = createReport("ok");
      const applyReport = {
        changed: false,
        mutations: [],
        manual_errors: [],
        aborted: false,
        message: "No apply-lint mutations were needed.",
        report: createReport("ok"),
      };
      const applyLintSpy = vi.fn().mockResolvedValue(applyReport);
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(preReport),
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
            "fix-knowledge": true,
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(applyLintSpy).toHaveBeenCalledTimes(1);
      // No plan banner because totalCount was 0.
      expect(stdout.lines.some((line) => line.includes("fix-knowledge mutation plan"))).toBe(false);
    });
  });

  // rc.23 TASK-012 (F8a): the legacy --rescan flag and its runInitScan dispatch
  // were removed clean-slate. The describe block previously covering --rescan
  // call-order assertions has been deleted along with the scan.ts module.

  // v2.0.0-rc.25 TASK-10: --archive-history flag dispatch + --since parsing.
  describe("--archive-history flag", () => {
    it("invokes runDoctorArchiveHistory with default --since=7d window", async () => {
      const archiveSpy = vi.fn().mockResolvedValue({
        entries: [],
        total: 0,
        since_ms: Date.now() - 7 * 86_400_000,
        generated_at: new Date().toISOString(),
      });
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: vi.fn(),
        runDoctorCiteCoverage: vi.fn(),
        runDoctorArchiveHistory: archiveSpy,
        enrichDescriptions: vi.fn(),
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();
      const now = Date.now();
      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "archive-history": true,
            since: "7d",
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(archiveSpy).toHaveBeenCalledTimes(1);
      const [resolvedTarget, opts] = archiveSpy.mock.calls[0] as [string, { since: number }];
      expect(typeof resolvedTarget).toBe("string");
      // Default 7d window: since should be approximately now - 7*86400000.
      // Allow a 5-second slack for the inner Date.now() vs ours.
      const expected = now - 7 * 86_400_000;
      expect(Math.abs(opts.since - expected)).toBeLessThan(5_000);
    });

    it("parses --since=14d to 14 * 86_400_000 ms", async () => {
      const archiveSpy = vi.fn().mockResolvedValue({
        entries: [],
        total: 0,
        since_ms: 0,
        generated_at: new Date().toISOString(),
      });
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn(),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: vi.fn(),
        runDoctorCiteCoverage: vi.fn(),
        runDoctorArchiveHistory: archiveSpy,
        enrichDescriptions: vi.fn(),
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stdout = captureStdout();
      const now = Date.now();
      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            fix: false,
            json: false,
            strict: false,
            "archive-history": true,
            since: "14d",
          },
        } as never);
      } finally {
        stdout.restore();
      }

      expect(archiveSpy).toHaveBeenCalledTimes(1);
      const [, opts] = archiveSpy.mock.calls[0] as [string, { since: number }];
      const expected = now - 14 * 86_400_000;
      // Same 5-second slack window — `parseSinceDuration` calls `Date.now()`
      // internally so the floor moves slightly between the test and the
      // command. 5s is generous; CI flakes have never crossed that bound.
      expect(Math.abs(opts.since - expected)).toBeLessThan(5_000);
    });
  });

  // v2.0.0-rc.29 TASK-007 (BUG-M2): --since is now validated up-front before
  // any dispatch arm checks. Previously bare `fabric doctor --since=bogus`
  // (without --cite-coverage / --archive-history) silently dropped the value
  // and exited 0; now it fails fast with exit 1 and the standard
  // cli.doctor.errors.invalid-since stderr line.
  describe("--since up-front validation (rc.29 BUG-M2)", () => {
    it("rejects bogus --since on a bare `fabric doctor` invocation (no --cite-coverage / --archive-history)", async () => {
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: vi.fn().mockResolvedValue(createReport("ok")),
        runDoctorFix: vi.fn(),
        runDoctorApplyLint: vi.fn(),
      }));

      const { doctorCommand } = await import("../src/commands/doctor.ts");
      const stderr = captureStderr();

      try {
        await doctorCommand.run?.({
          args: {
            target: "/tmp/fabric-target",
            json: false,
            strict: false,
            fix: false,
            since: "bogus-format",
          },
        } as never);
      } finally {
        stderr.restore();
      }

      expect(process.exitCode).toBe(1);
      expect(stderr.lines.join("\n")).toContain("bogus-format");
    });

    it("accepts a valid --since on a bare `fabric doctor` invocation and still runs the standard check pipeline", async () => {
      const reportSpy = vi.fn().mockResolvedValue(createReport("ok"));
      vi.doMock("@fenglimg/fabric-server", () => ({
        checkLockOrThrow: vi.fn(),
        runDoctorReport: reportSpy,
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
            strict: false,
            fix: false,
            since: "7d",
          },
        } as never);
      } finally {
        stdout.restore();
      }

      // No fail-fast → bare doctor pipeline executed.
      expect(reportSpy).toHaveBeenCalledTimes(1);
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

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stderr.write);

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
    fixable_errors: status === "error" ? [{ code: "agents_meta_stale", name: "Agents metadata", message: "not aligned" }] : [] as Array<{ code: string; name: string; message: string; path?: string }>,
    manual_errors: [] as Array<{ code: string; name: string; message: string; path?: string }>,
    warnings: (status === "warn" ? [{ code: "derived_identity", name: "Rule identity", message: "derived identity" }] : []) as Array<{ code: string; name: string; message: string; path?: string }>,
    infos: [] as Array<{ code: string; name: string; message: string; path?: string }>,
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

/**
 * Integration tests: doctor --cite-coverage --layer flag + contract renderer
 * v2.0.0-rc.24 TASK-10
 *
 * Covers:
 *   - --layer flag accepted values (team / personal / all) + invalid rejection
 *   - Layer value pass-through to runDoctorCiteCoverage
 *   - Contract section renderer: ok / awaiting_marker / skipped:bootstrap_drift
 *   - Per-layer × type cross-tab using singular knowledge_type keys
 *   - Layer suffix (team — review / personal — fyi) on hard_violated line
 *   - Skip bucket histogram with i18n labels + raw-key fallback for unknown reasons
 *   - cite_id_unresolved emitted as a ⚠ tail line
 *   - Bilingual mode honors locale config (zh-CN vs en)
 */

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

type ContractStatus = "ok" | "skipped:bootstrap_drift" | "awaiting_marker";

// Build a minimal CiteCoverageReport — shape mirrors the server-side type and
// the shared Zod schema. We default zeroed counters and let each test override
// the slice it cares about.
function makeCiteReport(
  overrides: {
    status?: ContractStatus;
    layer_filter?: "team" | "personal" | "all";
    decisions_cited?: number;
    pitfalls_cited?: number;
    contract_with?: number;
    contract_missing?: number;
    hard_violated?: number;
    cite_id_unresolved?: number;
    skip_count?: Record<string, number>;
    per_layer_type?: {
      team: Record<string, number>;
      personal: Record<string, number>;
    };
  } = {},
) {
  return {
    status: "ok" as const,
    marker_ts: Date.parse("2025-01-01T00:00:00.000Z"),
    marker_emitted_now: false,
    since_ts: Date.parse("2025-01-01T00:00:00.000Z"),
    client_filter: "all" as const,
    layer_filter: overrides.layer_filter ?? ("all" as const),
    metrics: {
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    },
    contract_metrics_status: (overrides.status ?? "ok") as ContractStatus,
    contract_metrics: {
      decisions_cited: overrides.decisions_cited ?? 0,
      pitfalls_cited: overrides.pitfalls_cited ?? 0,
      contract_with: overrides.contract_with ?? 0,
      contract_missing: overrides.contract_missing ?? 0,
      hard_violated: overrides.hard_violated ?? 0,
      cite_id_unresolved: overrides.cite_id_unresolved ?? 0,
      skip_count: overrides.skip_count ?? {},
    },
    per_layer_type: overrides.per_layer_type ?? {
      team: {},
      personal: {},
    },
    contract_marker_ts: Date.parse("2025-01-01T00:00:00.000Z"),
    generated_at: new Date("2025-06-01T00:00:00.000Z").toISOString(),
  };
}

describe("doctor --cite-coverage --layer (rc.24 TASK-10)", () => {
  it("(1) --layer=team passes through to runDoctorCiteCoverage", async () => {
    const citeSpy = vi.fn().mockResolvedValue(makeCiteReport({ layer_filter: "team" }));
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: citeSpy,
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "team",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    expect(citeSpy).toHaveBeenCalledTimes(1);
    const callArg = citeSpy.mock.calls[0][1];
    expect(callArg.layer).toBe("team");
    expect(callArg.client).toBe("all");
  });

  it("(2) --layer=invalid rejects with error", async () => {
    const citeSpy = vi.fn();
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: citeSpy,
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "both", // rc.20 plan-context vocabulary — rejected by cite-coverage
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
      stderr.restore();
    }

    expect(citeSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr.lines.some((line) => line.includes("--layer"))).toBe(true);
    expect(stderr.lines.some((line) => line.includes("both"))).toBe(true);
  });

  it("(3) renderer emits contract section header when contract_metrics_status='ok' with non-zero counts", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          decisions_cited: 3,
          contract_with: 2,
          contract_missing: 1,
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.header"));
    expect(blob).toContain(t("cite-coverage.contract.decisions_cited"));
    expect(blob).toContain(t("cite-coverage.contract.with"));
  });

  it("(4) renderer emits skipped message when status='skipped:bootstrap_drift'", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({ status: "skipped:bootstrap_drift" }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.header"));
    expect(blob).toContain(t("cite-coverage.contract.status.skipped_bootstrap_drift"));
  });

  it("(5) renderer applies [team — review] suffix when layer_filter='all' or 'team' and hard_violated>0", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          layer_filter: "team",
          decisions_cited: 2,
          contract_with: 1,
          hard_violated: 2,
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "team",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.hard_violated"));
    expect(blob).toContain(t("cite-coverage.layer.team_review"));
    // Personal suffix MUST NOT appear when layer=team
    expect(blob).not.toContain(t("cite-coverage.layer.personal_fyi"));
  });

  it("(6) renderer applies [personal — fyi] suffix when layer_filter='personal'", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          layer_filter: "personal",
          decisions_cited: 1,
          hard_violated: 1,
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "personal",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.layer.personal_fyi"));
  });

  it("(7) renderer emits skip_count histogram with translated i18n labels (and raw-key fallback for unknown buckets)", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          decisions_cited: 4,
          skip_count: {
            sequencing: 2,
            architectural: 1,
            // Unknown / operator-extensible bucket — should pass through as raw key.
            "experimental-feature-flag": 1,
          },
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.skip_count"));
    expect(blob).toContain(t("cite-coverage.skip.sequencing"));
    expect(blob).toContain(t("cite-coverage.skip.architectural"));
    // Unknown bucket falls back to the raw key (translator returns key itself).
    expect(blob).toContain("experimental-feature-flag");
  });

  it("(8) renderer suppresses entire contract section when status='awaiting_marker' AND all counts zero", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({ status: "awaiting_marker" }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    // rc.20 section MUST still render.
    expect(blob).toContain(t("doctor.section.cite-coverage"));
    // Contract block MUST NOT render (zero counts + awaiting_marker).
    expect(blob).not.toContain(t("cite-coverage.contract.header"));
  });

  it("(9) renderer emits per-layer × type cross-tab using singular knowledge_type keys", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          decisions_cited: 3,
          per_layer_type: {
            team: { decision: 2, pitfall: 1 },
            personal: { decision: 1 },
          },
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.type.decision"));
    expect(blob).toContain(t("cite-coverage.contract.type.pitfall"));
    expect(blob).toContain(t("cite-coverage.layer.team"));
    expect(blob).toContain(t("cite-coverage.layer.personal"));
  });

  it("(10) renderer emits cite_id_unresolved as a separate ⚠ tail line", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      checkLockOrThrow: vi.fn(),
      runDoctorReport: vi.fn(),
      runDoctorFix: vi.fn(),
      runDoctorApplyLint: vi.fn(),
      runDoctorCiteCoverage: vi.fn().mockResolvedValue(
        makeCiteReport({
          status: "ok",
          decisions_cited: 1,
          cite_id_unresolved: 3,
        }),
      ),
      enrichDescriptions: vi.fn(),
      appendEventLedgerEvent: vi.fn(),
    }));

    const { doctorCommand } = await import("../../src/commands/doctor.ts");
    const stdout = captureStdout();
    try {
      await doctorCommand.run?.({
        args: {
          target: "/tmp/itg-cite",
          "cite-coverage": true,
          since: "7d",
          client: "all",
          layer: "all",
          json: false,
          strict: false,
          fix: false,
        },
      } as never);
    } finally {
      stdout.restore();
    }

    const blob = stdout.lines.join("\n");
    expect(blob).toContain(t("cite-coverage.contract.cite_id_unresolved"));
    // The line must include the count `3`.
    const unresolvedLine = stdout.lines.find((l) =>
      l.includes(t("cite-coverage.contract.cite_id_unresolved")),
    );
    expect(unresolvedLine).toBeDefined();
    expect(unresolvedLine).toContain("3");
  });

  it("(11) bilingual mode honors locale config — contract.header text differs between zh-CN and en", async () => {
    // Verify directly via the translator that zh-CN and en yield different
    // strings for the contract header (the i18n keys themselves are stable).
    // The actual render path is already exercised above; this case pins the
    // locale-config bilingual contract documented in TASK-09.
    const { createTranslator: ct } = await import("@fenglimg/fabric-shared");
    const tZh = ct("zh-CN" as never);
    const tEn = ct("en" as never);
    expect(tZh("cite-coverage.contract.header")).toBe("应用契约校验");
    expect(tEn("cite-coverage.contract.header")).toBe("Contract check");
    // Skip bucket labels also differ across locales.
    expect(tZh("cite-coverage.skip.sequencing")).toBe("顺序约束");
    expect(tEn("cite-coverage.skip.sequencing")).toBe("sequencing constraint");
    // Layer suffix differs (the team review tag uses bracketed format in both
    // locales but the inner text differs).
    expect(tZh("cite-coverage.layer.team_review")).toContain("需复核");
    expect(tEn("cite-coverage.layer.team_review")).toContain("review");
  });
});

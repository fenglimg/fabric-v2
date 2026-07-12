// Doctor apply-lint orchestration (W8 Step C).
// Injected deps avoid ESM cycle with runDoctorReport in doctor.ts.
import { inspectStoreCounters, fixStoreCounters } from "./doctor-store-counters.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import {
  applySessionHintsStaleCleanup,
  inspectSessionHintsStale,
} from "./doctor-session-hints-stale.js";
import type { DoctorIssue, DoctorReport } from "./doctor.js";

// ISS-20260711-183: only kinds with live apply-lint arms after store cutover.
export type DoctorApplyLintMutationKind =
  | "knowledge_session_hints_stale_cleanup"
  | "store_counter_floor";

export type DoctorApplyLintMutation = {
  kind: DoctorApplyLintMutationKind;
  path: string;
  detail: string;
  applied: boolean;
  error?: string;
};

export type DoctorApplyLintReport = {
  changed: boolean;
  mutations: DoctorApplyLintMutation[];
  warnings: DoctorIssue[];
  manual_errors: DoctorIssue[];
  aborted: boolean;
  abort_reason?: string;
  message: string;
  report: DoctorReport;
};

const MANUAL_LINT_ERROR_CODES = new Set(["knowledge_layer_mismatch"]);

export type ApplyLintDeps = {
  normalizeTarget: (target: string) => string;
  runDoctorReport: (projectRoot: string) => Promise<DoctorReport>;
  appendDoctorWarnings: (report: DoctorReport, extra: DoctorIssue[]) => DoctorReport;
  createLedgerAppendWarning: (action: string, error: unknown) => DoctorIssue;
  contextCacheInvalidate: (kind: string, projectRoot: string) => void;
};

function createApplyLintMessage(
  succeeded: number,
  failed: number,
  manualErrorCount: number,
): string {
  const parts: string[] = [];
  if (succeeded === 0 && failed === 0) {
    parts.push("No apply-lint mutations were needed.");
  } else {
    parts.push(`Applied ${succeeded} apply-lint mutation${succeeded === 1 ? "" : "s"}.`);
    if (failed > 0) {
      parts.push(`${failed} mutation${failed === 1 ? "" : "s"} failed.`);
    }
  }
  parts.push(
    manualErrorCount === 0
      ? "No manual errors remain."
      : `${manualErrorCount} manual error${manualErrorCount === 1 ? "" : "s"} remain.`,
  );
  return parts.join(" ");
}

export async function runDoctorApplyLintWithDeps(
  target: string,
  deps: ApplyLintDeps,
): Promise<DoctorApplyLintReport> {
  const projectRoot = deps.normalizeTarget(target);
  const before = await deps.runDoctorReport(projectRoot);
  const mutations: DoctorApplyLintMutation[] = [];
  const ledgerWarnings: DoctorIssue[] = [];

  const blockingManual = before.manual_errors.find((issue) =>
    MANUAL_LINT_ERROR_CODES.has(issue.code),
  );
  if (blockingManual !== undefined) {
    return {
      changed: false,
      mutations: [],
      warnings: [],
      manual_errors: before.manual_errors,
      aborted: true,
      abort_reason: `Manual repair required for ${blockingManual.code}: ${blockingManual.message}. apply-lint will not auto-mutate it — open the entry via fabric-review (or fix layer/path by hand), then re-run doctor.`,
      message: `apply-lint aborted: ${blockingManual.code} requires manual repair.`,
      report: before,
    };
  }

  const now = Date.now();

  const sessionHintsStale = await inspectSessionHintsStale(projectRoot, now);
  for (const candidate of sessionHintsStale.candidates) {
    mutations.push(await applySessionHintsStaleCleanup(projectRoot, candidate));
  }

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "relevance_migration_run",
      timestamp: new Date(now).toISOString(),
      scanned_count: 0,
      touched_count: 0,
    });
  } catch (error) {
    ledgerWarnings.push(deps.createLedgerAppendWarning("relevance migration aggregate event", error));
  }

  const storeCounterDrifts = inspectStoreCounters(projectRoot);
  if (storeCounterDrifts.length > 0) {
    const reconciled = fixStoreCounters(projectRoot);
    const detail = storeCounterDrifts
      .map((d) => `${d.store_alias}:${d.layer}.${d.type} ${d.current} -> ${d.disk_max}`)
      .join("; ");
    mutations.push({
      kind: "store_counter_floor",
      path: "stores/*/counters.json",
      detail: detail || "(no store counters processed)",
      applied: reconciled.length > 0,
    });
  }

  deps.contextCacheInvalidate("meta_write", projectRoot);

  const after = deps.appendDoctorWarnings(await deps.runDoctorReport(projectRoot), ledgerWarnings);
  const successCount = mutations.filter((m) => m.applied).length;
  const failureCount = mutations.length - successCount;

  return {
    changed: successCount > 0,
    mutations,
    warnings: after.warnings,
    manual_errors: after.manual_errors,
    aborted: false,
    message: createApplyLintMessage(successCount, failureCount, after.manual_errors.length),
    report: after,
  };
}

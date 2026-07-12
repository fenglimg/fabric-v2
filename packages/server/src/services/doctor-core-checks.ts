/**
 * Core create*Check factories previously inlined in doctor.ts (W7).
 * Inspection result types used by runDoctorReport collect phase are exported
 * for doctor.ts inspect helpers. Builders table lives in doctor-check-registry.ts.
 */
import type { AgentsMeta, ForensicReport, OnboardSlot, Translator } from "@fenglimg/fabric-shared";
import { ONBOARD_SLOT_NAMES, ONBOARD_SLOT_TOTAL } from "@fenglimg/fabric-shared";
import type { DoctorCheck, MetaInspection } from "./doctor-types.js";
import { issueCheck, okCheck } from "./doctor-check-helpers.js";
import type { EventsJsonlGatesReport } from "./events-jsonl-gates.js";

/** Result shape of inspectForensic (kept local to avoid coupling to doctor.ts). */
export type ForensicInspection = {
  present: boolean;
  valid: boolean;
  report: ForensicReport | null;
  error?: string;
};

export type EventLedgerInspection = {
  exists: boolean;
  writable: boolean;
  parseable: boolean;
  hasPartialWrite: boolean;
  partialWriteByteOffset: number;
  partialWriteByteLength: number;
  schemaVersionUnsupportedCount: number;
  eventTypeUnknownCount: number;
  schemaVersionSamples: string[];
  eventTypeSamples: string[];
  path: string;
  error?: string;
};

export type DraftBacklogInspection = {
  status: "ok" | "warn";
  draftCount: number;
  totalCount: number;
  ratio: number;
};

export type CiteGoodhartInspection = {
  status: "ok" | "warn";
  fired: Array<{ pattern: "G1" | "G2" | "G5"; detail: string }>;
};

export type PreexistingRootFilesInspection = {
  detected: string[];
};

export type UnderseededInspection = {
  node_count: number;
  threshold: number;
  underseeded: boolean;
};

export type SessionHintsStaleCandidate = {
  path: string;
  age_days: number;
};

export type SessionHintsStaleInspection = {
  candidates: SessionHintsStaleCandidate[];
};

export type StaleServeLockInspection =
  | { present: false }
  | {
      present: true;
      pid: number;
      acquiredAt: number;
      ageMs: number;
      pidAlive: boolean;
    };

export type EmptyTagsInspection = {
  status: "ok" | "warn";
  emptyCount: number;
  totalCount: number;
  ratio: number;
};

export type DriftUnconsumedInspection = {
  status: "ok" | "warn";
  driftCount: number;
  demoteCount: number;
};

export type PromoteLedgerInvariantInspection = {
  proposedCount: number;
  promoteStartedCount: number;
  promotedCount: number;
  violation: "proposed-lt-started" | "started-lt-promoted" | null;
};

export type OnboardCoverageInspection = {
  filled: Record<OnboardSlot, string[]>;
  missing: OnboardSlot[];
  opted_out: string[];
};

export function emptyDraftBacklogInspection(): DraftBacklogInspection {
  return { status: "ok", draftCount: 0, totalCount: 0, ratio: 0 };
}

export const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;
export const SESSION_HINTS_STALE_DAYS = 7;
export const SESSION_HINTS_FILE_PREFIX = "session-hints-";
export const SESSION_HINTS_FILE_SUFFIX = ".json";
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const EMPTY_META_INSPECTION: MetaInspection = {
  present: true,
  valid: true,
  meta: { revision: "", nodes: {} } as unknown as AgentsMeta,
  revision: "",
  computedRevision: null,
  ruleCount: 0,
  missingContentRefs: [],
  invalidContentRefs: [],
  stale: false,
  changed: false,
};

export function createForensicCheck(
  t: Translator,
  forensic: ForensicInspection,
  frameworkKind: string,
  entryPointCount: number,
): DoctorCheck {
  if (!forensic.present) {
    return issueCheck(
      t("doctor.check.forensic.name"),
      "error",
      "manual_error",
      "forensic_missing",
      t(`doctor.check.forensic.message.missing.${entryPointCount === 1 ? "singular" : "plural"}`, {
        error: forensic.error ?? t("doctor.check.forensic.message.missing-default"),
        frameworkKind,
        count: String(entryPointCount),
      }),
      t("doctor.check.forensic.remediation"),
    );
  }
  if (!forensic.valid) {
    return issueCheck(
      t("doctor.check.forensic.name"),
      "error",
      "manual_error",
      "forensic_invalid",
      forensic.error ?? t("doctor.check.forensic.message.invalid-default"),
      t("doctor.check.forensic.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.forensic.name"),
    t("doctor.check.forensic.ok", { frameworkKind: forensic.report?.framework.kind ?? "unknown" }),
  );
}

// see comment at the call site in `runDoctorReport`.

// and its derived knowledge-test index. Knowledge lives in stores now.

// v2.0.0-rc.37 Wave B (B5): composite hard-gate check for events.jsonl /
// metrics.jsonl health. Surfaces G7 (size) / G8 (metric leak) /
// G9 (metrics staleness) / G10 (rotation overdue) as a single
// warning-severity finding. G11 is a code-time invariant verified by
// services/events-jsonl-gates.test.ts.
export function createEventsJsonlHealthCheck(
  t: Translator,
  report: EventsJsonlGatesReport,
): DoctorCheck {
  const findings: string[] = [];
  if (report.ledgerSizeWarn) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.size", {
        sizeMb: (report.ledgerSizeBytes / (1024 * 1024)).toFixed(1),
      }),
    );
  }
  if (report.metricLeakCount > 0) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.metric_leak", {
        count: String(report.metricLeakCount),
        samples: report.metricLeakSamples.join(", "),
      }),
    );
  }
  if (report.metricsStaleWarn && report.metricsStalenessMs !== null) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.metrics_stale", {
        minutes: String(Math.floor(report.metricsStalenessMs / 60_000)),
      }),
    );
  }
  if (report.rotationOverdueWarn && report.ledgerStalenessMs !== null) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.rotation_overdue", {
        days: String(Math.floor(report.ledgerStalenessMs / 86_400_000)),
      }),
    );
  }
  if (findings.length === 0) {
    return okCheck(
      t("doctor.check.events_jsonl_health.name"),
      t("doctor.check.events_jsonl_health.ok"),
    );
  }
  return issueCheck(
    t("doctor.check.events_jsonl_health.name"),
    "warn",
    "warning",
    "events_jsonl_health_degraded",
    findings.join(" | "),
    t("doctor.check.events_jsonl_health.remediation"),
  );
}

export function createEventLedgerCheck(t: Translator, ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "fixable_error",
      "event_ledger_missing",
      t("doctor.check.event_ledger.message.missing"),
      t("doctor.check.event_ledger.remediation.missing"),
    );
  }
  if (!ledger.writable) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "manual_error",
      "event_ledger_not_writable",
      ledger.error ?? t("doctor.check.event_ledger.message.not_writable-default"),
      t("doctor.check.event_ledger.remediation.not_writable"),
    );
  }
  if (!ledger.parseable) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "manual_error",
      "event_ledger_invalid",
      ledger.error ?? t("doctor.check.event_ledger.message.invalid-default"),
      t("doctor.check.event_ledger.remediation.invalid"),
    );
  }
  return okCheck(t("doctor.check.event_ledger.name"), t("doctor.check.event_ledger.ok"));
}

// v2.0.0-rc.27 TASK-010 (audit §2.24): surfaces forward-compat warnings when
// events.jsonl contains rows the current parser cannot validate (legacy
// schema_version != 1 OR an event_type not in the discriminator set). Both
// states usually mean the operator needs to pick between two recoveries:
//   1) archive + recreate events.jsonl (when stale rc.0/rc.1 rows linger), or
//   2) upgrade the CLI (when a newer server emitted a token this CLI does not
//      yet recognise).
// `warning` severity, not `error` — readEventLedger already silently drops
// these rows so the workspace continues to function; the check exists to
// stop the audit blind-spot, not to block progress.
export function createEventLedgerSchemaCompatCheck(
  t: Translator,
  ledger: EventLedgerInspection,
): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck(
      t("doctor.check.event_ledger_schema_compat.name"),
      t("doctor.check.event_ledger_schema_compat.ok.skipped"),
    );
  }
  const hasUnsupportedVersion = ledger.schemaVersionUnsupportedCount > 0;
  const hasUnknownEventType = ledger.eventTypeUnknownCount > 0;
  if (!hasUnsupportedVersion && !hasUnknownEventType) {
    return okCheck(
      t("doctor.check.event_ledger_schema_compat.name"),
      t("doctor.check.event_ledger_schema_compat.ok.clean"),
    );
  }
  const parts: string[] = [];
  if (hasUnsupportedVersion) {
    parts.push(
      t("doctor.check.event_ledger_schema_compat.message.schema_version", {
        count: String(ledger.schemaVersionUnsupportedCount),
        samples: ledger.schemaVersionSamples.join(", "),
      }),
    );
  }
  if (hasUnknownEventType) {
    parts.push(
      t("doctor.check.event_ledger_schema_compat.message.event_type", {
        count: String(ledger.eventTypeUnknownCount),
        samples: ledger.eventTypeSamples.join(", "),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.event_ledger_schema_compat.name"),
    "warn",
    "warning",
    "event_ledger_schema_compat",
    parts.join(" "),
    t("doctor.check.event_ledger_schema_compat.remediation"),
  );
}

// v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog check. Single ratio + count
// message — operator does not need a per-entry breakdown to act on the signal
// (the action is "run fabric-review to promote drafts" regardless of which
// entries are involved).
export function createDraftBacklogCheck(
  t: Translator,
  inspection: DraftBacklogInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.draft_backlog.name"),
      t("doctor.check.draft_backlog.ok"),
    );
  }
  const pct = Math.round(inspection.ratio * 100);
  return issueCheck(
    t("doctor.check.draft_backlog.name"),
    "warn",
    "warning",
    "knowledge_draft_backlog",
    t("doctor.check.draft_backlog.message", {
      draftCount: String(inspection.draftCount),
      totalCount: String(inspection.totalCount),
      pct: String(pct),
    }),
    t("doctor.check.draft_backlog.remediation"),
  );
}

export function createDriftUnconsumedCheck(
  t: Translator,
  inspection: DriftUnconsumedInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.drift_unconsumed.name"),
      t("doctor.check.drift_unconsumed.ok"),
    );
  }
  return issueCheck(
    t("doctor.check.drift_unconsumed.name"),
    "warn",
    "warning",
    "knowledge_drift_unconsumed",
    t("doctor.check.drift_unconsumed.message", {
      driftCount: String(inspection.driftCount),
      demoteCount: String(inspection.demoteCount),
    }),
    t("doctor.check.drift_unconsumed.remediation"),
  );
}

// rc.36 TASK-05 (P0-8): empty-tags warn check.
export function createKnowledgeTagsEmptyCheck(
  t: Translator,
  inspection: EmptyTagsInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.knowledge_tags_empty.name"),
      t("doctor.check.knowledge_tags_empty.ok"),
    );
  }
  const pct = Math.round(inspection.ratio * 100);
  return issueCheck(
    t("doctor.check.knowledge_tags_empty.name"),
    "warn",
    "warning",
    "knowledge_tags_empty_ratio",
    t("doctor.check.knowledge_tags_empty.message", {
      emptyCount: String(inspection.emptyCount),
      totalCount: String(inspection.totalCount),
      pct: String(pct),
    }),
    t("doctor.check.knowledge_tags_empty.remediation"),
  );
}

// v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart check. Aggregates fired
// patterns into a single multi-line message so the operator gets the full
// audit hit list in one report row. Always warning severity — Goodhart
// heuristics are advisory, not error-grade.
export function createCiteGoodhartCheck(
  t: Translator,
  inspection: CiteGoodhartInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.cite_goodhart.name"),
      t("doctor.check.cite_goodhart.ok"),
    );
  }
  const list = inspection.fired.map((f) => `${f.pattern}: ${f.detail}`).join("; ");
  const count = inspection.fired.length;
  return issueCheck(
    t("doctor.check.cite_goodhart.name"),
    "warn",
    "warning",
    "cite_goodhart_pattern",
    t(`doctor.check.cite_goodhart.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.cite_goodhart.remediation"),
    // rc.35 TASK-12 (P0-11): maintainer audience. G1/G2/G3/G5 are internal
    // pattern codes from the cite-policy design memo — npm end users have
    // no actionable lever for these. Fold by default; --verbose unfolds.
    "maintainer",
  );
}

export function createEventLedgerPartialWriteCheck(t: Translator, ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck(
      t("doctor.check.event_ledger_partial_write.name"),
      t("doctor.check.event_ledger_partial_write.ok.skipped"),
    );
  }
  if (ledger.hasPartialWrite) {
    return issueCheck(
      t("doctor.check.event_ledger_partial_write.name"),
      "error",
      "fixable_error",
      "event_ledger_partial_write",
      t("doctor.check.event_ledger_partial_write.message", {
        byteOffset: String(ledger.partialWriteByteOffset),
        byteLength: String(ledger.partialWriteByteLength),
      }),
      t("doctor.check.event_ledger_partial_write.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.event_ledger_partial_write.name"),
    t("doctor.check.event_ledger_partial_write.ok.clean"),
  );
}

export function createPromoteLedgerInvariantCheck(
  t: Translator,
  inspection: PromoteLedgerInvariantInspection,
): DoctorCheck {
  const params = {
    proposed: String(inspection.proposedCount),
    started: String(inspection.promoteStartedCount),
    promoted: String(inspection.promotedCount),
  };
  if (inspection.violation === null) {
    return okCheck(
      t("doctor.check.promote_ledger_invariant.name"),
      t("doctor.check.promote_ledger_invariant.ok", params),
    );
  }
  return issueCheck(
    t("doctor.check.promote_ledger_invariant.name"),
    "warn",
    "warning",
    "promote_ledger_invariant_violated",
    t(`doctor.check.promote_ledger_invariant.message.${inspection.violation}`, params),
    t("doctor.check.promote_ledger_invariant.remediation"),
  );
}

export function createPreexistingRootFilesCheck(t: Translator, inspection: PreexistingRootFilesInspection): DoctorCheck {
  if (inspection.detected.length === 0) {
    return okCheck(t("doctor.check.preexisting_root_files.name"), t("doctor.check.preexisting_root_files.ok"));
  }
  return {
    name: t("doctor.check.preexisting_root_files.name"),
    status: "ok",
    kind: "info",
    code: "preexisting_root_claude_md",
    fixable: false,
    message: t("doctor.check.preexisting_root_files.message", { files: inspection.detected.join(", ") }),
    actionHint: t("doctor.check.preexisting_root_files.remediation"),
  };
}

// rc.5 TASK-010: surface the underseeded lint (#22) as an `info` kind so it
// shows in the report without bumping doctor's status to warn/error — a small
// corpus is a legitimate state during early adoption, not a defect. The
// actionHint points the user at the fabric-import Skill, mirroring the
// fabric-hint hook's import-signal recommendation.
export function createUnderseededCheck(t: Translator, inspection: UnderseededInspection): DoctorCheck {
  if (!inspection.underseeded) {
    return okCheck(
      t("doctor.check.underseeded.name"),
      t("doctor.check.underseeded.ok", {
        count: String(inspection.node_count),
        threshold: String(inspection.threshold),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.underseeded.name"),
    "ok",
    "info",
    "knowledge_underseeded",
    t(`doctor.check.underseeded.message.${inspection.node_count === 1 ? "singular" : "plural"}`, {
      count: String(inspection.node_count),
      threshold: String(inspection.threshold),
    }),
    t("doctor.check.underseeded.remediation"),
  );
}

// rc.6 TASK-021 (E3): surface stale session-hints cache files as an info-
// kind finding. Status remains "ok" — the cache is hot-cache hygiene, not
// a correctness concern. The actionHint points at apply-lint so users can
// reap accumulated cache files in a single pass.
export function createSessionHintsStaleCheck(
  t: Translator,
  inspection: SessionHintsStaleInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.session_hints_stale.name"),
      t("doctor.check.session_hints_stale.ok", {
        days: String(SESSION_HINTS_STALE_DAYS),
      }),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.path} (${first.age_days}d old)`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.session_hints_stale.name"),
    "ok",
    "info",
    "knowledge_session_hints_stale",
    t(`doctor.check.session_hints_stale.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      days: String(SESSION_HINTS_STALE_DAYS),
      detail,
    }),
    t("doctor.check.session_hints_stale.remediation"),
  );
}

// rc.23 TASK-010 (e): surface a stale `.fabric/.serve.lock` (dead-PID corpse)
// as an info-kind advisory. Status stays "ok" — a stale lock is operator
// hygiene, not a doctor-fatal. `--fix` (runDoctorFix) unlinks the file and
// emits `serve_lock_cleared`. Skip cases: no lock file (steady state) and
// lock held by a live PID (a healthy `fabric serve` is running — never touch).
export function createStaleServeLockCheck(
  t: Translator,
  inspection: StaleServeLockInspection,
): DoctorCheck {
  if (!inspection.present) {
    return okCheck(
      t("doctor.check.stale_serve_lock.name"),
      t("doctor.check.stale_serve_lock.ok.no_lock"),
    );
  }
  if (inspection.pidAlive) {
    return okCheck(
      t("doctor.check.stale_serve_lock.name"),
      t("doctor.check.stale_serve_lock.ok.live_pid", {
        pid: String(inspection.pid),
      }),
    );
  }
  // Coarse "K time ago" — days when ≥1d, hours otherwise. Matches the prose
  // shape requested in the task spec; we floor-round so a 0-day reading
  // never confuses the operator about whether the lock is fresh.
  const days = Math.floor(inspection.ageMs / MS_PER_DAY);
  const hours = Math.floor(inspection.ageMs / (60 * 60 * 1000));
  const acquiredAgo =
    days >= 1
      ? t(`doctor.check.stale_serve_lock.age.day.${days === 1 ? "singular" : "plural"}`, {
          count: String(days),
        })
      : t(`doctor.check.stale_serve_lock.age.hour.${hours === 1 ? "singular" : "plural"}`, {
          count: String(hours),
        });
  return issueCheck(
    t("doctor.check.stale_serve_lock.name"),
    "ok",
    "info",
    "stale_serve_lock",
    t("doctor.check.stale_serve_lock.message.dead_pid", {
      pid: String(inspection.pid),
      acquiredAgo,
    }),
    t("doctor.check.stale_serve_lock.remediation.dead_pid"),
  );
}

export function createOnboardCoverageCheck(t: Translator, inspection: OnboardCoverageInspection): DoctorCheck {
  const filledCount = ONBOARD_SLOT_NAMES.filter(
    (slot) => inspection.filled[slot].length > 0,
  ).length;
  if (inspection.missing.length === 0) {
    return okCheck(
      t("doctor.check.onboard_coverage.name"),
      t("doctor.check.onboard_coverage.ok.complete", {
        filledCount: String(filledCount),
        total: String(ONBOARD_SLOT_TOTAL),
        optedOutCount: String(inspection.opted_out.length),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.onboard_coverage.name"),
    "ok",
    "info",
    "onboard_coverage_incomplete",
    t("doctor.check.onboard_coverage.message.incomplete", {
      missingSlots: inspection.missing.join(", "),
      filledCount: String(filledCount),
      total: String(ONBOARD_SLOT_TOTAL),
      optedOutCount: String(inspection.opted_out.length),
    }),
    t("doctor.check.onboard_coverage.remediation.incomplete"),
  );
}

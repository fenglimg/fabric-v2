// W8 extract: knowledge-facing create*Check builders from doctor.ts.
// Pure check assembly — inspect functions stay in sibling modules.
import type { Translator } from "@fenglimg/fabric-shared";

import type { BodyReadMisfireReport } from "./doctor-body-read-misfire.js";
import type { CiteGoodhartInspection } from "./doctor-cite-goodhart.js";
import type { DriftUnconsumedInspection } from "./doctor-drift-unconsumed.js";
import type { DraftBacklogInspection, EmptyTagsInspection } from "./doctor-knowledge-hygiene.js";
import type { SessionHintsStaleInspection } from "./doctor-session-hints-stale.js";
import { SESSION_HINTS_STALE_DAYS } from "./doctor-session-hints-stale.js";
import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "./doctor.js";

export type UnderseededInspection = {
  node_count: number;
  threshold: number;
  underseeded: boolean;
};

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
  audience?: "user" | "maintainer",
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
    audience,
  };
}

// v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog check.
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

// ISS-20260711-221: body_read misfire as a first-class doctor check.
export function createBodyReadMisfireCheck(
  _t: Translator,
  inspection: BodyReadMisfireReport,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck("Knowledge body-read wiring", inspection.message);
  }
  return issueCheck(
    "Knowledge body-read wiring",
    "warn",
    "warning",
    "knowledge_body_read_misfire",
    inspection.message,
    "Check PostToolUse matcher includes Read in .claude/settings.json (and Codex equivalent), then rerun `fabric install`.",
  );
}

// v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart check.
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
    // rc.35 TASK-12 (P0-11): maintainer audience.
    "maintainer",
  );
}

// rc.5 TASK-010: underseeded lint (#22) as info kind.
export function createUnderseededCheck(
  t: Translator,
  inspection: UnderseededInspection,
): DoctorCheck {
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

// rc.6 TASK-021 (E3): stale session-hints cache as info kind.
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

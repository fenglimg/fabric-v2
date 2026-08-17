import type { Translator } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "../cross-store-recall.js";
import { assessSummaryVoice } from "../summary-voice.js";
import type { DoctorCheck } from "../doctor-types.js";

export type SummaryVoiceEntry = {
  stable_id: string;
  path: string;
  detail: string;
};

export interface SummaryVoiceInspection {
  entries: SummaryVoiceEntry[];
  /** Mirrors COR-007: a failed corpus walk must not report a clean ok. */
  errored?: boolean;
  error_message?: string;
}

/**
 * Warn-only scan of store-backed canonical summaries for session-minute voice.
 * Never fixable_error — corpus hygiene signal only.
 *
 * Assesses `description.summary` (NOT the body): the summary is the only field
 * fab_recall puts on the wire, so it is where minute-shaped writing does damage.
 * This is the counterpart of inspectBodyAltitude, which owns the body.
 */
export async function inspectSummaryVoice(projectRoot: string): Promise<SummaryVoiceInspection> {
  const entries: SummaryVoiceEntry[] = [];
  try {
    const corpus = await collectStoreCanonicalEntries(projectRoot);
    for (const entry of corpus) {
      const summary = entry.description.summary ?? "";
      const assessment = assessSummaryVoice(summary);
      if (!assessment.ok) {
        entries.push({
          stable_id: entry.qualifiedId,
          path: entry.file || `store:${entry.qualifiedId}`,
          detail: assessment.detail,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { entries: [], errored: true, error_message: message };
  }
  entries.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { entries };
}

export function createSummaryVoiceCheck(
  t: Translator,
  inspection: SummaryVoiceInspection,
): DoctorCheck {
  if (inspection.errored) {
    return {
      name: t("doctor.check.knowledge_summary_session_voice.name"),
      status: "warn",
      kind: "warning",
      code: "knowledge_summary_voice_scan_error",
      fixable: false,
      message: t("doctor.check.knowledge_summary_session_voice.scan_error", {
        detail: inspection.error_message ?? "unknown",
      }),
      actionHint: t("doctor.check.knowledge_summary_session_voice.remediation"),
    };
  }
  if (inspection.entries.length === 0) {
    return {
      name: t("doctor.check.knowledge_summary_session_voice.name"),
      status: "ok",
      message: t("doctor.check.knowledge_summary_session_voice.ok"),
    };
  }
  const first = inspection.entries[0]!;
  const detail = `${first.stable_id} (${first.detail})`;
  const count = inspection.entries.length;
  return {
    name: t("doctor.check.knowledge_summary_session_voice.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_summary_session_voice",
    fixable: false,
    message: t(
      `doctor.check.knowledge_summary_session_voice.message.${count === 1 ? "singular" : "plural"}`,
      { count: String(count), detail },
    ),
    actionHint: t("doctor.check.knowledge_summary_session_voice.remediation"),
  };
}

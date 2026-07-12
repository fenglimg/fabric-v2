import type { Translator } from "@fenglimg/fabric-shared";

import { extractBody } from "./_shared.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import { assessBodyAltitude } from "./body-altitude.js";
import type { DoctorCheck } from "./doctor-types.js";

export type BodyAltitudeDumpEntry = {
  stable_id: string;
  path: string;
  code: string;
  detail: string;
};

export interface BodyAltitudeInspection {
  entries: BodyAltitudeDumpEntry[];
  /** COR-007: true when corpus walk failed — doctor must not report clean ok. */
  errored?: boolean;
  error_message?: string;
}

/**
 * Warn-only scan of store-backed canonical bodies for dump-shaped altitude.
 * Never fixable_error — corpus hygiene signal only (peer micro-transfer P0-2).
 *
 * Assesses the real markdown body (`entry.body`, frontmatter stripped), not the
 * short description proxy — dump markers live in body/session_context.
 *
 * PERF-001 residual: still walks store corpus via collectStoreCanonicalEntries;
 * doctor could later pass pre-materialized hygiene entries (API kept simple).
 */
export async function inspectBodyAltitude(projectRoot: string): Promise<BodyAltitudeInspection> {
  const entries: BodyAltitudeDumpEntry[] = [];
  try {
    const corpus = await collectStoreCanonicalEntries(projectRoot);
    for (const entry of corpus) {
      const summary = entry.description.summary ?? "";
      const bodyText = extractBody(entry.body).trim();
      const assessment = assessBodyAltitude(
        bodyText,
        summary,
        typeof entry.description.knowledge_type === "string"
          ? entry.description.knowledge_type
          : entry.type,
      );
      if (!assessment.ok) {
        entries.push({
          stable_id: entry.qualifiedId,
          path: entry.file || `store:${entry.qualifiedId}`,
          code: assessment.code,
          detail: assessment.detail,
        });
      }
    }
  } catch (err) {
    // COR-007: surface scan failure as warn, never fake clean ok.
    const message = err instanceof Error ? err.message : String(err);
    return { entries: [], errored: true, error_message: message };
  }
  entries.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { entries };
}

export function createBodyAltitudeDumpCheck(
  t: Translator,
  inspection: BodyAltitudeInspection,
): DoctorCheck {
  if (inspection.errored) {
    return {
      name: t("doctor.check.knowledge_body_altitude_dump.name"),
      status: "warn",
      kind: "warning",
      code: "knowledge_body_altitude_scan_error",
      fixable: false,
      message: t("doctor.check.knowledge_body_altitude_dump.scan_error", {
        detail: inspection.error_message ?? "unknown",
      }),
      actionHint: t("doctor.check.knowledge_body_altitude_dump.remediation"),
    };
  }
  if (inspection.entries.length === 0) {
    return {
      name: t("doctor.check.knowledge_body_altitude_dump.name"),
      status: "ok",
      message: t("doctor.check.knowledge_body_altitude_dump.ok"),
    };
  }
  const first = inspection.entries[0]!;
  const detail = `${first.stable_id} (${first.code}: ${first.detail})`;
  const count = inspection.entries.length;
  return {
    name: t("doctor.check.knowledge_body_altitude_dump.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_body_altitude_dump",
    fixable: false,
    message: t(
      `doctor.check.knowledge_body_altitude_dump.message.${count === 1 ? "singular" : "plural"}`,
      { count: String(count), detail },
    ),
    actionHint: t("doctor.check.knowledge_body_altitude_dump.remediation"),
  };
}

import type { Translator } from "@fenglimg/fabric-shared";

import type { StoreKnowledgeSummary } from "./cross-store-recall.js";
import type { DoctorCheck, MetaInspection } from "./doctor-types.js";

// rc.35 TASK-05 (P0-10.a): knowledge_summary_opaque inspection.
//
// Counts entries whose summary is just their id, which makes narrow hints
// semantically empty. Store summaries are folded in so team and personal
// read-set entries are covered after the store-only cutover.
const KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD = 0.30;

export type KnowledgeSummaryOpaqueInspection = {
  status: "skipped" | "ok" | "warn";
  totalWithDescription: number;
  opaqueCount: number;
  ratio: number;
  threshold: number;
  opaqueSample: string[];
};

export function inspectKnowledgeSummaryOpaque(
  meta: MetaInspection,
  storeSummaries: StoreKnowledgeSummary[] = [],
): KnowledgeSummaryOpaqueInspection {
  const baseline = {
    totalWithDescription: 0,
    opaqueCount: 0,
    ratio: 0,
    threshold: KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD,
    opaqueSample: [] as string[],
  };
  if (!meta.valid || meta.meta === null) {
    return { status: "skipped", ...baseline };
  }
  let total = 0;
  const opaqueIds: string[] = [];
  for (const node of Object.values(meta.meta.nodes)) {
    const description = node.description;
    const stableId = node.stable_id;
    if (!description || typeof stableId !== "string" || stableId.length === 0) {
      continue;
    }
    total += 1;
    const summary = (description.summary ?? "").trim();
    if (summary === stableId.trim()) {
      opaqueIds.push(stableId);
    }
  }
  for (const entry of storeSummaries) {
    total += 1;
    const summary = entry.summary.trim();
    const localId = entry.stableId.includes(":")
      ? entry.stableId.slice(entry.stableId.indexOf(":") + 1)
      : entry.stableId;
    if (summary.length === 0 || summary === entry.stableId.trim() || summary === localId.trim()) {
      opaqueIds.push(entry.stableId);
    }
  }
  if (total === 0) {
    return { status: "ok", ...baseline };
  }
  const ratio = opaqueIds.length / total;
  const status = ratio > KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD ? "warn" : "ok";
  return {
    status,
    totalWithDescription: total,
    opaqueCount: opaqueIds.length,
    ratio,
    threshold: KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD,
    opaqueSample: opaqueIds.slice(0, 5),
  };
}

export function createKnowledgeSummaryOpaqueCheck(
  t: Translator,
  inspection: KnowledgeSummaryOpaqueInspection,
): DoctorCheck {
  if (inspection.status === "skipped") {
    return {
      name: t("doctor.check.knowledge_summary_opaque.name"),
      status: "ok",
      message: t("doctor.check.knowledge_summary_opaque.ok.skipped"),
    };
  }
  if (inspection.status === "ok") {
    return {
      name: t("doctor.check.knowledge_summary_opaque.name"),
      status: "ok",
      message: t("doctor.check.knowledge_summary_opaque.ok", {
        opaque: String(inspection.opaqueCount),
        total: String(inspection.totalWithDescription),
      }),
    };
  }
  const pct = Math.round(inspection.ratio * 1000) / 10;
  return {
    name: t("doctor.check.knowledge_summary_opaque.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_summary_opaque",
    message: t("doctor.check.knowledge_summary_opaque.message.warn", {
      opaque: String(inspection.opaqueCount),
      total: String(inspection.totalWithDescription),
      pct: String(pct),
      threshold: String(Math.round(inspection.threshold * 100)),
      sample: inspection.opaqueSample.join(", "),
    }),
    actionHint: t("doctor.check.knowledge_summary_opaque.remediation"),
    fixable: false,
  };
}

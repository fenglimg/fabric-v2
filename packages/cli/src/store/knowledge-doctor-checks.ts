import {
  inspectConsumption,
  inspectRelatedGraph,
  precheckStoreReachability,
} from "@fenglimg/fabric-server";

import type { StoreDiagnostic } from "./doctor-checks.js";

// ---------------------------------------------------------------------------
// PR #33 re-wire: borrowed knowledge-health checks adapted to the REAL doctor
// registry. The originals were written against a non-existent `createXCheck`
// factory + `DoctorCheck` type; this project's doctor instead collects
// push-style `StoreDiagnostic[]` (see doctor-checks.ts → collectStoreDiagnostics
// in commands/doctor.ts). This module is the adapter: it calls the server-side
// pure inspections and emits diagnostics in the registry's shape, with inline
// English messages matching storeDoctorChecks's existing style.
//
// All three are READ-ONLY advisories surfaced under "Store Health" — never a
// gate (KT-DEC-0007) and with NO auto-fix arm (KT-PIT-0016): remediation copy
// points at manual action, never a `doctor --fix` mutation the lint won't run.
//
// Async (the inspections walk the read-set corpus / metrics ledger), so this is
// a sibling to the synchronous storeDoctorChecks; commands/doctor.ts merges both
// in collectStoreDiagnostics. Best-effort: each inspection is isolated so one
// failing branch never suppresses the others or changes doctor's exit code.
// ---------------------------------------------------------------------------

const SAMPLE_LIMIT = 5;
const HUB_LIMIT = 5;
const TOP_CONSUMED_LIMIT = 10;

export async function knowledgeDoctorChecks(projectRoot: string): Promise<StoreDiagnostic[]> {
  const diagnostics: StoreDiagnostic[] = [];

  await appendRelatedGraphDiagnostics(projectRoot, diagnostics);
  await appendStoreReachabilityDiagnostics(projectRoot, diagnostics);
  await appendConsumptionDiagnostics(projectRoot, diagnostics);

  return diagnostics;
}

// BORROW-007 — related broken links (warn) + hub ranking (info heatmap).
async function appendRelatedGraphDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  let inspection;
  try {
    inspection = await inspectRelatedGraph(projectRoot);
  } catch {
    return;
  }
  if (inspection.totalEntries === 0) {
    return;
  }

  if (inspection.brokenLinks.length > 0) {
    const samples = inspection.brokenLinks
      .slice(0, SAMPLE_LIMIT)
      .map((b) => `${b.source} → ${b.target}`)
      .join(", ");
    const overflow = inspection.brokenLinks.length - SAMPLE_LIMIT;
    out.push({
      code: "related_graph_broken_link",
      severity: "warn",
      message:
        `${inspection.brokenLinks.length} broken \`related\` link(s) point at ids absent from the corpus: ${samples}` +
        `${overflow > 0 ? `, …(+${overflow} more)` : ""}` +
        ` — fix the related edges via \`fab_review\` (modify) or edit the entry frontmatter`,
    });
  }

  if (inspection.hubEntries.length > 0) {
    const top = inspection.hubEntries
      .slice(0, HUB_LIMIT)
      .map((h) => `${h.stableId} (×${h.inDegree})`)
      .join(", ");
    out.push({
      code: "related_graph_hub",
      severity: "info",
      message: `related graph hubs (top ${Math.min(HUB_LIMIT, inspection.hubEntries.length)} of ${inspection.hubEntries.length} referenced): ${top}`,
    });
  }
}

// BORROW-019 — read-set store reachability (warn per unreachable store).
async function appendStoreReachabilityDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  let result;
  try {
    result = await precheckStoreReachability(projectRoot);
  } catch {
    return;
  }
  for (const store of result.stores) {
    if (store.reachable) continue;
    out.push({
      code: "store_unreachable",
      severity: "warn",
      ref: store.alias,
      message: `store '${store.alias}' is in the read-set but unreachable on disk (${store.reason ?? "unknown"}); run \`fabric store mount\` / re-clone it, then \`fabric doctor\``,
    });
  }
}

// BORROW-005 — consumption heatmap (info) + zero-consumed (warn, GATED).
async function appendConsumptionDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  let inspection;
  try {
    inspection = await inspectConsumption(projectRoot);
  } catch {
    return;
  }

  // Heatmap: always surfaced when there is any consumption data.
  if (inspection.topConsumed.length > 0) {
    const top = inspection.topConsumed
      .slice(0, TOP_CONSUMED_LIMIT)
      .map((e) => `${e.stableId} (${e.count}×)`)
      .join(", ");
    out.push({
      code: "knowledge_consumption_heatmap",
      severity: "info",
      message: `top consumed (last ${inspection.windowDays}d, ${inspection.consumedEntries}/${inspection.totalEntries} entries read across ${inspection.consumedWindows} window(s)): ${top}`,
    });
  }

  // Zero-consumed: only when the inspection deemed the data mature. The server
  // gate already empties zeroConsumed on immature data, so this branch is
  // naturally suppressed — but we guard on dataMature too for clarity.
  if (inspection.dataMature && inspection.zeroConsumed.length > 0) {
    const sample = inspection.zeroConsumed.slice(0, TOP_CONSUMED_LIMIT).join(", ");
    const overflow = inspection.zeroConsumed.length - TOP_CONSUMED_LIMIT;
    out.push({
      code: "knowledge_consumption_zero",
      severity: "warn",
      message:
        `${inspection.zeroConsumed.length} entries never consumed in the last ${inspection.windowDays}d: ${sample}` +
        `${overflow > 0 ? `, …(+${overflow} more)` : ""}` +
        ` — review for retirement via \`fab_review\` (consumption is one signal, not proof of rot)`,
    });
  }
}

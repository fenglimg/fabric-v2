import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  inspectConsumption,
  inspectRelatedGraph,
  precheckStoreReachability,
} from "@fenglimg/fabric-server";
import {
  STORE_LAYOUT,
  STORE_OVERRIDABLE_KNOBS,
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { getProjectTranslator } from "../i18n.js";
import { loadProjectConfig } from "./project-config-io.js";
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
  appendStoreKnobOverrideDiagnostics(projectRoot, diagnostics);

  return diagnostics;
}

// config-layering W3 (TASK-005) — grouped knob families in STORE_OVERRIDABLE_KNOBS
// name a family ONCE (credibility_half_life / credibility_floor / orphan_demote);
// the concrete storeConfigSchema fields expand each to its per-key form
// (credibility_half_life_decisions_days, …). A project key is store-overridable
// when it is a direct knob OR carries a family prefix.
const STORE_KNOB_FAMILIES = ["credibility_half_life", "credibility_floor", "orphan_demote"] as const;

function isStoreOverridableKnob(key: string): boolean {
  if ((STORE_OVERRIDABLE_KNOBS as readonly string[]).includes(key)) {
    return true;
  }
  return STORE_KNOB_FAMILIES.some((family) => key.startsWith(`${family}_`));
}

// Best-effort inline read of the TEAM/shared store's store-config.json at its
// resolved ROOT (parallel to store.json). Resolves the write target with the
// SHARED resolver (C-006: NO cli→server config-loader.resolveStoreConfig dep) and
// reads the file RAW (not schema-shaped) so we compare exactly the keys the repo
// set against the keys the store set. `{}` on ANY failure — unbound repo, no
// write target, absent/malformed store-config — so the advisory simply stays
// silent rather than surfacing on a broken/unbound setup.
function readTeamStoreConfigRaw(projectRoot: string): Record<string, unknown> {
  try {
    const input = buildStoreResolveInput(projectRoot);
    if (input === null) {
      return {};
    }
    let activeProject: string | undefined;
    try {
      activeProject = (loadProjectConfig(projectRoot) as { active_project?: string } | null)?.active_project;
    } catch {
      activeProject = undefined;
    }
    const scope = activeProject !== undefined && activeProject.length > 0 ? `project:${activeProject}` : "team";
    const { target } = createStoreResolver().resolveWriteTarget(input, scope);
    if (target === null) {
      return {};
    }
    const mounted =
      input.mountedStores.find((s) => s.store_uuid === target.store_uuid) ?? { store_uuid: target.store_uuid };
    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount(mounted));
    const parsed: unknown = JSON.parse(readFileSync(join(storeRoot, STORE_LAYOUT.configFile), "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// TASK-005 — INFO advisory (NEVER a warning): a repo overrides a store-layer knob
// the TEAM store also defaults. Routed to the info-severity StoreDiagnostic
// channel (NOT report.warnings, NOT FIX_KNOWLEDGE_CODES), so `fabric doctor
// --strict` — which exits 1 only on warn/error — stays exit 0. The project layer
// is ALLOWED to win (C-004 D2 user-in-control); this only surfaces the divergence.
function appendStoreKnobOverrideDiagnostics(projectRoot: string, out: StoreDiagnostic[]): void {
  const t = getProjectTranslator(projectRoot);
  let projectCfg: Record<string, unknown>;
  try {
    projectCfg = (loadProjectConfig(projectRoot) as Record<string, unknown> | null) ?? {};
  } catch {
    // A corrupt project config is not this advisory's concern (other lints own it).
    return;
  }
  const storeCfg = readTeamStoreConfigRaw(projectRoot);
  const overridden = Object.keys(projectCfg)
    .filter((key) => isStoreOverridableKnob(key) && Object.prototype.hasOwnProperty.call(storeCfg, key))
    .sort();
  for (const key of overridden) {
    out.push({
      code: "store_knob_repo_override",
      severity: "info",
      ref: key,
      message: t("doctor.store.knob-repo-override", { key }),
    });
  }
}

// BORROW-007 — related broken links (warn) + hub ranking (info heatmap).
async function appendRelatedGraphDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  const t = getProjectTranslator(projectRoot);
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
      message: t("doctor.store.related-broken", {
        count: String(inspection.brokenLinks.length),
        samples,
        overflow: overflow > 0 ? t("doctor.store.overflow-more", { count: String(overflow) }) : "",
      }),
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
      message: t("doctor.store.related-hub", {
        shown: String(Math.min(HUB_LIMIT, inspection.hubEntries.length)),
        total: String(inspection.hubEntries.length),
        top,
      }),
    });
  }
}

// BORROW-019 — read-set store reachability (warn per unreachable store).
async function appendStoreReachabilityDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  const t = getProjectTranslator(projectRoot);
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
      message: t("doctor.store.unreachable", { alias: store.alias, reason: store.reason ?? "unknown" }),
    });
  }
}

// BORROW-005 — consumption heatmap (info) + zero-consumed (warn, GATED).
async function appendConsumptionDiagnostics(
  projectRoot: string,
  out: StoreDiagnostic[],
): Promise<void> {
  const t = getProjectTranslator(projectRoot);
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
      message: t("doctor.store.consumption-heatmap", {
        days: String(inspection.windowDays),
        consumed: String(inspection.consumedEntries),
        total: String(inspection.totalEntries),
        windows: String(inspection.consumedWindows),
        top,
      }),
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
      message: t("doctor.store.consumption-zero", {
        count: String(inspection.zeroConsumed.length),
        days: String(inspection.windowDays),
        sample,
        overflow: overflow > 0 ? t("doctor.store.overflow-more", { count: String(overflow) }) : "",
      }),
    });
  }
}

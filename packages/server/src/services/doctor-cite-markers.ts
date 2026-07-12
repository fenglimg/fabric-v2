// Split from doctor-cite-coverage.ts (Doctor W4). Re-exported via doctor-cite-coverage.ts barrel.
// Cite / history domain previously extracted from doctor.ts.
// Public symbols re-exported via doctor.ts for package surface stability.
// inspectL1BootstrapSnapshotDrift + DoctorIssue/DoctorReport/LintMaturity refs
// import back from doctor.ts (a benign ESM function/type cycle — all cross-refs
// are resolved at call time, never at module-evaluation time).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative as nodeRelative, resolve, sep } from "node:path";
import { Script } from "node:vm";

import { minimatch } from "minimatch";
import { ZodError } from "zod";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  createTranslator,
  forensicReportSchema,
  parseKnowledgeId,
  knowledgeTestIndexSchema,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  ONBOARD_SLOT_NAMES,
  ONBOARD_SLOT_TOTAL,
  type AgentsMeta,
  type AgentsMetaCounters,
  type EventLedgerEvent,
  type ForensicReport,
  type KnowledgeTestIndex,
  type OnboardSlot,
  resolveFabricLocale,
  type Translator,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";
// v2.0.0-rc.29 TASK-008 (BUG-F2): surface MCP payload thresholds in doctor.
import {
  PAYLOAD_LIMIT_DEFAULT_HARD_BYTES,
  PAYLOAD_LIMIT_DEFAULT_WARN_BYTES,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { readOrphanDemoteThresholdDays, readPayloadLimits } from "../config-loader.js";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, getMetricsLedgerPath, sha256 } from "./_shared.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import {
  appendEventLedgerEvent,
  dropEventsFromLedger,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { appendCiteRollupRow, readCiteRollup, utcDayKey, utcDayBounds } from "./cite-rollup.js";
import type { CiteRollupRow } from "./cite-rollup.js";
import { readMetrics, METRIC_COUNTER_NAMES } from "./metrics.js";
import type { MetricsRow } from "./metrics.js";
import { INJECTION_PATTERNS } from "./extract-knowledge.js";

import { inspectL1BootstrapSnapshotDrift } from "./doctor-bootstrap-lints.js";
import { normalizePath } from "./doctor-path.js";
import type { DoctorIssue, DoctorReport, LintMaturity } from "./doctor-types.js";

const CITE_POLICY_VERSION = "2.0.0-rc.20";


export async function ensureCitePolicyActivatedMarker(
  projectRoot: string,
): Promise<{ marker_ts: number; emitted_now: boolean }> {
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, { event_type: "cite_policy_activated" });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_policy_activated",
      policy_version: CITE_POLICY_VERSION,
      timestamp: new Date().toISOString(),
    });
    return { marker_ts: stored.ts, emitted_now: true };
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }
}

// v2.0.0-rc.24 TASK-06: ensureCiteContractPolicyActivatedMarker — drift-gated
// counterpart to ensureCitePolicyActivatedMarker (rc.20). The cite-contract
// policy upgrade introduces structured `cite_commitments` written by post-rc.24
// hooks. During the rc.23 → rc.24 half-upgrade window (server on rc.24, hooks
// still rc.23) the marker emit MUST be refused — otherwise contract metrics
// open an audit window against events that physically cannot carry the new
// commitments field, manufacturing false `contract_missing` violations.
//
// The gate reuses `inspectL1BootstrapSnapshotDrift` (rc.19): if `.fabric/
// AGENTS.md` byte-equals the canonical bootstrap body for any locale (the
// inspector tolerates a language switch), the user has run the rc.24 `fabric
// install` and the hook layer is in sync with the schema.
// 'missing' is also treated as drift (deliberate conservative choice — no
// install snapshot present means we cannot prove the hook layer matches; user
// must run `fabric install` to seed `.fabric/AGENTS.md`).
//
// Return shape mirrors `ensureCitePolicyActivatedMarker` with one added
// discriminator: `blocked_by`. `null` when activation succeeded (or marker
// already existed); `'bootstrap_drift'` when the snapshot did not byte-equal
// canonical. Caller (`runDoctorCiteCoverage` extension in TASK-08) renders
// `contract_check: skipped (bootstrap drift — run fabric install)` when this
// field is non-null.
export async function ensureCiteContractPolicyActivatedMarker(
  projectRoot: string,
): Promise<{
  marker_ts: number;
  emitted_now: boolean;
  blocked_by: "bootstrap_drift" | null;
}> {
  // Step 1: gate on bootstrap drift. Use the existing L1 inspector so the
  // drift definition stays single-sourced. Any inspector throw (permissions,
  // unreadable FS) is treated as drift — conservative: better to skip
  // activation than to falsely advance the contract window.
  let driftStatus: "ok" | "drift" | "missing";
  try {
    const inspection = await inspectL1BootstrapSnapshotDrift(projectRoot);
    driftStatus = inspection.status;
  } catch {
    driftStatus = "drift";
  }
  if (driftStatus !== "ok") {
    return { marker_ts: 0, emitted_now: false, blocked_by: "bootstrap_drift" };
  }

  // Step 2: mirror ensureCitePolicyActivatedMarker — read existing marker
  // first, then append-if-missing. Read/write failures collapse to the
  // sentinel `{ marker_ts: 0, emitted_now: false }` exactly as the rc.20
  // marker does. Note: `blocked_by` is `null` for the silent-failure path —
  // the drift gate is the only path that surfaces a blocker, the ledger
  // sentinel preserves the rc.20 "warm-up never raises" contract.
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false, blocked_by: null };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    return { marker_ts: stored.ts, emitted_now: true, blocked_by: null };
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }
}

// v2.0.0-rc.20 TASK-05: cite policy adherence report shape returned by
// `fabric doctor --cite-coverage`. STUB scaffolding — TASK-06 fills the
// `metrics` / `per_client` / `dismissed_reason_histogram` fields by scanning
// `assistant_turn_observed` ledger events emitted by TASK-03. The shape is
// finalized here so the CLI renderer (TASK-07) and any downstream consumers
// can compile against a stable type before metrics are populated.
//
// status:
//   - 'skipped' when no `cite_policy_activated` marker exists AND the marker
//     write also failed (degraded ledger). Callers should render this as
//     "no data yet — re-run after first AI turn" rather than as an error.
//   - 'ok' once the marker is present (newly emitted or pre-existing). Zero
//     metrics in 'ok' status are valid: it means the marker is fresh and no
//     qualifying turns have been observed yet within the requested window.
//
// per_client / dismissed_reason_histogram are intentionally optional — they
// are only emitted by TASK-06 once the underlying observation events carry
// the `client` and `dismissed_reason` fields. STUB returns neither.
//
// v2.0.0-rc.24 TASK-08: extended with contract-policy metrics. Five new
// accumulators (contract_with / contract_missing / hard_violated / skip_count
// / cite_id_unresolved) plus per-(layer, type) cross-tab and a
// contract_metrics_status discriminator gating the contract audit window.
// The rc.20 metrics block stays untouched — contract metrics are an additive
// extension. See plan.json design_decisions for the B4 marker-independence
// rationale.


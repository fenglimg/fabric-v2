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
import {
  runDoctorCiteCoverage,
  ASSISTANT_TURN_COUNTER_PREFIX,
} from "./doctor-cite-coverage-core.js";



// ---------------------------------------------------------------------------
// v2.0.0-rc.39: cite-audit rollup
// ---------------------------------------------------------------------------
//
// assistant_turn_observed dominates events.jsonl (~96% in heavy dogfood). Each
// turn carries a cite audit payload that cite-coverage reads, but once a turn is
// older than the cite window it is dead weight in the main ledger. This pass
// rolls every such turn's day into ONE cite-rollup.jsonl row (computed by
// replaying runDoctorCiteCoverage over a single-UTC-day window — same metric
// logic as the live report, no drift) then DROPS the rolled-up turns from the
// main ledger (archived to events.archive/, never deleted). Net effect: the
// main ledger stays bounded near the cite window while the long-range compliance
// trend survives as compact daily rows.
//
// Only assistant_turn_observed is rolled/dropped — every other (low-volume)
// event stays in the ledger untouched. The per-day metrics are computed BEFORE
// the drop, while turns + edit_intent_checked + knowledge_body_read are
// all still present, so correlation-based metrics (expected_but_missed etc.)
// stay correct (modulo sessions that straddle a UTC midnight — an accepted
// observability approximation, not exact accounting).
export type CiteRollupResult = {
  days_rolled_up: number;
  turns_dropped: number;
  cutoff_ts: number;
};

export async function rollupCiteAuditIfNeeded(
  projectRoot: string,
  opts: { cutoffDays?: number; now?: Date } = {},
): Promise<CiteRollupResult> {
  const now = opts.now ?? new Date();
  // Default cutoff mirrors the cite-coverage default window (7d): turns younger
  // than this stay raw so the live report is unaffected; older ones roll up.
  const cutoffDays = typeof opts.cutoffDays === "number" && opts.cutoffDays >= 0 ? opts.cutoffDays : 7;
  const cutoffMs = now.getTime() - cutoffDays * 86_400_000;

  // Find the distinct UTC days that have at least one rollable turn.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }
  const days = new Set<string>();
  let rollableTurns = 0;
  for (const e of events) {
    if (e.event_type === "assistant_turn_observed" && e.ts < cutoffMs) {
      days.add(utcDayKey(e.ts));
      rollableTurns += 1;
    }
  }
  if (rollableTurns === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // One rollup row per day — reuse runDoctorCiteCoverage with a single-day
  // {since, until} window so the stored metrics are byte-identical to what the
  // live report would have produced for that day.
  let daysRolledUp = 0;
  const rolledDays = new Set<string>();
  for (const date of [...days].sort()) {
    const { start, end } = utcDayBounds(date);
    // Boundary day is split at the exact cutoff ms: only turns that will be
    // DROPPED (ts < cutoffMs) belong in the rollup row, so raw + rollup stay
    // disjoint and the Task-4 merge can sum them without double-counting.
    const report = await runDoctorCiteCoverage(projectRoot, {
      since: start,
      until: Math.min(end, cutoffMs),
      client: "all",
    });
    // A day that cannot be rolled up (no cite-policy marker → status 'skipped',
    // or zero coverable turns) is LEFT in the ledger — never silently drop a
    // turn whose cite signal was not captured. Such turns fall to the general
    // 30d rotation instead. This is the no-marker repo's safe path.
    if (report.status !== "ok" || report.metrics.total_turns === 0) continue;
    await appendCiteRollupRow(projectRoot, {
      date,
      generated_at: now.toISOString(),
      metrics: report.metrics,
    });
    rolledDays.add(date);
    daysRolledUp += 1;
  }

  if (rolledDays.size === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // Drop ONLY turns whose day was successfully rolled up (archived, not
  // deleted). Day-aware so un-rolled-up turns (pre-marker / skipped days) stay.
  const dropResult = await dropEventsFromLedger(projectRoot, {
    label: "cite-rolled",
    now,
    predicate: (parsed) =>
      parsed["event_type"] === "assistant_turn_observed" &&
      typeof parsed["ts"] === "number" &&
      (parsed["ts"] as number) < cutoffMs &&
      rolledDays.has(utcDayKey(parsed["ts"] as number)),
  });

  return {
    days_rolled_up: daysRolledUp,
    turns_dropped: dropResult.archivedCount,
    cutoff_ts: cutoffMs,
  };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.39 (P1 emit-fold, one-time backlog purge):
//
// The rc.39 hook folds NEW empty-shell turns at the source. This function folds
// the EXISTING backlog of empty-shell assistant_turn_observed events already
// sitting in events.jsonl (heavy dogfood repos accrued tens of thousands). It
// runs inside `doctor --fix` AFTER the cite-audit rollup (which sweeps every
// turn ≥7d, cite-bearing or empty), so this targets the live-window (<7d) empty
// shells the rollup intentionally leaves raw.
//
// Fold mechanism mirrors the hook: empties are tallied into metrics.jsonl
// counter rows keyed `assistant_turn_observed[:<client>]`, then dropped from the
// ledger (archived, never deleted). To keep cite-coverage total_turns invariant
// across the purge, each counter row is stamped with the MIN original ts of its
// (UTC-day, client) group: the reader's window filter (`ts >= effectiveSince`)
// then treats the folded group exactly as it treated the raw events, as long as
// the group's day does not straddle a window boundary — which holds because the
// rollup already removed everything ≥7d, leaving only recent days strictly
// inside the live window. The immediate cite-coverage re-check (dogfood
// verification) confirms the number is unchanged.
//
// Empty-shell predicate is identical to the hook's: no KB: line (kb_line_raw
// null/absent) AND no cite_ids AND no cite_commitments — i.e. zero cite signal.
export type EmptyShellPurgeResult = {
  turns_folded: number;
  groups_written: number;
};

function isEmptyShellTurn(parsed: Record<string, unknown>): boolean {
  if (parsed["event_type"] !== "assistant_turn_observed") return false;
  const kb = parsed["kb_line_raw"];
  if (kb !== null && kb !== undefined) return false;
  const citeIds = parsed["cite_ids"];
  if (Array.isArray(citeIds) && citeIds.length > 0) return false;
  const citeCommitments = parsed["cite_commitments"];
  if (Array.isArray(citeCommitments) && citeCommitments.length > 0) return false;
  return true;
}

export async function purgeEmptyShellTurnsIfNeeded(
  projectRoot: string,
  opts: { now?: Date } = {},
): Promise<EmptyShellPurgeResult> {
  const now = opts.now ?? new Date();

  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Group empty shells by (UTC-day, client). Value tracks count + min ts so the
  // folded counter row lands inside the original turns' window.
  const groups = new Map<string, { client: string | undefined; count: number; minTs: number }>();
  for (const e of events) {
    const parsed = e as unknown as Record<string, unknown>;
    if (!isEmptyShellTurn(parsed)) continue;
    const ts = typeof parsed["ts"] === "number" ? (parsed["ts"] as number) : now.getTime();
    const client = typeof parsed["client"] === "string" ? (parsed["client"] as string) : undefined;
    const key = `${utcDayKey(ts)}::${client ?? ""}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { client, count: 1, minTs: ts });
    } else {
      existing.count += 1;
      if (ts < existing.minTs) existing.minTs = ts;
    }
  }

  if (groups.size === 0) {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Write the folded counter rows BEFORE dropping (mirrors the rollup's
  // sidecar-then-drop order). Each row carries one (day, client) group.
  const metricsPath = getMetricsLedgerPath(projectRoot);
  await ensureParentDirectory(metricsPath);
  let turnsFolded = 0;
  let groupsWritten = 0;
  for (const { client, count, minTs } of groups.values()) {
    const counterKey =
      client !== undefined ? `${ASSISTANT_TURN_COUNTER_PREFIX}:${client}` : ASSISTANT_TURN_COUNTER_PREFIX;
    const row: MetricsRow = {
      timestamp: new Date(minTs).toISOString(),
      window: "purge-fold",
      counters: { [counterKey]: count },
    };
    await appendFile(metricsPath, `${JSON.stringify(row)}\n`);
    turnsFolded += count;
    groupsWritten += 1;
  }

  // Drop the folded empty shells (archived to events.archive/, never deleted).
  await dropEventsFromLedger(projectRoot, {
    label: "empty-shell-fold",
    now,
    predicate: (parsed) => isEmptyShellTurn(parsed),
  });

  return { turns_folded: turnsFolded, groups_written: groupsWritten };
}



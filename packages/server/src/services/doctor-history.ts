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



// ---------------------------------------------------------------------------
// v2.0.0-rc.25 TASK-10: `fabric doctor --archive-history`
// ---------------------------------------------------------------------------
//
// Read-only audit surface that renders one row per session showing the MOST
// RECENT `session_archive_attempted` event observed within the `--since`
// window. Mirrors the rc.20 `runDoctorCiteCoverage` precedent (parallel
// subcommand wired through the same CLI dispatch) but with a much smaller
// algorithm — a single readEventLedger pass + group-by-session reduction.
//
// Source-of-truth: events.jsonl rows whose `event_type` is
// `session_archive_attempted` (schema landed in rc.25 TASK-01). Each row
// carries `session_id`, `outcome`, `covered_through_ts`, `candidates_proposed`,
// and the event envelope `ts`. We project a stable, render-friendly shape so
// the CLI renderer (and any future JSON consumers) never has to walk the
// raw event union.
//
// Performance: O(N events in window). For typical pcf-grade corpora
// (<10k events) this stays under 50ms — well within the doctor budget.

export type ArchiveHistoryEntry = {
  // First 8 chars of the session_id, suffix `...` if truncated. The full
  // session_id is intentionally omitted from the projection — operators who
  // need it run `jq` against events.jsonl directly. Mirrors the truncation
  // convention used by the archive Skill's onboarding output.
  session_id_short: string;
  // ISO-8601 timestamp of the most recent attempt for this session. Derived
  // from the event envelope `ts` (epoch-ms) so all downstream sorting is
  // numeric-stable across timezones.
  last_attempted_at: string;
  // The terminal outcome of the most recent attempt. Closed enum mirrored
  // from the schema literal.
  outcome: "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal";
  // Count of pending knowledge entries written on that attempt. Zero for
  // non-`proposed` outcomes.
  candidates_proposed: number;
  // The latest event `ts` value the attempt scanned. Carries epoch-ms to
  // match the schema; downstream renderers convert to ISO.
  covered_through_ts: number;
  // Time elapsed (in hours, rounded down) between `covered_through_ts` and
  // `Date.now()` at the moment the report is generated. The "gap" surface
  // operators eyeball to spot sessions where archive coverage has stalled.
  age_since_covered_hours: number;
};

export type ArchiveHistoryReport = {
  entries: ArchiveHistoryEntry[];
  // Distinct session count (== entries.length). Surfaced explicitly so JSON
  // consumers don't have to count.
  total: number;
  // Epoch-ms floor of the `--since` window the caller passed in. Echoed back
  // so the renderer can interpolate it into the header line.
  since_ms: number;
  // ISO-8601 timestamp captured at the moment the report was assembled.
  // Provides a stable anchor for `age_since_covered_hours` so successive runs
  // are comparable even when wall-clock skews.
  generated_at: string;
};

export async function runDoctorArchiveHistory(
  projectRoot: string,
  options: { since: number },
): Promise<ArchiveHistoryReport> {
  const generatedAt = new Date().toISOString();
  const nowMs = Date.now();

  // Single ledger pass scoped to the requested window + event_type filter.
  // Both filters are pushed into readEventLedger so we never deserialize
  // events outside the report's surface area.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    events = result.events;
  } catch {
    // Degraded ledger — surface empty report rather than throw. Matches the
    // best-effort policy used by runDoctorCiteCoverage and downstream
    // observability emitters.
    return {
      entries: [],
      total: 0,
      since_ms: options.since,
      generated_at: generatedAt,
    };
  }

  // Group by session_id, keep the row with the MAX `ts` per session. Events
  // lacking session_id (envelope field is optional) are skipped — without a
  // session anchor there is no meaningful "last attempt for session X" to
  // render.
  type AttemptEvent = Extract<EventLedgerEvent, { event_type: "session_archive_attempted" }>;
  const mostRecentBySession = new Map<string, AttemptEvent>();
  for (const event of events) {
    if (event.event_type !== "session_archive_attempted") {
      // Defensive — the readEventLedger filter already gates this, but the
      // discriminated-union narrow below requires the runtime check.
      continue;
    }
    const sessionId = event.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      continue;
    }
    const prior = mostRecentBySession.get(sessionId);
    if (prior === undefined || event.ts > prior.ts) {
      mostRecentBySession.set(sessionId, event);
    }
  }

  // Project + sort. Descending by `last_attempted_at` (epoch-ms order is
  // identical to ISO order for `new Date(...).toISOString()`).
  const entries: ArchiveHistoryEntry[] = [];
  for (const [sessionId, event] of mostRecentBySession.entries()) {
    const ageHours = Math.max(
      0,
      Math.floor((nowMs - event.covered_through_ts) / 3_600_000),
    );
    entries.push({
      session_id_short: truncateSessionId(sessionId),
      last_attempted_at: new Date(event.ts).toISOString(),
      outcome: event.outcome,
      candidates_proposed: event.candidates_proposed,
      covered_through_ts: event.covered_through_ts,
      age_since_covered_hours: ageHours,
    });
  }
  entries.sort((a, b) =>
    a.last_attempted_at < b.last_attempted_at
      ? 1
      : a.last_attempted_at > b.last_attempted_at
        ? -1
        : 0,
  );

  return {
    entries,
    total: entries.length,
    since_ms: options.since,
    generated_at: generatedAt,
  };
}

// rc.37 NEW-33: unified history view. Aggregates doctor_run + archive
// attempt events into a per-day rollup over the --since window. Lightweight
// projection — daily counts only; for per-session detail operators continue
// to use the original --archive-history surface.
export type HistoryDayRow = {
  date: string; // YYYY-MM-DD (UTC)
  doctor_runs_lint: number;
  doctor_runs_fix: number;
  doctor_total_issues: number;
  doctor_total_mutations: number;
  archive_attempts: number;
  archive_proposed: number;
};

export type HistoryAllReport = {
  rows: HistoryDayRow[];
  since_ms: number;
  generated_at: string;
};

export async function runDoctorHistoryAll(
  projectRoot: string,
  options: { since: number },
): Promise<HistoryAllReport> {
  const generatedAt = new Date().toISOString();
  const buckets = new Map<string, HistoryDayRow>();
  const getBucket = (ts: number): HistoryDayRow => {
    const date = new Date(ts).toISOString().slice(0, 10);
    let row = buckets.get(date);
    if (row === undefined) {
      row = {
        date,
        doctor_runs_lint: 0,
        doctor_runs_fix: 0,
        doctor_total_issues: 0,
        doctor_total_mutations: 0,
        archive_attempts: 0,
        archive_proposed: 0,
      };
      buckets.set(date, row);
    }
    return row;
  };

  // doctor_run events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "doctor_run",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "doctor_run") continue;
      const row = getBucket(event.ts);
      if (event.mode === "lint") {
        row.doctor_runs_lint += 1;
      } else {
        row.doctor_runs_fix += 1;
      }
      row.doctor_total_issues += event.issues;
      row.doctor_total_mutations += event.mutations ?? 0;
    }
  } catch {
    // Degraded ledger — proceed with archive arm only.
  }

  // session_archive_attempted events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "session_archive_attempted") continue;
      const row = getBucket(event.ts);
      row.archive_attempts += 1;
      if (event.outcome === "proposed") {
        row.archive_proposed += event.candidates_proposed;
      }
    }
  } catch {
    // Degraded — empty archive arm.
  }

  const rows = Array.from(buckets.values()).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  return { rows, since_ms: options.since, generated_at: generatedAt };
}

// session_id truncation helper. The schema does not constrain session_id
// length (CLI clients pick arbitrary opaque strings — UUIDs, short prefixes,
// "sess-<n>" patterns) so the rule is: keep the first 8 chars and append
// `...` when truncation actually shortened the string. Short ids (<= 8 chars)
// render verbatim without a suffix.
function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 8) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...`;
}


// v2.0.0-rc.37 Wave B (Plan B counter-rollup): metrics.jsonl writer.
//
// Per the B1 decision lock (.workflow/.scratchpad/v2.0.0-ga-ux-audit-2026-05-27/
// wave-b/b1-events-jsonl-spike.md), high-frequency events that are metric in
// nature (knowledge_consumed / edit_intent_checked / knowledge_context_planned
// / knowledge_sections_fetched) leave the audit-grade events.jsonl ledger and
// route through this service instead. The hot path is `bumpCounter(name)` —
// O(1) in-memory increment, no I/O. A 60-second interval (configurable)
// flushes the accumulator to `.fabric/metrics.jsonl` as a single JSON row:
//
//   { timestamp, window: "60s", counters: { knowledge_consumed: 142, ... } }
//
// Downstream consumers (`fab metrics` CLI for NEW-34, doctor cite-goodhart
// replay) read the sidecar instead of replaying every individual event.
//
// Design constraints:
//  - Hot path zero-I/O — bumpCounter is called from MCP tool handlers.
//  - Flush is best-effort. fs failures degrade silently and the next flush
//    just carries the union of two intervals' counters (no data loss until
//    the process exits without a final flush).
//  - Per-project accumulator. Tests + multi-project installs need isolation.
//  - Idempotent flush — calling flushMetrics with zero counters is a no-op
//    (no spurious empty rows).

import { createReadStream, statSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { atomicWriteText, createLedgerWriteQueue } from "@fenglimg/fabric-shared/node/atomic-write";

import { ensureParentDirectory, getMetricsLedgerPath, isNodeError } from "./_shared.js";

const DEFAULT_FLUSH_INTERVAL_MS = 60 * 1000;
const METRICS_LEDGER_DEFAULT_RETENTION_DAYS = 30;
const METRICS_LEDGER_SIZE_WARN_BYTES = 50 * 1024 * 1024;
const METRICS_LEDGER_ARCHIVE_DIR = ".fabric/metrics.archive";

// W1-01 (ISS-015): serialize appends to metrics.jsonl through the same
// per-path write queue event-ledger uses, so concurrent flushMetrics calls on
// the same root can't interleave / tear a line. Mirrors event-ledger.ts.
const metricsQueue = createLedgerWriteQueue();

// Per-project counter accumulators, keyed by resolved project root. Keeps
// the API stateless from the caller's POV — bumpCounter / flushMetrics take
// a `projectRoot` and the right bucket is looked up here.
const counters = new Map<string, Map<string, number>>();
const flushTimers = new Map<string, ReturnType<typeof setInterval>>();
let flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS;

/**
 * Returns the per-project counter map, creating it lazily on first touch.
 */
function bucketFor(projectRoot: string): Map<string, number> {
  let bucket = counters.get(projectRoot);
  if (bucket === undefined) {
    bucket = new Map<string, number>();
    counters.set(projectRoot, bucket);
  }
  return bucket;
}

/**
 * O(1) in-memory increment for a named counter. Safe to call from any MCP
 * tool handler; no I/O happens until the next `flushMetrics()` call.
 *
 * `delta` defaults to 1; callers can pass a positive integer (e.g. fetched
 * N stable_ids in a single sections call) to fold N bumps into one.
 */
export function bumpCounter(projectRoot: string, name: string, delta = 1): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  const bucket = bucketFor(projectRoot);
  bucket.set(name, (bucket.get(name) ?? 0) + delta);
}

/**
 * Snapshot the current counter accumulator and reset it. Returned map is a
 * frozen copy; the live accumulator starts fresh from zero. Exposed so
 * flushMetrics + tests + a future fab_metrics manual-flush CLI hook can all
 * use the same primitive without racing.
 */
export function drainCounters(projectRoot: string): Record<string, number> {
  const bucket = bucketFor(projectRoot);
  const snapshot: Record<string, number> = {};
  for (const [name, count] of bucket.entries()) {
    snapshot[name] = count;
  }
  bucket.clear();
  return snapshot;
}

/**
 * Drain the current accumulator and append one JSONL row to
 * `.fabric/metrics.jsonl`. Returns the appended row (or `null` when the
 * accumulator was empty — no spurious zero rows). fs failures degrade
 * silently; the next flush will carry the union of the failed-write
 * interval + the current one.
 */
export async function flushMetrics(
  projectRoot: string,
  options: { windowMs?: number; now?: Date } = {},
): Promise<MetricsRow | null> {
  const drained = drainCounters(projectRoot);
  if (Object.keys(drained).length === 0) return null;
  const now = options.now ?? new Date();
  const windowMs = options.windowMs ?? flushIntervalMs;
  const row: MetricsRow = {
    timestamp: now.toISOString(),
    window: formatWindow(windowMs),
    counters: drained,
  };
  const path = getMetricsLedgerPath(projectRoot);
  try {
    await ensureParentDirectory(path);
    await metricsQueue.append(path, JSON.stringify(row));
    try {
      if (statSync(path).size > METRICS_LEDGER_SIZE_WARN_BYTES) {
        await rotateMetricsIfNeeded(projectRoot, {
          now,
          maxBytes: Math.floor(METRICS_LEDGER_SIZE_WARN_BYTES / 2),
        });
      }
    } catch {
      // Metrics rotation is best-effort and must not fail a flush.
    }
  } catch {
    // Re-seed the bucket so the failed counts survive into the next flush.
    const bucket = bucketFor(projectRoot);
    for (const [name, count] of Object.entries(drained)) {
      bucket.set(name, (bucket.get(name) ?? 0) + count);
    }
  }
  return row;
}

/**
 * Start the background flush timer for a project root. Idempotent — calling
 * twice on the same root replaces the prior interval. Returns a stop handle
 * the caller can invoke at shutdown to flush + clear the timer.
 *
 * The flush is fire-and-forget (no await on the setInterval callback) so
 * the timer cadence stays accurate even when fs is slow.
 */
export function startMetricsFlush(
  projectRoot: string,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  const interval = options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  flushIntervalMs = interval;
  stopMetricsFlush(projectRoot);
  const timer = setInterval(() => {
    void flushMetrics(projectRoot);
  }, interval);
  // Don't keep the event loop alive solely for metrics.
  if (typeof timer.unref === "function") timer.unref();
  flushTimers.set(projectRoot, timer);
  return async () => {
    stopMetricsFlush(projectRoot);
    await flushMetrics(projectRoot);
  };
}

/**
 * Cancel the background flush timer for a project root if one is running.
 * Does NOT drain the accumulator — callers that want a final flush should
 * await flushMetrics(projectRoot) afterward.
 */
export function stopMetricsFlush(projectRoot: string): void {
  const existing = flushTimers.get(projectRoot);
  if (existing !== undefined) {
    clearInterval(existing);
    flushTimers.delete(projectRoot);
  }
}

export type RotateMetricsResult = {
  rotated: boolean;
  archivedCount: number;
  keptCount: number;
  archivePath?: string;
};

export async function rotateMetricsIfNeeded(
  projectRoot: string,
  opts: { now?: Date; retentionDays?: number; maxBytes?: number } = {},
): Promise<RotateMetricsResult> {
  const path = getMetricsLedgerPath(projectRoot);
  try {
    statSync(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { rotated: false, archivedCount: 0, keptCount: 0 };
    }
    throw error;
  }

  const now = opts.now ?? new Date();
  const retentionDays = opts.retentionDays ?? METRICS_LEDGER_DEFAULT_RETENTION_DAYS;
  const cutoffMs = now.getTime() - retentionDays * 86_400_000;
  const archived: string[] = [];
  const kept: string[] = [];

  await visitCompleteMetricsLines(path, (line) => {
    const ts = metricTimestampMs(line);
    if (ts !== undefined && ts < cutoffMs) {
      archived.push(line);
    } else {
      kept.push(line);
    }
  });

  if (opts.maxBytes !== undefined && opts.maxBytes >= 0) {
    let keptBytes = kept.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
    while (keptBytes > opts.maxBytes && kept.length > 0) {
      const oldest = kept.shift() as string;
      archived.push(oldest);
      keptBytes -= Buffer.byteLength(oldest, "utf8") + 1;
    }
  }

  if (archived.length === 0) {
    return { rotated: false, archivedCount: 0, keptCount: kept.length };
  }

  const yyyymmdd = formatUtcDate(now);
  const archiveDirAbsolute = join(projectRoot, METRICS_LEDGER_ARCHIVE_DIR);
  const archiveFilename = `metrics-rotated-${yyyymmdd}.jsonl`;
  const archiveAbsolutePath = join(archiveDirAbsolute, archiveFilename);
  const archiveRelativePath = `${METRICS_LEDGER_ARCHIVE_DIR}/${archiveFilename}`;

  await mkdir(archiveDirAbsolute, { recursive: true });
  await appendFile(archiveAbsolutePath, archived.map((line) => `${line}\n`).join(""), "utf8");
  await atomicWriteText(path, kept.length > 0 ? `${kept.join("\n")}\n` : "");

  return {
    rotated: true,
    archivedCount: archived.length,
    keptCount: kept.length,
    archivePath: archiveRelativePath,
  };
}

/**
 * Read accumulated metrics rows from `.fabric/metrics.jsonl`. Missing file
 * returns []. Malformed rows are dropped silently (the sidecar is best-
 * effort observability; a corrupt row never blocks a reader).
 *
 * Exposed for the NEW-34 `fab metrics` CLI dashboard + future doctor lints
 * (e.g. cite-goodhart pattern replay) that need counter trends without
 * walking events.jsonl.
 */
export async function readMetrics(projectRoot: string): Promise<MetricsRow[]> {
  const path = getMetricsLedgerPath(projectRoot);
  const rows: MetricsRow[] = [];

  try {
    await visitCompleteMetricsLines(path, (line) => {
      try {
        const parsed = JSON.parse(line) as MetricsRow;
        if (
          typeof parsed.timestamp === "string" &&
          typeof parsed.window === "string" &&
          parsed.counters !== null &&
          typeof parsed.counters === "object"
        ) {
          rows.push(parsed);
        }
      } catch {
        // skip malformed
      }
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  return rows;
}

async function visitCompleteMetricsLines(
  path: string,
  visitor: (line: string) => void,
): Promise<void> {
  let remainder = "";

  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    remainder += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    let newlineIndex = remainder.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = remainder.slice(0, newlineIndex);
      remainder = remainder.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      const trimmed = line.trim();
      if (trimmed.length > 0) {
        visitor(trimmed);
      }

      newlineIndex = remainder.indexOf("\n");
    }
  }

  // A non-newline-terminated tail mirrors the old split behavior: if it is a
  // complete JSON row it still gets parsed, while malformed partial rows are
  // ignored by the visitor's JSON.parse guard.
  const tail = remainder.trim();
  if (tail.length > 0) {
    visitor(tail);
  }
}

/**
 * Test-only helper: zero out the in-memory accumulator AND clear any
 * registered flush timers for a project root. Exported so unit tests can
 * isolate between cases without leaking state into the next test.
 */
export function resetMetricsForTest(projectRoot?: string): void {
  if (projectRoot === undefined) {
    for (const timer of flushTimers.values()) clearInterval(timer);
    flushTimers.clear();
    counters.clear();
    return;
  }
  stopMetricsFlush(projectRoot);
  counters.delete(projectRoot);
}

function metricTimestampMs(line: string): number | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.timestamp !== "string") {
      return undefined;
    }
    const ts = Date.parse(parsed.timestamp);
    return Number.isFinite(ts) ? ts : undefined;
  } catch {
    return undefined;
  }
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWindow(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

export type MetricsRow = {
  timestamp: string;
  window: string;
  counters: Record<string, number>;
};

/**
 * Canonical metric counter names used by the high-frequency emitters that
 * left events.jsonl as part of the rc.37 Wave B clean-slate. Centralized
 * here so the B5 hard-gate (`metric_event_in_jsonl`) can grep for these
 * exact strings and fail when one accidentally re-appears in the audit
 * ledger emit path.
 */
export const METRIC_COUNTER_NAMES = {
  knowledge_consumed: "knowledge_consumed",
  edit_intent_checked: "edit_intent_checked",
  knowledge_context_planned: "knowledge_context_planned",
  knowledge_sections_fetched: "knowledge_sections_fetched",
} as const;
export type MetricCounterName = (typeof METRIC_COUNTER_NAMES)[keyof typeof METRIC_COUNTER_NAMES];

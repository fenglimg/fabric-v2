// v2.0.0-rc.39: cite-audit rollup store.
//
// assistant_turn_observed events carry a per-turn cite audit payload (cite_ids,
// cite_tags, cite_commitments) that cite-coverage reads to compute compliance.
// They are also the highest-volume event in the ledger (~96% in heavy dogfood).
// Once a turn is older than the cite-coverage window it is dead weight in the
// main ledger, but its daily compliance signal still has value for long-range
// trend analysis.
//
// This sidecar stores ONE row per UTC day: the fully-computed cite-coverage
// metrics for that day (produced by replaying runDoctorCiteCoverage over a
// single-day window — no duplicate metric logic). The rollup writer drops the
// raw turns from the main ledger afterward, bounding events.jsonl while keeping
// the compliance trend queryable.
//
// gitignored per-dev telemetry, mirroring events.jsonl / metrics.jsonl.

import { appendFile, readFile } from "node:fs/promises";

import type { CiteCoverageReport } from "./doctor.js";
import { ensureParentDirectory, getCiteRollupPath, isNodeError } from "./_shared.js";

export type CiteRollupRow = {
  /** UTC day this row aggregates, `YYYY-MM-DD`. */
  date: string;
  /** ISO timestamp the rollup row was written. */
  generated_at: string;
  /** Fully-computed cite-coverage metrics for the day (same shape as live report). */
  metrics: CiteCoverageReport["metrics"];
};

/**
 * Append one daily rollup row to `.fabric/cite-rollup.jsonl`. Best-effort:
 * fs failures throw to the caller (rotation wraps this so a write failure
 * aborts the drop, never losing un-rolled-up turns silently).
 */
export async function appendCiteRollupRow(projectRoot: string, row: CiteRollupRow): Promise<void> {
  const path = getCiteRollupPath(projectRoot);
  await ensureParentDirectory(path);
  await appendFile(path, `${JSON.stringify(row)}\n`);
}

/**
 * Read all rollup rows. Missing file → []. Malformed rows dropped silently
 * (best-effort observability; a corrupt row never blocks a reader). Rows are
 * returned in file order (chronological, since the writer appends per day).
 */
export async function readCiteRollup(projectRoot: string): Promise<CiteRollupRow[]> {
  const path = getCiteRollupPath(projectRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const rows: CiteRollupRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as CiteRollupRow;
      if (
        typeof parsed.date === "string" &&
        parsed.metrics !== null &&
        typeof parsed.metrics === "object"
      ) {
        rows.push(parsed);
      }
    } catch {
      // skip malformed
    }
  }
  return rows;
}

/** UTC `YYYY-MM-DD` for a ms timestamp. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Exclusive [dayStartMs, dayEndMs) bounds for a `YYYY-MM-DD` UTC day. */
export function utcDayBounds(date: string): { start: number; end: number } {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return { start, end: start + 86_400_000 };
}

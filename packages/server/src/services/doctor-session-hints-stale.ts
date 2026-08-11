// Session-hints cache hygiene inspect (W8 Step A only).
// Step B: apply-lint unlink arm lives here; doctor re-exports/uses it.
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { join as posixJoin } from "node:path/posix";

/** Days after which a per-session cache file is considered stale (lint #27). */
export const SESSION_HINTS_STALE_DAYS = 7;
export const SESSION_HINTS_FILE_PREFIX = "session-hints-";
export const SESSION_HINTS_FILE_SUFFIX = ".json";

// Every `<name>-<session_id>.json` sidecar under .fabric/.cache/ is swept by
// this one lint. Sweeping matters more now that these are per-session: a single
// shared slot was self-limiting at one file, whereas one file per session grows
// without bound across weeks of windows. Adding a per-session sidecar without
// adding its prefix here leaks files forever.
export const STALE_SWEEP_PREFIXES = [
  SESSION_HINTS_FILE_PREFIX,
  "narrow-dedup-window-",
  "active-session-",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SessionHintsStaleCandidate = {
  // Project-relative POSIX path of the stale cache file (display + apply-lint
  // anchor). The apply-lint arm joins this back to projectRoot to unlink.
  path: string;
  // Age of the file (mtime delta) in whole days. Floor-rounded to keep the
  // signal coarse; sub-day precision adds noise without informational value.
  age_days: number;
};

export type SessionHintsStaleInspection = {
  candidates: SessionHintsStaleCandidate[];
};

export async function inspectSessionHintsStale(
  projectRoot: string,
  now: number,
): Promise<SessionHintsStaleInspection> {
  const cacheDir = join(projectRoot, ".fabric", ".cache");
  let entries;
  try {
    entries = await readdir(cacheDir, { withFileTypes: true });
  } catch {
    return { candidates: [] };
  }
  const candidates: SessionHintsStaleCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!STALE_SWEEP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
    if (!entry.name.endsWith(SESSION_HINTS_FILE_SUFFIX)) continue;
    const absPath = join(cacheDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(absPath)).mtimeMs;
    } catch {
      // Unreadable stat → skip rather than guess at age. The next doctor
      // run will retry (or the OS will reap a corrupted entry).
      continue;
    }
    const ageDays = Math.floor((now - mtimeMs) / MS_PER_DAY);
    if (ageDays < SESSION_HINTS_STALE_DAYS) continue;
    candidates.push({
      path: posixJoin(".fabric", ".cache", entry.name),
      age_days: ageDays,
    });
  }
  // Stable display order — alphabetical by path so test assertions and
  // human review aren't sensitive to readdir() ordering quirks.
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
}

export type SessionHintsCleanupMutation = {
  kind: "knowledge_session_hints_stale_cleanup";
  path: string;
  detail: string;
  applied: boolean;
  error?: string;
};

function truncateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

/**
 * Apply-lint arm for lint #27: unlink one stale session-hints cache file.
 * Local hot-cache only — no ledger event / git mv.
 */
export async function applySessionHintsStaleCleanup(
  projectRoot: string,
  candidate: SessionHintsStaleCandidate,
): Promise<SessionHintsCleanupMutation> {
  const detail = `deleted (${candidate.age_days}d old)`;
  const absPath = join(projectRoot, candidate.path);
  try {
    await unlink(absPath);
    return {
      kind: "knowledge_session_hints_stale_cleanup",
      path: candidate.path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_session_hints_stale_cleanup",
      path: candidate.path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

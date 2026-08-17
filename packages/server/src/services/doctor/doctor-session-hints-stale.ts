// Session-hints cache hygiene inspect (W8 Step A only).
// Step B: apply-lint unlink arm lives here; doctor re-exports/uses it.
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { join as posixJoin } from "node:path/posix";

/** Days after which a per-session cache file is considered stale (lint #27). */
export const SESSION_HINTS_STALE_DAYS = 7;
export const SESSION_HINTS_FILE_PREFIX = "session-hints-";
export const SESSION_HINTS_FILE_SUFFIX = ".json";

/** One per-session sidecar family: `<prefix><session_id><suffix>`. */
export type StaleSweepFamily = { prefix: string; suffix: string };

// Every `<prefix><session_id><suffix>` sidecar under .fabric/.cache/ is swept by
// this one lint. Sweeping matters more now that these are per-session: a single
// shared slot was self-limiting at one file, whereas one file per session grows
// without bound across weeks of windows. Adding a per-session sidecar without
// adding its family here leaks files forever — `session-cache-prefix-parity`
// round-trips the real writer helpers against this list to catch that.
//
// The suffix is per-family, not one shared `.json`: `maintenance-hint-last-emit-`
// writes a bare ISO timestamp with no extension, so a single shared suffix gate
// skipped it even once its prefix was known.
export const STALE_SWEEP_FAMILIES: readonly StaleSweepFamily[] = [
  { prefix: SESSION_HINTS_FILE_PREFIX, suffix: SESSION_HINTS_FILE_SUFFIX },
  { prefix: "narrow-dedup-window-", suffix: ".json" },
  { prefix: "active-session-", suffix: ".json" },
  { prefix: "archive-hint-shown-", suffix: ".json" },
  { prefix: "hint-dismiss-", suffix: ".json" },
  { prefix: "maintenance-hint-last-emit-", suffix: "" },
];

// Mirrors the writer's own sanitiser (`session-signal-state.cjs`
// sessionScopedCacheFile / sessionDismissFileName): a session id is reduced to
// this character class before it reaches a filename. Requiring a non-empty match
// is what keeps the legacy shared slots (`archive-hint-shown.json`) and a
// truncated `session-hints-.json` out of a DELETE arm — see KT-PIT-0051.
const SESSION_ID_TOKEN_RE = /^[A-Za-z0-9_.-]+$/;

/** The family a cache filename belongs to, or null if the sweep must not touch it. */
export function matchStaleSweepFamily(name: string): StaleSweepFamily | null {
  for (const family of STALE_SWEEP_FAMILIES) {
    if (!name.startsWith(family.prefix)) continue;
    if (family.suffix.length > 0 && !name.endsWith(family.suffix)) continue;
    const token = name.slice(family.prefix.length, name.length - family.suffix.length);
    if (!SESSION_ID_TOKEN_RE.test(token)) continue;
    return family;
  }
  return null;
}

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
    if (matchStaleSweepFamily(entry.name) === null) continue;
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

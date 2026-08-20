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

/**
 * The family a cache filename belongs to, or null if the sweep must not touch it.
 *
 * @param families narrows the set considered. Defaults to all of them; the
 * console passes {@link ON_DEMAND_SWEEP_FAMILIES} so a live session's file
 * cannot match at all, rather than matching and then being filtered later.
 */
export function matchStaleSweepFamily(
  name: string,
  families: readonly StaleSweepFamily[] = STALE_SWEEP_FAMILIES,
): StaleSweepFamily | null {
  for (const family of families) {
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

/**
 * The prefix of the one family a sweep must NOT clear on demand.
 *
 * `active-session-*` is live state for a session that may be running right now,
 * and people routinely have several client windows open on one repo. Doctor is
 * safe from this by construction — it only ever deletes files past
 * {@link SESSION_HINTS_STALE_DAYS}, and a running session's file is minutes old
 * — but a console button that clears the cache NOW has no such floor, so it has
 * to exclude the family by name.
 *
 * Named here rather than in the console so the exclusion sits beside the list it
 * excludes from; `session-cache-prefix-parity` asserts it still matches a real
 * family, which is what turns a rename into a red test instead of an exclusion
 * that silently stops excluding.
 */
export const LIVE_SESSION_FAMILY_PREFIX = "active-session-";

/** Every sweepable family except the live-session one. @see LIVE_SESSION_FAMILY_PREFIX */
export const ON_DEMAND_SWEEP_FAMILIES: readonly StaleSweepFamily[] =
  STALE_SWEEP_FAMILIES.filter((f) => f.prefix !== LIVE_SESSION_FAMILY_PREFIX);

/**
 * @param now epoch ms to measure age against.
 * @param options.minAgeDays how old a file must be to count. Defaults to
 * {@link SESSION_HINTS_STALE_DAYS} — doctor's threshold, unchanged. The console
 * passes 0 to enumerate the whole accumulation, which is a different question
 * ("what is piling up here") from doctor's ("what is safe to reap unattended").
 * @param options.families which families to consider. Defaults to all of them.
 */
export async function inspectSessionHintsStale(
  projectRoot: string,
  now: number,
  options?: { minAgeDays?: number; families?: readonly StaleSweepFamily[] },
): Promise<SessionHintsStaleInspection> {
  const minAgeDays = options?.minAgeDays ?? SESSION_HINTS_STALE_DAYS;
  const families = options?.families ?? STALE_SWEEP_FAMILIES;
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
    if (matchStaleSweepFamily(entry.name, families) === null) continue;
    const absPath = join(cacheDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(absPath)).mtimeMs;
    } catch {
      // Unreadable stat → skip rather than guess at age. The next doctor
      // run will retry (or the OS will reap a corrupted entry).
      continue;
    }
    // Clamped at zero. `mtimeMs` carries sub-millisecond precision on APFS while
    // `Date.now()` is whole milliseconds, so a file written moments ago is
    // routinely stamped a fraction of a millisecond AFTER `now` — and
    // `Math.floor` turns that fraction into -1, not 0. Under doctor's seven-day
    // floor that was invisible (-1 and 0 are both "too new"). Under the
    // console's zero floor it meant the newest files were silently skipped about
    // four times in five: "clear the cache" would leave behind exactly the files
    // the user had just generated.
    const ageDays = Math.max(0, Math.floor((now - mtimeMs) / MS_PER_DAY));
    if (ageDays < minAgeDays) continue;
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

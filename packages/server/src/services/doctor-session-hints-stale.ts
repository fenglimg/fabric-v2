// Session-hints cache hygiene inspect (W8 Step A only).
// Apply-lint unlink arm stays in doctor.ts until Step B.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { join as posixJoin } from "node:path/posix";

/** Days after which a session-hints-* cache file is considered stale (lint #27). */
export const SESSION_HINTS_STALE_DAYS = 7;
export const SESSION_HINTS_FILE_PREFIX = "session-hints-";
export const SESSION_HINTS_FILE_SUFFIX = ".json";

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
    if (!entry.name.startsWith(SESSION_HINTS_FILE_PREFIX)) continue;
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


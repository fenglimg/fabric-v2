// Active-session sidecar reader for MCP-side session_id fallback.
//
// Hooks stamp `.fabric/.cache/active-session-<session_id>.json` (see
// packages/cli/templates/hooks/lib/state-store.cjs writeActiveSession) so that
// fab_recall / planContext can attach session_id to knowledge_context_planned
// when the agent omits the optional arg. Without this, recall_coverage_rate
// stays 0 because planned events have no session_id while edits do
// (ccpm dogfood 2026-07-12, KT-PIT-0053).
//
// Shape: { session_id: string, ts: number }. Max age 24h. Best-effort: any
// failure returns null — never throw into the recall hot path.
//
// ## Why this is not a single shared slot
//
// It used to be one `active-session.json`. That is last-writer-wins, and
// several client windows routinely run against the same repo at once: window
// B's stamp became window A's answer, so A's planned events were attributed to
// B's session and cite coverage joined A's recalls to B's edits. Silent
// misattribution — confidently wrong numbers, worse than no numbers.
//
// The fix is NOT merely one file per session: the reader has no way to tell
// which of several files is "its own", so per-session files alone just relocate
// the same guess. The actual discriminator is PROCESS IDENTITY — the client
// hands this process its session_id whenever the agent passes it explicitly,
// and that answer is about US, where a stamp on disk may be about anyone.
// Resolution order:
//
//   1. explicit caller arg                        → also (re)pins the process
//   2. this process's pin, unless contested        → survives the agent forgetting
//   3. sidecar, ONLY if exactly one session is live
//   4. undefined                                   → refuse to guess
//
// Step 4 costs an undercount (the KT-PIT-0053 symptom) but steps 2-3 make it
// rare, and an undercount is recoverable where a misattribution is not.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { FABRIC_DIR } from "./_shared.js";

export const ACTIVE_SESSION_FILE_PREFIX = "active-session-";
export const ACTIVE_SESSION_FILE_SUFFIX = ".json";
export const ACTIVE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ActiveSessionState = {
  session_id: string;
  ts: number;
};

function isActiveSessionState(value: unknown): value is ActiveSessionState {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.session_id === "string" &&
    rec.session_id.length > 0 &&
    typeof rec.ts === "number" &&
    Number.isFinite(rec.ts)
  );
}

// Process pin (see header). Module-level rather than passed around because
// "which client owns this server process" is a property of the process.
//
// TIMESTAMPED, not permanent. One process does not always mean one session for
// its whole life: `/clear` starts a new session inside the same client process
// without restarting the MCP server, so a permanent pin would keep stamping the
// retired session id forever — a misattribution that never self-corrects, which
// is strictly worse than the shared-slot bug this replaces. Carrying `at` lets
// resolution prefer whichever evidence is NEWER.
let pinned: { session_id: string; at: number } | null = null;

/** Test seam — production code never needs to clear the pin. */
export function resetPinnedSessionId(): void {
  pinned = null;
}

export function getPinnedSessionId(): string | null {
  return pinned?.session_id ?? null;
}

/**
 * Resolve the session_id to stamp on knowledge_context_planned:
 *   1. explicit caller arg (agent passed session_id to fab_recall)
 *   2. this process's pinned id (from an earlier explicit arg)
 *   3. undefined (leave event unscoped — recall_coverage stays uncorrelatable)
 *
 * Kept as a pure helper; `resolveSessionId` is the one that also reads disk.
 */
export function coalesceSessionId(
  explicit: string | undefined,
  fallback: string | null | undefined,
): string | undefined {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return undefined;
}

/**
 * Read the sidecar stamps and return the single live session_id, or null when
 * the answer is ambiguous (several distinct sessions stamped within the max
 * age) or absent. Ambiguity resolves to null BY DESIGN — see header.
 */
/** Every stamp still inside the max-age window, newest first. */
async function readLiveStamps(
  projectRoot: string,
  nowMs: number,
): Promise<{ session_id: string; ts: number }[]> {
  const cacheDir = join(projectRoot, FABRIC_DIR, ".cache");
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return [];
  }

  const live: { session_id: string; ts: number }[] = [];
  for (const name of entries) {
    if (!name.startsWith(ACTIVE_SESSION_FILE_PREFIX)) continue;
    if (!name.endsWith(ACTIVE_SESSION_FILE_SUFFIX)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(cacheDir, name), "utf8"));
    } catch {
      continue; // unreadable / malformed stamp — skip, never throw
    }
    if (!isActiveSessionState(parsed)) continue;
    // Clock skew (future stamp) is not evidence of liveness — drop it rather
    // than let a bad clock win.
    if (parsed.ts > nowMs) continue;
    if (nowMs - parsed.ts > ACTIVE_SESSION_MAX_AGE_MS) continue;
    live.push({ session_id: parsed.session_id, ts: parsed.ts });
  }
  live.sort((a, b) => b.ts - a.ts);
  return live;
}

/**
 * The single live session_id, or null when the answer is ambiguous (several
 * distinct sessions stamped within the max age) or absent. Ambiguity resolves
 * to null BY DESIGN — see header.
 */
export async function readActiveSessionId(
  projectRoot: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const live = await readLiveStamps(projectRoot, nowMs);
  const distinct = new Set(live.map((s) => s.session_id));
  if (distinct.size !== 1) return null;
  return live[0]?.session_id ?? null;
}

/**
 * The full resolution chain. Explicit wins outright and (re)pins the process.
 *
 * Without an explicit id the question is "is my pin still who I am?", and the
 * only counter-evidence on disk is a stamp from a DIFFERENT session that is
 * newer than anything known about mine. That evidence is genuinely ambiguous:
 * it looks identical whether a neighbouring window is active or the user ran
 * `/clear` (new session, same process, same server, stale pin). Since the two
 * demand opposite answers and nothing on disk separates them, this returns
 * undefined rather than pick one — the undercount is recoverable, and it
 * self-corrects the moment the agent passes session_id explicitly again.
 */
export async function resolveSessionId(
  projectRoot: string,
  explicit: string | undefined,
  nowMs: number = Date.now(),
): Promise<string | undefined> {
  if (typeof explicit === "string" && explicit.length > 0) {
    pinned = { session_id: explicit, at: nowMs };
    return explicit;
  }

  const live = await readLiveStamps(projectRoot, nowMs);

  if (pinned !== null) {
    const mineLastSeen = Math.max(
      pinned.at,
      ...live.filter((s) => s.session_id === pinned?.session_id).map((s) => s.ts),
    );
    const contested = live.some(
      (s) => s.session_id !== pinned?.session_id && s.ts > mineLastSeen,
    );
    return contested ? undefined : pinned.session_id;
  }

  const distinct = new Set(live.map((s) => s.session_id));
  if (distinct.size !== 1) return undefined;
  const adopted = live[0];
  if (adopted === undefined) return undefined;
  pinned = { session_id: adopted.session_id, at: adopted.ts };
  return adopted.session_id;
}

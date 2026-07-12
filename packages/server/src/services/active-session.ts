// Active-session sidecar reader for MCP-side session_id fallback.
//
// Hooks write `.fabric/.cache/active-session.json` (see
// packages/cli/templates/hooks/lib/state-store.cjs writeActiveSession) so that
// fab_recall / planContext can attach session_id to knowledge_context_planned
// when the agent omits the optional arg. Without this, recall_coverage_rate
// stays 0 because planned events have no session_id while edits do
// (ccpm dogfood 2026-07-12).
//
// Shape: { session_id: string, ts: number }. Max age 24h. Best-effort: any
// failure returns null — never throw into the recall hot path.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FABRIC_DIR } from "./_shared.js";

export const ACTIVE_SESSION_FILE = "active-session.json";
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

/**
 * Resolve the session_id to stamp on knowledge_context_planned:
 *   1. explicit caller arg (agent passed session_id to fab_recall)
 *   2. freshest active-session sidecar written by SessionStart / edit hooks
 *   3. undefined (leave event unscoped — recall_coverage stays uncorrelatable)
 */
export function coalesceSessionId(
  explicit: string | undefined,
  fallback: string | null | undefined,
): string | undefined {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return undefined;
}

export async function readActiveSessionId(
  projectRoot: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const path = join(projectRoot, FABRIC_DIR, ".cache", ACTIVE_SESSION_FILE);
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isActiveSessionState(parsed)) return null;
    if (parsed.ts > nowMs) return null;
    if (nowMs - parsed.ts > ACTIVE_SESSION_MAX_AGE_MS) return null;
    return parsed.session_id;
  } catch {
    return null;
  }
}

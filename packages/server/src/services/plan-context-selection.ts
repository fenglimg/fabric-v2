/**
 * ISS-20260713-011: selection_token mint / LRU cache for plan-context.
 */
export type SelectionTokenState = {
  token: string;
  revision_hash: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  created_at: number;
  expires_at: number;
};

// v2.0.0-rc.29 TASK-008 (BUG-F3): default selection_token TTL. Overridable
// at runtime via fabric.config.json's `selection_token_ttl_ms` (per
// projectRoot).
//
// v2.0.0-rc.37 NEW-3: default bumped 5min → 30min. After A1 removed
// `selectable=false` server-side filtering, the AI can legitimately reuse a
// single fab_plan_context token across a longer reasoning loop (multi-tool
// chains, iterative refinement). 5min was tuned for the single straight-through
// plan→fetch pair; 30min covers mid-task token reuse without bloating cache.
// Tokens stay valid until TTL/LRU expiry even if the read-set revision changes;
// get_sections validates against the minted token state, not a global revision
// invalidation. Operators on long-running agents can override via
// fabric-config.selection_token_ttl_ms.
export const SELECTION_TOKEN_TTL_DEFAULT_MS = 30 * 60 * 1000;
// v2.0-rc.7 T9: degenerate-mode threshold removed — the API is now symmetric
// across all candidate counts. See docs/decisions/rc5-a3-superseded.md.
const selectionTokenCache = new Map<string, SelectionTokenState>();

// ISS-027: the cache was unbounded — one entry per plan-context call lived up to
// the TTL with no proactive eviction, so memory grew O(call-rate within the TTL
// window). Cap it and run an expiry sweep on insert. The Map preserves insertion
// order, and readSelectionToken re-inserts on a hit (LRU bump), so eviction from
// the front drops the least-recently-used token.
const SELECTION_TOKEN_CACHE_MAX = 1000;

function sweepAndCapSelectionTokens(now: number): void {
  // Proactive expiry sweep (bounded: the cache is capped below).
  for (const [token, state] of selectionTokenCache) {
    if (state.expires_at <= now) {
      selectionTokenCache.delete(token);
    }
  }
  // Capacity cap: evict the least-recently-used (front of insertion order) until
  // there is room for the new token.
  while (selectionTokenCache.size >= SELECTION_TOKEN_CACHE_MAX) {
    const lru = selectionTokenCache.keys().next().value;
    if (lru === undefined) {
      break;
    }
    selectionTokenCache.delete(lru);
  }
}

// Test seams (mirror the other cache seams in this module).
export function __selectionTokenCacheSize(): number {
  return selectionTokenCache.size;
}
export function __resetSelectionTokenCache(): void {
  selectionTokenCache.clear();
}

export function readSelectionToken(token: string, now = Date.now()): SelectionTokenState | undefined {
  const state = selectionTokenCache.get(token);
  if (state === undefined) {
    return undefined;
  }

  if (state.expires_at <= now) {
    selectionTokenCache.delete(token);
    return undefined;
  }

  // ISS-027: LRU bump — re-insert so a recently-read token moves to the back of
  // the insertion order and is evicted last under the capacity cap.
  selectionTokenCache.delete(token);
  selectionTokenCache.set(token, state);
  return state;
}

// Exported for test scaffolds that need a selection_token without going
// through the public planContext() entry point (e.g. two-stage flow tests
// where the seeded corpus would otherwise drop into degenerate mode and
// omit the token entirely). Internal API; not part of the MCP contract.
export function createSelectionToken(
  revisionHash: string,
  targetPaths: string[],
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
  now = Date.now(),
  // v2.0.0-rc.29 TASK-008 (BUG-F3): caller-provided TTL override (defaults to
  // the constant when omitted). Test scaffolds can short-circuit by passing
  // a small ttlMs to exercise expiry without sleeping for 5 minutes.
  ttlMs: number = SELECTION_TOKEN_TTL_DEFAULT_MS,
): string {
  const token = buildSelectionToken(revisionHash, now);
  writeSelectionTokenState(token, revisionHash, targetPaths, requiredStableIds, aiSelectableStableIds, now, ttlMs);
  return token;
}

export function buildSelectionToken(revisionHash: string, now: number): string {
  return `selection:${revisionHash}:${now.toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function writeSelectionTokenState(
  token: string,
  revisionHash: string,
  targetPaths: string[],
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
  now: number,
  ttlMs: number,
): void {
  // ISS-027: sweep expired + enforce the capacity cap before inserting.
  sweepAndCapSelectionTokens(now);
  selectionTokenCache.set(token, {
    token,
    revision_hash: revisionHash,
    target_paths: targetPaths,
    required_stable_ids: requiredStableIds,
    ai_selectable_stable_ids: aiSelectableStableIds,
    created_at: now,
    expires_at: now + ttlMs,
  });
}

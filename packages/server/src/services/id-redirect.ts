// v2.0.0-rc.37 NEW-24: id-redirect resolver.
//
// When fab_review modify-layer flips an entry across layer counters (KT-*
// ↔ KP-*), the entry receives a *new* stable_id. Callers (Skills, hooks,
// LLM agents) that cached the *old* id in their working context would
// otherwise see "rule no longer present" on the next plan-context call.
// review.ts now emits a `knowledge_id_redirect` event recording the
// (previous_stable_id → new_stable_id) mapping; this module reads recent
// redirect events and exposes a transitive lookup so plan-context can
// surface the map and knowledge-sections can transparently rewrite stale
// caller-held ids before fetching bodies.
//
// Window: redirects older than the configured window are dropped. The
// default (30 days) gives long-lived AI sessions plenty of time to observe
// the rename without unbounded ledger replay cost.

import { statSync } from "node:fs";

import { getEventLedgerPath } from "./_shared.js";
import { readEventLedger } from "./event-ledger.js";

const DEFAULT_REDIRECT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type IdRedirectMap = Map<string, string>;

// ISS-20260711-134: avoid re-streaming events.jsonl on every plan-context call
// when the ledger file has not grown/changed.
type RedirectCacheEntry = {
  size: number;
  mtimeMs: number;
  windowMs: number;
  map: IdRedirectMap;
};
const redirectMapCache = new Map<string, RedirectCacheEntry>();

/**
 * Read recent `knowledge_id_redirect` events from the ledger and fold them
 * into a flat (old → new) lookup map. Chain compression: if A→B and B→C
 * both exist, the returned map maps A→C and B→C, so callers never need to
 * walk the chain themselves.
 *
 * Events older than `windowMs` (default 30 days) are ignored — long-lived
 * redirect chains are deliberately bounded so a workspace that has lived
 * through many flip cycles doesn't accumulate unbounded indirection.
 */
export async function loadIdRedirectMap(
  projectRoot: string,
  options: { windowMs?: number; now?: number } = {},
): Promise<IdRedirectMap> {
  const windowMs = options.windowMs ?? DEFAULT_REDIRECT_WINDOW_MS;
  const now = options.now ?? Date.now();
  const cutoffMs = now - windowMs;

  // Fast path: reuse the last built map when the ledger file is unchanged.
  const ledgerPath = getEventLedgerPath(projectRoot);
  let size = -1;
  let mtimeMs = -1;
  try {
    const st = statSync(ledgerPath);
    size = st.size;
    mtimeMs = st.mtimeMs;
    const cached = redirectMapCache.get(projectRoot);
    if (
      cached !== undefined &&
      cached.size === size &&
      cached.mtimeMs === mtimeMs &&
      cached.windowMs === windowMs
    ) {
      return new Map(cached.map);
    }
  } catch {
    // missing ledger — fall through to empty read
  }

  const { events } = await readEventLedger(projectRoot, {
    event_type: "knowledge_id_redirect",
  });

  // Build the raw old→new mapping, keeping the LATEST mapping per old id
  // (later flips supersede earlier ones).
  const raw = new Map<string, string>();
  for (const event of events) {
    if (event.event_type !== "knowledge_id_redirect") continue;
    const redirect = event as { previous_stable_id?: string; new_stable_id?: string; timestamp?: string };
    if (redirect.previous_stable_id === undefined || redirect.new_stable_id === undefined) continue;
    if (redirect.timestamp !== undefined) {
      const ts = Date.parse(redirect.timestamp);
      if (!Number.isNaN(ts) && ts < cutoffMs) continue;
    }
    raw.set(redirect.previous_stable_id, redirect.new_stable_id);
  }

  // Chain compression: resolve transitive paths so callers do a single lookup.
  // Detects cycles defensively (a malformed ledger could in theory produce
  // one) by bailing after `raw.size` hops.
  const compressed: IdRedirectMap = new Map();
  for (const [oldId, firstTarget] of raw.entries()) {
    let current = firstTarget;
    let hops = 0;
    while (raw.has(current) && hops < raw.size) {
      const next = raw.get(current);
      if (next === undefined || next === current) break;
      current = next;
      hops += 1;
    }
    compressed.set(oldId, current);
  }

    if (size >= 0) {
    redirectMapCache.set(projectRoot, {
      size,
      mtimeMs,
      windowMs,
      map: compressed,
    });
  }
  return compressed;
}

/**
 * Resolve a single id through the redirect map. Returns the input unchanged
 * if no redirect applies. Pure helper — no I/O.
 */
export function resolveRedirectedId(redirects: IdRedirectMap, stableId: string): string {
  return redirects.get(stableId) ?? stableId;
}

/**
 * Filter a redirect map down to only the (old → new) mappings where `new`
 * appears in the supplied set of currently-known ids. Plan-context surfaces
 * the trimmed map so the AI only sees redirects that are *actionable* for
 * the current call — entries already gone from the index aren't worth
 * surfacing even if the redirect chain is technically still valid.
 */
export function trimRedirectsToActiveIds(
  redirects: IdRedirectMap,
  activeIds: Iterable<string>,
): Record<string, string> {
  const active = new Set(activeIds);
  const out: Record<string, string> = {};
  for (const [oldId, newId] of redirects.entries()) {
    if (active.has(newId)) {
      out[oldId] = newId;
    }
  }
  return out;
}

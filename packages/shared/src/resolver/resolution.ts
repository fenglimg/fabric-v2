import { scopeRoot } from "../schemas/scope.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Resolution engine (double-axis + store tie-break).
//
// Surfaces: S21 (scope axis) · S53 (store tie-break) · F2 (no silent degrade) ·
// S61 (dedup keeps source; shadowing not merged).
//
// Given recall candidates gathered across the read-set, produce a DETERMINISTIC,
// EXPLAINABLE ordering:
//   axis 1 — scope specificity: a more specific coordinate (more ':'-segments)
//            outranks a broader one (project:x > team > <root>).
//   axis 2 — store tie-break: within equal specificity, the store earlier in
//            `storeOrder` wins (e.g. active write store / required order, S53).
//   final  — global_ref lexical, purely for stable determinism.
//
// Dedup removes EXACT global_ref duplicates only; two entries sharing a local_id
// across different stores keep DISTINCT global_refs and are BOTH retained
// (shadowing surfaced, not silently merged — S61). Unavailable required stores
// become warnings, never silent drops (F2).
// ---------------------------------------------------------------------------

export interface ResolutionCandidate {
  global_ref: string;
  store_uuid: string;
  alias: string;
  local_id: string;
  semantic_scope: string;
}

export interface ResolvedEntry extends ResolutionCandidate {
  rank: number;
  // Human-readable explanation of why this entry landed at this rank.
  reason: string;
}

export interface ResolutionWarning {
  code: "required_store_unavailable" | "shadowed_local_id";
  ref: string;
  message: string;
}

export interface ResolveOptions {
  // Store UUIDs in priority order (index 0 = highest). Stores not listed sort
  // after listed ones, preserving input order among themselves.
  storeOrder?: string[];
  // Required stores that could not be mounted — surfaced as warnings (F2).
  unavailableRequiredStores?: string[];
}

function specificity(scope: string): number {
  return scope.split(":").length;
}

export interface ResolutionResult {
  resolved: ResolvedEntry[];
  warnings: ResolutionWarning[];
}

export function resolveCandidates(
  candidates: ResolutionCandidate[],
  options: ResolveOptions = {},
): ResolutionResult {
  const storeOrder = options.storeOrder ?? [];
  const storeRank = (uuid: string): number => {
    const idx = storeOrder.indexOf(uuid);
    return idx === -1 ? storeOrder.length : idx;
  };

  // Dedup EXACT global_ref (keep first occurrence; preserves provenance).
  const seen = new Set<string>();
  const deduped: ResolutionCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.global_ref)) {
      continue;
    }
    seen.add(c.global_ref);
    deduped.push(c);
  }

  // Detect shadowing (same local_id across >1 distinct store) — surfaced, kept.
  const byLocal = new Map<string, Set<string>>();
  for (const c of deduped) {
    const stores = byLocal.get(c.local_id) ?? new Set<string>();
    stores.add(c.store_uuid);
    byLocal.set(c.local_id, stores);
  }

  const warnings: ResolutionWarning[] = [];
  for (const [localId, stores] of byLocal) {
    if (stores.size > 1) {
      warnings.push({
        code: "shadowed_local_id",
        ref: localId,
        message: `local id '${localId}' exists in ${stores.size} stores; references must be store-qualified`,
      });
    }
  }
  for (const uuid of options.unavailableRequiredStores ?? []) {
    warnings.push({
      code: "required_store_unavailable",
      ref: uuid,
      message: `required store '${uuid}' is unavailable; results may be incomplete (not silently degraded)`,
    });
  }

  const sorted = [...deduped].sort((a, b) => {
    const specDiff = specificity(b.semantic_scope) - specificity(a.semantic_scope);
    if (specDiff !== 0) {
      return specDiff;
    }
    const rankDiff = storeRank(a.store_uuid) - storeRank(b.store_uuid);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.global_ref < b.global_ref ? -1 : a.global_ref > b.global_ref ? 1 : 0;
  });

  const resolved: ResolvedEntry[] = sorted.map((c, i) => ({
    ...c,
    rank: i,
    reason: `scope '${scopeRoot(c.semantic_scope)}' (specificity ${specificity(
      c.semantic_scope,
    )}), store '${c.alias}' (priority ${storeRank(c.store_uuid)})`,
  }));

  return { resolved, warnings };
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// W4-2 (KT-DEC-0028 / KT-MOD-0001) — broad-index-drift lint.
//
// W2-1 retired the hint_broad_top_k hard cap: the SessionStart broad banner now
// shows EVERY broad-scope entry (completeness). The only scale guard is the
// `broad_index_backstop` (fabric-config.json, default 50, range 20..500) — once
// a store's rendered broad index exceeds it, the overflow tail folds into a
// single marker and entries silently drop off the banner.
//
// This lint warns BEFORE that happens: when a store's broad-scope entry count
// reaches BROAD_INDEX_DRIFT_RATIO (80%) of the backstop, it surfaces a per-store
// warning pointing at `fabric-audit` (the prune skill) so the corpus can be
// trimmed before completeness is lost. Per-store attribution tells the user
// WHICH store is bloating. Pure read; never throws (degrades to ok on any error).
//
// "broad-scope" = relevance_scope === "broad" (the relevance axis of the
// three-axis model). guidelines/models are broad by nature; broad-tagged
// decisions/pitfalls/processes also count. narrow entries never appear in the
// banner so they are excluded.
// ---------------------------------------------------------------------------

export const DEFAULT_BROAD_INDEX_BACKSTOP = 50;
const BROAD_INDEX_BACKSTOP_MIN = 20;
const BROAD_INDEX_BACKSTOP_MAX = 500;
export const BROAD_INDEX_DRIFT_RATIO = 0.8;

export type BroadIndexStoreCount = {
  store: string; // store alias (the qualifiedId prefix)
  broad_count: number;
};

export interface BroadIndexDriftInspection {
  backstop: number;
  threshold: number; // floor(backstop * BROAD_INDEX_DRIFT_RATIO)
  // Stores whose broad_count >= threshold, descending by count.
  drifted_stores: BroadIndexStoreCount[];
}

// Best-effort reader for `.fabric/fabric-config.json#broad_index_backstop`.
// Mirrors knowledge-hint-broad.cjs#readBroadIndexBackstop EXACTLY (same file,
// same 20..500 clamp, floor) so the lint and the hook agree on the value for a
// given workspace. Any failure (missing file, parse error, out-of-range) →
// default 50.
async function readBroadIndexBackstop(projectRoot: string): Promise<number> {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>).broad_index_backstop;
      if (typeof v === "number" && Number.isFinite(v)) {
        const floored = Math.floor(v);
        if (floored >= BROAD_INDEX_BACKSTOP_MIN && floored <= BROAD_INDEX_BACKSTOP_MAX) {
          return floored;
        }
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_BROAD_INDEX_BACKSTOP;
}

export async function inspectBroadIndexDrift(
  projectRoot: string,
): Promise<BroadIndexDriftInspection> {
  const backstop = await readBroadIndexBackstop(projectRoot);
  const threshold = Math.floor(backstop * BROAD_INDEX_DRIFT_RATIO);

  const entries = await collectStoreCanonicalEntries(projectRoot);
  const byStore = new Map<string, number>();
  for (const entry of entries) {
    if (entry.description.relevance_scope !== "broad") continue;
    // qualifiedId is `<alias>:<local-id>`; the alias is the store attribution.
    const alias = entry.qualifiedId.split(":")[0] ?? entry.qualifiedId;
    byStore.set(alias, (byStore.get(alias) ?? 0) + 1);
  }

  const drifted: BroadIndexStoreCount[] = [];
  for (const [store, broad_count] of byStore) {
    if (broad_count >= threshold) {
      drifted.push({ store, broad_count });
    }
  }
  drifted.sort((a, b) => (b.broad_count - a.broad_count) || a.store.localeCompare(b.store));

  return { backstop, threshold, drifted_stores: drifted };
}

export function createBroadIndexDriftCheck(
  t: Translator,
  inspection: BroadIndexDriftInspection,
): DoctorCheck {
  if (inspection.drifted_stores.length === 0) {
    return {
      name: t("doctor.check.broad_index_drift.name"),
      status: "ok",
      message: t("doctor.check.broad_index_drift.ok", {
        threshold: String(inspection.threshold),
        backstop: String(inspection.backstop),
      }),
    };
  }
  const first = inspection.drifted_stores[0];
  const detail = `${first.store} (${String(first.broad_count)} broad)`;
  const count = inspection.drifted_stores.length;
  return {
    name: t("doctor.check.broad_index_drift.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_broad_index_drift",
    fixable: false,
    message: t(`doctor.check.broad_index_drift.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
      threshold: String(inspection.threshold),
      backstop: String(inspection.backstop),
    }),
    actionHint: t("doctor.check.broad_index_drift.remediation"),
  };
}

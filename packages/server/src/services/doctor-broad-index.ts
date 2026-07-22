import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import { resolveStoreConfig } from "../config-loader.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck } from "./doctor-types.js";

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

// Best-effort reader for `broad_index_backstop`. Cascades: project-level
// `.fabric/fabric-config.json` → store-level `store-config.json` (via
// resolveStoreConfig) → default 50. The store's own backstop takes effect when
// the project config omits the key, so a team store can set a higher ceiling
// (e.g. 80) without every bound project repeating it.
async function readBroadIndexBackstop(projectRoot: string): Promise<number> {
  // Project layer — highest priority.
  const projectValue = await readProjectBackstop(projectRoot);
  if (projectValue !== undefined) {
    return projectValue;
  }
  // Store layer — the store's store-config.json, already parsed + validated by
  // resolveStoreConfig (same 20..500 range enforced by storeConfigSchema).
  try {
    const storeCfg = resolveStoreConfig(projectRoot) as Record<string, unknown>;
    const sv = storeCfg.broad_index_backstop;
    if (typeof sv === "number" && Number.isFinite(sv)) {
      const floored = Math.floor(sv);
      if (floored >= BROAD_INDEX_BACKSTOP_MIN && floored <= BROAD_INDEX_BACKSTOP_MAX) {
        return floored;
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_BROAD_INDEX_BACKSTOP;
}

// Read the project-level backstop from `.fabric/fabric-config.json`.
// Returns undefined when absent/invalid so the caller can fall through.
async function readProjectBackstop(projectRoot: string): Promise<number | undefined> {
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
    // fall through
  }
  return undefined;
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

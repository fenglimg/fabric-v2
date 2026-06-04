import { readFileSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteJson, withFileLock } from "../node/atomic-write.js";
import {
  AgentsMetaCountersSchema,
  allocateKnowledgeId,
  defaultAgentsMetaCounters,
  type AgentsMetaCounters,
} from "../schemas/agents-meta.js";
import type { KnowledgeType, Layer, StableId } from "../schemas/api-contracts.js";
import { STORE_LAYOUT } from "../schemas/store.js";

// ---------------------------------------------------------------------------
// v2.2 W4 (agents.meta decolo) — per-store monotonic stable_id counters.
//
// The co-location `<projectRoot>/.fabric/agents.meta.json#counters` is retired.
// Knowledge now lives ONLY inside stores (write-side is store-only since the
// v2.2 B2 cutover), so the monotonic id counter that mints each entry's
// stable_id moves WITH the knowledge into the store: a committed `counters.json`
// at the store root, parallel to store.json / projects.json.
//
// Why COMMITTED (not the gitignored, deterministically-rebuilt agents.meta):
// counters are NON-derivable state. Deleting the highest-numbered entry must NOT
// free its slot (KT-DEC-0004) — a reader that rebuilt counters from disk-max
// would re-mint that id and corrupt cite history. The ledger therefore has to
// persist and travel with the store on clone, exactly like projects.json.
//
// The on-disk shape is the bare {KP,KT} envelope (AgentsMetaCountersSchema), so
// the pure `allocateKnowledgeId` allocator is reused verbatim — this module only
// adds store-rooted path resolution + the file-locked read-modify-write.
// ---------------------------------------------------------------------------

// Absolute path to a store's committed counters ledger.
export function storeCountersPath(storeDir: string): string {
  return join(storeDir, STORE_LAYOUT.countersFile);
}

// Read a store's counters envelope. Returns all-zero slots when the file is
// absent (a fresh store has minted nothing) or unreadable/invalid (degrade to
// zeros rather than crash a read path) — mirrors readStoreProjects' tolerance.
export function readStoreCounters(storeDir: string): AgentsMetaCounters {
  let raw: string;
  try {
    raw = readFileSync(storeCountersPath(storeDir), "utf8");
  } catch {
    return defaultAgentsMetaCounters();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultAgentsMetaCounters();
  }
  const result = AgentsMetaCountersSchema.safeParse(parsed);
  return result.success ? result.data : defaultAgentsMetaCounters();
}

/**
 * Allocate the next stable_id for `(layer, type)` in the given store and persist
 * the advanced counter to `<storeDir>/counters.json`.
 *
 * The read → mutate → atomic-write is guarded by a cross-process advisory lock
 * keyed on the counters path so two concurrent allocate calls (two windows
 * approving knowledge into the same store at once) can never read the same
 * counter and mint a duplicate id (the same invariant the retired
 * KnowledgeIdAllocator held over agents.meta).
 */
export async function allocateStoreKnowledgeId(
  layer: Layer,
  type: KnowledgeType,
  storeDir: string,
): Promise<StableId> {
  const countersPath = storeCountersPath(storeDir);
  return withFileLock(`${countersPath}.lock`, async () => {
    const counters = readStoreCounters(storeDir);
    const { id, nextCounters } = allocateKnowledgeId(layer, type, counters);
    await atomicWriteJson(countersPath, nextCounters, { indent: 2 });
    return id;
  });
}

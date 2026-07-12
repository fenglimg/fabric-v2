import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  defaultAgentsMetaCounters,
  KNOWLEDGE_TYPE_CODES,
  parseKnowledgeId,
  readStoreCounters,
  reconcileStoreCounters,
  resolveGlobalRoot,
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  storeRelativePathForMount,
  type AgentsMetaCounters,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";

// ---------------------------------------------------------------------------
// v2.2 W5 R4 (agents.meta decolo) — per-store stable_id counter health.
//
// The retired co-location `<projectRoot>/.fabric/agents.meta.json#counters`
// envelope drove the old doctor `counter_desync` / `index_drift` checks. Post
// decolo the monotonic stable_id counter travels WITH the knowledge into each
// store as a committed `counters.json` (store-counters.ts / KT-DEC-0004). This
// is the store-aware replacement: it walks every store in the project's
// read-set and verifies each store's committed `counters.json` is floored at
// the highest stable_id actually present on disk.
//
// Disk-max FLOOR semantics (KT-DEC-0004 monotonic invariant): drift fires ONLY
// when a stored counter is STRICTLY BELOW the max counter observed on disk —
// the case where the next `allocateStoreKnowledgeId` would re-mint an existing
// id and corrupt cite history. A counter ABOVE disk-max (the highest entry was
// deleted, freeing nothing) is correct and must NOT be flagged: the floor
// never lowers. `--fix` calls `reconcileStoreCounters` which floors (never
// lowers) the on-disk envelope.
//
// Reads ONLY stores (the post-decolo knowledge home); never throws — a
// multi-store hiccup degrades to "no drift observable", never crashes doctor.
// Mirrors the doctor-scope-lint.ts store-resolution access pattern (W4-A6).
// ---------------------------------------------------------------------------

export interface StoreCounterDrift {
  store_alias: string;
  store_uuid: string;
  store_dir: string;
  layer: "KP" | "KT";
  type: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  current: number; // value recorded in the store's counters.json
  disk_max: number; // highest counter observed across the store's entries
}

interface StoreRef {
  uuid: string;
  alias: string;
  dir: string;
}

// Resolve the project's read-set store dirs (uuid + alias + absolute dir). []
// when there is no global config / no mounted store (never throws) — identical
// resolution to doctor-scope-lint.resolveLintStores.
function resolveCounterStores(projectRoot: string): StoreRef[] {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  if (readSet.stores.length === 0) {
    return [];
  }
  const globalRoot = resolveGlobalRoot();
  return readSet.stores.map((entry) => ({
    uuid: entry.store_uuid,
    alias: entry.alias,
    dir: join(
      globalRoot,
      storeRelativePathForMount(
        input.mountedStores.find((s) => s.store_uuid === entry.store_uuid) ?? {
          store_uuid: entry.store_uuid,
        },
      ),
    ),
  }));
}

// The `id:` frontmatter line, falling back to the `<id>--slug.md` filename
// prefix — the same two id carriers reconcileStoreCounters trusts.
function readEntryId(file: string): string | null {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const match = content.match(/^id:\s*(\S+)\s*$/mu);
  if (match) {
    return match[1] ?? null;
  }
  const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.md$/u, "");
  const idPart = stem.split("--")[0];
  return idPart.length > 0 ? idPart : null;
}

// Read-only sibling of reconcileStoreCounters: compute the highest stable_id
// counter present on disk per (layer, type) for a store WITHOUT writing. Mirrors
// reconcileStoreCounters' walk exactly so the drift detection and the --fix
// floor stay in lock-step.
function computeStoreDiskMax(storeDir: string): AgentsMetaCounters {
  const max = defaultAgentsMetaCounters();
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, type);
    if (!existsSync(dir)) {
      continue;
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const parsed = parseKnowledgeId(readEntryId(join(dir, name)) ?? "");
      if (parsed === null) {
        continue;
      }
      const layerKey: "KP" | "KT" = parsed.layer === "personal" ? "KP" : "KT";
      const typeCode = KNOWLEDGE_TYPE_CODES[parsed.type];
      max[layerKey][typeCode] = Math.max(max[layerKey][typeCode], parsed.counter);
    }
  }
  return max;
}

const LAYER_KEYS = ["KP", "KT"] as const;
const TYPE_CODES = ["MOD", "DEC", "GLD", "PIT", "PRO"] as const;

// Inspect every read-set store for counters.json that has drifted BELOW its
// disk-max (a re-mint collision risk). Returns the flat list of drifts (empty
// when every store's counters are floored at disk-max). Never throws.
export function inspectStoreCounters(projectRoot: string): StoreCounterDrift[] {
  const drifts: StoreCounterDrift[] = [];
  for (const store of resolveCounterStores(projectRoot)) {
    let current: AgentsMetaCounters;
    let diskMax: AgentsMetaCounters;
    try {
      current = readStoreCounters(store.dir);
      diskMax = computeStoreDiskMax(store.dir);
    } catch {
      continue; // store unreadable — skip, never crash doctor.
    }
    for (const layer of LAYER_KEYS) {
      for (const type of TYPE_CODES) {
        const cur = current[layer][type];
        const max = diskMax[layer][type];
        if (cur < max) {
          drifts.push({
            store_alias: store.alias,
            store_uuid: store.uuid,
            store_dir: store.dir,
            layer,
            type,
            current: cur,
            disk_max: max,
          });
        }
      }
    }
  }
  return drifts;
}

// Floor every read-set store's counters.json at disk-max (KT-DEC-0004: floor,
// never lower). Returns the absolute store dirs that were reconciled. Used by
// `doctor --fix`. reconcileStoreCounters is a no-throw, exclusive one-shot
// write (the only callers run in non-concurrent --fix contexts).
export function fixStoreCounters(projectRoot: string): string[] {
  const reconciled: string[] = [];
  // Recompute drift fresh so we only touch stores that actually need flooring.
  const drifted = new Set(inspectStoreCounters(projectRoot).map((d) => d.store_dir));
  for (const dir of drifted) {
    try {
      reconcileStoreCounters(dir);
      reconciled.push(dir);
    } catch {
      // best-effort — a single unreconcilable store must not abort --fix.
    }
  }
  return reconciled;
}

// Store-aware successor to the retired co-location counter_desync/index_drift
// checks. A drift is fixable because `doctor --fix` floors each affected
// store's counters.json at disk max, never lowers it.
export function createStoreCounterCheck(t: Translator, drifts: StoreCounterDrift[]): DoctorCheck {
  if (drifts.length > 0) {
    const first = drifts[0];
    const detail = `${first.store_alias}: counters.${first.layer}.${first.type}=${first.current} but disk max is ${first.disk_max}`;
    const count = drifts.length;
    return {
      name: t("doctor.check.store_counter_drift.name"),
      status: "error",
      kind: "fixable_error",
      code: "store_counter_drift",
      fixable: true,
      message: t(`doctor.check.store_counter_drift.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        detail,
      }),
      actionHint: t("doctor.check.store_counter_drift.remediation"),
    };
  }
  return {
    name: t("doctor.check.store_counter_drift.name"),
    status: "ok",
    message: t("doctor.check.store_counter_drift.ok"),
  };
}

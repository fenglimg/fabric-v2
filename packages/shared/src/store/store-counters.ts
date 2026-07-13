import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { atomicWriteJson, withFileLock } from "../node/atomic-write.js";
import {
  AgentsMetaCountersSchema,
  allocateKnowledgeId,
  defaultAgentsMetaCounters,
  type AgentsMetaCounters,
} from "../schemas/agents-meta.js";
import {
  KNOWLEDGE_TYPE_CODES,
  type KnowledgeType,
  type Layer,
  parseKnowledgeId,
  type StableId,
} from "../schemas/api-contracts.js";
import { STORE_KNOWLEDGE_TYPE_DIRS, STORE_LAYOUT } from "../schemas/store.js";

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

function preserveCorruptCounters(path: string, raw: string): string {
  const corruptedPath = `${path}.corrupted.${Date.now()}`;
  writeFileSync(corruptedPath, raw, "utf8");
  return corruptedPath;
}

function readStoreCountersForAllocation(storeDir: string): AgentsMetaCounters {
  const path = storeCountersPath(storeDir);
  if (!existsSync(path)) {
    return defaultAgentsMetaCounters();
  }

  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const corruptedPath = preserveCorruptCounters(path, raw);
    throw new Error(
      `store counters.json is corrupt; forensic copy saved to ${corruptedPath}. ` +
        `Run doctor --fix or reconcileStoreCounters before allocating a new stable_id. ` +
        `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = AgentsMetaCountersSchema.safeParse(parsed);
  if (!result.success) {
    const corruptedPath = preserveCorruptCounters(path, raw);
    throw new Error(
      `store counters.json is schema-invalid; forensic copy saved to ${corruptedPath}. ` +
        "Run doctor --fix or reconcileStoreCounters before allocating a new stable_id.",
    );
  }
  return result.data;
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
    const counters = readStoreCountersForAllocation(storeDir);
    const { id, nextCounters } = allocateKnowledgeId(layer, type, counters);
    await atomicWriteJson(countersPath, nextCounters, { indent: 2 });
    return id;
  });
}

// The `id:` frontmatter line, falling back to the `<id>--slug.md` filename prefix
// (the two id carriers the migrate/disk-reader paths already trust).
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

/**
 * Floor a store's `counters.json` at the highest stable_id actually present on
 * disk, persisting and returning the reconciled envelope.
 *
 * This is the producer↔consumer bridge (W4 F1): a BULK import
 * writes entries whose ids were minted elsewhere (collision-remapped from
 * disk-max) WITHOUT advancing this store's counters.json. Without reconciliation
 * the next `allocateStoreKnowledgeId` would start from a stale zero and re-mint
 * an already-present id. Flooring is also the self-heal `doctor` runs to repair a
 * drifted ledger.
 *
 * Floor — never lower — preserves the monotonic invariant (KT-DEC-0004): a slot
 * already advanced past disk-max (because the highest entry was deleted) keeps
 * its higher value. Sync write (no lock) because the only callers run in
 * exclusive one-shot contexts (post-migrate CLI step, `doctor --fix`).
 */

/** Sync ownership-token lock for counters.json (ISS-20260713-026). */
function withCountersFileLockSync<T>(lockPath: string, fn: () => T): T {
  const token = `${process.pid}.${randomUUID()}`;
  const start = Date.now();
  const maxWaitMs = 10_000;
  const staleMs = 10_000;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(lockPath, token, "utf8");
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        return fn();
      } finally {
        try {
          if (readFileSync(lockPath, "utf8") === token) rmSync(lockPath, { force: true });
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code !== "EEXIST") throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          const stale = readFileSync(lockPath, "utf8");
          if (readFileSync(lockPath, "utf8") === stale) rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > maxWaitMs) {
        throw new Error(`withCountersFileLockSync: timeout on ${lockPath}`);
      }
      // brief spin
      const end = Date.now() + 20;
      while (Date.now() < end) {
        /* spin */
      }
    }
  }
}

function atomicWriteCountersSync(path: string, counters: AgentsMetaCounters): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(counters, null, 2)}\n`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

export function reconcileStoreCounters(storeDir: string): AgentsMetaCounters {
  const current = readStoreCounters(storeDir);
  const next: AgentsMetaCounters = {
    KP: { ...current.KP },
    KT: { ...current.KT },
  };

  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, type);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const parsed = parseKnowledgeId(readEntryId(join(dir, name)) ?? "");
      if (parsed === null) {
        continue;
      }
      const layerKey: "KP" | "KT" = parsed.layer === "personal" ? "KP" : "KT";
      const typeCode = KNOWLEDGE_TYPE_CODES[parsed.type];
      next[layerKey][typeCode] = Math.max(next[layerKey][typeCode], parsed.counter);
    }
  }

  // ISS-20260713-026: hold counters lock + atomic write so allocate cannot race.
  withCountersFileLockSync(`${storeCountersPath(storeDir)}.lock`, () => {
    // Re-floor under lock against current disk counters + on-disk ids.
    const latest = readStoreCounters(storeDir);
    for (const layer of ["KP", "KT"] as const) {
      for (const code of ["MOD", "DEC", "GLD", "PIT", "PRO"] as const) {
        next[layer][code] = Math.max(next[layer][code], latest[layer][code]);
      }
    }
    atomicWriteCountersSync(storeCountersPath(storeDir), next);
  });
  return next;
}

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  AgentsMetaCountersSchema,
  agentsMetaSchema,
  allocateKnowledgeId,
  defaultAgentsMetaCounters,
  type AgentsMetaCounters,
  type KnowledgeType,
  type Layer,
  type StableId,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

type AgentsMetaShape = {
  revision?: string;
  nodes?: Record<string, unknown>;
  counters?: AgentsMetaCounters;
  [key: string]: unknown;
};

/**
 * v2.0 KnowledgeIdAllocator
 *
 * Wraps the pure `allocateKnowledgeId` allocator with persistence: it reads
 * `agents.meta.json`, advances the counter for the requested (layer, type)
 * pair, and writes the updated meta atomically (write-to-tmp + rename) so
 * concurrent readers always see a consistent file.
 *
 * Counters are MONOTONIC across the lifetime of the meta file: deleting a
 * knowledge entry does NOT free its counter slot, so previously-allocated
 * stable_ids remain unique even after their files are removed.
 *
 * Key invariants:
 *   - Counters envelope is initialized to zeros if absent (v1.x meta compat).
 *   - Each allocate() call performs read → mutate → atomic-write in sequence.
 *   - The returned id is guaranteed to differ from every previously-returned
 *     id for the same meta path.
 */
export class KnowledgeIdAllocator {
  constructor(private readonly metaPath: string) {}

  /**
   * Allocate the next stable_id for the given (layer, type) pair and persist
   * the advanced counter to `agents.meta.json`.
   */
  async allocate(layer: Layer, type: KnowledgeType): Promise<StableId> {
    const meta = await this.readMeta();
    const counters = this.normalizeCounters(meta.counters);
    const { id, nextCounters } = allocateKnowledgeId(layer, type, counters);

    await this.writeMetaAtomic({ ...meta, counters: nextCounters });
    return id;
  }

  /**
   * Returns the current counters envelope, defaulting to all-zero slots when
   * the meta file is absent or pre-v2.0 (counters key missing).
   */
  async getCounters(): Promise<AgentsMetaCounters> {
    const meta = await this.readMeta();
    return this.normalizeCounters(meta.counters);
  }

  // ---- internal helpers ------------------------------------------------

  private async readMeta(): Promise<AgentsMetaShape> {
    let raw: string;
    try {
      raw = await readFile(this.metaPath, "utf8");
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        // Treat missing file as "fresh meta" — caller will allocate from zero.
        return { revision: "", nodes: {} };
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON: fall back to fresh meta rather than corrupting further.
      return { revision: "", nodes: {} };
    }

    // Best-effort schema validation: prefer agentsMetaSchema (which honors
    // optional counters) but fall back to the raw object so non-fatal schema
    // drift does not block allocation.
    const validation = agentsMetaSchema.safeParse(parsed);
    if (validation.success) {
      return validation.data as AgentsMetaShape;
    }
    return (parsed && typeof parsed === "object" ? parsed : {}) as AgentsMetaShape;
  }

  private normalizeCounters(input: unknown): AgentsMetaCounters {
    if (input === undefined || input === null) {
      return defaultAgentsMetaCounters();
    }
    const parsed = AgentsMetaCountersSchema.safeParse(input);
    return parsed.success ? parsed.data : defaultAgentsMetaCounters();
  }

  private async writeMetaAtomic(meta: AgentsMetaShape): Promise<void> {
    await ensureParentDirectory(this.metaPath);
    // atomicWriteJson uses tmp-file + rename under the hood (see
    // packages/shared/src/node/atomic-write.ts) — same pattern as doctor.ts.
    await atomicWriteJson(this.metaPath, meta, { indent: 2 });
  }
}

// ---- module-private utilities ---------------------------------------------

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}

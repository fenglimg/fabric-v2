import { readFile, writeFile } from "node:fs/promises";
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
import { atomicWriteJson, withFileLock } from "@fenglimg/fabric-shared/node/atomic-write";
import { GenericIOError } from "@fenglimg/fabric-shared/errors";

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
    // ISS-013: the read → mutate → atomic-write below must be a single critical
    // section. atomicWriteJson only guarantees readers never see a torn file;
    // it does NOT serialize the R-M-W, so two concurrent allocate() calls (e.g.
    // two windows approving knowledge at once) would both read the same counter
    // and mint a duplicate stable_id. Guard the whole sequence with a
    // cross-process advisory lock keyed on the meta path.
    return withFileLock(`${this.metaPath}.lock`, async () => {
      const meta = await this.readMeta();
      const counters = this.normalizeCounters(meta.counters);
      const { id, nextCounters } = allocateKnowledgeId(layer, type, counters);

      await this.writeMetaAtomic({ ...meta, counters: nextCounters });
      return id;
    });
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
    } catch (err) {
      // ISS-014: a corrupt/truncated agents.meta.json must NOT silently fall
      // back to empty meta — the next allocate() would atomically write that
      // near-empty object back, destroying every node entry. Quarantine the
      // bytes to a `.corrupted.{ts}` sidecar (mirrors event-ledger forensics)
      // and ABORT so the original file is preserved and the caller surfaces the
      // failure instead of overwriting it.
      const corruptedPath = `${this.metaPath}.corrupted.${Date.now()}`;
      try {
        await writeFile(corruptedPath, raw, "utf8");
      } catch {
        // best-effort forensics — never mask the original parse failure
      }
      throw new GenericIOError(
        `agents.meta.json is corrupt and was NOT overwritten (forensic copy: ${corruptedPath}). Parse error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {
          actionHint: `Restore agents.meta.json from version control, or delete it to let Fabric rebuild a fresh meta. Inspect ${corruptedPath} for the corrupt bytes.`,
          details: { metaPath: this.metaPath, corruptedPath },
        },
      );
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

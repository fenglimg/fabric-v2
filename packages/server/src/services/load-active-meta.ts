/**
 * v2.0.0-rc.22 Scope D T-D1: loadActiveMeta — read-path auto-heal helper.
 *
 * Two entry points share the same internal flow but diverge on rebuild
 * failure semantics:
 *
 *   • loadActiveMeta         — STRICT. Throws if buildKnowledgeMeta fails.
 *                              Use from authoritative read paths
 *                              (fab_get_knowledge_sections / fab_get_knowledge
 *                              / fab_extract_knowledge) where silent stale
 *                              data would be worse than a loud error.
 *
 *   • loadActiveMetaOrStale  — GRACEFUL. On rebuild failure, returns the
 *                              on-disk meta unchanged with degraded:true +
 *                              error:string. Use from best-effort hint paths
 *                              (fab_plan_context) where availability matters
 *                              more than strict freshness.
 *
 * Flow (shared):
 *   1. Read on-disk meta via readAgentsMeta (throws on missing/invalid file).
 *   2. Call buildKnowledgeMeta(projectRoot) to compute the derived meta from
 *      the current knowledge tree.
 *   3. Compare on-disk revision against derived revision.
 *      • match  → return { auto_healed: false, meta: on-disk }
 *      • differ → writeKnowledgeMeta to persist the derived meta, invalidate
 *                 the meta cache, emit knowledge_meta_auto_healed event
 *                 (best-effort — wrapped in try/catch so telemetry can't
 *                 break the read path), return { auto_healed: true,
 *                 meta: derived }.
 *
 * The event emission is best-effort because the read path is the hot path —
 * a wedged event ledger must NOT take down knowledge reads. The auto-heal
 * write itself is NOT best-effort (drift on read with no persistence would
 * leave the next call to keep re-healing the same nodes).
 */

import {
  AgentsMetaFileMissingError,
  AgentsMetaInvalidError,
  readAgentsMeta,
} from "../meta-reader.js";
import { contextCache } from "../cache.js";
import type { AgentsMeta } from "@fenglimg/fabric-shared";

import { buildKnowledgeMeta, writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { appendEventLedgerEvent } from "./event-ledger.js";

export type LoadActiveMetaCaller =
  | "planContext"
  | "getKnowledgeSections"
  | "getKnowledge"
  | "extractKnowledge";

export type LoadActiveMetaOptions = {
  caller?: LoadActiveMetaCaller;
};

export type LoadActiveMetaResult = {
  meta: AgentsMeta;
  auto_healed: boolean;
  previous_revision_hash: string;
  revision_hash: string;
};

export type LoadActiveMetaOrStaleResult = LoadActiveMetaResult & {
  degraded: boolean;
  error?: string;
};

/**
 * STRICT variant — throws on rebuild failure.
 *
 * Use from read paths that MUST see a consistent meta or fail loudly:
 *   - fab_get_knowledge_sections
 *   - fab_get_knowledge
 *   - fab_extract_knowledge
 *
 * readAgentsMeta failure (missing/invalid on-disk file) propagates unchanged
 * — strict by definition, and the same surface error v1 callers already see.
 */
export async function loadActiveMeta(
  projectRoot: string,
  opts: LoadActiveMetaOptions = {},
): Promise<LoadActiveMetaResult> {
  const onDisk = await readAgentsMeta(projectRoot);
  const previousRevisionHash = onDisk.revision;

  // buildKnowledgeMeta throws on transient fs errors / unreadable knowledge
  // files. Strict mode lets that propagate so the caller fails loudly.
  const derived = await buildKnowledgeMeta(projectRoot);

  if (derived.meta.revision === previousRevisionHash) {
    return {
      meta: onDisk,
      auto_healed: false,
      previous_revision_hash: previousRevisionHash,
      revision_hash: previousRevisionHash,
    };
  }

  // Drift detected — persist the rebuilt meta in-place. writeKnowledgeMeta
  // re-runs buildKnowledgeMeta internally; the second call sees the same
  // on-disk knowledge tree so the resulting revision matches `derived`.
  const written = await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

  // Invalidate the meta cache so the next readAgentsMeta picks up the new
  // bytes (the cache slot was populated in step 1 above).
  contextCache.invalidate("meta_write", projectRoot);

  await emitAutoHealEventBestEffort(projectRoot, {
    previous_revision_hash: previousRevisionHash,
    revision_hash: written.meta.revision,
    caller: opts.caller,
  });

  return {
    meta: written.meta,
    auto_healed: true,
    previous_revision_hash: previousRevisionHash,
    revision_hash: written.meta.revision,
  };
}

/**
 * GRACEFUL variant — falls back to on-disk meta on rebuild failure.
 *
 * Use from best-effort hint paths (currently: fab_plan_context's narrow-hint
 * fetcher) where serving a slightly stale broad-scope hint is preferable to
 * surfacing a transient fs error to the user.
 *
 * Failure modes:
 *   - readAgentsMeta throws (missing/invalid) → propagates. We cannot return
 *     "stale on-disk meta" when there is no on-disk meta to begin with.
 *   - buildKnowledgeMeta throws → caught, returned as
 *     { degraded: true, error, meta: on-disk, auto_healed: false }.
 *   - writeKnowledgeMeta throws → caught, returned as
 *     { degraded: true, error, meta: on-disk, auto_healed: false }. We do
 *     NOT emit knowledge_meta_auto_healed in this branch because no write
 *     actually landed.
 */
export async function loadActiveMetaOrStale(
  projectRoot: string,
  opts: LoadActiveMetaOptions = {},
): Promise<LoadActiveMetaOrStaleResult> {
  // Missing/invalid on-disk meta is unrecoverable for the graceful variant
  // too — there is no "stale" copy to fall back on. Surface the same error
  // shape readAgentsMeta would have thrown to a direct caller.
  let onDisk: AgentsMeta;
  try {
    onDisk = await readAgentsMeta(projectRoot);
  } catch (error) {
    if (
      error instanceof AgentsMetaFileMissingError ||
      error instanceof AgentsMetaInvalidError
    ) {
      throw error;
    }
    throw error;
  }
  const previousRevisionHash = onDisk.revision;

  let derived;
  try {
    derived = await buildKnowledgeMeta(projectRoot);
  } catch (error) {
    return {
      meta: onDisk,
      auto_healed: false,
      previous_revision_hash: previousRevisionHash,
      revision_hash: previousRevisionHash,
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (derived.meta.revision === previousRevisionHash) {
    return {
      meta: onDisk,
      auto_healed: false,
      previous_revision_hash: previousRevisionHash,
      revision_hash: previousRevisionHash,
      degraded: false,
    };
  }

  // Drift detected — try to persist. If the persist step itself blows up
  // (disk-full, EROFS, etc.) we still want to hand back something usable,
  // so degrade rather than throw.
  let written;
  try {
    written = await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
  } catch (error) {
    return {
      meta: onDisk,
      auto_healed: false,
      previous_revision_hash: previousRevisionHash,
      revision_hash: previousRevisionHash,
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  contextCache.invalidate("meta_write", projectRoot);

  await emitAutoHealEventBestEffort(projectRoot, {
    previous_revision_hash: previousRevisionHash,
    revision_hash: written.meta.revision,
    caller: opts.caller,
  });

  return {
    meta: written.meta,
    auto_healed: true,
    previous_revision_hash: previousRevisionHash,
    revision_hash: written.meta.revision,
    degraded: false,
  };
}

/**
 * Emit the auto-heal audit event without ever propagating a failure to the
 * caller. Telemetry must NEVER take down the read path — a wedged or
 * corrupted ledger should still allow knowledge reads to return.
 */
async function emitAutoHealEventBestEffort(
  projectRoot: string,
  payload: {
    previous_revision_hash: string;
    revision_hash: string;
    caller?: LoadActiveMetaCaller;
  },
): Promise<void> {
  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_meta_auto_healed",
      previous_revision_hash: payload.previous_revision_hash,
      revision_hash: payload.revision_hash,
      trigger: "read",
      ...(payload.caller !== undefined ? { caller: payload.caller } : {}),
    });
  } catch {
    // Intentionally swallowed — see fn header.
  }
}

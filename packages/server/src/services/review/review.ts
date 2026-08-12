/**
 * fab_review / fab_pending facade (ISS-20260713-013).
 * Action implementations live in review-write-actions / review-search;
 * path/sandbox/list helpers in review-shared; frontmatter in review-frontmatter.
 */
import type {
  FabPendingInput,
  FabPendingOutput,
  FabReviewInput,
  FabReviewOutput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";

import { isPendingKnowledgePath } from "./review-path.js";
import {
  triageSearch,
  bindReviewSearchDeps,
  __resetReviewSearchIndexCacheForTests,
  __getReviewSearchIndexCacheStatsForTests,
} from "./review-search.js";
import {
  approveAll,
  rejectAll,
  modifyEntry,
  modifyContentBatch,
  modifyLayerFlip,
  deferAll,
  retireAll,
  bindReviewWriteDeps,
} from "./review-write-actions.js";
import {
  listPending,
  resolveSandboxedPath,
  assertNoSecretsInReviewContent,
  assertCrossStoreRefsSafe,
  emitKnowledgeLifecycleEvent,
  extractBodyTrimmed,
  resolvePersonalRoot,
  storeKnowledgeRoots,
  isUnder,
  realpathExistingPrefix,
  isVisibleByLifecycle,
} from "./review-shared.js";

/**
 * v2.0 rc.3 fab_review service (W3-K K2: WRITE-only).
 *
 * Pure async dispatcher over a discriminated union of 6 WRITE actions (approve,
 * reject, modify, modify-content, modify-layer, defer). The two READ actions
 * (list / search) were lifted out into `reviewPending` (the fab_pending tool) —
 * pure relocation, ZERO behavior change.
 *
 * Approve performs late-bind id allocation (KP-/KT- + type-code + monotonic
 * counter via KnowledgeIdAllocator), emits 2-phase events (knowledge_promote_started
 * → knowledge_promoted | knowledge_promote_failed), and uses git mv to preserve
 * file history when the target lives in the team layer (same repo). Personal
 * layer files use plain fs.rename because they live under ~/.fabric/ outside
 * the project's git tree.
 *
 * Modify implements the only legal stable_id mutation: layer-flip across
 * KP/KT counter spaces. Allocates a new id under the target layer, renames
 * the file across layer roots, emits knowledge_layer_changed.
 */
export async function reviewKnowledge(
  projectRoot: string,
  input: FabReviewInput,
): Promise<FabReviewOutput> {
  switch (input.action) {
    case "approve":
      {
        const { approved, failed } = await approveAll(projectRoot, input.pending_paths);
        return {
          action: "approve",
          approved,
          ...(failed.length > 0 ? { failed } : {}),
        };
      }
    case "reject":
      return {
        action: "reject",
        rejected: await rejectAll(projectRoot, input.pending_paths, input.reason),
      };
    case "modify":
      return await modifyEntry(projectRoot, input.pending_path, input.changes);
    // v2.0.0-rc.37 NEW-12: explicit modify split. Both delegate to modifyEntry
    // (which already branches content-edit vs layer-flip internally); the split
    // makes the SKILL's intent explicit at the call site + lets the contract
    // enforce "content edits never carry a layer flip".
    case "modify-content": {
      // Strip any layer field so this path can never flip layer.
      const { layer: _droppedLayer, ...contentChanges } = input.changes;
      return await modifyEntry(projectRoot, input.pending_path, contentChanges);
    }
    case "modify-layer":
      // changes.layer is REQUIRED by the modify-layer input schema.
      return await modifyEntry(projectRoot, input.pending_path, input.changes);
    // v2.3 batch content-modify: the array-native flush path for the
    // fabric-review maintain loop. Collapses N per-item modify round-trips
    // (each paying a first-reconcile gate wait) into one call.
    case "modify-content-batch":
      return {
        action: "modify-content-batch",
        modified: await modifyContentBatch(projectRoot, input.items),
      };
    case "defer":
      return {
        action: "defer",
        deferred: await deferAll(
          projectRoot,
          input.pending_paths,
          input.until,
          input.reason,
        ),
      };
    // retire (W3-C): mark canonical entries deprecated in place. Same in-place
    // frontmatter-merge path as modify (resolveModifyTarget + rewriteFrontmatterMerge),
    // batched over pending_paths like reject/defer. Never deletes a file.
    case "retire":
      {
        const { retired, failed } = await retireAll(
          projectRoot,
          input.pending_paths,
          input.superseded_by,
          input.reason,
        );
        return {
          action: "retire",
          retired,
          ...(failed.length > 0 ? { failed } : {}),
        };
      }
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * fab_pending service (W3-K K2: READ-only).
 *
 * Pure async dispatcher over the two READ actions (list / search) relocated
 * from `reviewKnowledge`. list browses the store-backed pending backlog;
 * search ranges over BOTH pending and canonical knowledge. Neither mutates
 * state — the fab_pending tool is registered readOnlyHint:true / idempotentHint:true.
 * P1 recall-engine-refactor (TASK-005): search now routes through `triageSearch`,
 * which gates on the substring query then RANKS the matches via the shared
 * rankDescriptionItems('triage') — NO top_k, NO floor, so pending review never
 * silently drops a match. The old substring-only search machine is gone.
 */
export async function reviewPending(
  projectRoot: string,
  input: FabPendingInput,
): Promise<FabPendingOutput> {
  switch (input.action) {
    case "list":
      return {
        action: "list",
        items: await listPending(projectRoot, input.filters),
      };
    case "search":
      return {
        action: "search",
        items: await triageSearch(projectRoot, input.query, input.filters),
      };
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// Wire extracted modules (lazy circular-safe init at load time).
bindReviewWriteDeps({
  resolveSandboxedPath,
  assertNoSecretsInReviewContent,
  assertCrossStoreRefsSafe,
  emitKnowledgeLifecycleEvent,
  extractBodyTrimmed,
  resolvePersonalRoot,
  storeKnowledgeRoots,
  isUnder,
  realpathExistingPrefix,
});

bindReviewSearchDeps({
  isVisibleByLifecycle,
  extractBodyTrimmed,
  resolvePersonalRoot,
});

export function __isPendingKnowledgePathForTest(path: string): boolean {
  return isPendingKnowledgePath(path);
}

export {
  __resetReviewSearchIndexCacheForTests,
  __getReviewSearchIndexCacheStatsForTests,
};

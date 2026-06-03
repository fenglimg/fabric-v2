import { join } from "node:path";

import {
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  storeRelativePath,
} from "@fenglimg/fabric-shared";
import { StoreWriteTargetUnresolvedError } from "@fenglimg/fabric-shared/errors";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1-T2) — cross-store write-side wiring.
// v2.2 全砍 Stage 2 (B2 cutover) — the write path is now STORE-ONLY.
//
// The knowledge write path (extract-knowledge → pending; review approve →
// canonical) historically fell back to the dual-root co-location:
//   team     → <projectRoot>/.fabric/knowledge/...
//   personal → <FABRIC_HOME>/.fabric/knowledge/...
// That fallback is removed. Knowledge now lives ONLY inside the resolved
// write-target store (~/.fabric/stores/<uuid>/). When no target resolves the
// write hard-fails with an actionable StoreWriteTargetUnresolvedError pointing
// at the onboarding commands — never a silent fallback to the retired model.
//
// Pre-req (S1): a per-repo `fabric install` mints the global config + personal
// store, and `fabric store bind` + `switch-write` select the team target, so a
// correctly-onboarded project always resolves a target. The hard-fail only
// fires on a genuinely un-onboarded write.
// ---------------------------------------------------------------------------

function writeTargetUnresolved(layer: "team" | "personal"): StoreWriteTargetUnresolvedError {
  const actionHint =
    layer === "personal"
      ? "run `fabric install --global` to mint your personal store, then retry"
      : "mount + select a team store: `fabric install --global` then `fabric store bind <alias>` and `fabric store switch-write <alias>`, then retry";
  return new StoreWriteTargetUnresolvedError(
    `no ${layer} write-target store resolved — knowledge writes are store-only (dual-root co-location removed)`,
    { actionHint, fixable: true, details: { layer } },
  );
}

function resolveWriteTargetStoreDir(layer: "team" | "personal", projectRoot: string): string {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    throw writeTargetUnresolved(layer);
  }
  // "personal" scope → personal store; any non-personal scope → active write
  // store. The literal scope string only needs to be (non-)personal here.
  const scope = layer === "personal" ? "personal" : "team";
  const { target } = createStoreResolver().resolveWriteTarget(input, scope);
  if (target === null) {
    throw writeTargetUnresolved(layer);
  }
  return join(resolveGlobalRoot(), storeRelativePath(target.store_uuid));
}

// Store-rooted pending base for a layer. Throws StoreWriteTargetUnresolvedError
// when no write-target store resolves (B2 cutover — no dual-root fallback).
export function resolveStorePendingBase(layer: "team" | "personal", projectRoot: string): string {
  return join(resolveWriteTargetStoreDir(layer, projectRoot), STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR);
}

// Store-rooted canonical knowledge base (the per-type subdir is appended by the
// caller) — where review approve promotes a pending entry. Throws when no
// write-target store resolves (B2 cutover — no dual-root fallback). Keeps the
// extract→approve→recall round-trip entirely inside the store.
export function resolveStoreCanonicalBase(layer: "team" | "personal", projectRoot: string): string {
  return join(resolveWriteTargetStoreDir(layer, projectRoot), STORE_LAYOUT.knowledgeDir);
}

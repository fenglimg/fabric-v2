import { join } from "node:path";

import {
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1-T2) — cross-store write-side wiring.
//
// The knowledge write path (extract-knowledge → pending; review approve →
// canonical) historically wrote ONLY to the dual-root co-location:
//   team     → <projectRoot>/.fabric/knowledge/...
//   personal → <FABRIC_HOME>/.fabric/knowledge/...
// Mounted stores under ~/.fabric/stores/<uuid> were never written
// (F-MULTISTORE-UNWIRED / hollow-audit F3 — store write helpers had zero
// server consumers; the write face and read face were physically disconnected).
//
// This resolves the write-target store for a given layer via the SAME resolver
// the CLI scope-explain uses, and returns the store-rooted pending base when a
// target store is resolved. It returns null — preserving the dual-root default
// byte-for-byte — when:
//   - no global config exists (no stores mounted), OR
//   - team layer but no active_write_store is set (resolveWriteTarget → null), OR
//   - personal layer but no personal store is mounted.
//
// So routing only kicks in once the user has actually mounted + selected a
// store, never silently moving knowledge for the dual-root co-location model.
// ---------------------------------------------------------------------------

function resolveWriteTargetStoreDir(
  layer: "team" | "personal",
  projectRoot: string,
): string | null {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return null;
  }
  // "personal" scope → personal store; any non-personal scope → active write
  // store. The literal scope string only needs to be (non-)personal here.
  const scope = layer === "personal" ? "personal" : "team";
  const { target } = createStoreResolver().resolveWriteTarget(input, scope);
  if (target === null) {
    return null;
  }
  return join(resolveGlobalRoot(), storeRelativePath(target.store_uuid));
}

export function resolveStorePendingBase(
  layer: "team" | "personal",
  projectRoot: string,
): string | null {
  const storeDir = resolveWriteTargetStoreDir(layer, projectRoot);
  if (storeDir === null) {
    return null;
  }
  return join(storeDir, STORE_LAYOUT.knowledgeDir, STORE_PENDING_DIR);
}

// v2.1 global-refactor (NEW-APPROVE-PROMOTE) — the approve-side counterpart of
// resolveStorePendingBase. Resolves the canonical knowledge base of the
// write-target store (where review approve promotes the pending entry to), so
// the full extract→approve→recall round-trip stays inside the store instead of
// landing the canonical copy back in the project .fabric (which recall would
// still find, but as a project-local entry, defeating store sharing).
//
// Returns the store's `<storeDir>/knowledge` base (the per-type subdir is
// appended by the caller). null under the SAME conditions as
// resolveStorePendingBase — preserving the dual-root default byte-for-byte when
// no store is selected.
export function resolveStoreCanonicalBase(
  layer: "team" | "personal",
  projectRoot: string,
): string | null {
  const storeDir = resolveWriteTargetStoreDir(layer, projectRoot);
  if (storeDir === null) {
    return null;
  }
  return join(storeDir, STORE_LAYOUT.knowledgeDir);
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  storeRelativePath,
  type MountedStoreDir,
  type RuleDescriptionIndexItem,
} from "@fenglimg/fabric-shared";

import { deriveRuleIdentity, extractRuleDescription } from "./knowledge-meta-builder.js";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1-T1) — cross-store read-side wiring.
//
// The MCP recall path (plan-context.ts) historically read ONLY the project's
// own `.fabric/knowledge` (via agents.meta.json). Mounted stores under
// `~/.fabric/stores/<uuid>/` were never read — `readKnowledgeAcrossStores`
// existed in shared but had zero consumers (F-MULTISTORE-UNWIRED / hollow-audit
// F1). This module is that consumer: it resolves the project's read-set
// (required_stores ∪ implicit personal) and turns each mounted store's raw
// markdown into recall candidates, which plan-context concatenates into its
// candidate corpus so they flow through the same ranking/dedup/top_k pipeline.
//
// Read-set / write-target resolution inputs come from the shared
// `buildStoreResolveInput` (single source shared with the CLI scope-explain and
// the W1-T2 write-side) instead of a hand-rolled config read.
//
// Stores ship NO prebuilt agents.meta (their `.gitignore` excludes it), so each
// candidate's description is built from frontmatter at recall time. Entry ids
// are store-qualified (`<alias>:<stable_id>`) so they (a) never collide with
// project ids in dedup and (b) satisfy the multi-store cite contract (S61
// anti-shadowing — the cite-line-parser already accepts `alias:id`).
// ---------------------------------------------------------------------------

// One walked store entry: its store-qualified id + on-disk file + derived layer.
interface CrossStoreEntry {
  qualifiedId: string; // `<alias>:<stableId>`
  file: string; // absolute path inside the store
  alias: string;
  layer: "team" | "personal";
  source: string; // raw markdown (read once during the walk)
}

// Walk every store in the project's read-set, returning each entry with its
// store-qualified id + file + raw source. Shared by buildCrossStoreRawItems
// (candidate descriptions for recall) and buildCrossStoreBodyIndex (id → file
// for F7 body delivery in get_sections). Returns [] (never throws) when there
// is no global config / no mounted store / a store walk fails — both callers are
// on read paths that must degrade gracefully, never crash.
function walkReadSetStores(projectRoot: string): CrossStoreEntry[] {
  const resolveInput = buildStoreResolveInput(projectRoot);
  if (resolveInput === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(resolveInput);
  if (readSet.stores.length === 0) {
    return [];
  }
  // store_uuid → "personal" | "team" for layer tagging (the read-set entry does
  // not carry the personal flag; the resolver input's mountedStores does).
  const personalUuids = new Set(
    resolveInput.mountedStores.filter((s) => s.personal).map((s) => s.store_uuid),
  );
  const globalRoot = resolveGlobalRoot();
  const dirs: MountedStoreDir[] = readSet.stores.map((entry) => ({
    store_uuid: entry.store_uuid,
    alias: entry.alias,
    dir: join(globalRoot, storeRelativePath(entry.store_uuid)),
  }));

  const entries: CrossStoreEntry[] = [];
  for (const ref of readKnowledgeAcrossStores(dirs)) {
    let source: string;
    try {
      source = readFileSync(ref.file, "utf8");
    } catch {
      continue; // store file vanished between walk and read — skip, don't crash.
    }
    const stableId = deriveRuleIdentity(ref.file, source, undefined).stableId;
    const layer = personalUuids.has(ref.store_uuid) ? "personal" : "team";
    entries.push({
      qualifiedId: `${ref.alias}:${stableId}`,
      file: ref.file,
      alias: ref.alias,
      layer,
      source,
    });
  }
  return entries;
}

/**
 * Build recall candidates from every store in the project's read-set.
 *
 * Returns [] (never throws) when there is no global config, no mounted store in
 * the read-set, or any individual store/file is unreadable — plan-context is on
 * the hot read path and a multi-store hiccup must degrade to project-only
 * recall, not crash the call.
 */
export async function buildCrossStoreRawItems(
  projectRoot: string,
): Promise<RuleDescriptionIndexItem[]> {
  const items: RuleDescriptionIndexItem[] = [];
  for (const entry of walkReadSetStores(projectRoot)) {
    const baseDescription = extractRuleDescription(entry.source);
    if (baseDescription === undefined) {
      continue; // no frontmatter description → no selection signal.
    }
    items.push({
      stable_id: entry.qualifiedId,
      description: { ...baseDescription, knowledge_layer: entry.layer },
    });
  }
  return items;
}

// v2.2 全砍 F7 (HIGH): store-qualified body delivery. Cross-store recall surfaces
// candidates as `<alias>:<stableId>` but their bodies live in the store, NOT in
// the project's agents.meta — so get_sections could only SKIP them (the body was
// never delivered, only the summary was ever visible). This index maps every
// read-set store entry's qualified id → its on-disk file so get_sections can
// read + return the real body, closing the recall→fetch round-trip for store
// (personal + team) knowledge. Returns an empty map (never throws) when no store
// is in the read-set.
export interface CrossStoreBodyRef {
  file: string;
  layer: "team" | "personal";
}

export function buildCrossStoreBodyIndex(
  projectRoot: string,
): Map<string, CrossStoreBodyRef> {
  const index = new Map<string, CrossStoreBodyRef>();
  for (const entry of walkReadSetStores(projectRoot)) {
    if (!index.has(entry.qualifiedId)) {
      index.set(entry.qualifiedId, { file: entry.file, layer: entry.layer });
    }
  }
  return index;
}

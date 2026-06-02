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

  const items: RuleDescriptionIndexItem[] = [];
  for (const ref of readKnowledgeAcrossStores(dirs)) {
    let source: string;
    try {
      source = readFileSync(ref.file, "utf8");
    } catch {
      continue; // store file vanished between walk and read — skip, don't crash.
    }
    const baseDescription = extractRuleDescription(source);
    if (baseDescription === undefined) {
      continue; // no frontmatter description → no selection signal.
    }
    const stableId = deriveRuleIdentity(ref.file, source, undefined).stableId;
    const layer = personalUuids.has(ref.store_uuid) ? "personal" : "team";
    items.push({
      stable_id: `${ref.alias}:${stableId}`,
      description: { ...baseDescription, knowledge_layer: layer },
    });
  }

  return items;
}

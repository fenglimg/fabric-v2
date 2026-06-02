import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createStoreResolver,
  loadGlobalConfig,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  storeRelativePath,
  type MountedStoreDir,
  type RuleDescriptionIndexItem,
  type StoreResolveInput,
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
// Path A (self-resolve at recall time) is used INSTEAD of reading the
// pre-resolved bindings snapshot (`~/.fabric/state/bindings/<project_id>_resolved.json`)
// because `install` does not yet write `project_id` (deeptest F9), so the
// snapshot is itself unwired. Self-resolving from global + project config is
// robust to that gap.
//
// Stores ship NO prebuilt agents.meta (their `.gitignore` excludes it), so each
// candidate's description is built from frontmatter at recall time. Entry ids
// are store-qualified (`<alias>:<stable_id>`) so they (a) never collide with
// project ids in dedup and (b) satisfy the multi-store cite contract (S61
// anti-shadowing — the cite-line-parser already accepts `alias:id`).
// ---------------------------------------------------------------------------

// Read the project's declared required_stores from `.fabric/fabric-config.json`
// (the schema-described, hook-facing config — same file readConflictLintThreshold
// targets). Best-effort: any read/parse failure → no required stores (the
// implicit personal store still resolves).
function readRequiredStores(projectRoot: string): StoreResolveInput["requiredStores"] {
  try {
    const cfgPath = join(projectRoot, ".fabric", "fabric-config.json");
    if (!existsSync(cfgPath)) {
      return [];
    }
    const parsed = JSON.parse(readFileSync(cfgPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const raw = (parsed as { required_stores?: unknown }).required_stores;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") {
        return [];
      }
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) {
        return [];
      }
      const suggestedRemote = (entry as { suggested_remote?: unknown }).suggested_remote;
      return [
        typeof suggestedRemote === "string" && suggestedRemote.length > 0
          ? { id, suggested_remote: suggestedRemote }
          : { id },
      ];
    });
  } catch {
    return [];
  }
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
  const globalConfig = loadGlobalConfig();
  if (globalConfig === null || globalConfig.stores.length === 0) {
    return [];
  }

  const resolveInput: StoreResolveInput = {
    uid: globalConfig.uid,
    mountedStores: globalConfig.stores.map((s) => ({
      store_uuid: s.store_uuid,
      alias: s.alias,
      ...(s.remote !== undefined ? { remote: s.remote } : {}),
      writable: s.writable ?? true,
      personal: s.personal ?? false,
    })),
    requiredStores: readRequiredStores(projectRoot),
  };

  const readSet = createStoreResolver().resolveReadSet(resolveInput);
  if (readSet.stores.length === 0) {
    return [];
  }

  // store_uuid → "personal" | "team" for layer tagging (the read-set entry does
  // not carry the personal flag; the global config does).
  const personalUuids = new Set(
    globalConfig.stores.filter((s) => s.personal === true).map((s) => s.store_uuid),
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

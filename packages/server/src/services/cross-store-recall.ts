import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  loadProjectConfig,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  scopeRoot,
  storeRelativePath,
  type MountedStoreDir,
  type RuleDescriptionIndexItem,
} from "@fenglimg/fabric-shared";

import { deriveRuleIdentity, extractRuleDescription } from "./knowledge-meta-builder.js";
import { sha256 } from "./_shared.js";

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
  // v2.1 global-refactor (W2/A3): the entry's scope coordinate (resolution axis,
  // schemas/scope.ts). Read from frontmatter `semantic_scope`; falls back to the
  // store-derived layer for not-yet-migrated entries (A5 backfills these).
  semanticScope: string;
  source: string; // raw markdown (read once during the walk)
}

// Read the `semantic_scope` frontmatter line, falling back to the layer-derived
// coordinate when absent (pre-migration entries). Line-regex (not full YAML) to
// match the write-side emit shape + the other frontmatter scanners in this repo.
const SEMANTIC_SCOPE_LINE = /^semantic_scope:\s*"?([^"\n]+?)"?\s*$/mu;
function readSemanticScope(source: string, layer: "team" | "personal"): string {
  const match = SEMANTIC_SCOPE_LINE.exec(source);
  return match?.[1] ?? layer;
}

// v2.1 global-refactor (W2/A3) — project-grained recall filter. Given the repo's
// active project (A2 binding), keep only entries whose scope is the CURRENT
// `project:<active>` plus every NON-project coordinate (team/personal/org/...),
// dropping entries专属 to OTHER projects. When the repo has no project binding,
// the filter is a no-op (S20 open-coordinate — an unbound repo sees its read-set
// verbatim). Pure function over the walked entries.
function filterByActiveProject(
  entries: CrossStoreEntry[],
  activeProject: string | undefined,
): CrossStoreEntry[] {
  if (activeProject === undefined || activeProject.length === 0) {
    return entries;
  }
  const current = `project:${activeProject}`;
  return entries.filter(
    (e) => scopeRoot(e.semanticScope) !== "project" || e.semanticScope === current,
  );
}

// The repo's active project coordinate segment (A2), or undefined when unbound.
function activeProjectOf(projectRoot: string): string | undefined {
  const ap = loadProjectConfig(projectRoot)?.active_project;
  return ap !== undefined && ap.length > 0 ? ap : undefined;
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
      semanticScope: readSemanticScope(source, layer),
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
  const activeProject = activeProjectOf(projectRoot);
  for (const entry of filterByActiveProject(walkReadSetStores(projectRoot), activeProject)) {
    const baseDescription = extractRuleDescription(entry.source);
    if (baseDescription === undefined) {
      continue; // no frontmatter description → no selection signal.
    }
    items.push({
      stable_id: entry.qualifiedId,
      description: {
        ...baseDescription,
        knowledge_layer: entry.layer,
        semantic_scope: entry.semanticScope,
      },
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
  const activeProject = activeProjectOf(projectRoot);
  for (const entry of filterByActiveProject(walkReadSetStores(projectRoot), activeProject)) {
    if (!index.has(entry.qualifiedId)) {
      index.set(entry.qualifiedId, { file: entry.file, layer: entry.layer });
    }
  }
  return index;
}

// v2.2 全砍 F10: doctor's opaque-summary lint historically only scanned the
// project agents.meta (team co-location). Post-cutover, canonical knowledge
// lives in stores (team + personal) which carry no agents.meta — so the lint
// would miss every store entry, including the personal layer the dogfood F10
// flagged. This collector reads the read-set stores' knowledge frontmatter
// (store-qualified id + summary) so the opacity inspection can fold them in.
export interface StoreKnowledgeSummary {
  stableId: string; // store-qualified `<alias>:<id>`
  summary: string;
  layer: "team" | "personal";
}

// v2.2 W5 R0 (读侧 cutover): store-corpus revision hash. Replaces the
// co-location `meta.revision` (= sha256 of agents.meta nodes) once co-location
// is retired. Hashes the read-set stores' (qualified id + content sha) in
// sorted order, EXCLUDING pending drafts — structurally mirrors
// knowledge-meta-builder.computeRevision so the value keeps the same semantics:
// a content fingerprint that moves whenever any non-pending knowledge changes.
//
// Consumers: (a) plan-context BM25 corpus cache key (must invalidate when store
// content changes), (b) client stale-detection compare (client_hash !== rev).
// It is NOT load-bearing for the selection_token round-trip: get_sections
// validates against the in-memory token state (ai_selectable_stable_ids), never
// by re-deriving + comparing the revision — so the empty-string fallback
// (sha256("") when no store is in the read-set) is a safe degrade, identical to
// the pre-cutover empty-meta behavior.
export function computeReadSetRevision(projectRoot: string): string {
  const revisionSource = walkReadSetStores(projectRoot)
    .filter((entry) => !entry.file.includes("/knowledge/pending/"))
    .map((entry) => `${entry.qualifiedId}|${sha256(entry.source)}`)
    .sort()
    .join("\n");
  return sha256(revisionSource);
}

export function collectStoreKnowledgeSummaries(projectRoot: string): StoreKnowledgeSummary[] {
  const out: StoreKnowledgeSummary[] = [];
  for (const entry of walkReadSetStores(projectRoot)) {
    const description = extractRuleDescription(entry.source);
    if (description === undefined) {
      continue;
    }
    out.push({
      stableId: entry.qualifiedId,
      summary: description.summary ?? "",
      layer: entry.layer,
    });
  }
  return out;
}

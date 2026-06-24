import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  STORE_LAYOUT,
  buildStoreResolveInput,
  createStoreResolver,
  loadProjectConfig,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  scopeRoot,
  storeRelativePathForMount,
  type MountedStoreDir,
} from "@fenglimg/fabric-shared";

import { deriveRuleIdentity } from "./knowledge-meta-builder.js";

// ---------------------------------------------------------------------------
// W3-H (proposals/05-strategy S6): `fabric audit why-not-surfaced <id>` — a
// self-serve diagnostic for the single most common scope confusion: "why isn't
// THIS knowledge entry showing up?". scope has three independent axes
// (KT-MOD-0001): semantic_scope (audience) × relevance_scope (timing) × store
// (physical lib). Two of them share the "team/broad" vocabulary, so a
// non-surfacing entry has THREE independent failure paths with — before this —
// no unified diagnostic exit. This module answers the first blocking cause.
//
// Read-only: it reuses the SAME read-set resolution the recall path uses
// (buildStoreResolveInput → createStoreResolver.resolveReadSet) and the SAME
// project filter semantics (scopeRoot, mirroring cross-store-recall's
// filterByActiveProject), so its verdict can never drift from what actually
// surfaces. It finds the entry across ALL mounted stores (not just the read-set)
// so an unbound-store entry is still located and explained.
// ---------------------------------------------------------------------------

export type SurfaceVerdict =
  | "not_found"
  | "store_unbound"
  | "project_mismatch"
  | "narrow_timing"
  | "should_surface";

export interface WhyNotSurfacedResult {
  /** The id exactly as queried. */
  query: string;
  /** Normalized LOCAL stable id (store-qualified `alias:ID` → `ID`). */
  localId: string;
  verdict: SurfaceVerdict;
  /** Store the entry physically lives in, or null when not found. */
  storeAlias: string | null;
  /** Whether that store is in this project's read-set (null when not found). */
  storeBound: boolean | null;
  /** Entry's semantic_scope coordinate (audience axis), or null. */
  semanticScope: string | null;
  /** This repo's bound project coordinate segment, or null when unbound. */
  activeProject: string | null;
  /** Entry's relevance_scope (timing axis); defaults to "broad" when absent. */
  relevanceScope: "broad" | "narrow" | null;
}

// Line-regex frontmatter reads (not full YAML) — matches the write-side emit
// shape and the other frontmatter scanners in this repo (cross-store-recall's
// readSemanticScope). Keeps the diagnostic's parse identical to the recall path.
const SEMANTIC_SCOPE_LINE = /^semantic_scope:\s*"?([^"\n]+?)"?\s*$/mu;
const RELEVANCE_SCOPE_LINE = /^relevance_scope:\s*"?(broad|narrow)"?\s*$/mu;

// `alias:KT-DEC-0001` → `KT-DEC-0001`; bare `KT-DEC-0001` → itself. The alias
// and the local stable id never contain a colon, so the first colon splits them.
function toLocalId(query: string): string {
  const i = query.indexOf(":");
  return i === -1 ? query : query.slice(i + 1);
}

// A store knowledge file is named `<stableId>--slug.md` or `<stableId>.md`.
function fileMatchesId(file: string, localId: string): boolean {
  const base = basename(file);
  return base === `${localId}.md` || base.startsWith(`${localId}--`);
}

export async function explainWhyNotSurfaced(
  projectRoot: string,
  query: string,
): Promise<WhyNotSurfacedResult> {
  const localId = toLocalId(query.trim());
  const base: WhyNotSurfacedResult = {
    query,
    localId,
    verdict: "not_found",
    storeAlias: null,
    storeBound: null,
    semanticScope: null,
    activeProject: null,
    relevanceScope: null,
  };

  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return base; // no global config → nothing is mounted → not found
  }

  // Enumerate ALL mounted stores (NOT just the read-set) so an entry in an
  // unbound store is still located — that is precisely the store_unbound verdict.
  const globalRoot = resolveGlobalRoot();
  const allStores: MountedStoreDir[] = input.mountedStores.map((s) => ({
    store_uuid: s.store_uuid,
    alias: s.alias,
    dir: join(globalRoot, storeRelativePathForMount(s)),
  }));

  const refs = await readKnowledgeAcrossStores(allStores);
  const candidate = refs.find((ref) => fileMatchesId(ref.file, localId));
  if (candidate === undefined) {
    return base;
  }

  let source: string;
  try {
    source = await readFile(candidate.file, "utf8");
  } catch {
    return base; // file vanished between walk and read
  }
  // Confirm the on-disk stable id actually matches (filename is a fast prefilter).
  if (deriveRuleIdentity(candidate.file, source, undefined).stableId !== localId) {
    return base;
  }

  const semanticScope = SEMANTIC_SCOPE_LINE.exec(source)?.[1] ?? null;
  const relevanceScope = (RELEVANCE_SCOPE_LINE.exec(source)?.[1] as "broad" | "narrow" | undefined) ?? "broad";
  const activeProject = loadProjectConfig(projectRoot)?.active_project ?? null;

  const boundUuids = new Set(
    createStoreResolver().resolveReadSet(input).stores.map((s) => s.store_uuid),
  );
  const storeBound = boundUuids.has(candidate.store_uuid);

  const found: WhyNotSurfacedResult = {
    ...base,
    storeAlias: candidate.alias,
    storeBound,
    semanticScope,
    activeProject,
    relevanceScope,
  };

  // Report the FIRST blocking cause, in surfacing-pipeline order.
  if (!storeBound) {
    return { ...found, verdict: "store_unbound" };
  }
  // Project filter (G-FILTER): an entry scoped to project:OTHER is dropped only
  // when this repo is bound to a DIFFERENT project. An unbound repo (activeProject
  // null) sees its read-set verbatim — no project filter (S20 open-coordinate).
  if (
    semanticScope !== null &&
    scopeRoot(semanticScope) === "project" &&
    activeProject !== null &&
    semanticScope !== `project:${activeProject}`
  ) {
    return { ...found, verdict: "project_mismatch" };
  }
  if (relevanceScope === "narrow") {
    return { ...found, verdict: "narrow_timing" };
  }
  return { ...found, verdict: "should_surface" };
}

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  loadProjectConfig,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  scopeRoot,
  storeRelativePathForMount,
  type MountedStoreDir,
  type RuleDescriptionIndexItem,
  type StoreKnowledgeRef,
} from "@fenglimg/fabric-shared";

import { deriveRuleIdentity, extractRuleDescription } from "./knowledge-meta-builder.js";
import { extractBody, sha256 } from "./_shared.js";

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
  type: string;
  alias: string;
  layer: "team" | "personal";
  // v2.1 global-refactor (W2/A3): the entry's scope coordinate (resolution axis,
  // schemas/scope.ts). Phase-1 (W1/TASK-002): DERIVED from structural facts —
  // path project id + store layer (readSemanticScope) — with authored
  // `semantic_scope` frontmatter kept only as fallback when structure is absent.
  semanticScope: string;
  // retire (W3-C): true when the entry's frontmatter carries `deprecated: true`.
  // A deprecated entry stays ON DISK (deprecate-over-delete) but is filtered OUT
  // of the surfacing builders (recall candidates + broad SessionStart indexes) by
  // filterOutDeprecated. Parsed once here so every consumer sees the same signal.
  deprecated: boolean;
  /**
   * ISS-20260713-002: cache stores frontmatter-only (or a small head cap), not
   * the full markdown body. Full text is re-read from `file` when a consumer
   * needs the body (collectStoreCanonicalEntries). `contentHash` is the sha256
   * of the full file at walk time for revision fingerprints.
   */
  source: string;
  contentHash: string;
}

interface ReadSetWalkCacheEntry {
  fingerprint: string;
  entries: CrossStoreEntry[];
  lastAccessMs: number;
}

// ISS-20260711-141: bound the walk cache so long-lived MCP servers cannot retain
// every project root's full markdown corpus forever.
const READ_SET_WALK_CACHE_MAX = 8;
const readSetWalkCache = new Map<string, ReadSetWalkCacheEntry>();
let readSetWalkCount = 0;

// ISS-20260711-132: cap concurrent full-file reads on a cold walk.
const READ_SET_WALK_CONCURRENCY = 16;

interface ReadSetSnapshot {
  refs: StoreKnowledgeRef[];
  personalUuids: Set<string>;
}

function readSetWalkCacheKey(projectRoot: string): string {
  return `${projectRoot}\0${process.env.FABRIC_HOME ?? ""}`;
}

function touchReadSetCache(key: string, entry: ReadSetWalkCacheEntry): void {
  entry.lastAccessMs = Date.now();
  // Map preserves insertion order; re-insert to mark as most-recently used.
  readSetWalkCache.delete(key);
  readSetWalkCache.set(key, entry);
  while (readSetWalkCache.size > READ_SET_WALK_CACHE_MAX) {
    const oldest = readSetWalkCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    readSetWalkCache.delete(oldest);
  }
}

// ISS-20260713-012: fingerprint EVERY ref's size/mtime (not one sample file per
// store). Sampling only the first file left content edits on non-sampled paths
// serving stale walk-cache bodies until process restart.
async function readSetFingerprint(refs: StoreKnowledgeRef[]): Promise<string> {
  const structure = refs
    .map((ref) => `${ref.store_uuid}|${ref.alias}|${ref.file}|${ref.type}|${ref.project ?? ""}`)
    .sort()
    .join("\n");
  const contentParts: string[] = [];
  const sorted = [...refs].sort((a, b) => a.file.localeCompare(b.file));
  await mapPool(sorted, READ_SET_WALK_CONCURRENCY, async (ref) => {
    try {
      const fileStat = await stat(ref.file);
      contentParts.push(`${ref.file}|${fileStat.size}|${fileStat.mtimeMs}`);
    } catch {
      contentParts.push(`${ref.file}|missing`);
    }
  });
  contentParts.sort();
  return `${structure}\n--\n${contentParts.join("\n")}`;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}

export function __resetReadSetWalkCacheForTests(): void {
  readSetWalkCache.clear();
  readSetWalkCount = 0;
}

export function __readSetWalkCacheStatsForTests(): { walks: number; entries: number } {
  return {
    walks: readSetWalkCount,
    entries: readSetWalkCache.size,
  };
}

// Line-regex (not full YAML) matching the write-side emit shape + the other
// frontmatter scanners in this repo. Retained as the phase-1 FALLBACK only —
// path-derived structure (project + layer) is now the primary scope source.
const SEMANTIC_SCOPE_LINE = /^semantic_scope:\s*"?([^"\n]+?)"?\s*$/mu;

// retire (W3-C): matches the exact `deprecated: true` frontmatter line the review
// write path emits (rewriteFrontmatterMerge → `deprecated: ${boolean}`). Mirrors
// the SEMANTIC_SCOPE_LINE line-regex convention (whole-line anchor keeps a stray
// body line from false-matching). `deprecated: false` / absent → not deprecated.
const DEPRECATED_LINE = /^deprecated:\s*true\s*$/mu;

// Derive an entry's scope coordinate from STRUCTURAL facts (path project + store
// layer) as the PRIMARY source (C-104 single point), with the authored
// `semantic_scope` frontmatter kept ONLY as a phase-1 fallback when structure is
// absent (removed in phase-2). Precedence:
//   1. personal store → 'personal' — short-circuit BEFORE reading `project`, so a
//      personal entry mis-nested under a projects/-like path can never leak as
//      `project:<id>` (C-105: privacy is store-derived, never scope-inferred).
//   2. shared store with a path-derived project id → `project:<id>` (path wins
//      over any conflicting authored frontmatter — path is the source of truth).
//   3. otherwise → authored `semantic_scope` frontmatter, then 'team'.
function readSemanticScope(
  source: string,
  layer: "team" | "personal",
  project: string | undefined,
): string {
  if (layer === "personal") {
    return "personal";
  }
  if (typeof project === "string" && project.length > 0) {
    return `project:${project}`;
  }
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

// retire (W3-C): drop entries the review retire path marked `deprecated: true`.
// Deprecate-over-delete keeps the file on disk (inspectable via fab_pending /
// doctor / audit), but a retired entry must NOT proactively surface — so the
// SURFACING builders (recall candidates + broad SessionStart indexes/census)
// run their walk output through this filter. The audit/doctor collectors
// (collectStoreCanonicalEntries / collectStoreKnowledgeSummaries) and the
// revision hash (computeReadSetRevision) intentionally do NOT filter, so a
// retired entry stays visible to tooling and its content still moves the hash.
function filterOutDeprecated(entries: CrossStoreEntry[]): CrossStoreEntry[] {
  return entries.filter((entry) => !entry.deprecated);
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
async function resolveReadSetSnapshot(projectRoot: string): Promise<ReadSetSnapshot | null> {
  const resolveInput = buildStoreResolveInput(projectRoot);
  if (resolveInput === null) {
    return null;
  }
  const readSet = createStoreResolver().resolveReadSet(resolveInput);
  if (readSet.stores.length === 0) {
    return null;
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
    dir: join(
      globalRoot,
      storeRelativePathForMount(
        resolveInput.mountedStores.find((s) => s.store_uuid === entry.store_uuid) ?? {
          store_uuid: entry.store_uuid,
        },
      ),
    ),
  }));

  return {
    refs: await readKnowledgeAcrossStores(dirs),
    personalUuids,
  };
}

async function walkReadSetStores(projectRoot: string): Promise<CrossStoreEntry[]> {
  const snapshot = await resolveReadSetSnapshot(projectRoot);
  if (snapshot === null) {
    return [];
  }
  const key = readSetWalkCacheKey(projectRoot);
  const fingerprint = await readSetFingerprint(snapshot.refs);
  const cached = readSetWalkCache.get(key);
  if (cached !== undefined && cached.fingerprint === fingerprint) {
    touchReadSetCache(key, cached);
    return cached.entries.slice();
  }
  const entries = await walkReadSetStoresUncached(snapshot);
  touchReadSetCache(key, { fingerprint, entries, lastAccessMs: Date.now() });
  return entries.slice();
}


/** Keep YAML frontmatter (+ small head) for description extract; drop body for cache. */
function frontmatterHead(source: string, maxChars = 8192): string {
  if (source.startsWith("---")) {
    const end = source.indexOf("\n---", 3);
    if (end !== -1) {
      return source.slice(0, Math.min(end + 4, maxChars));
    }
  }
  return source.length <= maxChars ? source : source.slice(0, maxChars);
}

async function walkReadSetStoresUncached(snapshot: ReadSetSnapshot): Promise<CrossStoreEntry[]> {
  readSetWalkCount += 1;
  // ISS-20260711-132: bounded concurrency instead of one Promise.all per file.
  const entries = await mapPool(
    snapshot.refs,
    READ_SET_WALK_CONCURRENCY,
    async (ref): Promise<CrossStoreEntry | null> => {
      let source: string;
      try {
        source = await readFile(ref.file, "utf8");
      } catch {
        return null; // store file vanished between walk and read — skip, don't crash.
      }
      const stableId = deriveRuleIdentity(ref.file, source, undefined).stableId;
      const layer = snapshot.personalUuids.has(ref.store_uuid) ? "personal" : "team";
      return {
        qualifiedId: `${ref.alias}:${stableId}`,
        file: ref.file,
        type: ref.type,
        alias: ref.alias,
        layer,
        semanticScope: readSemanticScope(source, layer, ref.project),
        deprecated: DEPRECATED_LINE.test(source),
        contentHash: sha256(source),
        // ISS-20260713-002: do not retain full body in the 8-root walk cache.
        source: frontmatterHead(source),
      };
    },
  );
  return entries.filter((entry): entry is CrossStoreEntry => entry !== null);
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
  // retire (W3-C): deprecated entries are excluded from recall candidates.
  for (const entry of filterOutDeprecated(
    filterByActiveProject(await walkReadSetStores(projectRoot), activeProject),
  )) {
    const baseDescription = extractRuleDescription(entry.source);
    if (baseDescription === undefined) {
      continue; // no frontmatter description → no selection signal.
    }
    items.push({
      stable_id: entry.qualifiedId,
      description: {
        ...baseDescription,
        // W4/Track1 (D1): no `knowledge_layer` backfill — a candidate's layer is
        // derived from its stable_id prefix (layerFromStableId in plan-context),
        // the single source of truth (KT-DEC-0004).
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

export async function buildCrossStoreBodyIndex(
  projectRoot: string,
): Promise<Map<string, CrossStoreBodyRef>> {
  const index = new Map<string, CrossStoreBodyRef>();
  const activeProject = activeProjectOf(projectRoot);
  for (const entry of filterByActiveProject(await walkReadSetStores(projectRoot), activeProject)) {
    if (!index.has(entry.qualifiedId)) {
      index.set(entry.qualifiedId, { file: entry.file, layer: entry.layer });
    }
  }
  return index;
}

// v2.2 dual-sink (Goal A / D9): the "always-active" knowledge subset surfaced in
// the SessionStart AI sink as INDEX lines (title + summary, body on demand —
// KT-DEC-0036; eager-body injection retired). Per the rev4.4 §3 AI-sink contract
// the always-active types are guidelines + models — the standing rules (code
// style, domain models) that apply UNCONDITIONALLY; decisions / pitfalls /
// processes are situational REFERENCE (surfaced as title + must_read_if, Read on
// demand when a trigger fires). BROAD-only on both sides (KT-DEC-0029): narrow
// guideline/model is filtered out here and surfaces via the PreToolUse narrow
// hint, never as an unconditional rule.
//
// NOTE (Goal-A boundary): store candidates carry `relevance_scope` (broad|narrow)
// but NOT `activation.tier` (always|path|description) — the latter lives on the
// retired co-location meta-node, and converging the two axes is explicitly Goal
// B. So "always-active" is resolved here by knowledge_type, the only signal
// present on every store entry today. When Goal B lands activation.tier on store
// frontmatter, this selector should switch to `tier === "always"`.
const ALWAYS_ACTIVE_TYPES = new Set(["guidelines", "models"]);

export interface AlwaysActiveBody {
  /** store-qualified id (`<alias>:<stableId>`). */
  stable_id: string;
  /** knowledge_type — one of ALWAYS_ACTIVE_TYPES. */
  type: string;
  layer: "team" | "personal";
  /** description.summary — the overflow-degrade fallback when the body cannot
   *  fit the injection char budget (the budget is enforced hook-side, D10). */
  summary: string;
  /**
   * ISS-20260713-014 / KT-DEC-0036: SessionStart wire is index-only.
   * Body is empty on this path; full text via Read/fab_recall.
   * Field retained for wire compatibility.
   */
  body: string;
}

/**
 * Collect the always-active (guidelines + models) entries from the project's
 * read-set, project-filtered identically to recall (filterByActiveProject), with
 * their frontmatter-stripped bodies. The SessionStart hook injects these bodies
 * into the AI context and renders category counts for the on-demand remainder.
 *
 * Returns [] (never throws) on any read-set resolution failure — the SessionStart
 * banner must degrade gracefully, never crash session start.
 */
// v2.2 dual-sink (Goal A / D8): an UNSLICED census of the project's read-set,
// grouped by knowledge_type + layer, with the count of OTHER-project entries the
// recall filter dropped. The SessionStart human sink renders this as the grouped
// "what knowledge exists" banner (always-loaded vs on-demand split + [team]/
// [personal] + ✗ dropped). Distinct from plan-context-hint's `entries`, which are
// top_k-sliced for the AI candidate list and cannot report full per-type totals.
export interface KnowledgeCensus {
  /** knowledge_type → count (decisions/pitfalls/guidelines/models/processes). */
  by_type: Record<string, number>;
  // semantic_scope buckets: `team`/`personal` keyed on the physical layer, plus a
  // `project` bucket for `project:<active>`-scoped entries (A1/KT-MOD-0001 — a
  // project entry lives in a team store but is its own audience, not team-wide).
  by_layer: { team: number; personal: number; project: number };
  // v2.2 HUD (Goal H1): relevance_scope slice of by_type. The SessionStart human
  // sink is scope-primary (KT-DEC-0029: SessionStart shows BROAD only; narrow
  // surfaces via the PreToolUse hint). `broad_by_type` counts ONLY broad entries
  // per knowledge_type — its sum is the "本会话注入" spine size — and `narrow_total`
  // is the file-specific remainder. Invariant: sum(broad_by_type) + narrow_total
  // == total (every store entry is typed + classified broad|narrow). Existing
  // `by_type`/`by_layer`/`total` stay unsliced for backward compatibility.
  broad_by_type: Record<string, number>;
  /** count of narrow-scope kept entries (file-specific; only合计, not per-type). */
  narrow_total: number;
  /** entries专属 to OTHER projects that filterByActiveProject removed. */
  dropped_other_project: number;
  /** kept (post-filter) total. */
  total: number;
}

/**
 * Build the read-set census (project-filtered counts + dropped-other-project).
 * Reuses the cached read-set walk, so calling alongside buildAlwaysActiveBodies
 * in one SessionStart fire costs a single walk. Never throws — degrades to an
 * all-zero census so the banner stays renderable.
 */
export async function buildKnowledgeCensus(projectRoot: string): Promise<KnowledgeCensus> {
  const census: KnowledgeCensus = {
    by_type: {},
    by_layer: { team: 0, personal: 0, project: 0 },
    broad_by_type: {},
    narrow_total: 0,
    dropped_other_project: 0,
    total: 0,
  };
  try {
    const activeProject = activeProjectOf(projectRoot);
    // retire (W3-C): drop deprecated entries BEFORE the project split so they are
    // absent from every census count and never inflate dropped_other_project
    // (which should reflect only live, other-project drops).
    const all = filterOutDeprecated(await walkReadSetStores(projectRoot));
    const kept = filterByActiveProject(all, activeProject);
    census.dropped_other_project = all.length - kept.length;
    for (const entry of kept) {
      const desc = extractRuleDescription(entry.source);
      const type = desc?.knowledge_type;
      // relevance_scope slice (KT-DEC-0029): narrow == file-specific, everything
      // else (incl. undefined) is broad — same predicate buildAlwaysActiveBodies
      // uses, so the spine size stays consistent across both sinks.
      const isNarrow = desc?.relevance_scope === "narrow";
      if (typeof type === "string") {
        census.by_type[type] = (census.by_type[type] ?? 0) + 1;
        if (!isNarrow) {
          census.broad_by_type[type] = (census.broad_by_type[type] ?? 0) + 1;
        }
      }
      if (isNarrow) census.narrow_total += 1;
      // Project-scoped entries get their own bucket (they physically live in a
      // team store but are a distinct audience); everything else folds into its
      // physical layer (team/personal).
      if (scopeRoot(entry.semanticScope) === "project") {
        census.by_layer.project += 1;
      } else {
        census.by_layer[entry.layer] += 1;
      }
      census.total += 1;
    }
  } catch {
    // degrade to all-zero census
  }
  return census;
}

export async function buildAlwaysActiveBodies(
  projectRoot: string,
): Promise<AlwaysActiveBody[]> {
  const out: AlwaysActiveBody[] = [];
  try {
    const activeProject = activeProjectOf(projectRoot);
    // retire (W3-C): deprecated entries never enter the broad always-active index.
    for (const entry of filterOutDeprecated(
      filterByActiveProject(await walkReadSetStores(projectRoot), activeProject),
    )) {
      const desc = extractRuleDescription(entry.source);
      if (desc === undefined) continue;
      const type = desc.knowledge_type;
      if (typeof type !== "string" || !ALWAYS_ACTIVE_TYPES.has(type)) continue;
      // SessionStart invariant: both sinks show BROAD only — narrow stays silent
      // here and surfaces contextually via the PreToolUse narrow hint. Without
      // this, a narrow guideline/model would leak into "always-active" and be
      // presented as an unconditional rule, contradicting its narrow scope.
      // (knowledge_type is today's always-active proxy; when Goal B lands
      // activation.tier this whole selector switches to tier === "always".)
      if (desc.relevance_scope === "narrow") continue;
      out.push({
        stable_id: entry.qualifiedId,
        type,
        layer: entry.layer,
        summary: typeof desc.summary === "string" ? desc.summary : "",
        // ISS-20260713-014: do not serialize full markdown on SessionStart wire.
        body: "",
      });
    }
  } catch {
    return [];
  }
  return out;
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
export async function computeReadSetRevision(projectRoot: string): Promise<string> {
  const revisionSource = (await walkReadSetStores(projectRoot))
    .filter((entry) => !entry.file.includes("/knowledge/pending/"))
    .map((entry) => `${entry.qualifiedId}|${entry.contentHash}`)
    .sort()
    .join("\n");
  return sha256(revisionSource);
}

// v2.2 W5 R6 (读侧 cutover): canonical (non-pending) store entries with their
// LOCAL stable_id, store-qualified id, layer, raw body, and parsed frontmatter
// description. Replaces the co-location `readAgentsMeta().nodes` walk that
// doctor-conflict (knowledge_type + body for the conflict lint) and
// doctor-cite-coverage (relevance_paths / relevance_scope for the cite
// denominator) used to do. Skips pending drafts (curated corpus only) and any
// entry with no parseable frontmatter description. Never throws — degrades to []
// when no store is in the read-set, mirroring the other collectors here.
export interface StoreCanonicalEntry {
  stableId: string; // LOCAL stable_id (e.g. "KT-DEC-0001"), from frontmatter id
  qualifiedId: string; // `<alias>:<stableId>`
  file: string; // absolute path inside the mounted store
  type: string; // canonical store knowledge type directory
  layer: "team" | "personal";
  body: string; // raw markdown (frontmatter included; callers strip as needed)
  description: NonNullable<ReturnType<typeof extractRuleDescription>>;
}

export async function collectStoreCanonicalEntries(projectRoot: string): Promise<StoreCanonicalEntry[]> {
  const out: StoreCanonicalEntry[] = [];
  for (const entry of await walkReadSetStores(projectRoot)) {
    if (entry.file.includes("/knowledge/pending/")) {
      continue; // curated corpus only — drafts are not canonical.
    }
    const description = extractRuleDescription(entry.source);
    if (description === undefined) {
      continue;
    }
    // ISS-20260713-002: body is not in the walk cache — re-read for callers that need it.
    let body = entry.source;
    try {
      body = await readFile(entry.file, "utf8");
    } catch {
      /* keep head */
    }
    out.push({
      stableId: entry.qualifiedId.slice(entry.alias.length + 1),
      qualifiedId: entry.qualifiedId,
      file: entry.file,
      type: entry.type,
      layer: entry.layer,
      body,
      description,
    });
  }
  return out;
}

export async function collectStoreKnowledgeSummaries(projectRoot: string): Promise<StoreKnowledgeSummary[]> {
  const out: StoreKnowledgeSummary[] = [];
  for (const entry of await walkReadSetStores(projectRoot)) {
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

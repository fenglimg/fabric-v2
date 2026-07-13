/**
 * ISS-20260713-013: fab_pending search (extracted from review.ts).
 */
import { join, relative, resolve, sep } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

import type { RuleDescription, RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";
import type { KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  buildScoringContext,
  rankDescriptionItems,
  type ScoringContext,
} from "./plan-context.js";
import { computeReadSetRevision } from "./cross-store-recall.js";
import {
  resolveStoreCanonicalBase,
  resolveStorePendingBase,
} from "./cross-store-write.js";
import { extractBody } from "./_shared.js";
import { parseFrontmatter, type ParsedFrontmatter } from "./review-frontmatter.js";

// --- Types mirrored from review.ts (kept local to avoid circular imports) ---
type PluralType = KnowledgeType;
type Layer = "team" | "personal";
type Maturity = "draft" | "verified" | "proven";
type LifecycleStatus = "active" | "rejected" | "deferred";

const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

type ListFilters = {
  type?: PluralType;
  layer?: Layer | "both";
  maturity?: Maturity;
  tags?: string[];
  include_rejected?: boolean;
  include_deferred?: boolean;
  include_body?: boolean;
  created_after?: string;
};

type SearchItem = {
  path: string;
  area: "pending" | "canonical";
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  title?: string;
  summary?: string;
  tags?: string[];
  body?: string;
  pending_path?: string;
  score?: number;
};

// Injected deps from review.ts to avoid circular imports / massive helper move.
export type ReviewSearchDeps = {
  isVisibleByLifecycle: (
    fm: ParsedFrontmatter,
    filters: ListFilters | undefined,
  ) => boolean;
  extractBodyTrimmed: (content: string) => string;
  resolvePersonalRoot: () => string;
};


let deps: ReviewSearchDeps | null = null;

/** Wire helpers from review.ts once at module load of review.ts */
export function bindReviewSearchDeps(d: ReviewSearchDeps): void {
  deps = d;
}

function D(): ReviewSearchDeps {
  if (!deps) throw new Error("review-search: bindReviewSearchDeps not called");
  return deps;
}


// ---------------------------------------------------------------------------
// search action (TASK-002)
//
// Walks pending + canonical (team + personal) trees, parses frontmatter, and
// applies filters. Search keeps a process-local per-file index keyed by mtime
// and size so repeated queries do not reread and reparse the whole corpus.
// ---------------------------------------------------------------------------

type SearchSource = {
  root: string;
  isPending: boolean;
  isPersonal: boolean;
  isStore: boolean;
};

type IndexedSearchEntry = {
  name: string;
  absolutePath: string;
  type: PluralType;
  source: SearchSource;
  fm: ParsedFrontmatter;
  layer: Layer;
  maturity: Maturity;
  body: string;
};

type SearchEntryCacheRecord = {
  fingerprint: string;
  entry: IndexedSearchEntry;
};

type SearchDirectoryCache = {
  files: Map<string, SearchEntryCacheRecord>;
};

const SEARCH_INDEX_CACHE_MAX_DIRS = 256;
const searchEntryIndexCache = new Map<string, SearchDirectoryCache>();
let searchEntryIndexContentReads = 0;

export function __resetReviewSearchIndexCacheForTests(): void {
  searchEntryIndexCache.clear();
  searchEntryIndexContentReads = 0;
}

export function __getReviewSearchIndexCacheStatsForTests(): {
  directories: number;
  indexedFiles: number;
  contentReads: number;
} {
  let indexedFiles = 0;
  for (const directoryCache of searchEntryIndexCache.values()) {
    indexedFiles += directoryCache.files.size;
  }
  return {
    directories: searchEntryIndexCache.size,
    indexedFiles,
    contentReads: searchEntryIndexContentReads,
  };
}

export function getSearchDirectoryCache(cacheKey: string): SearchDirectoryCache {
  const cached = searchEntryIndexCache.get(cacheKey);
  if (cached !== undefined) {
    searchEntryIndexCache.delete(cacheKey);
    searchEntryIndexCache.set(cacheKey, cached);
    return cached;
  }

  const created: SearchDirectoryCache = { files: new Map() };
  searchEntryIndexCache.set(cacheKey, created);
  while (searchEntryIndexCache.size > SEARCH_INDEX_CACHE_MAX_DIRS) {
    const lru = searchEntryIndexCache.keys().next().value;
    if (lru === undefined) break;
    searchEntryIndexCache.delete(lru);
  }
  return created;
}

export async function listIndexedSearchEntries(
  source: SearchSource,
  type: PluralType,
): Promise<IndexedSearchEntry[]> {
  const dir = join(source.root, type);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const cacheKey = `${dir}|${source.isPending ? "pending" : "canonical"}|${source.isPersonal ? "personal" : "team"}|${source.isStore ? "store" : "local"}`;
  const directoryCache = getSearchDirectoryCache(cacheKey);
  const seen = new Set<string>();
  const indexed: IndexedSearchEntry[] = [];

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const absolutePath = join(dir, name);
    let fingerprint: string;
    try {
      const st = await stat(absolutePath);
      if (!st.isFile()) continue;
      fingerprint = `${st.size}:${st.mtimeMs}`;
    } catch {
      continue;
    }

    seen.add(absolutePath);
    const cached = directoryCache.files.get(absolutePath);
    if (cached !== undefined && cached.fingerprint === fingerprint) {
      indexed.push(cached.entry);
      continue;
    }

    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
      searchEntryIndexContentReads += 1;
    } catch {
      directoryCache.files.delete(absolutePath);
      continue;
    }

    const fm = parseFrontmatter(content);
    const entry: IndexedSearchEntry = {
      name,
      absolutePath,
      type,
      source,
      fm,
      layer: fm.layer ?? (source.isPersonal ? "personal" : "team"),
      maturity: fm.maturity ?? "draft",
      body: D().extractBodyTrimmed(content),
    };
    directoryCache.files.set(absolutePath, { fingerprint, entry });
    indexed.push(entry);
  }

  for (const cachedPath of directoryCache.files.keys()) {
    if (!seen.has(cachedPath)) {
      directoryCache.files.delete(cachedPath);
    }
  }

  return indexed;
}

// P1 recall-engine-refactor (TASK-005): the substring relevance GATE for triage
// search. A reviewer searching "auth" wants the auth entries, not the whole
// corpus — so query-matching is what defines a "match" / "candidate". The
// UNIFIED ranker (rankDescriptionItems triage mode) then ORDERS the matches and
// — crucially — applies NO top_k and NO floor, so pending review never silently
// drops a match (守 KT-DEC-0019 no-server-filter). Mirrors the prior search
// haystack: title || summary || tags || filename (+ body when include_body).
export function matchesTriageQuery(
  indexed: IndexedSearchEntry,
  lowerQuery: string,
  includeBody: boolean,
): boolean {
  const haystacks = [
    indexed.fm.title ?? "",
    indexed.fm.summary ?? "",
    ...(indexed.fm.tags ?? []),
    indexed.name,
    includeBody ? indexed.body : "",
  ].map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(lowerQuery));
}

// P1 recall-engine-refactor (TASK-005): pending/canonical → ranker item adapter.
// A pending DRAFT carries fewer frontmatter fields than a recall candidate, so
// every field the ranker reads degrades gracefully (never crash, never
// fabricate): maturity ?? 'draft', relevance_paths ?? [], summary ?? title ??
// filename, and a MISSING created_at adds no recency boost (the scorer already
// no-ops on an absent/unparseable created_at — we simply pass it through rather
// than inventing a date). The `stable_id` key is the absolute path (unique per
// entry; pending drafts have no real id yet) so the ranker can de-dupe and the
// caller can map ranked items back to their SearchItem.
export function pendingEntryToRankerItem(indexed: IndexedSearchEntry): RuleDescriptionIndexItem {
  const { fm, name } = indexed;
  const slug = name.replace(/\.md$/u, "");
  const summary = fm.summary ?? fm.title ?? slug;
  const description: RuleDescription = {
    summary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: fm.title ?? summary,
    ...(fm.id !== undefined ? { id: fm.id } : {}),
    ...(fm.type !== undefined ? { knowledge_type: fm.type } : {}),
    maturity: fm.maturity ?? "draft",
    // W4/Track1 (D1): no `knowledge_layer` field — layer is derived from the
    // stable_id prefix (KT-DEC-0004), never carried on the description.
    ...(fm.semantic_scope !== undefined ? { semantic_scope: fm.semantic_scope } : {}),
    ...(fm.created_at !== undefined ? { created_at: fm.created_at } : {}),
    tags: fm.tags ?? [],
    relevance_scope: fm.relevance_scope ?? "broad",
    relevance_paths: fm.relevance_paths ?? [],
  };
  return { stable_id: indexed.absolutePath, description };
}

// P1 recall-engine-refactor (TASK-005): fab_pending search runs through the
// UNIFIED triage ranker. The old substring-only `.includes()`
// machine is GONE — query-matching is now just the relevance GATE, and the
// shared rankDescriptionItems('triage') orders the matches with no top_k/floor.
export async function triageSearch(
  projectRoot: string,
  query: string,
  filters: ListFilters | undefined,
): Promise<SearchItem[]> {
  const lowerQuery = query.toLowerCase();
  const includeBody = filters?.include_body === true;

  // v2.2 全砍 Stage 2 (B2 cutover): search scans pending + canonical (+ rejected
  // when opted in) INSIDE the resolved write-target stores (team + personal) — no
  // dual-root. Each layer is resolved defensively so an un-onboarded layer is
  // skipped rather than crashing the read. Store entries are reported by
  // absolute path.
  const sources: SearchSource[] = [];
  for (const layer of ["team", "personal"] as const) {
    const isPersonal = layer === "personal";
    try {
      const pendingRoot = resolveStorePendingBase(layer, projectRoot);
      sources.push({ root: pendingRoot, isPending: true, isPersonal, isStore: true });
      if (filters?.include_rejected === true) {
        sources.push({
          root: pendingRoot.replace(`${sep}pending`, `${sep}rejected`),
          isPending: true,
          isPersonal,
          isStore: true,
        });
      }
    } catch {
      // no pending store for this layer — skip.
    }
    try {
      sources.push({ root: resolveStoreCanonicalBase(layer, projectRoot), isPending: false, isPersonal, isStore: true });
    } catch {
      // no canonical store for this layer — skip.
    }
  }

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  // ------ corpus prep: walk sources, apply the layer/maturity/tags/created_after
  // + lifecycle filters (migrated verbatim from the prior search), then the
  // substring query GATE. Each surviving entry is adapted into a ranker item,
  // keyed by absolute path so the ranked output maps back to its SearchItem. ------
  const matchedByKey = new Map<string, { indexed: IndexedSearchEntry; source: SearchSource; type: PluralType }>();
  const rankerItems: RuleDescriptionIndexItem[] = [];

  for (const source of sources) {
    for (const type of typesToScan) {
      for (const indexed of await listIndexedSearchEntries(source, type)) {
        const { fm, layer, maturity } = indexed;

        // Filter: layer
        if (filters?.layer !== undefined && filters.layer !== "both" && filters.layer !== layer) {
          continue;
        }
        // Filter: maturity
        if (filters?.maturity !== undefined && filters.maturity !== maturity) {
          continue;
        }
        // Filter: tags subset
        if (filters?.tags !== undefined && filters.tags.length > 0) {
          const itemTags = fm.tags ?? [];
          const hasAll = filters.tags.every((t) => itemTags.includes(t));
          if (!hasAll) continue;
        }
        // rc.4 TASK-006 fix (c): created_after threshold (mirrors D().listPending).
        if (filters?.created_after !== undefined) {
          const createdAt = fm.created_at;
          if (createdAt === undefined || createdAt < filters.created_after) {
            continue;
          }
        }

        // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): mirror D().listPending's lifecycle
        // visibility default. Search shares the same hide-rejected /
        // hide-future-deferred semantics so callers don't see different
        // populations from the two read APIs.
        if (!D().isVisibleByLifecycle(fm, filters)) {
          continue;
        }

        // Substring relevance GATE (the "match" definition). Triage ranking
        // below adds NO further cut, so a gated match is never silently dropped.
        if (!matchesTriageQuery(indexed, lowerQuery, includeBody)) continue;

        const item = pendingEntryToRankerItem(indexed);
        matchedByKey.set(item.stable_id, { indexed, source, type });
        rankerItems.push(item);
      }
    }
  }

  if (rankerItems.length === 0) {
    return [];
  }

  // ------ rank the matches through the UNIFIED ranker in 'triage' mode (NO
  // top_k, NO floor — completeness for the reviewer). The scoring context is
  // built by the SAME helper fab_recall uses, so triage and recall rank over
  // identical BM25/vector/scope/fusion signals. The corpus fingerprint keys the
  // on-disk BM25 cache (mirrors plan-context's read-set revision key). ------
  let revision: string;
  try {
    revision = await computeReadSetRevision(projectRoot);
  } catch {
    revision = "triage-search";
  }
  const scoringContext: ScoringContext = await buildScoringContext(projectRoot, revision, rankerItems, {
    queryText: query,
    targetPaths: [],
  });
  const ranked = rankDescriptionItems(rankerItems, scoringContext, "triage");

  // ------ map ranked items back to SearchItems (ranked order preserved). ------
  const items: SearchItem[] = [];
  for (const { item } of ranked) {
    const match = matchedByKey.get(item.stable_id);
    if (match === undefined) continue; // defensive — every ranked item was matched
    const { indexed, source, type } = match;
    const { absolutePath, fm, layer, maturity } = indexed;

    // v2.2 全砍: store entries (all entries now) report by absolute path —
    // they live in a store repo outside both the project + personal roots.
    const reportedPath = source.isStore
      ? absolutePath
      : source.isPersonal
        ? `~/${relative(D().resolvePersonalRoot(), absolutePath)}`
        : relative(projectRoot, absolutePath);

    // v2.0.0-rc.29 TASK-007 (BUG-M4): emit the new search-item shape.
    // `area` is the authoritative pending-vs-canonical discriminator;
    // `path` replaces the misleading `pending_path` field. Personal hits add
    // `path_absolute` (mirrors list's `pending_path_absolute`).
    items.push({
      area: source.isPending ? "pending" : "canonical",
      path: reportedPath,
      ...(source.isPersonal ? { path_absolute: absolutePath } : {}),
      type,
      layer,
      maturity,
      // Only pending entries carry an origin tag (canonical hits live
      // outside the dual-pending-root convention).
      ...(source.isPending ? { origin: source.isPersonal ? ("personal" as const) : ("team" as const) } : {}),
      ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
      ...(fm.title !== undefined ? { title: fm.title } : {}),
      ...(fm.summary !== undefined ? { summary: fm.summary } : {}),
      ...(fm.status !== undefined ? { status: fm.status } : {}),
      ...(fm.deferred_until !== undefined ? { deferred_until: fm.deferred_until } : {}),
      // v2.0.0-rc.27 TASK-006 (audit §2.23): body emission when opted in.
      ...(includeBody ? { body: indexed.body } : {}),
      // Canonical hits always have an id; pending hits typically don't yet —
      // surface the frontmatter id when present so consumers can dedupe.
      ...(fm.id !== undefined ? { stable_id: fm.id } : {}),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// defer action
//
// v2.0.0-rc.27 TASK-001 (§2.3): writes `status: deferred` + `deferred_until`
// to the pending file's frontmatter so list/search hide the entry until the
// deferred_until threshold passes. Mirrors the reject action's frontmatter
// authoring pattern — both lifecycle mutations are dual-write (ledger event
// + frontmatter cache) so consumers don't need to walk the ledger.
//
// When `until` is omitted the caller didn't request a time gate; we still
// write status=deferred so list/search can hide the entry, but list will
// surface it again at the next manual filter relaxation
// (filters.include_deferred=true).
// ---------------------------------------------------------------------------


import { minimatch } from "minimatch";

import { deriveAgentsMetaLayer, type RuleDescription, type RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { readSelectionTokenTtlMs } from "../config-loader.js";
import { type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { loadActiveMetaOrStale } from "./load-active-meta.js";
import { reconcileKnowledge } from "./knowledge-sync.js";

export type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
  // v2.0-rc.5 C3 (TASK-012): caller-supplied path context for relevance_paths
  // filtering. `narrow` description_index entries are only surfaced when at
  // least one of their `relevance_paths` globs matches at least one entry in
  // `target_paths`. When omitted or empty, the filter fails open and every
  // narrow entry is included (matches the rc.5 D1 hint CLI behavior).
  target_paths?: string[];
};

// v2.0-rc.5 A3 (TASK-007): Cocos-era profile inference retired. The profile
// is now a neutral path/intent echo — no UI/Gameplay/Asset hardcoded domains,
// no Chinese game-perf token list, no Performance regex.
export type RequirementProfile = {
  target_path: string;
  path_segments: string[];
  extension: string;
  known_tech: string[];
  user_intent: string;
  detected_entities: string[];
};

// v2.0-rc.5 A3 (TASK-007): per-entry shape drops the legacy L0/L1/L2 selection
// ceremony (required_stable_ids / ai_selectable_stable_ids /
// initial_selected_stable_ids / selection_policy).
//
// v2.0-rc.7 T9: degenerate single-stage mode (≤30 entries inlined as
// `candidates_full_content`) removed. The shape is now symmetric across all
// candidate counts: every response returns `description_index` + a
// `selection_token`, and the Agent follows up with `fab_get_knowledge_sections`
// to fetch bodies. Rationale: the inline-body branch silently bypassed
// `knowledge_consumed` event emission, breaking rc.5 C5 closure. See
// docs/decisions/rc5-a3-superseded.md.
export type PlanContextEntry = {
  path: string;
  requirement_profile: RequirementProfile;
  description_index: RuleDescriptionIndexItem[];
};

export type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: PlanContextEntry[];
  shared: {
    description_index: RuleDescriptionIndexItem[];
    preflight_diagnostics: Array<{
      code: "missing_description";
      severity: "warn";
      message: string;
      stable_ids?: string[];
      path?: string;
    }>;
  };
  // v2.0.0-rc.22 Scope D T-D2: optional auto-heal banner fields. Surfaced ONLY
  // when loadActiveMetaOrStale detected drift between on-disk meta and the
  // derived knowledge tree and rebuilt the meta in-place. Omitted (undefined)
  // when the meta was already fresh — keeps the wire shape minimal in the
  // common case. Downstream CLI shim (rc.22 T-D3) reads this pair to render
  // a one-line banner without querying the event ledger.
  auto_healed?: boolean;
  previous_revision_hash?: string;
};

export type SelectionTokenState = {
  token: string;
  revision_hash: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  created_at: number;
  expires_at: number;
};

// v2.0.0-rc.29 TASK-008 (BUG-F3): default selection_token TTL. Overridable
// at runtime via fabric.config.json's `selection_token_ttl_ms` (per
// projectRoot). The default 5 minutes matches the pre-rc.29 hard-coded value.
const SELECTION_TOKEN_TTL_DEFAULT_MS = 5 * 60 * 1000;
// v2.0-rc.7 T9: degenerate-mode threshold removed — the API is now symmetric
// across all candidate counts. See docs/decisions/rc5-a3-superseded.md.
const selectionTokenCache = new Map<string, SelectionTokenState>();

/**
 * v2.0.0-rc.27 TASK-002 (audit §2.22): sandbox each caller-supplied path
 * before it reaches downstream consumers. plan_context currently only echoes
 * paths into requirement_profile.path_segments and the description_index
 * matcher — but two of its downstream calls (knowledge-meta-builder
 * relevance-paths glob matching, plus the rc.5 D1 hint CLI) DO take the
 * path further. A traversal like `../../../etc/passwd` slips through
 * `normalizeKnowledgePath` (slash-only normalization) and would land in
 * those callers as an absolute escape vector when the next iteration of
 * relevance_paths glob matching adds prefix anchoring.
 *
 * Allowed shapes:
 *   - relative paths under the project root: `src/foo.ts`, `a/b/c.md`
 *   - the `**` sentinel (used by --all to probe broad/cross-cutting entries)
 *   - the bare `*` glob (matches anything at root)
 *
 * Rejected:
 *   - absolute paths (`/etc/passwd`, `/Users/x/...`)
 *   - traversal segments (`..` anywhere in the path)
 *   - shell-only sigils (`~/...` — caller must expand before passing)
 *
 * Thrown errors propagate to the MCP layer which surfaces them as
 * structured tool errors — no silent drop to broad-fallback.
 */
function assertPathInSandbox(rawPath: string): void {
  // Allow the global-match sentinels first (the only legitimate non-tree paths).
  if (rawPath === "**" || rawPath === "*") return;

  const normalized = rawPath.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    throw new Error(
      `plan_context: absolute paths are not allowed (got "${rawPath}"); pass a path relative to the project root`,
    );
  }
  if (normalized.startsWith("~/") || normalized === "~") {
    throw new Error(
      `plan_context: shell sigil "~" is not allowed (got "${rawPath}"); expand to a project-relative path before calling`,
    );
  }
  if (normalized.split("/").some((seg) => seg === "..")) {
    throw new Error(
      `plan_context: ".." traversal is not allowed (got "${rawPath}"); pass a path that resolves under the project root`,
    );
  }
}

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  // v2.0.0-rc.27 TASK-002 (audit §2.22): sandbox every caller-supplied path
  // before any matching/reconcile work runs. Failure here is a hard throw
  // — plan_context callers are MCP-trusted but a stray traversal from a
  // misconfigured skill or a malformed prompt should not silently land in
  // the description_index matcher.
  for (const p of input.paths) {
    assertPathInSandbox(p);
  }
  if (input.target_paths !== undefined) {
    for (const p of input.target_paths) {
      assertPathInSandbox(p);
    }
  }

  // v2.0.0-rc.22 Scope D T-D2: graceful meta-load. planContext is a hint-time
  // advisor — when buildKnowledgeMeta fails transiently we'd rather return a
  // slightly stale broad-scope hint than surface an fs-error to the caller.
  // loadActiveMetaOrStale degrades to the on-disk meta in that case and flags
  // the response via `stale: true` so consumers can warn.
  let metaResult = await loadActiveMetaOrStale(projectRoot, { caller: "planContext" });
  let meta = metaResult.meta;

  // v2.0.0-rc.23 TASK-005 (a-B): description-undefined auto-heal.
  //
  // Symmetric to rc.22 D2 read-side auto-heal, but covers a case the
  // revision-hash gate cannot detect: an older agents.meta.json was authored
  // before frontmatter descriptions were required and the on-disk knowledge
  // tree has no descriptive frontmatter to populate them. Such entries
  // serve `description: undefined` to the LLM and degrade hint quality —
  // they collapse to "KB: none" in cite enforcement. Revision hashes match,
  // so loadActiveMetaOrStale's auto-heal stays silent.
  //
  // We probe the freshly-loaded meta for any node missing BOTH the structured
  // description and the legacy activation.description summary. On hit, we
  // drive a full reconcile (which re-derives frontmatter from disk and writes
  // a new meta), then reload. The guard `metaResult.auto_healed !== true`
  // prevents an infinite loop: if loadActiveMetaOrStale already healed once
  // this call and we STILL see undefined descriptions, that means the
  // knowledge .md files genuinely lack frontmatter — a second reconcile would
  // not change anything. We accept the degraded state and surface the
  // existing preflight_diagnostics warning instead.
  //
  // No threshold (grill decision): any single undefined description triggers
  // the heal. A threshold would introduce a confusing middle state where
  // some legacy entries get healed and others don't.
  let firstSeenPreviousRevision = metaResult.previous_revision_hash;
  let autoHealedAccumulated = metaResult.auto_healed;
  if (
    metaResult.auto_healed !== true &&
    hasUndefinedDescription(meta)
  ) {
    try {
      await reconcileKnowledge(projectRoot, { trigger: "auto-heal-description" });
      // Re-read the meta after the reconcile rebuild. Use loadActiveMetaOrStale
      // again rather than readAgentsMeta directly so the same graceful-degrade
      // semantics apply if the post-reconcile load fails.
      const healedResult = await loadActiveMetaOrStale(projectRoot, { caller: "planContext" });
      meta = healedResult.meta;
      autoHealedAccumulated = true;
      // Preserve the ORIGINAL pre-call revision so the response always
      // carries the oldest known hash. healedResult.previous_revision_hash
      // would be the post-reconcile revision (same as the current one),
      // which is not useful for downstream "what changed under me?" audit.
      firstSeenPreviousRevision = metaResult.previous_revision_hash;
      metaResult = healedResult;
    } catch {
      // Best-effort heal — never propagate. The hint path must remain
      // available even when reconcile encounters fs errors; the original
      // meta is still usable and the preflight_diagnostics warning will
      // surface the missing descriptions to the caller.
    }
  }
  const stale =
    metaResult.degraded === true ||
    (input.client_hash !== undefined && input.client_hash !== meta.revision);
  const uniquePaths = dedupePaths(input.paths);
  // v2.0.0-rc.33 W2-3 / W2-4: pass scoring context so workspace-wide sort
  // pulls recency-boosted + path-local entries to the top. Uses the same
  // path resolution as relevanceTargetPaths (input.target_paths if provided,
  // else the deduped request paths). The `**` sentinel that --all mode uses
  // contributes zero locality score (no dirname / no package root), which is
  // the correct degenerate behavior — broad mode falls through to recency +
  // stable_id tiebreaker.
  const scoringContext = {
    nowMs: Date.now(),
    targetPaths: input.target_paths ?? dedupePaths(input.paths),
  };
  const allDescriptions = buildDescriptionIndex(meta, scoringContext);

  // v2.0-rc.5 C3 (TASK-012): caller-supplied path context for relevance
  // filtering. When omitted, fall back to `paths` so direct callers (without
  // a separate target_paths surface) still benefit from narrowing on
  // narrow-scoped entries whose globs anchor against the requested paths.
  // Empty resolved set → fail-open at the matcher layer (narrow always passes).
  const relevanceTargetPaths = input.target_paths ?? uniquePaths;

  const entries: PlanContextEntry[] = uniquePaths.map((path) => {
    const profile = buildRequirementProfile(path, input);
    const descriptionIndex = allDescriptions
      .filter((item) => shouldIncludeIndexItemForPath(item, meta, path))
      .filter((item) => shouldIncludeByRelevance(item, relevanceTargetPaths));

    return {
      path,
      requirement_profile: profile,
      description_index: descriptionIndex,
    };
  });

  const sharedDescriptionIndex = dedupeDescriptionIndex(entries.flatMap((entry) => entry.description_index));

  // v2.0-rc.7 T9: always emit a selection_token. The Agent must follow up with
  // `fab_get_knowledge_sections` (which DOES emit the `knowledge_consumed`
  // event required for rc.5 C5 closure) to load bodies. The inline
  // `candidates_full_content` short-circuit is gone.
  const sharedStableIds = sharedDescriptionIndex.map((item) => item.stable_id);
  // v2.0.0-rc.29 TASK-008 (BUG-F3): resolve per-workspace TTL override (if any)
  // and thread it through createSelectionToken so the token's expires_at lines
  // up with the operator's chosen lifetime. Hot-path safe: readSelectionTokenTtlMs
  // is best-effort and returns undefined on any read/parse failure.
  const ttlMs = readSelectionTokenTtlMs(projectRoot) ?? SELECTION_TOKEN_TTL_DEFAULT_MS;
  const selectionToken = createSelectionToken(meta.revision, uniquePaths, [], sharedStableIds, Date.now(), ttlMs);

  const result: PlanContextResult = {
    revision_hash: meta.revision,
    stale,
    selection_token: selectionToken,
    entries,
    shared: {
      description_index: sharedDescriptionIndex,
      preflight_diagnostics: buildPreflightDiagnostics(meta),
    },
    // v2.0.0-rc.22 Scope D T-D2 + rc.23 TASK-005 (a-B): surface auto-heal pair
    // only when a heal actually fired (either revision-drift heal in
    // loadActiveMetaOrStale or description-undefined heal driven from here).
    // Keeping these fields absent on the steady-state path means existing
    // consumers see the same wire shape they always have.
    ...(autoHealedAccumulated
      ? {
          auto_healed: true,
          previous_revision_hash: firstSeenPreviousRevision,
        }
      : {}),
  };

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_context_planned",
      target_paths: uniquePaths,
      required_stable_ids: [],
      ai_selectable_stable_ids: sharedDescriptionIndex.map((item) => item.stable_id),
      final_stable_ids: [],
      selection_token: selectionToken,
      client_hash: input.client_hash,
      intent: input.intent,
      known_tech: input.known_tech,
      diagnostics: result.shared.preflight_diagnostics,
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Planning telemetry is best-effort and must not block rule discovery.
  }

  return result;
}

export function readSelectionToken(token: string, now = Date.now()): SelectionTokenState | undefined {
  const state = selectionTokenCache.get(token);
  if (state === undefined) {
    return undefined;
  }

  if (state.expires_at <= now) {
    selectionTokenCache.delete(token);
    return undefined;
  }

  return state;
}

// Exported for test scaffolds that need a selection_token without going
// through the public planContext() entry point (e.g. two-stage flow tests
// where the seeded corpus would otherwise drop into degenerate mode and
// omit the token entirely). Internal API; not part of the MCP contract.
export function createSelectionToken(
  revisionHash: string,
  targetPaths: string[],
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
  now = Date.now(),
  // v2.0.0-rc.29 TASK-008 (BUG-F3): caller-provided TTL override (defaults to
  // the constant when omitted). Test scaffolds can short-circuit by passing
  // a small ttlMs to exercise expiry without sleeping for 5 minutes.
  ttlMs: number = SELECTION_TOKEN_TTL_DEFAULT_MS,
): string {
  const token = `selection:${revisionHash}:${now.toString(36)}:${Math.random().toString(36).slice(2)}`;
  selectionTokenCache.set(token, {
    token,
    revision_hash: revisionHash,
    target_paths: targetPaths,
    required_stable_ids: requiredStableIds,
    ai_selectable_stable_ids: aiSelectableStableIds,
    created_at: now,
    expires_at: now + ttlMs,
  });
  return token;
}

function dedupePaths(paths: string[]): string[] {
  const seenPaths = new Set<string>();

  return paths.flatMap((path) => {
    const normalizedPath = normalizeKnowledgePath(path);

    if (seenPaths.has(normalizedPath)) {
      return [];
    }

    seenPaths.add(normalizedPath);
    return [normalizedPath];
  });
}

function buildRequirementProfile(path: string, input: PlanContextInput): RequirementProfile {
  const normalizedPath = normalizeKnowledgePath(path);
  const extensionMatch = /(\.[^./\\]+)$/u.exec(normalizedPath);
  const knownTech = dedupeStableIds([
    ...(input.known_tech ?? []),
    ...(extensionMatch?.[1] === ".ts" ? ["TypeScript"] : []),
  ]);

  return {
    target_path: normalizedPath,
    path_segments: normalizedPath.split("/").filter(Boolean),
    extension: extensionMatch?.[1] ?? "",
    known_tech: knownTech,
    user_intent: input.intent ?? "",
    detected_entities: input.detected_entities?.[normalizedPath] ?? input.detected_entities?.[path] ?? [],
  };
}

function buildDescriptionIndex(
  meta: AgentsMeta,
  scoringContext?: { nowMs: number; targetPaths: string[] },
): RuleDescriptionIndexItem[] {
  return Object.entries(meta.nodes)
    .flatMap(([nodeId, node]) => {
      // v2.0-rc.5 A3 (TASK-007): legacy `node.level` / `node.layer` reads
      // retired. Layer is derived from the file path so plan-context no
      // longer depends on the (deprecated) on-disk level field. Path-derived
      // layer stays L0/L1/L2-shaped for back-compat with consumers that still
      // surface a level value, but it carries no selection semantics here.
      const level = deriveAgentsMetaLayer(node.file);
      const description = node.description ?? descriptionFromLegacyActivation(node.activation?.description);
      if (description === undefined) {
        return [];
      }

      // v2.0: prefer fields that flowed in via frontmatter (description.*).
      // Fall back to the inferred knowledge layer derived from the
      // content_ref/file root (team vs personal) so MCP clients always see
      // SOMETHING for the layer surface — even on un-migrated entries.
      const inferredLayer = inferKnowledgeLayerFromContentRef(node.content_ref ?? node.file);

      // v2.0-rc.5 A3: `required`/`selectable` no longer carry meaning — they
      // were the L0/L1/L2 selection ceremony. We emit them as `false` so the
      // shared schema (which still types them as booleans) remains valid;
      // consumers should not branch on these fields any more.
      return [{
        stable_id: node.stable_id ?? nodeId,
        level,
        required: false,
        selectable: false,
        description,
        type: description.knowledge_type,
        maturity: description.maturity,
        layer: description.knowledge_layer ?? inferredLayer,
        layer_reason: description.layer_reason,
        // v2.0-rc.5 C3 (TASK-012): surface relevance fields at the top level
        // so the per-entry filter + downstream MCP clients can read them
        // without reaching into description.*. Defaults (broad + []) are
        // applied at the meta-builder layer; we just pass them through here.
        relevance_scope: description.relevance_scope,
        relevance_paths: description.relevance_paths,
      }];
    })
    .sort((left, right) => compareDescriptionIndexItems(left, right, scoringContext));
}

// v2.0-rc.5 C3 (TASK-012): relevance-paths filter. Returns true when an entry
// should be surfaced for a given request path-context:
//   * `broad` (or missing scope) entries always pass — they're cross-cutting.
//   * `narrow` entries pass only when at least one of their `relevance_paths`
//     globs matches at least one path in `targetPaths`.
//   * Empty `targetPaths` is fail-open: every narrow entry passes. This matches
//     the rc.5 D1 hint CLI semantics (no path context → no filter).
//   * Empty `relevance_paths` on a narrow entry means "narrow but un-anchored"
//     — there's no glob to match, so the entry is excluded under a non-empty
//     target_paths set. The frontmatter parser defaults to broad+[] precisely
//     to avoid this case slipping through silently.
//
// Glob matching delegates to `minimatch` (already a server dep). We accept
// path-prefix anchors too: a `relevance_paths` entry ending with `/` is
// treated as a directory anchor and matched as `<dir>/**`.
function matchesAnyPath(globs: string[], targetPaths: string[]): boolean {
  if (globs.length === 0) {
    return false;
  }
  for (const rawGlob of globs) {
    const glob = rawGlob.endsWith("/") ? `${rawGlob}**` : rawGlob;
    for (const target of targetPaths) {
      if (minimatch(target, glob, { dot: true, matchBase: false })) {
        return true;
      }
    }
  }
  return false;
}

function shouldIncludeByRelevance(
  item: RuleDescriptionIndexItem,
  targetPaths: string[],
): boolean {
  // Default scope is broad: missing field → always pass.
  const scope = item.relevance_scope ?? "broad";
  if (scope === "broad") {
    return true;
  }
  // Narrow scope. Fail-open when no target_paths supplied.
  if (targetPaths.length === 0) {
    return true;
  }
  return matchesAnyPath(item.relevance_paths ?? [], targetPaths);
}

function inferKnowledgeLayerFromContentRef(contentRef: string | undefined): "team" | "personal" | undefined {
  if (contentRef === undefined) {
    return undefined;
  }
  if (contentRef.startsWith("~/.fabric/knowledge/")) {
    return "personal";
  }
  if (contentRef.startsWith(".fabric/knowledge/")) {
    return "team";
  }
  return undefined;
}

function descriptionFromLegacyActivation(summary: string | undefined): RuleDescription | undefined {
  if (summary === undefined) {
    return undefined;
  }

  return {
    summary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: summary,
  };
}

// v2.0-rc.5 A3 (TASK-007): the L0/L1/L2 short-circuit + scope_glob match was
// the legacy per-path filter. With the L0/L1/L2 selection ceremony retired
// every candidate flows through. The relevance-paths filter (TASK-012, C3)
// lives in `shouldIncludeByRelevance` and is applied as a separate stage by
// `planContext()`; this hook is kept for any future per-path constraint that
// is NOT covered by the relevance pipeline.
function shouldIncludeIndexItemForPath(
  _item: RuleDescriptionIndexItem,
  _meta: AgentsMeta,
  _path: string,
): boolean {
  return true;
}

/**
 * v2.0.0-rc.23 TASK-005 (a-B): detector for description-undefined drift.
 *
 * Returns true if ANY node in the meta lacks both the structured description
 * AND the legacy activation.description summary. Matches the exact predicate
 * used by buildPreflightDiagnostics so the detector and the diagnostic stay in
 * lockstep: every entry that would surface a `missing_description` warning
 * also drives the auto-heal trigger.
 *
 * No threshold — any single undefined description triggers heal. See the
 * call-site comment in planContext for the rationale.
 */
function hasUndefinedDescription(meta: AgentsMeta): boolean {
  return Object.values(meta.nodes).some(
    (node) => node.description === undefined && node.activation?.description === undefined,
  );
}

function buildPreflightDiagnostics(meta: AgentsMeta): PlanContextResult["shared"]["preflight_diagnostics"] {
  const missingDescriptionStableIds = Object.entries(meta.nodes)
    .filter(([, node]) => node.description === undefined && node.activation?.description === undefined)
    .map(([nodeId, node]) => node.stable_id ?? nodeId)
    .sort();

  if (missingDescriptionStableIds.length === 0) {
    return [];
  }

  return [{
    code: "missing_description",
    severity: "warn",
    stable_ids: missingDescriptionStableIds,
    message: `Resolved registry includes ${missingDescriptionStableIds.length} node(s) without structured descriptions.`,
  }];
}

function dedupeStableIds(stableIds: string[]): string[] {
  return Array.from(new Set(stableIds));
}

function dedupeDescriptionIndex(items: RuleDescriptionIndexItem[]): RuleDescriptionIndexItem[] {
  const seenStableIds = new Set<string>();
  return items.filter((item) => {
    if (seenStableIds.has(item.stable_id)) {
      return false;
    }

    seenStableIds.add(item.stable_id);
    return true;
  });
}

// v2.0-rc.5 A3 (TASK-007): primary sort is stable_id only — the legacy
// levelOrder switch keyed off L0/L1/L2 selection ceremony which no longer
// drives output.
//
// v2.0.0-rc.33 W2-3 / W2-4 (P1-6 + P1-7): scoring layer. When `now` and
// `targetPaths` are provided, compute a per-item score and sort DESCENDING
// by score, with stable_id ascending as tiebreaker. Scoring components:
//
//   recency_score (W2-3, P1-6):
//     +100 if description.created_at parses and is within the last 7 days
//     of `now`. Binary boost — avoids over-fitting to micro-time differences.
//
//   locality_score (W2-4, P1-7): max over (relevance_path, target_path) pairs
//     +100 if exact file match (rp === tp)
//     +50  if same directory (dirname matches)
//     +25  if same package (first 2 path segments match — captures monorepo
//          packages/cli, packages/server, src/auth etc. ad-hoc heuristic)
//     +0   otherwise
//
// Sort is stable: items with identical scores fall through to the
// pre-existing alphabetic stable_id order.
function compareDescriptionIndexItems(
  left: RuleDescriptionIndexItem,
  right: RuleDescriptionIndexItem,
  context?: { nowMs: number; targetPaths: string[] },
): number {
  if (context !== undefined) {
    const leftScore = scoreDescriptionItem(left, context.nowMs, context.targetPaths);
    const rightScore = scoreDescriptionItem(right, context.nowMs, context.targetPaths);
    if (leftScore !== rightScore) {
      return rightScore - leftScore; // descending
    }
  }
  return left.stable_id.localeCompare(right.stable_id);
}

// v2.0.0-rc.33 W2-3: recency boost — entries created within RECENCY_WINDOW_MS
// of `now` get +RECENCY_BOOST. Binary boost (vs. linear decay) keeps the
// sort key resilient against clock skew and ISO-string parse jitter.
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 100;

// v2.0.0-rc.33 W2-4: locality tiers. Same-file > same-dir > same-package >
// none. Values are calibrated so a same-dir hit dominates a recency boost
// (recency 100 ties with same-dir 50 + same-package 25 if entry is also
// new), keeping locality the lead signal — recency is a secondary nudge.
const LOCALITY_SAME_FILE = 100;
const LOCALITY_SAME_DIR = 50;
const LOCALITY_SAME_PACKAGE = 25;

function scoreDescriptionItem(
  item: RuleDescriptionIndexItem,
  nowMs: number,
  targetPaths: string[],
): number {
  let score = 0;

  // W2-3: recency boost — read description.created_at, compare with now.
  const createdAtRaw = item.description?.created_at;
  if (typeof createdAtRaw === "string" && createdAtRaw.length > 0) {
    const createdMs = Date.parse(createdAtRaw);
    if (Number.isFinite(createdMs) && nowMs - createdMs < RECENCY_WINDOW_MS) {
      score += RECENCY_BOOST;
    }
  }

  // W2-4: path-locality scoring — max over (relevance_path, target_path).
  if (targetPaths.length > 0) {
    const relevancePaths = item.relevance_paths ?? item.description?.relevance_paths ?? [];
    let best = 0;
    for (const rp of relevancePaths) {
      for (const tp of targetPaths) {
        const tier = localityTier(rp, tp);
        if (tier > best) best = tier;
      }
    }
    score += best;
  }

  return score;
}

function localityTier(relevancePath: string, targetPath: string): number {
  if (relevancePath === targetPath) return LOCALITY_SAME_FILE;
  const rpDir = dirnameOfPath(relevancePath);
  const tpDir = dirnameOfPath(targetPath);
  if (rpDir.length > 0 && rpDir === tpDir) return LOCALITY_SAME_DIR;
  const rpPkg = packageRootOfPath(relevancePath);
  const tpPkg = packageRootOfPath(targetPath);
  if (rpPkg.length > 0 && rpPkg === tpPkg) return LOCALITY_SAME_PACKAGE;
  return 0;
}

function dirnameOfPath(p: string): string {
  // Strip trailing glob segments (e.g. `packages/cli/src/**/*.ts` → `packages/cli/src`)
  // and read the directory. We treat `*` and `**` as glob delimiters; the
  // first one terminates the path prefix.
  const idx = p.search(/[*?[]/);
  const stem = idx >= 0 ? p.slice(0, idx).replace(/\/$/, "") : p;
  const lastSlash = stem.lastIndexOf("/");
  return lastSlash >= 0 ? stem.slice(0, lastSlash) : "";
}

function packageRootOfPath(p: string): string {
  // First two path segments captures the conventional `packages/<name>` or
  // `src/<area>` monorepo / mid-size-app rooting. Ad-hoc heuristic; the W2-4
  // task spec calls this out as a "rough scoring" knob, not a precise
  // dependency-graph lookup.
  const idx = p.search(/[*?[]/);
  const stem = idx >= 0 ? p.slice(0, idx).replace(/\/$/, "") : p;
  const segments = stem.split("/").filter(Boolean);
  if (segments.length < 2) return "";
  return segments.slice(0, 2).join("/");
}

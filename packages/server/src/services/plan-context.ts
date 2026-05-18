import { minimatch } from "minimatch";

import { deriveAgentsMetaLayer, type RuleDescription, type RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { loadActiveMetaOrStale } from "./load-active-meta.js";

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

const SELECTION_TOKEN_TTL_MS = 5 * 60 * 1000;
// v2.0-rc.7 T9: degenerate-mode threshold removed — the API is now symmetric
// across all candidate counts. See docs/decisions/rc5-a3-superseded.md.
const selectionTokenCache = new Map<string, SelectionTokenState>();

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  // v2.0.0-rc.22 Scope D T-D2: graceful meta-load. planContext is a hint-time
  // advisor — when buildKnowledgeMeta fails transiently we'd rather return a
  // slightly stale broad-scope hint than surface an fs-error to the caller.
  // loadActiveMetaOrStale degrades to the on-disk meta in that case and flags
  // the response via `stale: true` so consumers can warn.
  const metaResult = await loadActiveMetaOrStale(projectRoot, { caller: "planContext" });
  const meta = metaResult.meta;
  const stale =
    metaResult.degraded === true ||
    (input.client_hash !== undefined && input.client_hash !== meta.revision);
  const uniquePaths = dedupePaths(input.paths);
  const allDescriptions = buildDescriptionIndex(meta);

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
  const selectionToken = createSelectionToken(meta.revision, uniquePaths, [], sharedStableIds);

  const result: PlanContextResult = {
    revision_hash: meta.revision,
    stale,
    selection_token: selectionToken,
    entries,
    shared: {
      description_index: sharedDescriptionIndex,
      preflight_diagnostics: buildPreflightDiagnostics(meta),
    },
    // v2.0.0-rc.22 Scope D T-D2: surface auto-heal pair only when a heal
    // actually fired. Keeping these fields absent on the steady-state path
    // means existing consumers see the same wire shape they always have.
    ...(metaResult.auto_healed
      ? {
          auto_healed: true,
          previous_revision_hash: metaResult.previous_revision_hash,
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
): string {
  const token = `selection:${revisionHash}:${now.toString(36)}:${Math.random().toString(36).slice(2)}`;
  selectionTokenCache.set(token, {
    token,
    revision_hash: revisionHash,
    target_paths: targetPaths,
    required_stable_ids: requiredStableIds,
    ai_selectable_stable_ids: aiSelectableStableIds,
    created_at: now,
    expires_at: now + SELECTION_TOKEN_TTL_MS,
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

function buildDescriptionIndex(meta: AgentsMeta): RuleDescriptionIndexItem[] {
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
    .sort(compareDescriptionIndexItems);
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

// v2.0-rc.5 A3 (TASK-007): sort by stable_id only — the legacy levelOrder
// switch keyed off L0/L1/L2 selection ceremony which no longer drives output.
function compareDescriptionIndexItems(left: RuleDescriptionIndexItem, right: RuleDescriptionIndexItem): number {
  return left.stable_id.localeCompare(right.stable_id);
}

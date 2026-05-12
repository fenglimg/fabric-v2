import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { deriveAgentsMetaLayer, type RuleDescription, type RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { readAgentsMeta, type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";

export type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
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
// initial_selected_stable_ids / selection_policy). When the description_index
// has ≤ DEGENERATE_THRESHOLD entries the result enters single-stage degenerate
// mode: `candidates_full_content` carries the full markdown body of every
// candidate and `selection_token` is omitted. Above the threshold the legacy
// two-stage flow is retained (selection_token → fab_get_knowledge_sections).
export type PlanContextEntry = {
  path: string;
  requirement_profile: RequirementProfile;
  description_index: RuleDescriptionIndexItem[];
};

export type PlanContextCandidateContent = {
  stable_id: string;
  path: string;
  content: string;
};

export type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token?: string;
  candidates_full_content?: PlanContextCandidateContent[];
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
// v2.0-rc.5 A3: when the candidate set is small enough we ship every entry's
// full markdown body up-front and skip the selection_token round-trip. 30 is
// the working budget; if 30 entries exceed ~50KB payload during dogfood we
// lower this in rc.7 (see TASK-007 risk note).
const DEGENERATE_CANDIDATE_THRESHOLD = 30;
const selectionTokenCache = new Map<string, SelectionTokenState>();

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  const meta = await readAgentsMeta(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== meta.revision;
  const uniquePaths = dedupePaths(input.paths);
  const allDescriptions = buildDescriptionIndex(meta);

  const entries: PlanContextEntry[] = uniquePaths.map((path) => {
    const profile = buildRequirementProfile(path, input);
    const descriptionIndex = allDescriptions.filter((item) => shouldIncludeIndexItemForPath(item, meta, path));

    return {
      path,
      requirement_profile: profile,
      description_index: descriptionIndex,
    };
  });

  const sharedDescriptionIndex = dedupeDescriptionIndex(entries.flatMap((entry) => entry.description_index));

  // Degenerate single-stage mode: dump every candidate body inline, skip the
  // selection_token ceremony. Threshold is empirical (see comment above).
  const isDegenerate = sharedDescriptionIndex.length <= DEGENERATE_CANDIDATE_THRESHOLD;
  let selectionToken: string | undefined;
  let candidatesFullContent: PlanContextCandidateContent[] | undefined;

  if (isDegenerate) {
    candidatesFullContent = await loadCandidatesFullContent(projectRoot, meta, sharedDescriptionIndex);
  } else {
    const sharedStableIds = sharedDescriptionIndex.map((item) => item.stable_id);
    selectionToken = createSelectionToken(meta.revision, uniquePaths, [], sharedStableIds);
  }

  const result: PlanContextResult = {
    revision_hash: meta.revision,
    stale,
    entries,
    shared: {
      description_index: sharedDescriptionIndex,
      preflight_diagnostics: buildPreflightDiagnostics(meta),
    },
  };

  if (selectionToken !== undefined) {
    result.selection_token = selectionToken;
  }
  if (candidatesFullContent !== undefined) {
    result.candidates_full_content = candidatesFullContent;
  }

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
      }];
    })
    .sort(compareDescriptionIndexItems);
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
// every candidate flows through to the per-entry index; TASK-006 (C1) layers
// a `relevance_paths` filter on top of this in the next slice. Function body
// kept as a single-return for symmetry with TASK-006's incoming patch.
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

async function loadCandidatesFullContent(
  projectRoot: string,
  meta: AgentsMeta,
  index: RuleDescriptionIndexItem[],
): Promise<PlanContextCandidateContent[]> {
  const nodesByStableId = new Map<string, AgentsMeta["nodes"][string]>();
  for (const [nodeId, node] of Object.entries(meta.nodes)) {
    nodesByStableId.set(node.stable_id ?? nodeId, node);
  }

  const out: PlanContextCandidateContent[] = [];
  for (const item of index) {
    const node = nodesByStableId.get(item.stable_id);
    if (node === undefined) {
      continue;
    }

    const contentRef = node.content_ref ?? node.file;
    const sourcePath = resolveCandidateSourcePath(projectRoot, contentRef);
    try {
      const content = await readFile(sourcePath, "utf8");
      out.push({
        stable_id: item.stable_id,
        path: normalizeKnowledgePath(contentRef),
        content,
      });
    } catch {
      // Missing file is reported via preflight_diagnostics elsewhere; here we
      // simply omit the entry from the inline payload so degenerate mode never
      // becomes a hard failure point.
    }
  }
  return out;
}

function resolveCandidateSourcePath(projectRoot: string, contentRef: string): string {
  if (contentRef.startsWith("~/.fabric/knowledge/")) {
    const home = process.env.FABRIC_HOME ?? homedir();
    return join(home, ".fabric", "knowledge", contentRef.slice("~/.fabric/knowledge/".length));
  }
  return join(projectRoot, contentRef);
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

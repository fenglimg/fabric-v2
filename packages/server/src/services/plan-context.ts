import type { RuleDescription, RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { readAgentsMeta, type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeRulesPath } from "./get-rules.js";

export type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
  // v2.0: by default we hide entries with `maturity = 'deprecated'`. Setting
  // this flag to true returns them. Note: TASK-002 MaturitySchema enumerates
  // draft|verified|proven only — `deprecated` is reserved future state, so
  // today this filter is a no-op placeholder. Wired now so we don't need a
  // protocol break when the enum widens. TODO(rc.3): expand MaturitySchema.
  include_deprecated?: boolean;
};

export type RequirementProfile = {
  target_path: string;
  path_segments: string[];
  extension: string;
  inferred_domain: string[];
  known_tech: string[];
  user_intent: string;
  intent_tokens: string[];
  impact_hints: string[];
  detected_entities: string[];
};

export type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{
    path: string;
    requirement_profile: RequirementProfile;
    description_index: RuleDescriptionIndexItem[];
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
    initial_selected_stable_ids: string[];
    selection_policy: {
      required_levels: ["L0", "L2"];
      ai_selectable_levels: ["L1"];
      final_fetch_rule: "required_stable_ids + ai_selected_l1_stable_ids";
    };
  }>;
  shared: {
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
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
const selectionTokenCache = new Map<string, SelectionTokenState>();

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  const meta = await readAgentsMeta(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== meta.revision;
  const uniquePaths = dedupePaths(input.paths);
  const includeDeprecated = input.include_deprecated === true;
  const allDescriptions = buildDescriptionIndex(meta).filter((item) =>
    includeDeprecated ? true : !isDeprecatedMaturity(item),
  );

  const entries = uniquePaths.map((path) => {
    const profile = buildRequirementProfile(path, input);
    const descriptionIndex = allDescriptions.filter((item) => shouldIncludeIndexItemForPath(item, meta, path));
    const requiredStableIds = descriptionIndex
      .filter((item) => item.required)
      .map((item) => item.stable_id);
    const aiSelectableStableIds = descriptionIndex
      .filter((item) => item.selectable)
      .map((item) => item.stable_id);

    return {
      path,
      requirement_profile: profile,
      description_index: descriptionIndex,
      required_stable_ids: requiredStableIds,
      ai_selectable_stable_ids: aiSelectableStableIds,
      initial_selected_stable_ids: requiredStableIds,
      selection_policy: {
        required_levels: ["L0", "L2"] as ["L0", "L2"],
        ai_selectable_levels: ["L1"] as ["L1"],
        final_fetch_rule: "required_stable_ids + ai_selected_l1_stable_ids" as const,
      },
    };
  });

  const requiredStableIds = dedupeStableIds(entries.flatMap((entry) => entry.required_stable_ids));
  const aiSelectableStableIds = dedupeStableIds(entries.flatMap((entry) => entry.ai_selectable_stable_ids));
  const sharedDescriptionIndex = dedupeDescriptionIndex(entries.flatMap((entry) => entry.description_index));
  const selectionToken = createSelectionToken(meta.revision, uniquePaths, requiredStableIds, aiSelectableStableIds);

  const result: PlanContextResult = {
    revision_hash: meta.revision,
    stale,
    selection_token: selectionToken,
    entries,
    shared: {
      required_stable_ids: requiredStableIds,
      ai_selectable_stable_ids: aiSelectableStableIds,
      description_index: sharedDescriptionIndex,
      preflight_diagnostics: buildPreflightDiagnostics(meta),
    },
  };

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "rule_context_planned",
      target_paths: uniquePaths,
      required_stable_ids: requiredStableIds,
      ai_selectable_stable_ids: aiSelectableStableIds,
      final_stable_ids: requiredStableIds,
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

function createSelectionToken(
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
    const normalizedPath = normalizeRulesPath(path);

    if (seenPaths.has(normalizedPath)) {
      return [];
    }

    seenPaths.add(normalizedPath);
    return [normalizedPath];
  });
}

function buildRequirementProfile(path: string, input: PlanContextInput): RequirementProfile {
  const normalizedPath = normalizeRulesPath(path);
  const extensionMatch = /(\.[^./\\]+)$/u.exec(normalizedPath);
  const knownTech = dedupeStableIds([
    ...(input.known_tech ?? []),
    ...(extensionMatch?.[1] === ".ts" ? ["TypeScript"] : []),
  ]);

  return {
    target_path: normalizedPath,
    path_segments: normalizedPath.split("/").filter(Boolean),
    extension: extensionMatch?.[1] ?? "",
    inferred_domain: inferDomains(normalizedPath),
    known_tech: knownTech,
    user_intent: input.intent ?? "",
    intent_tokens: tokenizeIntent(input.intent ?? ""),
    impact_hints: inferImpactHints(input.intent ?? ""),
    detected_entities: input.detected_entities?.[normalizedPath] ?? input.detected_entities?.[path] ?? [],
  };
}

function buildDescriptionIndex(meta: AgentsMeta): RuleDescriptionIndexItem[] {
  return Object.entries(meta.nodes)
    .flatMap(([nodeId, node]) => {
      const level = node.level ?? node.layer;
      const description = node.description ?? descriptionFromLegacyActivation(node.activation?.description);
      if (description === undefined) {
        return [];
      }

      // v2.0: prefer fields that flowed in via frontmatter (description.*).
      // Fall back to the inferred knowledge layer derived from the
      // content_ref/file root (team vs personal) so MCP clients always see
      // SOMETHING for the layer surface — even on un-migrated entries.
      const inferredLayer = inferKnowledgeLayerFromContentRef(node.content_ref ?? node.file);

      return [{
        stable_id: node.stable_id ?? nodeId,
        level,
        required: level === "L0" || level === "L2",
        selectable: level === "L1",
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

function isDeprecatedMaturity(item: RuleDescriptionIndexItem): boolean {
  // v2.0 placeholder: TASK-002 enum is draft|verified|proven only. We check
  // both surfaces (top-level + nested) so that if either ever resolves to
  // "deprecated" via a future schema expansion, the filter activates without
  // a code change. Today this is a no-op for all conformant entries.
  const a = item.maturity as string | undefined;
  const b = item.description.maturity as string | undefined;
  return a === "deprecated" || b === "deprecated";
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

function shouldIncludeIndexItemForPath(
  item: RuleDescriptionIndexItem,
  meta: AgentsMeta,
  path: string,
): boolean {
  if (item.level === "L0" || item.level === "L1") {
    return true;
  }

  const node = Object.values(meta.nodes).find((candidate) => candidate.stable_id === item.stable_id);
  if (node === undefined) {
    return false;
  }

  return node.scope_glob === path || minimatchSimple(path, node.scope_glob);
}

function minimatchSimple(path: string, glob: string): boolean {
  if (glob === "**") {
    return true;
  }
  if (glob.endsWith("/**")) {
    return path.startsWith(glob.slice(0, -3));
  }
  return path === glob;
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

function inferDomains(path: string): string[] {
  const domains: string[] = [];
  if (path.includes("/ui/") || path.toLowerCase().includes("ui")) {
    domains.push("UI");
  }
  if (path.includes("assets/scripts")) {
    domains.push("Gameplay");
  }
  if (path.includes("resources") || path.includes("assets/resources")) {
    domains.push("Asset");
  }
  return domains;
}

function tokenizeIntent(intent: string): string[] {
  const tokens = ["性能", "优化", "drawcall", "渲染", "卡顿", "闪烁", "界面", "UI", "资源", "图集"]
    .filter((token) => intent.toLowerCase().includes(token.toLowerCase()));
  return dedupeStableIds(tokens);
}

function inferImpactHints(intent: string): string[] {
  return /性能|优化|drawcall|渲染|卡顿|闪烁/iu.test(intent) ? ["Performance"] : [];
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

function compareDescriptionIndexItems(left: RuleDescriptionIndexItem, right: RuleDescriptionIndexItem): number {
  const levelDelta = levelOrder(left.level) - levelOrder(right.level);
  return levelDelta !== 0 ? levelDelta : left.stable_id.localeCompare(right.stable_id);
}

function levelOrder(level: "L0" | "L1" | "L2"): number {
  switch (level) {
    case "L0":
      return 0;
    case "L1":
      return 1;
    case "L2":
      return 2;
  }
}

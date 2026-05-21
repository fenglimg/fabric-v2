import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentsLayer } from "@fenglimg/fabric-shared";

import { type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { readSelectionToken } from "./plan-context.js";
import { loadActiveMeta } from "./load-active-meta.js";

// v2.0.0-rc.23 TASK-013 (F8b): KNOWLEDGE_SECTION_NAMES + KnowledgeSectionName
// + the `missing_section` diagnostic + the per-section structured response
// were removed. After F8a deleted the scan baseline writers, the A-set
// `## [BRACKET]` heading discipline had no writer; the LLM-facing API now
// returns the full markdown body (frontmatter stripped) keyed by stable_id.
// See parseKnowledgeSections (now `extractBody`) below.

export type GetKnowledgeSectionsInput = {
  selection_token: string;
  ai_selected_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
  correlation_id?: string;
  session_id?: string;
  // v2.0 rc.5 TASK-014 (C5): client identity propagated into knowledge_consumed
  // events. Falls back to empty string when unset (full client-identity
  // propagation pattern deferred to rc.6 per TASK-014 note).
  client_hash?: string;
};

// v2.0.0-rc.29 TASK-006 (BUG-Q1): dropped `export` — only referenced inside
// this file (`KnowledgeSectionResult.diagnostics[]` field type + local
// `diagnostics: KnowledgeSectionDiagnostic[]` array). No external consumer.
type KnowledgeSectionDiagnostic = {
  // v2.0: warn-level signal that a fetched rule lacks knowledge metadata
  // (no `type` AND no `layer` in frontmatter). Surfaces un-migrated v1.x
  // files without breaking selection — the rule is still returned.
  code: "missing_knowledge_metadata";
  severity: "warn";
  stable_id: string;
  message: string;
};

export type KnowledgeSectionResult = {
  revision_hash: string;
  precedence: ["L2", "L1", "L0"];
  selected_stable_ids: string[];
  rules: Array<{
    stable_id: string;
    level: AgentsLayer;
    path: string;
    body: string;
  }>;
  diagnostics: KnowledgeSectionDiagnostic[];
};

type NodePriority = NonNullable<AgentsMeta["nodes"][string]["priority"]>;

type RuleNodeEntry = {
  stable_id: string;
  level: AgentsLayer;
  path: string;
  priority: NodePriority;
  node: AgentsMeta["nodes"][string];
};

const PRIORITY_ORDER: Record<NodePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * v2.0.0-rc.23 TASK-013 (F8b): strip a YAML frontmatter block from raw rule
 * markdown and return the remaining body. The frontmatter regex mirrors the
 * one in knowledge-meta-builder.ts (extractDescription / extractIdFromFrontmatter)
 * to keep parsing behavior consistent. When no frontmatter is present the
 * original content is returned unchanged.
 *
 * Replaces the legacy `parseKnowledgeSections` which split markdown into the
 * 4-element A-set enum (removed in F8b).
 */
export function extractBody(content: string): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(content);
  if (match === null) {
    return content.replace(/^\uFEFF/u, "");
  }
  return content.slice(match[0].length);
}

export async function getKnowledgeSections(
  projectRoot: string,
  input: GetKnowledgeSectionsInput,
): Promise<KnowledgeSectionResult> {
  const token = readSelectionToken(input.selection_token);
  if (token === undefined) {
    throw new Error("selection_token is missing or expired");
  }

  validateAiSelections(token.ai_selectable_stable_ids, input.ai_selected_stable_ids, input.ai_selection_reasons);

  // v2.0.0-rc.22 Scope D T-D2: strict meta-load. Section delivery is an
  // authoritative id-based lookup; serving stale meta would mean handing back
  // bodies for ids that no longer exist or missing newly-resolved ones. We
  // want a loud failure (vs. silent staleness) when buildKnowledgeMeta breaks.
  const { meta } = await loadActiveMeta(projectRoot, { caller: "getKnowledgeSections" });
  const selectedStableIds = [...token.required_stable_ids, ...input.ai_selected_stable_ids];
  const selectedRules = sortRuleNodes(selectedStableIds.map((stableId) => findRuleNode(meta, stableId)));
  const diagnostics: KnowledgeSectionDiagnostic[] = [];
  const rules = [];

  for (const rule of selectedRules) {
    const content = await readFile(resolveRuleSourcePath(projectRoot, rule.path), "utf8");
    // v2.0.0-rc.23 TASK-013 (F8b): the API now returns the full markdown body
    // (frontmatter stripped). Section-name discipline is a writer convention,
    // not an API contract — callers scan for B-set headings as needed.
    const body = extractBody(content);

    // v2.0: emit a warn-level diagnostic when a fetched rule has neither
    // `knowledge_type` nor `knowledge_layer` in its description — these are
    // un-migrated v1.x entries surviving in the index. Does not block delivery.
    const description = rule.node.description;
    if (
      description !== undefined &&
      description.knowledge_type === undefined &&
      description.knowledge_layer === undefined
    ) {
      diagnostics.push({
        code: "missing_knowledge_metadata",
        severity: "warn",
        stable_id: rule.stable_id,
        message: `Rule ${rule.stable_id} has no knowledge metadata (type/layer) — likely an un-migrated v1.x entry.`,
      });
    }

    rules.push({
      stable_id: rule.stable_id,
      level: rule.level,
      path: rule.path,
      body,
    });
  }

  const result: KnowledgeSectionResult = {
    revision_hash: meta.revision,
    precedence: ["L2", "L1", "L0"],
    selected_stable_ids: rules.map((rule) => rule.stable_id),
    rules,
    diagnostics,
  };

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_selection",
      selection_token: input.selection_token,
      target_paths: token.target_paths,
      required_stable_ids: token.required_stable_ids,
      ai_selectable_stable_ids: token.ai_selectable_stable_ids,
      ai_selected_stable_ids: input.ai_selected_stable_ids,
      final_stable_ids: result.selected_stable_ids,
      ai_selection_reasons: pickSelectionReasons(input.ai_selected_stable_ids, input.ai_selection_reasons),
      rejected_stable_ids: [],
      ignored_stable_ids: [],
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Selection telemetry is best-effort and must not block rule delivery.
  }

  try {
    // v2.0.0-rc.23 TASK-013 (F8b): `requested_sections` retained in the
    // ledger envelope for replay/audit continuity (event schema is generic
    // `z.array(z.string())`), but always emitted as an empty array now that
    // the `sections` input parameter was removed. Downstream cite-coverage /
    // orphan-demote replay code never reads this field — the canonical
    // signal is `final_stable_ids`.
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_sections_fetched",
      selection_token: input.selection_token,
      target_paths: token.target_paths,
      requested_sections: [],
      final_stable_ids: result.selected_stable_ids,
      ai_selected_stable_ids: input.ai_selected_stable_ids,
      diagnostics,
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Fetch telemetry is best-effort and must not block rule delivery.
  }

  // v2.0 rc.5 TASK-014 (C5): emit one knowledge_consumed event per unique
  // stable_id resolved by this fetch. Dedupe within a single request via a
  // Set so a stable_id appearing more than once in the resolved rule list
  // produces exactly one event. Drives doctor lint #16 (orphan_demote) via
  // replay-derived last_consumed_at.
  const consumedAt = new Date().toISOString();
  const consumedClientHash = input.client_hash ?? "";
  const emittedConsumed = new Set<string>();
  for (const stableId of result.selected_stable_ids) {
    if (emittedConsumed.has(stableId)) {
      continue;
    }
    emittedConsumed.add(stableId);
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "knowledge_consumed",
        stable_id: stableId,
        consumed_at: consumedAt,
        client_hash: consumedClientHash,
        correlation_id: input.correlation_id,
        session_id: input.session_id,
      });
    } catch {
      // Consumption telemetry is best-effort and must not block rule delivery.
    }
  }

  return result;
}

function validateAiSelections(
  aiSelectableStableIds: string[],
  aiSelectedStableIds: string[],
  aiSelectionReasons: Record<string, string>,
): void {
  const selectable = new Set(aiSelectableStableIds);

  for (const stableId of aiSelectedStableIds) {
    if (!selectable.has(stableId)) {
      throw new Error(`Invalid L1 rule selection: ${stableId}`);
    }

    if (aiSelectionReasons[stableId]?.trim() === "") {
      throw new Error(`Missing AI selection reason for ${stableId}`);
    }

    if (aiSelectionReasons[stableId] === undefined) {
      throw new Error(`Missing AI selection reason for ${stableId}`);
    }
  }
}

function findRuleNode(meta: AgentsMeta, stableId: string): RuleNodeEntry {
  for (const [nodeId, node] of Object.entries(meta.nodes)) {
    const nodeStableId = node.stable_id ?? nodeId;

    if (nodeStableId !== stableId) {
      continue;
    }

    const level: AgentsLayer = node.level ?? node.layer ?? "L2";
    return {
      stable_id: nodeStableId,
      level,
      path: normalizeKnowledgePath(node.content_ref ?? node.file),
      priority: node.priority ?? "medium",
      node,
    };
  }

  throw new Error(`Selected rule is not present in agents.meta.json: ${stableId}`);
}

function sortRuleNodes(rules: RuleNodeEntry[]): RuleNodeEntry[] {
  return [...rules].sort((left, right) => {
    const levelDelta = outputLevelOrder(left.level) - outputLevelOrder(right.level);
    if (levelDelta !== 0) {
      return levelDelta;
    }

    const priorityDelta = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.stable_id.localeCompare(right.stable_id);
  });
}

function outputLevelOrder(level: AgentsLayer): number {
  switch (level) {
    case "L0":
      return 0;
    case "L1":
      return 1;
    case "L2":
      return 2;
  }
}

/**
 * v2.0: Resolve a content_ref/path captured in agents.meta.json to an absolute
 * filesystem path. Personal-layer entries are persisted as `~/.fabric/...`
 * and live outside the project root; team-layer entries stay project-relative.
 * Mirrors `resolveContentRefPath` in knowledge-meta-builder.ts.
 */
function resolveRuleSourcePath(projectRoot: string, contentRef: string): string {
  if (contentRef.startsWith("~/.fabric/knowledge/")) {
    const home = process.env.FABRIC_HOME ?? homedir();
    return join(home, ".fabric", "knowledge", contentRef.slice("~/.fabric/knowledge/".length));
  }
  return join(projectRoot, contentRef);
}

function pickSelectionReasons(
  selectedStableIds: string[],
  reasons: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(selectedStableIds.map((stableId) => [stableId, reasons[stableId] ?? ""]));
}

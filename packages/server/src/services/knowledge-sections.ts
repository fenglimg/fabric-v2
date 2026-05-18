import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentsLayer } from "@fenglimg/fabric-shared";

import { type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { readSelectionToken } from "./plan-context.js";
import { loadActiveMeta } from "./load-active-meta.js";

export const KNOWLEDGE_SECTION_NAMES = [
  "MISSION_STATEMENT",
  "MANDATORY_INJECTION",
  "BUSINESS_LOGIC_CHUNKS",
  "CONTEXT_INFO",
] as const;

export type KnowledgeSectionName = typeof KNOWLEDGE_SECTION_NAMES[number];

export type GetKnowledgeSectionsInput = {
  selection_token: string;
  sections: KnowledgeSectionName[];
  ai_selected_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
  correlation_id?: string;
  session_id?: string;
  // v2.0 rc.5 TASK-014 (C5): client identity propagated into knowledge_consumed
  // events. Falls back to empty string when unset (full client-identity
  // propagation pattern deferred to rc.6 per TASK-014 note).
  client_hash?: string;
};

export type KnowledgeSectionDiagnostic =
  | {
      code: "missing_section";
      severity: "warn";
      stable_id: string;
      section: KnowledgeSectionName;
      message: string;
    }
  | {
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
    sections: Record<KnowledgeSectionName, string>;
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

export function parseKnowledgeSections(content: string): Map<KnowledgeSectionName, string> {
  const sections = new Map<KnowledgeSectionName, string[]>();
  const lines = content.split(/\r?\n/u);
  let activeSection: KnowledgeSectionName | undefined;
  let activeSectionDepth = 0;
  let buffer: string[] = [];

  const flush = (): void => {
    if (activeSection === undefined) {
      return;
    }

    const text = buffer.join("\n").trim();
    if (text.length === 0) {
      buffer = [];
      return;
    }

    sections.set(activeSection, [...(sections.get(activeSection) ?? []), text]);
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^(#{2,6})\s+\[([A-Z_]+)\]\s*$/u.exec(line.trim());

    if (heading !== null) {
      flush();
      activeSection = isKnowledgeSectionName(heading[2]) ? heading[2] : undefined;
      activeSectionDepth = activeSection === undefined ? 0 : heading[1].length;
      continue;
    }

    const ordinaryHeading = /^(#{1,6})\s+/u.exec(line.trim());
    if (ordinaryHeading !== null) {
      if (activeSection !== undefined && ordinaryHeading[1].length > activeSectionDepth) {
        buffer.push(line);
        continue;
      }

      flush();
      activeSection = undefined;
      activeSectionDepth = 0;
      continue;
    }

    if (activeSection !== undefined) {
      buffer.push(line);
    }
  }

  flush();

  return new Map(
    Array.from(sections.entries()).map(([section, values]) => [section, values.join("\n\n")]),
  );
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
    const parsedSections = parseKnowledgeSections(content);
    const sections = {} as Record<KnowledgeSectionName, string>;

    for (const section of input.sections) {
      const sectionContent = parsedSections.get(section);
      sections[section] = sectionContent ?? "";

      if (sectionContent === undefined) {
        diagnostics.push({
          code: "missing_section",
          severity: "warn",
          stable_id: rule.stable_id,
          section,
          message: `Rule ${rule.stable_id} does not define section ${section}.`,
        });
      }
    }

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
      sections,
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
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_sections_fetched",
      selection_token: input.selection_token,
      target_paths: token.target_paths,
      requested_sections: input.sections,
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

function isKnowledgeSectionName(value: string): value is KnowledgeSectionName {
  return KNOWLEDGE_SECTION_NAMES.includes(value as KnowledgeSectionName);
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

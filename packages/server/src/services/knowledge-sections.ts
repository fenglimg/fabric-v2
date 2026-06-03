import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { deriveAgentsMetaLayer, type AgentsLayer } from "@fenglimg/fabric-shared";
import { McpToolError } from "@fenglimg/fabric-shared/errors";

import { type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { buildCrossStoreBodyIndex, type CrossStoreBodyRef } from "./cross-store-recall.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { readSelectionToken, compareStableIds } from "./plan-context.js";
import { loadActiveMeta } from "./load-active-meta.js";
import { loadIdRedirectMap, resolveRedirectedId } from "./id-redirect.js";
import { bumpCounter, METRIC_COUNTER_NAMES } from "./metrics.js";
// ISS-017: extractBody is now the single shared implementation in _shared.ts.
// Re-exported here to preserve the existing import surface (recall.ts +
// knowledge-sections.test.ts import it from this module).
import { extractBody } from "./_shared.js";
export { extractBody };

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
  // Wave D (F7): `unresolved_selected_id` — a store-qualified id surfaced by
  // cross-store recall has no project-meta node; skipped instead of crashing.
  code: "missing_knowledge_metadata" | "unresolved_selected_id";
  severity: "warn";
  stable_id: string;
  message: string;
};

export type KnowledgeSectionResult = {
  revision_hash: string;
  selected_stable_ids: string[];
  rules: Array<{
    stable_id: string;
    level: AgentsLayer;
    path: string;
    body: string;
  }>;
  diagnostics: KnowledgeSectionDiagnostic[];
  // v2.0.0-rc.37 NEW-24: populated when the input `ai_selected_stable_ids`
  // referenced a layer-flipped id that was transparently rewritten to the
  // post-flip canonical id before fetching. Maps OLD id → NEW id so the
  // caller can refresh its cached selection. Omitted when no rewrites fired.
  redirect_to?: { stable_id: string } | Record<string, string>;
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
 * 4-element A-set enum (removed in F8b). The implementation now lives in
 * _shared.ts (ISS-017) and is re-exported above.
 */

export async function getKnowledgeSections(
  projectRoot: string,
  input: GetKnowledgeSectionsInput,
): Promise<KnowledgeSectionResult> {
  const token = readSelectionToken(input.selection_token);
  if (token === undefined) {
    // ISS-035: the MCP SDK serializes only `error.message` to the client, so
    // the recovery hint lives in the message AND the FabricError actionHint
    // field (the latter aligns with the payload-warning action_hint surface).
    throw new McpToolError(
      "selection_token is missing or expired — re-run fab_plan_context to obtain a fresh selection_token, then retry fab_get_knowledge_sections with the same ai_selected_stable_ids",
      {
        actionHint:
          "re-run fab_plan_context(paths) to mint a fresh selection_token, then call fab_get_knowledge_sections again with that token",
      },
    );
  }

  // v2.0.0-rc.37 NEW-24: rewrite any layer-flipped ids in the caller-supplied
  // selection BEFORE selectable-set validation. A stale id (cached from a
  // pre-flip plan-context call) would otherwise fail validation; with the
  // rewrite the caller transparently sees the new canonical id served and
  // gets back a redirect_to map describing every substitution that fired.
  let idRedirects: Map<string, string>;
  try {
    idRedirects = await loadIdRedirectMap(projectRoot);
  } catch {
    idRedirects = new Map();
  }
  const rewriteApplied: Record<string, string> = {};
  const rewrittenAiSelected = input.ai_selected_stable_ids.map((stableId) => {
    const resolved = resolveRedirectedId(idRedirects, stableId);
    if (resolved !== stableId) {
      rewriteApplied[stableId] = resolved;
    }
    return resolved;
  });
  // Reasons map keys may also reference the old id. Re-key onto the new id
  // so validateAiSelections sees a consistent (id, reason) pair set.
  const rewrittenReasons: Record<string, string> = { ...input.ai_selection_reasons };
  for (const [oldId, newId] of Object.entries(rewriteApplied)) {
    if (rewrittenReasons[oldId] !== undefined && rewrittenReasons[newId] === undefined) {
      rewrittenReasons[newId] = rewrittenReasons[oldId];
    }
  }

  validateAiSelections(token.ai_selectable_stable_ids, rewrittenAiSelected, rewrittenReasons);

  // v2.0.0-rc.22 Scope D T-D2: strict meta-load. Section delivery is an
  // authoritative id-based lookup; serving stale meta would mean handing back
  // bodies for ids that no longer exist or missing newly-resolved ones. We
  // want a loud failure (vs. silent staleness) when buildKnowledgeMeta breaks.
  const { meta } = await loadActiveMeta(projectRoot, { caller: "getKnowledgeSections" });
  const selectedStableIds = [...token.required_stable_ids, ...rewrittenAiSelected];
  // ISS-008: build the stable_id → node index ONCE (O(nodes)) instead of a full
  // Object.entries scan per selected id. In the common rc.37 "pick all" path
  // selectedStableIds ≈ every node, so the old per-id linear scan was O(n²).
  const ruleNodeIndex = buildRuleNodeIndex(meta);
  // v2.2 全砍 F7 (HIGH): store-qualified ids (`alias:id`, surfaced by cross-store
  // recall) have no node in the PROJECT's agents.meta — stores ship none. Build
  // the read-set body index so their bodies are delivered FROM THE STORE instead
  // of being silently skipped (the pre-F7 behavior where only the summary was
  // ever visible). A store id absent from the index too → genuinely unresolved
  // (deleted / not in read-set) → warn-skip. A bare, colon-less project-local id
  // that is missing still means real meta breakage → keep the loud failure.
  const storeBodyIndex = buildCrossStoreBodyIndex(projectRoot);
  const unresolvedSelectedIds: string[] = [];
  const storeSelected: Array<{ stableId: string; ref: CrossStoreBodyRef }> = [];
  const selectedRules = sortRuleNodes(
    selectedStableIds.flatMap((stableId) => {
      const entry = ruleNodeIndex.get(stableId);
      if (entry === undefined) {
        if (stableId.includes(":")) {
          const ref = storeBodyIndex.get(stableId);
          if (ref !== undefined) {
            storeSelected.push({ stableId, ref });
          } else {
            unresolvedSelectedIds.push(stableId);
          }
          return [];
        }
        throw new Error(`Selected rule is not present in agents.meta.json: ${stableId}`);
      }
      return [entry];
    }),
  );
  const diagnostics: KnowledgeSectionDiagnostic[] = [];
  const rules: KnowledgeSectionResult["rules"] = [];

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

  // v2.2 全砍 F7 (HIGH): deliver store-qualified bodies from the read-set store.
  // Store entries carry no agents.meta node, so they're served as L1 with the
  // store file path. A read failure here (file vanished between walk + read)
  // degrades to an unresolved diagnostic rather than crashing the whole call.
  for (const { stableId, ref } of storeSelected) {
    let content: string;
    try {
      content = await readFile(ref.file, "utf8");
    } catch {
      unresolvedSelectedIds.push(stableId);
      continue;
    }
    rules.push({
      stable_id: stableId,
      level: "L1",
      path: ref.file,
      body: extractBody(content),
    });
  }

  for (const stableId of unresolvedSelectedIds) {
    diagnostics.push({
      code: "unresolved_selected_id",
      severity: "warn",
      stable_id: stableId,
      message: `Selected rule '${stableId}' is not present in the project's agents.meta.json or any read-set store — skipped (deleted, layer-flipped, or its store is not bound).`,
    });
  }

  const result: KnowledgeSectionResult = {
    revision_hash: meta.revision,
    selected_stable_ids: rules.map((rule) => rule.stable_id),
    rules,
    diagnostics,
    // v2.0.0-rc.37 NEW-24: only surface redirect_to when a rewrite actually
    // fired. The shape is a `{ old_id: new_id, ... }` map so callers can
    // refresh multiple stale ids in one response; the legacy single-stable_id
    // form is preserved as a degenerate special case in the schema for
    // forward-compat (one rewrite = the canonical pre-rc.37 shape consumers
    // already understood).
    ...(Object.keys(rewriteApplied).length > 0 ? { redirect_to: rewriteApplied } : {}),
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

  // v2.0.0-rc.37 Wave B (B3): dual-write counter rollup. Per-call bump for
  // the fetched signal; the audit event continues to land in events.jsonl
  // because orphan_demote consumes per-id final_stable_ids[]. Cutover to
  // counter-only happens post-GA after lint readers migrate.
  bumpCounter(projectRoot, METRIC_COUNTER_NAMES.knowledge_sections_fetched);
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
    // v2.0.0-rc.37 Wave B (B3): dual-write per-id consumption counter alongside
    // the audit event. Counter name embeds the stable_id so post-GA migration
    // of orphan_demote / cite-coverage can switch to reading the metrics
    // sidecar without losing per-entry granularity.
    bumpCounter(projectRoot, `${METRIC_COUNTER_NAMES.knowledge_consumed}:${stableId}`);
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
      throw new Error(
        `Invalid rule selection "${stableId}": not in this token's plan-context candidates. Pass only stable_ids from fab_plan_context candidates[].stable_id.`,
      );
    }

    if (aiSelectionReasons[stableId]?.trim() === "") {
      throw new Error(`Missing AI selection reason for ${stableId}`);
    }

    if (aiSelectionReasons[stableId] === undefined) {
      throw new Error(`Missing AI selection reason for ${stableId}`);
    }
  }
}

// ISS-008: one-pass index of stable_id → resolved RuleNodeEntry. Preserves the
// previous linear-scan semantics exactly: first occurrence wins on a duplicate
// stable_id (Object.entries iteration order), so we never overwrite an existing
// key. Resolution of level/path/priority is identical to the old findRuleNode.
function buildRuleNodeIndex(meta: AgentsMeta): Map<string, RuleNodeEntry> {
  const index = new Map<string, RuleNodeEntry>();
  for (const [nodeId, node] of Object.entries(meta.nodes)) {
    const nodeStableId = node.stable_id ?? nodeId;
    if (index.has(nodeStableId)) {
      continue; // first-match-wins, mirroring the original scan's early return.
    }
    // v2.0.0-rc.30 TASK-003 (B.1 前置): 三段 fallback `node.level ?? node.layer
    // ?? "L2"` 简化为 `node.level ?? deriveAgentsMetaLayer(node.file)` —
    // 删 `node.layer` 中间段,移除对即将被 TASK-004 删除的 passthrough field
    // 的依赖。`node.level` declared 优先依然成立,fixture / 用户显式标的 level
    // 仍生效;只在节点未声明 level 时走 derive 而非吃 v1.x 残留 layer 字段。
    // `priority` 同理保留 declared 优先 — fixture 依赖 priority sort,
    // 提早全硬编码 "medium" 会破现有测试契约。
    const level: AgentsLayer = node.level ?? deriveAgentsMetaLayer(node.file);
    index.set(nodeStableId, {
      stable_id: nodeStableId,
      level,
      path: normalizeKnowledgePath(node.content_ref ?? node.file),
      priority: node.priority ?? "medium",
      node,
    });
  }
  return index;
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

    // ISS-029: numeric-aware so a 5-digit counter sorts after 9999, not before.
    return compareStableIds(left.stable_id, right.stable_id);
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

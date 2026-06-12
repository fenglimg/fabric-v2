export type AgentsTopologyType = "mirror" | "cross-cutting" | "domain" | "local" | "global";

export type AgentsIdentitySource = "declared" | "derived";

export interface RuleDescription {
  summary: string;
  intent_clues: string[];
  tech_stack: string[];
  impact: string[];
  must_read_if: string;
  entities?: string[];
  // v2.0 knowledge entry fields (TASK-002 schemas). All optional for backward compat.
  id?: string;
  knowledge_type?: "models" | "decisions" | "guidelines" | "pitfalls" | "processes";
  maturity?: "draft" | "verified" | "proven";
  knowledge_layer?: "personal" | "team";
  // v2.1 global-refactor (W2/A4): the entry's scope coordinate (schemas/scope.ts).
  // Carries `project:<id>` / `team` / `personal` into the resolveCandidates
  // double-axis ranking (scope-specificity tie-break under equal relevance).
  // Optional — only cross-store recall items populate it; project co-location
  // entries fall back to their knowledge_layer at rank time.
  semantic_scope?: string;
  layer_reason?: string;
  created_at?: string;
  // v2/rc.2: flat flow-style YAML array; auto-filled by init-scan from forensic tech-stack.
  tags?: string[];
  // v2.0-rc.5 (C1): relevance scope/paths drive plan-context-hint narrowing.
  // `relevance_scope='narrow'` opts an entry into path-filtered hints; `broad`
  // (default) always surfaces. `relevance_paths` are workspace-relative glob
  // anchors used to match against caller-supplied target paths. Both fields
  // default to safe values when absent from frontmatter (broad + []).
  relevance_scope?: "narrow" | "broad";
  relevance_paths?: string[];
  // v2.2 H2-related (W1-T7): explicit graph edges to related KB entries by
  // stable_id. Authored in frontmatter or written by the fabric-connect skill
  // (SK2); consumed by fab_recall include_related packaging (MC1). Optional —
  // pre-v2.2 entries simply lack it.
  related?: string[];
}

// v2.0.0-rc.38 UX-3 (D-MCP fold ③): collapsed to the two load-bearing fields.
// Removed the dead L0/L1/L2 selection-ceremony scalars (level/required/
// selectable — write-only since rc.5 A3) and every top-level mirror of a
// `description.*` field (type/maturity/layer/layer_reason/relevance_scope/
// relevance_paths/tags). All knowledge surface the LLM needs for selection
// lives in `description`; the mirrors were ~7 redundant keys per entry. The
// inferred knowledge layer (from content_ref) is now backfilled into
// `description.knowledge_layer` at build time so the layer signal survives
// without the top-level copy.
export interface RuleDescriptionIndexItem {
  stable_id: string;
  description: RuleDescription;
}

export interface AgentsMetaNode {
  file: string;
  content_ref?: string;
  scope_glob: string;
  hash: string;
  stable_id?: string;
  identity_source?: AgentsIdentitySource;
  description?: RuleDescription;
  sections?: string[];
  // v2.0-rc.5 A1: legacy protocol fields retired from the Zod schema but kept
  // here as optionals for transitional consumers / on-disk back-compat.
  // v2.0.0-rc.38 (Goal B scaffold-teardown): the dead L0/L1/L2 `level` axis was
  // removed entirely (dead-write — populated into output but read by nothing);
  // `relevance_scope` (broad/narrow on RuleDescription) is the single live
  // surfacing axis. `topology_type` derives from file path via
  // `deriveAgentsMetaTopologyType` rather than being read off the node.
  deps?: string[];
  priority?: "high" | "medium" | "low";
  topology_type?: AgentsTopologyType;
}

// v2.0: Knowledge-entry stable_id counters. Optional for backward compat —
// pre-v2.0 meta files lack the `counters` key and load with implicit zeros.
export interface AgentsMetaKnowledgeTypeCounters {
  MOD: number;
  DEC: number;
  GLD: number;
  PIT: number;
  PRO: number;
}

export interface AgentsMetaCountersEnvelope {
  KP: AgentsMetaKnowledgeTypeCounters;
  KT: AgentsMetaKnowledgeTypeCounters;
}

export interface AgentsMeta {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
  counters?: AgentsMetaCountersEnvelope;
}

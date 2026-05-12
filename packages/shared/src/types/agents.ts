export type AgentsLayer = "L0" | "L1" | "L2";

export type AgentsTopologyType = "mirror" | "cross-cutting" | "domain" | "local" | "global";

export type AgentsActivationTier = "always" | "path" | "description";
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
  knowledge_type?: "model" | "decision" | "guideline" | "pitfall" | "process";
  maturity?: "draft" | "verified" | "proven";
  knowledge_layer?: "personal" | "team";
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
}

export interface RuleDescriptionIndexItem {
  stable_id: string;
  level: AgentsLayer;
  required: boolean;
  selectable: boolean;
  description: RuleDescription;
  // v2.0: knowledge-layer surface for client-side filtering. Mirrors the
  // homonymous fields on `description` so callers don't have to reach into
  // the nested payload. Optional because v1.x entries lack frontmatter.
  type?: "model" | "decision" | "guideline" | "pitfall" | "process";
  maturity?: "draft" | "verified" | "proven";
  layer?: "personal" | "team";
  layer_reason?: string;
}

export interface AgentsMetaNodeActivation {
  tier: AgentsActivationTier;
  description?: string;
}

export interface AgentsMetaNode {
  file: string;
  content_ref?: string;
  scope_glob: string;
  hash: string;
  stable_id?: string;
  identity_source?: AgentsIdentitySource;
  activation?: AgentsMetaNodeActivation;
  description?: RuleDescription;
  sections?: string[];
  // v2.0-rc.5 A1: legacy L0/L1/L2 protocol fields retired from the Zod
  // schema but kept here as optionals for TASK-007 transitional consumers.
  // Consumers should derive these via `deriveAgentsMetaLayer` /
  // `deriveAgentsMetaTopologyType` rather than reading them off the node.
  deps?: string[];
  priority?: "high" | "medium" | "low";
  level?: AgentsLayer;
  layer?: AgentsLayer;
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

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
}

export interface RuleDescriptionIndexItem {
  stable_id: string;
  level: AgentsLayer;
  required: boolean;
  selectable: boolean;
  description: RuleDescription;
}

export interface AgentsMetaNodeActivation {
  tier: AgentsActivationTier;
  description?: string;
}

export interface AgentsMetaNode {
  file: string;
  content_ref?: string;
  scope_glob: string;
  deps: string[];
  priority: "high" | "medium" | "low";
  level?: AgentsLayer;
  layer: AgentsLayer;
  topology_type: AgentsTopologyType;
  hash: string;
  stable_id?: string;
  identity_source?: AgentsIdentitySource;
  activation?: AgentsMetaNodeActivation;
  description?: RuleDescription;
  sections?: string[];
}

export interface AgentsMeta {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
}

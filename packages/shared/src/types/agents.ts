export type AgentsLayer = "L0" | "L1" | "L2";

export type AgentsTopologyType = "mirror" | "cross-cutting";

export type AgentsActivationTier = "always" | "path" | "description";
export type AgentsIdentitySource = "declared" | "derived";

export interface AgentsMetaNodeActivation {
  tier: AgentsActivationTier;
  description?: string;
}

export interface AgentsMetaNode {
  file: string;
  scope_glob: string;
  deps: string[];
  priority: "high" | "medium" | "low";
  layer: AgentsLayer;
  topology_type: AgentsTopologyType;
  hash: string;
  stable_id?: string;
  identity_source?: AgentsIdentitySource;
  activation?: AgentsMetaNodeActivation;
}

export interface AgentsMeta {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
}

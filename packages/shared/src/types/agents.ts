export type AgentsLayer = "L0" | "L1" | "L2";

export type AgentsTopologyType = "mirror" | "cross-cutting";

export interface AgentsMetaNode {
  file: string;
  scope_glob: string;
  deps: string[];
  priority: "high" | "medium" | "low";
  layer: AgentsLayer;
  topology_type: AgentsTopologyType;
  hash: string;
}

export interface AgentsMeta {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
}

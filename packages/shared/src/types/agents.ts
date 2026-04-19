export interface AgentsMetaNode {
  file: string;
  scope_glob: string;
  deps: string[];
  priority: "high" | "medium" | "low";
  hash: string;
}

export interface AgentsMeta {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
}

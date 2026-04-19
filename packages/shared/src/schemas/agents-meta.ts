import { z } from "zod";

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

export const agentsMetaNodeSchema = z.object({
  file: z.string(),
  scope_glob: z.string(),
  deps: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  hash: z.string(),
});

export const agentsMetaSchema = z.object({
  revision: z.string(),
  nodes: z.record(agentsMetaNodeSchema),
});

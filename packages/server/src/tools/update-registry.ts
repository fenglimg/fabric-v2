import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentsLayerSchema, agentsTopologyTypeSchema } from "@fenglimg/fabric-shared";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { updateRegistry } from "../services/update-registry.js";

type UpdateRegistryInput = {
  op: "add-node" | "remove-node" | "update-node";
  node_id: string;
  data?: {
    file?: string;
    scope_glob?: string;
    deps?: string[];
    priority?: "high" | "medium" | "low";
    layer?: "L0" | "L1" | "L2";
    topology_type?: "mirror" | "cross-cutting";
    hash?: string;
  };
};

const nodeInputSchema = z.object({
  file: z.string().optional(),
  scope_glob: z.string().optional(),
  deps: z.array(z.string()).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  layer: agentsLayerSchema.optional(),
  topology_type: agentsTopologyTypeSchema.optional(),
  hash: z.string().optional(),
});

const inputSchema = {
  op: z.enum(["add-node", "remove-node", "update-node"]),
  node_id: z.string(),
  data: nodeInputSchema.optional(),
};

const outputSchema = z.object({
  success: z.boolean(),
  revision_hash: z.string(),
});

export function registerUpdateRegistry(server: McpServer): void {
  server.registerTool(
    "fab_update_registry",
    {
      description:
        "Call to add, remove, or update Fabric registry nodes. Use instead of editing .fabric/agents.meta.json directly.",
      inputSchema,
      outputSchema,
      annotations: { destructiveHint: true },
    },
    async ({ op, node_id, data }: UpdateRegistryInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await updateRegistry(projectRoot, { op, node_id, data });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

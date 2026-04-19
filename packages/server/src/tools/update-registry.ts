import { agentsMetaNodeSchema } from "@fenglimg/fabric-shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { updateRegistry } from "../services/update-registry.js";

type UpdateRegistryInput = {
  op: "add-node" | "remove-node" | "update-node";
  node_id: string;
  data?: Record<string, unknown>;
};

const inputSchema = {
  op: z.enum(["add-node", "remove-node", "update-node"]),
  node_id: z.string(),
  data: z.record(z.unknown()).optional(),
};

function createTextResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function registerUpdateRegistry(server: McpServer): void {
  server.tool(
    "fab_update_registry",
    "MANDATORY: Call to add, remove, or update Fabric registry nodes instead of editing registry files directly.",
    inputSchema,
    async ({ op, node_id, data }: UpdateRegistryInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await updateRegistry(projectRoot, { op, node_id, data });

      return createTextResponse(result);
    },
  );
}

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgentsMeta, readAgentsMeta, resolveProjectRoot } from "../meta-reader.js";

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

const agentsMetaNodeSchema = z.object({
  file: z.string(),
  scope_glob: z.string(),
  deps: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  hash: z.string(),
});

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

function computeRevision(meta: AgentsMeta): string {
  const joinedHashes = Object.entries(meta.nodes)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([, node]) => node.hash)
    .join("");

  return `sha256:${createHash("sha256").update(joinedHashes).digest("hex")}`;
}

function assertNodeData(
  data: Record<string, unknown> | undefined,
  message: string,
): z.infer<typeof agentsMetaNodeSchema> {
  if (data === undefined) {
    throw new Error(message);
  }

  return agentsMetaNodeSchema.parse(data);
}

function applyRegistryOperation(
  meta: AgentsMeta,
  op: "add-node" | "remove-node" | "update-node",
  nodeId: string,
  data: Record<string, unknown> | undefined,
): AgentsMeta {
  const nextNodes = { ...meta.nodes };

  if (op === "remove-node") {
    delete nextNodes[nodeId];

    return {
      ...meta,
      nodes: nextNodes,
    };
  }

  if (op === "add-node") {
    nextNodes[nodeId] = assertNodeData(data, `fab_update_registry requires data for ${op}`);

    return {
      ...meta,
      nodes: nextNodes,
    };
  }

  const currentNode = nextNodes[nodeId];

  if (currentNode === undefined) {
    throw new Error(`Cannot update missing Fabric registry node: ${nodeId}`);
  }

  nextNodes[nodeId] = agentsMetaNodeSchema.parse({
    ...currentNode,
    ...data,
  });

  return {
    ...meta,
    nodes: nextNodes,
  };
}

export function registerUpdateRegistry(server: McpServer): void {
  server.tool(
    "fab_update_registry",
    "MANDATORY: Call to add, remove, or update Fabric registry nodes instead of editing registry files directly.",
    inputSchema,
    async ({ op, node_id, data }: UpdateRegistryInput) => {
      const projectRoot = resolveProjectRoot();
      const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
      const currentMeta = readAgentsMeta(projectRoot);
      const nextMeta = applyRegistryOperation(currentMeta, op, node_id, data);
      const newRevision = computeRevision(nextMeta);

      await writeFile(
        metaPath,
        `${JSON.stringify(
          {
            ...nextMeta,
            revision: newRevision,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      return createTextResponse({
        revision_hash: newRevision,
        success: true,
      });
    },
  );
}

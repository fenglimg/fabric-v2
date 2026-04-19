import type { AgentsMeta } from "@fenglimg/fabric-shared";
import { agentsMetaNodeSchema } from "@fenglimg/fabric-shared";
import { join } from "node:path";

import { readAgentsMeta } from "../meta-reader.js";
import { FABRIC_DIR, atomicWriteText, sha256 } from "./_shared.js";

export type UpdateRegistryInput = {
  op: "add-node" | "remove-node" | "update-node";
  node_id: string;
  data?: Record<string, unknown>;
};

export type UpdateRegistryResult = {
  revision_hash: string;
  success: true;
};

export async function updateRegistry(
  projectRoot: string,
  input: UpdateRegistryInput,
): Promise<UpdateRegistryResult> {
  const metaPath = join(projectRoot, FABRIC_DIR, "agents.meta.json");
  const currentMeta = readAgentsMeta(projectRoot);
  const nextMeta = applyRegistryOperation(currentMeta, input.op, input.node_id, input.data);
  const newRevision = computeRevision(nextMeta);

  await atomicWriteText(
    metaPath,
    `${JSON.stringify(
      {
        ...nextMeta,
        revision: newRevision,
      },
      null,
      2,
    )}\n`,
  );

  return {
    revision_hash: newRevision,
    success: true,
  };
}

function computeRevision(meta: AgentsMeta): string {
  const joinedHashes = Object.entries(meta.nodes)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([, node]) => node.hash)
    .join("");

  return sha256(joinedHashes);
}

function assertNodeData(
  data: Record<string, unknown> | undefined,
  message: string,
): AgentsMeta["nodes"][string] {
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

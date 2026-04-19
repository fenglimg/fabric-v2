import { z } from "zod";

import type { AgentsLayer, AgentsMetaNode, AgentsTopologyType } from "../types/agents.js";

const FABRIC_AGENTS_PREFIX = ".fabric/agents/";

export const AGENTS_META_LAYERS = ["L0", "L1", "L2"] as const;
export const AGENTS_META_TOPOLOGY_TYPES = ["mirror", "cross-cutting"] as const;

export const agentsLayerSchema = z.enum(AGENTS_META_LAYERS);
export const agentsTopologyTypeSchema = z.enum(AGENTS_META_TOPOLOGY_TYPES);

type AgentsMetaNodeInput = Omit<AgentsMetaNode, "layer" | "topology_type"> &
  Partial<Pick<AgentsMetaNode, "layer" | "topology_type">>;

const agentsMetaNodeBaseSchema = z.object({
  file: z.string(),
  scope_glob: z.string(),
  deps: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  layer: agentsLayerSchema,
  topology_type: agentsTopologyTypeSchema,
  hash: z.string(),
});

export const agentsMetaNodeSchema = z.preprocess((value) => {
  if (!isRecord(value) || typeof value.file !== "string") {
    return value;
  }

  return withDerivedAgentsMetaNodeDefaults(value as AgentsMetaNodeInput);
}, agentsMetaNodeBaseSchema);

export const agentsMetaSchema = z.object({
  revision: z.string(),
  nodes: z.record(agentsMetaNodeSchema),
});

export function withDerivedAgentsMetaNodeDefaults(node: AgentsMetaNodeInput): AgentsMetaNode {
  return {
    ...node,
    layer: node.layer ?? deriveAgentsMetaLayer(node.file),
    topology_type: node.topology_type ?? deriveAgentsMetaTopologyType(node.file),
  };
}

export function deriveAgentsMetaLayer(file: string): AgentsLayer {
  const normalized = normalizePath(file);

  if (normalized === "AGENTS.md") {
    return "L0";
  }

  if (hasCrossCuttingSegment(normalized)) {
    return "L1";
  }

  const depthSource = getDepthSource(normalized);
  const directoryDepth = getDirectoryDepth(depthSource);

  if (directoryDepth === 0) {
    return "L0";
  }

  if (directoryDepth <= 2) {
    return "L1";
  }

  return "L2";
}

export function deriveAgentsMetaTopologyType(file: string): AgentsTopologyType {
  return hasCrossCuttingSegment(normalizePath(file)) ? "cross-cutting" : "mirror";
}

function getDepthSource(file: string): string {
  return file.startsWith(FABRIC_AGENTS_PREFIX) ? file.slice(FABRIC_AGENTS_PREFIX.length) : file;
}

function getDirectoryDepth(file: string): number {
  const segments = file.split("/").filter(Boolean);
  return Math.max(segments.length - 1, 0);
}

function hasCrossCuttingSegment(file: string): boolean {
  return file.split("/").includes("_cross");
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { z } from "zod";

import type {
  AgentsIdentitySource,
  AgentsLayer,
  AgentsMetaNode,
  AgentsTopologyType,
} from "../types/agents.js";

const FABRIC_AGENTS_PREFIX = ".fabric/agents/";

export const AGENTS_META_LAYERS = ["L0", "L1", "L2"] as const;
export const AGENTS_META_TOPOLOGY_TYPES = ["mirror", "cross-cutting"] as const;
export const AGENTS_META_IDENTITY_SOURCES = ["declared", "derived"] as const;

export const agentsLayerSchema = z.enum(AGENTS_META_LAYERS);
export const agentsTopologyTypeSchema = z.enum(AGENTS_META_TOPOLOGY_TYPES);
export const agentsIdentitySourceSchema = z.enum(AGENTS_META_IDENTITY_SOURCES);

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
  stable_id: z.string().optional(),
  identity_source: agentsIdentitySourceSchema.optional(),
  activation: z
    .object({
      tier: z.enum(["always", "path", "description"]),
      description: z.string().optional(),
    })
    .optional(),
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
  const stableId = node.stable_id ?? deriveAgentsMetaStableId(node.file);
  const identitySource = deriveAgentsMetaIdentitySource(node);

  return {
    ...node,
    layer: node.layer ?? deriveAgentsMetaLayer(node.file),
    topology_type: node.topology_type ?? deriveAgentsMetaTopologyType(node.file),
    stable_id: stableId,
    identity_source: identitySource,
  };
}

export function deriveAgentsMetaStableId(file: string): string {
  const normalized = normalizePath(file);

  if (normalized === "AGENTS.md" || normalized === ".fabric/bootstrap/README.md") {
    return "bootstrap";
  }

  return getDepthSource(normalized).replace(/\.md$/u, "");
}

export function deriveAgentsMetaIdentitySource(
  node: Pick<AgentsMetaNode, "file"> & Partial<Pick<AgentsMetaNode, "stable_id" | "identity_source">>,
): AgentsIdentitySource {
  if (node.identity_source !== undefined) {
    return node.identity_source;
  }

  const derivedStableId = deriveAgentsMetaStableId(node.file);
  return node.stable_id !== undefined && node.stable_id !== derivedStableId ? "declared" : "derived";
}

export function deriveAgentsMetaLayer(file: string): AgentsLayer {
  const normalized = normalizePath(file);

  if (normalized === "AGENTS.md" || normalized === ".fabric/bootstrap/README.md") {
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

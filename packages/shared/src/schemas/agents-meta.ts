import { z } from "zod";

import type {
  AgentsIdentitySource,
  AgentsLayer,
  AgentsMetaNode,
  AgentsTopologyType,
} from "../types/agents.js";
import {
  KNOWLEDGE_TYPE_CODES,
  formatKnowledgeId,
  type KnowledgeType,
  type Layer,
  type StableId,
} from "./api-contracts.js";

const FABRIC_AGENTS_PREFIX = ".fabric/agents/";

export const AGENTS_META_LAYERS = ["L0", "L1", "L2"] as const;
export const AGENTS_META_TOPOLOGY_TYPES = ["mirror", "cross-cutting", "domain", "local", "global"] as const;
export const AGENTS_META_IDENTITY_SOURCES = ["declared", "derived"] as const;

export const agentsLayerSchema = z.enum(AGENTS_META_LAYERS);
export const agentsTopologyTypeSchema = z.enum(AGENTS_META_TOPOLOGY_TYPES);
export const agentsIdentitySourceSchema = z.enum(AGENTS_META_IDENTITY_SOURCES);

type AgentsMetaNodeInput = Omit<AgentsMetaNode, "layer" | "topology_type"> &
  Partial<Pick<AgentsMetaNode, "layer" | "topology_type">>;

export const ruleDescriptionSchema = z
  .object({
    summary: z.string(),
    intent_clues: z.array(z.string()),
    tech_stack: z.array(z.string()),
    impact: z.array(z.string()),
    must_read_if: z.string(),
    entities: z.array(z.string()).optional(),
    // v2.0 knowledge entry fields (TASK-002 schemas). All optional for backward compat.
    id: z.string().optional(),
    knowledge_type: z.enum(["model", "decision", "guideline", "pitfall", "process"]).optional(),
    maturity: z.enum(["draft", "verified", "proven"]).optional(),
    knowledge_layer: z.enum(["personal", "team"]).optional(),
    layer_reason: z.string().optional(),
    created_at: z.string().optional(),
    // v2/rc.2: flat flow-style YAML array; populated by init-scan from forensic tech stack and editable by user. Used by rc.3 review skill for tag-filter search.
    tags: z.array(z.string()).default([]).optional(),
  })
  .strict();

export const ruleDescriptionIndexItemSchema = z
  .object({
    stable_id: z.string(),
    level: agentsLayerSchema,
    required: z.boolean(),
    selectable: z.boolean(),
    description: ruleDescriptionSchema,
  })
  .strict();

const agentsMetaNodeBaseSchema = z.object({
  file: z.string(),
  content_ref: z.string().optional(),
  scope_glob: z.string(),
  deps: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  level: agentsLayerSchema.optional(),
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
  description: ruleDescriptionSchema.optional(),
  sections: z.array(z.string()).optional(),
});

export const agentsMetaNodeSchema = z.preprocess((value) => {
  if (!isRecord(value) || typeof value.file !== "string") {
    return value;
  }

  return withDerivedAgentsMetaNodeDefaults(value as AgentsMetaNodeInput);
}, agentsMetaNodeBaseSchema);

// ---------------------------------------------------------------------------
// v2.0 knowledge counters envelope
//
// Used by stable_id allocation for knowledge entries (KP-/KT- prefixes).
// Optional with defaults so v1.x meta files load without modification.
// ---------------------------------------------------------------------------

const knowledgeTypeCountersSchema = z
  .object({
    MOD: z.number().int().nonnegative().default(0),
    DEC: z.number().int().nonnegative().default(0),
    GLD: z.number().int().nonnegative().default(0),
    PIT: z.number().int().nonnegative().default(0),
    PRO: z.number().int().nonnegative().default(0),
  })
  .default({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });

export const AgentsMetaCountersSchema = z
  .object({
    KP: knowledgeTypeCountersSchema,
    KT: knowledgeTypeCountersSchema,
  })
  .default({
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  });

export type AgentsMetaCounters = z.infer<typeof AgentsMetaCountersSchema>;

export const agentsMetaSchema = z.object({
  revision: z.string(),
  nodes: z.record(agentsMetaNodeSchema),
  counters: AgentsMetaCountersSchema.optional(),
});

// v2.0: Knowledge entry stable_id pattern (KP-/KT-{TYPE}-{NNNN})
// When a stable_id matches this pattern it is treated as authoritative
// (`identity_source = 'declared'`) and is NOT derived from the file path —
// allowing knowledge entries to be moved between directories without changing
// their identity (path-decoupled).
const KNOWLEDGE_STABLE_ID_PATTERN = /^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u;

export function isKnowledgeStableId(stableId: string | undefined): boolean {
  return stableId !== undefined && KNOWLEDGE_STABLE_ID_PATTERN.test(stableId);
}

export function withDerivedAgentsMetaNodeDefaults(node: AgentsMetaNodeInput): AgentsMetaNode {
  // Knowledge entries (KP-/KT-) are path-decoupled — preserve declared id verbatim.
  const isKnowledgeEntry = isKnowledgeStableId(node.stable_id);
  const stableId = node.stable_id ?? deriveAgentsMetaStableId(node.file);
  const identitySource = isKnowledgeEntry ? "declared" : deriveAgentsMetaIdentitySource(node);

  return {
    ...node,
    layer: node.layer ?? node.level ?? deriveAgentsMetaLayer(node.file),
    level: node.level ?? node.layer ?? deriveAgentsMetaLayer(node.file),
    topology_type: node.topology_type ?? deriveAgentsMetaTopologyType(node.file),
    stable_id: stableId,
    identity_source: identitySource,
  };
}

/**
 * v2.0: Pure path-decoupled stable_id allocator for knowledge entries.
 *
 * Given the current counters envelope, returns the NEXT id for the
 * (layer, type) pair plus a new counters object with that slot incremented.
 * Counters are monotonic: the function never reuses a previously-allocated
 * counter, even after deletion, so historical ids remain unique.
 *
 * @example
 *   allocateKnowledgeId('team', 'decision',
 *     { KP: zeros, KT: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 } })
 *   // → { id: 'KT-DEC-0006',
 *   //     nextCounters: { KP: zeros, KT: { ..., DEC: 6 } } }
 */
export function allocateKnowledgeId(
  layer: Layer,
  type: KnowledgeType,
  current: AgentsMetaCounters,
): { id: StableId; nextCounters: AgentsMetaCounters } {
  const layerKey: "KP" | "KT" = layer === "personal" ? "KP" : "KT";
  const typeCode = KNOWLEDGE_TYPE_CODES[type];
  const previousCount = current[layerKey][typeCode] ?? 0;
  const nextCount = previousCount + 1;
  const id = formatKnowledgeId(layer, type, nextCount);

  const nextCounters: AgentsMetaCounters = {
    ...current,
    [layerKey]: {
      ...current[layerKey],
      [typeCode]: nextCount,
    },
  };

  return { id, nextCounters };
}

/**
 * v2.0: Default counters envelope (all slots zero). Used when a meta file
 * does not yet carry the v2.0 counters key.
 */
export function defaultAgentsMetaCounters(): AgentsMetaCounters {
  return {
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  };
}

/**
 * Path-derived stable_id (legacy / fallback for non-knowledge files).
 *
 * v2.0 NOTE: This function is NOT used for knowledge entries (KP-/KT-).
 * Knowledge ids are allocated via `allocateKnowledgeId` and persisted in
 * frontmatter; their identity travels with the file content, not its path.
 */
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

  // v2.0: Knowledge entry ids (KP-/KT-) are always declared regardless of path.
  if (isKnowledgeStableId(node.stable_id)) {
    return "declared";
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

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

// rc.31 NEW-1: legacy singular → canonical plural map for knowledge_type
// forward-compat. Mirrors knowledge-meta-builder.ts SINGULAR_TO_PLURAL but
// applied at the schema-validation layer so already-persisted agents.meta.json
// entries load without aborting doctor / plan-context-hint.
const KNOWLEDGE_TYPE_SINGULAR_TO_PLURAL = {
  model: "models",
  decision: "decisions",
  guideline: "guidelines",
  pitfall: "pitfalls",
  process: "processes",
} as const;

export const AGENTS_META_LAYERS = ["L0", "L1", "L2"] as const;
export const AGENTS_META_TOPOLOGY_TYPES = ["mirror", "cross-cutting", "domain", "local", "global"] as const;
export const AGENTS_META_IDENTITY_SOURCES = ["declared", "derived"] as const;

export const agentsLayerSchema = z.enum(AGENTS_META_LAYERS);
export const agentsTopologyTypeSchema = z.enum(AGENTS_META_TOPOLOGY_TYPES);
export const agentsIdentitySourceSchema = z.enum(AGENTS_META_IDENTITY_SOURCES);

// v2.0-rc.5 A1: `layer`/`topology_type` are now optional on AgentsMetaNode
// (legacy protocol retired); `AgentsMetaNodeInput` is the bare interface for
// path-derived defaults.
type AgentsMetaNodeInput = AgentsMetaNode;

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
    // rc.31 NEW-1: forward-compat for legacy on-disk agents.meta.json carrying
    // singular knowledge_type values (model/decision/guideline/pitfall/process).
    // Normalize to canonical plural form before enum validation so doctor and
    // plan-context-hint can load pre-rc.28 meta files without aborting. Disk
    // gets rewritten to plural on next reconcile (via knowledge-meta-builder).
    knowledge_type: z
      .preprocess(
        (value) =>
          typeof value === "string" && value in KNOWLEDGE_TYPE_SINGULAR_TO_PLURAL
            ? KNOWLEDGE_TYPE_SINGULAR_TO_PLURAL[value as keyof typeof KNOWLEDGE_TYPE_SINGULAR_TO_PLURAL]
            : value,
        z.enum(["models", "decisions", "guidelines", "pitfalls", "processes"]),
      )
      .optional(),
    maturity: z.enum(["draft", "verified", "proven"]).optional(),
    knowledge_layer: z.enum(["personal", "team"]).optional(),
    layer_reason: z.string().optional(),
    created_at: z.string().optional(),
    // v2/rc.2: flat flow-style YAML array; populated by init-scan from forensic tech stack and editable by user. Used by rc.3 review skill for tag-filter search.
    tags: z.array(z.string()).default([]).optional(),
    // v2.0-rc.5 (C1): relevance scope/paths drive plan-context-hint narrowing.
    // Defaults applied so existing entries lacking these fields parse cleanly:
    //   relevance_scope → 'broad'   (always-surface, safe default)
    //   relevance_paths → []        (no path anchors)
    relevance_scope: z.enum(["narrow", "broad"]).default("broad"),
    relevance_paths: z.array(z.string()).default([]),
    // v2.2 H2-related (W1-T7): explicit graph edges to related KB entries by
    // stable_id. Authored in frontmatter (`related: [KT-DEC-0001, KT-PIT-0002]`)
    // or written by the fabric-connect skill (SK2); read by fab_recall's
    // include_related packaging (MC1). Optional + default [] so the field is a
    // pure additive — every pre-v2.2 entry parses unchanged. The schema is
    // .strict(), so this MUST be declared or `related:` frontmatter would be
    // rejected at parse time.
    related: z.array(z.string()).default([]).optional(),
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

// v2.0-rc.5 A1: retire L0/L1/L2 protocol — `level`, `layer`, `deps`,
// `topology_type`, `priority` removed from the schema. Surface remains
// path-derivable via `deriveAgentsMetaLayer` / `deriveAgentsMetaTopologyType`
// when consumers need it. Older on-disk meta files carrying these fields
// continue to load (Zod strips unknown keys by default).
//
// v2.0.0-rc.30 TASK-004 (B.1, replacing rc.29 TASK-007 BUG-P1 documentation):
// the `level` vs `layer` double semantic is GONE — `layer` was removed
// entirely from AgentsMetaNode + withDerivedAgentsMetaNodeDefaults. The
// v1→v2 dual-write was a migration shim where disk wrote both fields with
// identical values; cleanup deferred until knowledge-sections.ts +
// get-knowledge.ts upstream consumers migrated to `node.level ??
// deriveAgentsMetaLayer(file)` in TASK-003. Single source of truth for
// loading semantic:
//
//   - declared `node.level` (override on meta.json) takes priority
//   - else `deriveAgentsMetaLayer(file)` derives L0/L1/L2 from file path depth
//
// Storage layer (team vs personal) is a SEPARATE concept tracked at
// frontmatter (`knowledge_layer`) + disk path (`.fabric/knowledge/team/*`
// vs `~/.fabric/knowledge/personal/*`) — never the `layer` field on this
// schema (which was always L0/L1/L2 enum, not team/personal). See
// memory/project_l0_l1_l2_redesign_v21.md for v2.1 redesign that will
// rename `level` to `load` and add explicit `scope: team|personal`.
const agentsMetaNodeBaseSchema = z.object({
  file: z.string(),
  content_ref: z.string().optional(),
  scope_glob: z.string(),
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
}).passthrough(); // v2.0-rc.5: L0/L1/L2 protocol fields (level/deps/topology_type/priority) removed from the declared schema but preserved through parse() via .passthrough(). v2.0.0-rc.30 TASK-003+TASK-004 closure: knowledge-sections.ts + get-knowledge.ts upstream consumers migrated to `node.level ?? deriveAgentsMetaLayer(file)`, `node.priority` kept as fallback for test fixture sort contracts; `node.layer` field removed entirely (was a dual-write of `level` with identical values in every observed workspace). Passthrough retained to load pre-rc.30 on-disk meta files without re-key churn; v2.1 redesign (see memory/project_l0_l1_l2_redesign_v21.md) may replace passthrough with strict schema once disk migration completes.

export const agentsMetaNodeSchema = z.preprocess((value) => {
  if (!isRecord(value) || typeof value.file !== "string") {
    return value;
  }

  return withDerivedAgentsMetaNodeDefaults(value as unknown as AgentsMetaNodeInput);
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

  // v2.0-rc.5: legacy L0/L1/L2 protocol fields (level/topology_type) are
  // no longer declared in the Zod schema. They remain populated as
  // transitional defaults via .passthrough() so knowledge-sections.ts and
  // get-knowledge.ts (after TASK-003 migration: only as the optional
  // `node.level ?? derive()` short-circuit) keep functioning.
  // v2.0.0-rc.30 TASK-004 (B.1): `layer` field dropped — was a v1→v2 dual
  // with `level` writing identical values to disk. Single source of truth:
  // declared `node.level` (override) OR derive from file path.
  return {
    ...node,
    level: node.level ?? deriveAgentsMetaLayer(node.file),
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
 *   allocateKnowledgeId('team', 'decisions',
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

  if (normalized === "AGENTS.md") {
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

import { z } from "zod";

import { StableIdSchema } from "./api-contracts.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0 — Per-store + per-uid stable_id contract
//
// Surface: S27. REVERSES KT-DEC-0004's single global monotonic counter living
// in one `agents.meta.json`. In the N-parallel-git-store model each store owns
// an INDEPENDENT counter namespace, and personal ids are ADDITIONALLY namespaced
// by `uid` so the same personal store synced across two machines/accounts never
// collides. See memory/project_layered_kb_registry_northstar.md
// ("stable_id per-store+per-uid namespace (推翻 KT-DEC-0004)").
//
// Pure definition layer (P0): grammar + format/parse + counter envelope shape.
// Counter ALLOCATION (monotonic, per-store) is implemented in P0.6/P1.
//
// Two id forms:
//   local_id   — `K[PT]-TYPE-NNNN`, unique WITHIN one store (per-store counter).
//                Reuses the v2.0 StableIdSchema grammar verbatim — the change
//                is where the counter lives, not the string shape.
//   global_ref — store-qualified, globally unambiguous across mounted stores:
//                  shared:   `<store_uuid>:<local_id>`
//                  personal: `<store_uuid>:<uid>:<local_id>`   (uid segment)
//                This is what MCP recall/cite surface as `global_ref` (F1/F3,
//                P2/P4) so the AI can disambiguate same-numbered ids living in
//                different stores ("shadowing not silently merged", S61).
// ---------------------------------------------------------------------------

// local_id == the v2.0 stable_id grammar (KP-/KT-{TYPE}-{NNNN}). Re-aliased
// for call-site clarity in the multi-store context.
export const localKnowledgeIdSchema = StableIdSchema;
export type LocalKnowledgeId = z.infer<typeof localKnowledgeIdSchema>;

// A `uid` segment in a global_ref: lowercased hex/alnum-dash, non-empty. The
// uid itself is minted in the global config (S33) — typically a hash of
// git user.email. Kept loose (no fixed length) so the hashing strategy can
// evolve without a grammar change.
export const UID_SEGMENT_PATTERN = /^[a-z0-9-]+$/u;
export const uidSchema = z
  .string()
  .min(1)
  .regex(UID_SEGMENT_PATTERN, "uid must be lowercase [a-z0-9-] segments");
export type Uid = z.infer<typeof uidSchema>;

// global_ref grammar. The store reference is the intrinsic store UUID (aliases
// are a per-machine read-time convenience resolved by StoreResolver, never
// baked into the canonical ref). Optional middle uid segment marks a personal
// (per-uid) entry.
export const GLOBAL_REF_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[a-z0-9-]+)?:K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u;

export const globalRefSchema = z
  .string()
  .regex(GLOBAL_REF_PATTERN, "global_ref must be <store_uuid>[:<uid>]:<local_id>");
export type GlobalRef = z.infer<typeof globalRefSchema>;

export interface ParsedGlobalRef {
  store_uuid: string;
  // Present iff the entry is per-uid namespaced (personal layer).
  uid?: string;
  local_id: string;
}

// Build a global_ref from its parts. `uid` is included only for personal
// (per-uid) entries; omit it for shared (team/project) entries.
export function formatGlobalRef(parts: ParsedGlobalRef): string {
  const { store_uuid, uid, local_id } = parts;
  return uid === undefined
    ? `${store_uuid}:${local_id}`
    : `${store_uuid}:${uid}:${local_id}`;
}

// Parse a global_ref back into its parts, or null if malformed. A store UUID is
// fixed-shape (5 dash-joined hex groups), so the local_id is always the trailing
// `K[PT]-...` token and the optional uid is whatever sits between them.
export function parseGlobalRef(ref: string): ParsedGlobalRef | null {
  if (!GLOBAL_REF_PATTERN.test(ref)) {
    return null;
  }
  const localMatch = ref.match(/K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u);
  if (localMatch === null) {
    return null;
  }
  const local_id = localMatch[0];
  // Strip trailing ":<local_id>", leaving "<store_uuid>" or "<store_uuid>:<uid>".
  const head = ref.slice(0, ref.length - local_id.length - 1);
  const firstColon = head.indexOf(":");
  if (firstColon === -1) {
    return { store_uuid: head, local_id };
  }
  return {
    store_uuid: head.slice(0, firstColon),
    uid: head.slice(firstColon + 1),
    local_id,
  };
}

// ---------------------------------------------------------------------------
// Per-store counter envelope. Each store persists its OWN counters (in the
// store's agents.meta.json, rebuilt deterministically — S18). Same per-type
// shape as v2.0's AgentsMetaCounters but scoped to a single store rather than a
// single global file. KP (personal) counters are only meaningful in a personal
// store; KT (shared) counters only in a shared store — but the envelope carries
// both for layout parity (S42/A2).
// ---------------------------------------------------------------------------
const storeKnowledgeTypeCountersSchema = z
  .object({
    MOD: z.number().int().nonnegative().default(0),
    DEC: z.number().int().nonnegative().default(0),
    GLD: z.number().int().nonnegative().default(0),
    PIT: z.number().int().nonnegative().default(0),
    PRO: z.number().int().nonnegative().default(0),
  })
  .default({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });

export const storeCountersSchema = z
  .object({
    KP: storeKnowledgeTypeCountersSchema,
    KT: storeKnowledgeTypeCountersSchema,
  })
  .default({
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  });

export type StoreCounters = z.infer<typeof storeCountersSchema>;

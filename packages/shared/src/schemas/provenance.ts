import { z } from "zod";

import { localKnowledgeIdSchema, globalRefSchema } from "./store-stable-id.js";
import { scopeCoordinateSchema } from "./scope.js";
import { storeUuidSchema } from "./store.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Knowledge provenance (store edge visible to the AI).
//
// Surfaces: F1 (provenance visible) · S61 (store-qualified ids; shadowing not
// silently merged). Every knowledge entry surfaced by the 6 MCP tools
// (fab_recall / fab_plan_context / fab_get_knowledge_sections / fab_archive_scan
// / fab_extract_knowledge / fab_review) carries this envelope so the AI can tell
// WHICH store an entry came from and cite it store-qualified.
//
//   store_uuid — intrinsic store identity (authoritative)
//   alias      — local per-machine alias for that store (human-facing)
//   local_id   — per-store stable id (KP-/KT-{TYPE}-{NNNN})
//   global_ref — globally unambiguous <store_uuid>[:<uid>]:<local_id> (the cite
//                form; disambiguates same-numbered ids across stores)
// ---------------------------------------------------------------------------
export const knowledgeProvenanceSchema = z
  .object({
    store_uuid: storeUuidSchema,
    alias: z.string().min(1),
    local_id: localKnowledgeIdSchema,
    global_ref: globalRefSchema,
    // Optional scope coordinate of the entry (resolution axis); present when the
    // surfacing tool has read the entry's frontmatter.
    semantic_scope: scopeCoordinateSchema.optional(),
  })
  .strict();

export type KnowledgeProvenance = z.infer<typeof knowledgeProvenanceSchema>;

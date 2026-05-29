import { z } from "zod";

import { knowledgeProvenanceSchema } from "./provenance.js";
import { globalRefSchema } from "./store-stable-id.js";
import { storeUuidSchema } from "./store.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Store-aware MCP tool contracts.
//
// The 6 MCP tools each gain a store edge (S61/F1). This module lives DOWNSTREAM
// of both api-contracts and provenance (provenance → store-stable-id →
// api-contracts), so composing the store-aware shapes here avoids the import
// cycle that would arise from editing api-contracts to import provenance.
//
// Two store-aware additions, by tool role:
//   - READ tools (fab_recall / fab_plan_context / fab_get_knowledge_sections /
//     fab_review): each surfaced entry carries a `provenance` envelope and is
//     cited by `global_ref` (store-qualified).
//   - WRITE tools (fab_archive_scan / fab_extract_knowledge): the output echoes
//     `written_to_store` so the AI sees WHERE the entry landed (F1).
// ---------------------------------------------------------------------------

// The 6 store-aware MCP tools (locked surface).
export const MCP_STORE_AWARE_TOOLS = [
  "fab_recall",
  "fab_plan_context",
  "fab_get_knowledge_sections",
  "fab_archive_scan",
  "fab_extract_knowledge",
  "fab_review",
] as const;
export type McpStoreAwareTool = (typeof MCP_STORE_AWARE_TOOLS)[number];

// READ-tool surfaced entry: identity + provenance. `stable_id` keeps the bare
// local id for back-compat display; `global_ref` is the store-qualified cite
// form; `provenance` is the full store edge.
export const storeAwareEntrySchema = z
  .object({
    stable_id: z.string(),
    global_ref: globalRefSchema,
    provenance: knowledgeProvenanceSchema,
  })
  .strict();
export type StoreAwareEntry = z.infer<typeof storeAwareEntrySchema>;

// WRITE-tool echo: which store the write landed in.
export const writtenToStoreSchema = z
  .object({
    store_uuid: storeUuidSchema,
    alias: z.string().min(1),
  })
  .strict();
export type WrittenToStore = z.infer<typeof writtenToStoreSchema>;

// Per-tool store-aware contract descriptor. `surfacesEntries` = READ tool
// emitting provenance entries; `echoesWrittenStore` = WRITE tool echoing the
// target store. fab_review does both (aggregates pending entries across stores
// + can promote, echoing the store).
export interface McpStoreAwareContract {
  tool: McpStoreAwareTool;
  surfacesEntries: boolean;
  echoesWrittenStore: boolean;
}

export const MCP_STORE_AWARE_CONTRACTS: Record<McpStoreAwareTool, McpStoreAwareContract> = {
  fab_recall: { tool: "fab_recall", surfacesEntries: true, echoesWrittenStore: false },
  fab_plan_context: { tool: "fab_plan_context", surfacesEntries: true, echoesWrittenStore: false },
  fab_get_knowledge_sections: {
    tool: "fab_get_knowledge_sections",
    surfacesEntries: true,
    echoesWrittenStore: false,
  },
  fab_archive_scan: {
    tool: "fab_archive_scan",
    surfacesEntries: false,
    echoesWrittenStore: true,
  },
  fab_extract_knowledge: {
    tool: "fab_extract_knowledge",
    surfacesEntries: false,
    echoesWrittenStore: true,
  },
  fab_review: { tool: "fab_review", surfacesEntries: true, echoesWrittenStore: true },
};

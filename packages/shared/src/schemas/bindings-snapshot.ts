import { z } from "zod";

import { storeReadSetSchema, writeTargetSchema } from "../resolver/contracts.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Resolved bindings snapshot (P3→P4 dependency-chain link).
//
// CLI `install` / `sync` / `bind` pre-resolve the project's read-set +
// write-target via the StoreResolver and persist the result to
// `~/.fabric/state/bindings/<project_id>_resolved.json`. P4 hooks then read this
// snapshot directly (no re-resolution, no store parsing) and degrade harmlessly
// when it is absent (roadmap gemini#1). The snapshot MUST equal what the
// resolver produces from the same inputs (the P3 consistency acceptance test).
// ---------------------------------------------------------------------------
export const resolvedBindingsSnapshotSchema = z
  .object({
    // Schema version of the snapshot document.
    version: z.literal(1),
    // The project this snapshot is bound to (S13).
    project_id: z.string().min(1),
    // ISO-8601 generation timestamp (provenance / staleness signal for doctor).
    generated_at: z.string().min(1),
    // Pre-resolved read-set (required_stores ∪ implicit personal + warnings).
    read_set: storeReadSetSchema,
    // Pre-resolved active write target for non-personal scopes (null if none).
    write_target: writeTargetSchema.nullable(),
  })
  .strict();

export type ResolvedBindingsSnapshot = z.infer<typeof resolvedBindingsSnapshotSchema>;

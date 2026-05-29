import { parseGlobalRef } from "../schemas/store-stable-id.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Cross-store hard-reference lint (S49-lint).
//
// A shared store must never contain a hard reference (cite / [[link]]) to an
// entry that lives in a PERSONAL store: doing so would leak a personal id into
// a repo other people clone (R5#3). This lint runs on the write path alongside
// the secret scan. Personal→anywhere and shared→shared references are fine;
// only shared→personal is a violation.
// ---------------------------------------------------------------------------

export type StoreVisibility = "shared" | "personal";

export interface CrossStoreRefViolation {
  code: "personal-ref-in-shared";
  // global_ref the entry referenced.
  ref: string;
  // The personal store the reference points into.
  to_store_uuid: string;
  message: string;
}

export interface CrossStoreLintInput {
  // Visibility of the store the entry being written lands in.
  entryVisibility: StoreVisibility;
  // global_refs the entry hard-references (cites / links).
  referencedGlobalRefs: string[];
  // Visibility of every known store, keyed by store_uuid.
  storeVisibility: Record<string, StoreVisibility>;
}

export function lintCrossStoreReferences(input: CrossStoreLintInput): CrossStoreRefViolation[] {
  // Only writes into a SHARED store can leak; personal stores may reference
  // anything (they are never shared).
  if (input.entryVisibility !== "shared") {
    return [];
  }

  const violations: CrossStoreRefViolation[] = [];
  for (const ref of input.referencedGlobalRefs) {
    const parsed = parseGlobalRef(ref);
    if (parsed === null) {
      continue;
    }
    if (input.storeVisibility[parsed.store_uuid] === "personal") {
      violations.push({
        code: "personal-ref-in-shared",
        ref,
        to_store_uuid: parsed.store_uuid,
        message: `shared-store entry references personal-store id '${ref}' — personal knowledge must not leak into a shared store`,
      });
    }
  }
  return violations;
}

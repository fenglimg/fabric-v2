import { z } from "zod";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0 — Open scope coordinate + entry scope metadata
//
// Surfaces: S20 (open coordinate string — org/team/federation expressible
// without engine changes) · S23 (entry scope is METADATA, not directory
// hierarchy — supersedes the v2.0 dir-derived layer) · A3.
//
// Pure definition layer (P0). The two-axis resolution engine (scope × store
// tie-break) that CONSUMES these coordinates is P2 (S21/S53); here we only
// define the coordinate grammar and the per-entry metadata fields.
//
// Replaces the v2.0 `knowledge_layer: personal|team` binary (KT-DEC-0005). In
// v2.1 an entry carries an OPEN scope coordinate string so future shapes (org,
// multiple teams, federation nesting — S20, Deferred) extend the vocabulary
// WITHOUT touching the resolver: the engine treats the coordinate as an opaque,
// optionally-prefixed string and only special-cases the privacy-critical
// `personal` axis.
// ---------------------------------------------------------------------------

// The personal scope coordinate. Privacy-load-bearing (R5#3): entries with this
// scope MUST NOT be written into a shared store — enforced at the write path in
// P2. Everything else is an open string the engine does not enumerate.
export const PERSONAL_SCOPE = "personal" as const;

// Reserved, well-known scope prefixes the resolver gives first-class meaning to.
// This list is advisory/non-exhaustive — unknown coordinates are valid (S20).
export const KNOWN_SCOPE_PREFIXES = ["personal", "team", "project", "org"] as const;

// A scope coordinate is one or more `[a-z0-9-_]` segments joined by ':'
// (e.g. "personal", "team", "project:fabric-v2", "org:acme:team:platform").
// Open by construction: the grammar admits arbitrary nesting depth so new
// organizational shapes need no schema change — only the resolver decides how
// deep it interprets. Lowercased to keep coordinates canonical/comparable.
export const SCOPE_COORDINATE_PATTERN = /^[a-z0-9_-]+(:[a-z0-9_-]+)*$/u;

export const scopeCoordinateSchema = z
  .string()
  .min(1)
  .regex(
    SCOPE_COORDINATE_PATTERN,
    "scope coordinate must be ':'-joined lowercase [a-z0-9_-] segments",
  );

export type ScopeCoordinate = z.infer<typeof scopeCoordinateSchema>;

// The leading segment of a coordinate — the axis the resolver keys off of.
export function scopeRoot(coordinate: string): string {
  const colon = coordinate.indexOf(":");
  return colon === -1 ? coordinate : coordinate.slice(0, colon);
}

// True for the privacy-critical personal axis (root segment === "personal").
// Used by the P2 write-path lint to refuse personal entries into shared stores.
export function isPersonalScope(coordinate: string): boolean {
  return scopeRoot(coordinate) === PERSONAL_SCOPE;
}

// ---------------------------------------------------------------------------
// Per-entry scope metadata. Lives in knowledge-entry frontmatter (flat scalars,
// honoring KT-DEC-0005). Replaces the v2.0 `knowledge_layer` field and the
// dir-derived layer signal (S23):
//
//   semantic_scope   — the OPEN coordinate describing WHO the entry is for
//                      (personal / team / project:x / org:y...). Resolution axis.
//   visibility_store — the alias/UUID of the store this entry physically lives
//                      in. Decouples "what scope it serves" from "which git
//                      repo holds it"; store ⊥ scope (S42/A2). On write the
//                      resolver picks the store; on read it is provenance.
// ---------------------------------------------------------------------------
export const entryScopeMetadataSchema = z
  .object({
    semantic_scope: scopeCoordinateSchema,
    // Store alias or UUID. Validated as a non-empty string here; the resolver
    // (P0.6) maps alias→UUID and verifies the store is in the read-set.
    visibility_store: z.string().min(1),
  })
  .strict();

export type EntryScopeMetadata = z.infer<typeof entryScopeMetadataSchema>;

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Store-qualified id resolution (S61).
//
// A reference the AI/user supplies may be:
//   - store-qualified:  `<alias>:<local_id>`  or  `<store_uuid>:<local_id>`
//   - bare local id:    `<local_id>`          (e.g. "KT-DEC-0001")
//
// Bare ids are accepted ONLY when they match exactly ONE entry across the
// read-set. When the same local_id exists in multiple stores (shadowing), a
// bare reference is AMBIGUOUS and is NOT silently merged/picked — the caller
// must qualify it. This is the read-side guarantee behind F1/S61.
// ---------------------------------------------------------------------------

// An entry present in the current read-set, the population a reference resolves
// against. Mirrors the provenance envelope's identity fields.
export interface QualifiedCandidate {
  store_uuid: string;
  alias: string;
  local_id: string;
}

export interface QualifiedIdResolution {
  // The single matched candidate, or null when none/ambiguous.
  resolved: QualifiedCandidate | null;
  // True when a bare id matched >1 store (shadowing) — caller must qualify.
  ambiguous: boolean;
  // All candidates the reference matched (length >1 ⟺ ambiguous bare id).
  matches: QualifiedCandidate[];
}

const LOCAL_ID = /^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u;

// Split a reference into an optional store qualifier + the trailing local id.
// The local id is always the `K[PT]-...` tail; everything before the final ':'
// is the store qualifier (alias or uuid). Returns null when no local id tail.
function splitRef(ref: string): { storeQualifier: string | null; localId: string } | null {
  const localMatch = ref.match(/K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u);
  if (localMatch === null) {
    return null;
  }
  const localId = localMatch[0];
  if (localId === ref) {
    return { storeQualifier: null, localId };
  }
  // Expect "<qualifier>:<localId>".
  const head = ref.slice(0, ref.length - localId.length);
  if (!head.endsWith(":")) {
    return null;
  }
  return { storeQualifier: head.slice(0, -1), localId };
}

export function resolveStoreQualifiedId(
  ref: string,
  candidates: QualifiedCandidate[],
): QualifiedIdResolution {
  const split = splitRef(ref);
  if (split === null || !LOCAL_ID.test(split.localId)) {
    return { resolved: null, ambiguous: false, matches: [] };
  }

  const { storeQualifier, localId } = split;

  if (storeQualifier !== null) {
    // Store-qualified: match the named store + local id (at most one).
    const match = candidates.find(
      (c) =>
        c.local_id === localId && (c.alias === storeQualifier || c.store_uuid === storeQualifier),
    );
    return match === undefined
      ? { resolved: null, ambiguous: false, matches: [] }
      : { resolved: match, ambiguous: false, matches: [match] };
  }

  // Bare local id: unique-match-only.
  const matches = candidates.filter((c) => c.local_id === localId);
  if (matches.length === 1) {
    return { resolved: matches[0], ambiguous: false, matches };
  }
  // 0 matches → not found; >1 → ambiguous (shadowing, not silently merged).
  return { resolved: null, ambiguous: matches.length > 1, matches };
}

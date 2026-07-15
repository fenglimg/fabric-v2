/**
 * ISS-20260713-011 first slice: pure id helpers extracted from plan-context.ts.
 */

/** Numeric-aware stable_id compare so KT-DEC-9999 < KT-DEC-10000. */
export function compareStableIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function layerFromStableId(qualifiedId: string): "personal" | "team" {
  const colon = qualifiedId.lastIndexOf(":");
  const localId = colon === -1 ? qualifiedId : qualifiedId.slice(colon + 1);
  return localId.startsWith("KP-") ? "personal" : "team";
}

/** Keys for related-edge lookup: qualified id + bare local id when store-qualified. */
export function relatedLookupKeys(stableId: string): string[] {
  const parts = stableId.split(":");
  const localId = parts.at(-1);
  return localId === undefined || localId === stableId ? [stableId] : [stableId, localId];
}


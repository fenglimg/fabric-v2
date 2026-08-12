import { PROTECTED_TOKENS } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

import { RETIRED_TOKENS } from "./doctor/doctor-retired-references-lint.js";

/**
 * Two registries make opposite claims about the same vocabulary:
 *
 *   PROTECTED_TOKENS  — "AI clients read this verbatim; never translate it."
 *   RETIRED_TOKENS    — "this names something that no longer exists; flag it."
 *
 * A token in both is a contradiction that pins rot in place: the retired-
 * reference lint tells you to delete the mention while the protected-token
 * lint requires it to stay. That state actually shipped — `fab_plan_context`
 * and `fab_get_knowledge_sections` sat in both after the retrieval surface
 * collapsed to `fab_recall`, and nothing failed because the protected-token
 * lint's bootstrap arm was scanning a directory that had been deleted.
 *
 * This gate makes the contradiction unrepresentable, so retiring a token forces
 * the protected registry to be updated in the same change.
 */
describe("PROTECTED_TOKENS vs RETIRED_TOKENS", () => {
  it("no token is simultaneously protected and retired", () => {
    const retired = new Set(RETIRED_TOKENS.map((entry) => entry.token));
    const conflicting = PROTECTED_TOKENS.filter((token) => retired.has(token));
    expect(conflicting).toEqual([]);
  });

  it("every retired token names a live replacement, or explicitly none", () => {
    for (const entry of RETIRED_TOKENS) {
      // `replacement: null` means "simply removed" — a valid, deliberate state.
      // A replacement that is itself retired would send readers in a circle.
      if (entry.replacement === null) continue;
      const stillRetired = RETIRED_TOKENS.some((other) => other.token === entry.replacement);
      expect(stillRetired, `${entry.token} → ${entry.replacement} points at another retired token`).toBe(
        false,
      );
    }
  });
});

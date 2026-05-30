import { describe, expect, it } from "vitest";

import { compareStableIds } from "./plan-context.js";

// W4-07 (ISS-029): stable_id ordering must be numeric-aware in the counter
// suffix so a 5-digit counter sorts AFTER 9999, not before. Plain
// localeCompare sorts "KT-DEC-10000" before "KT-DEC-9999" ('1' < '9').

describe("compareStableIds (ISS-029 counter-width overflow)", () => {
  it("orders the counter suffix numerically across the 4→5 digit boundary", () => {
    const ids = ["KT-DEC-10001", "KT-DEC-9999", "KT-DEC-10000", "KT-DEC-9998"];
    const sorted = [...ids].sort(compareStableIds);
    expect(sorted).toEqual(["KT-DEC-9998", "KT-DEC-9999", "KT-DEC-10000", "KT-DEC-10001"]);
  });

  it("keeps same-width ids in the same order as plain lexicographic sort", () => {
    const ids = ["KT-DEC-0003", "KT-DEC-0001", "KT-DEC-0002"];
    expect([...ids].sort(compareStableIds)).toEqual(["KT-DEC-0001", "KT-DEC-0002", "KT-DEC-0003"]);
  });

  it("orders by type/layer prefix before the counter", () => {
    const ids = ["KT-PIT-0001", "KP-DEC-9999", "KT-DEC-0001"];
    const sorted = [...ids].sort(compareStableIds);
    expect(sorted[0]).toBe("KP-DEC-9999"); // KP < KT
    expect(sorted[1]).toBe("KT-DEC-0001"); // DEC < PIT within KT
    expect(sorted[2]).toBe("KT-PIT-0001");
  });
});

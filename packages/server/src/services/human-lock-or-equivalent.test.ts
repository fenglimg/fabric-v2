import { describe, expect, it } from "vitest";

import { HumanLockEntryNotFoundError } from "./human-lock-or-equivalent.js";

describe("HumanLockEntryNotFoundError", () => {
  it("has HTTP 404 to match old API contract", () => {
    const err = new HumanLockEntryNotFoundError("entry-abc");
    expect(err.code).toBe("HUMAN_LOCK_ENTRY_NOT_FOUND");
    expect(err.httpStatus).toBe(404);
    expect(err.message).toContain("entry-abc");
    expect(err.actionHint).toBeTruthy();
    expect(err).toBeInstanceOf(HumanLockEntryNotFoundError);
  });
});

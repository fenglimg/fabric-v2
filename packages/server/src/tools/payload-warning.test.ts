import { describe, expect, it } from "vitest";

import { appendPayloadWarning, type StructuredToolWarning } from "./payload-warning.js";

const HINT = "narrow the request";

describe("appendPayloadWarning (MC5 symmetric warn surfacing)", () => {
  it("no-ops when the guard flagged no warning (undefined input stays undefined)", () => {
    expect(appendPayloadWarning(undefined, { bytes: 10 }, HINT)).toBeUndefined();
  });

  it("preserves an existing array unchanged when there is no warning", () => {
    const existing: StructuredToolWarning[] = [{ code: "x", file: "<response>", action_hint: "h" }];
    expect(appendPayloadWarning(existing, { bytes: 10 }, HINT)).toBe(existing);
  });

  it("appends a structured warning with the tool-specific action_hint when flagged", () => {
    const result = appendPayloadWarning(undefined, {
      bytes: 99999,
      warning: { code: "mcp_payload_warn", message: "big", bytes: 99999, threshold: 16384 },
    }, HINT);
    expect(result).toEqual([{ code: "mcp_payload_warn", file: "<response>", action_hint: HINT }]);
  });

  it("appends to existing warnings without dropping them", () => {
    const existing: StructuredToolWarning[] = [{ code: "gate", file: "<response>", action_hint: "g" }];
    const result = appendPayloadWarning(existing, {
      bytes: 99999,
      warning: { code: "mcp_payload_warn", message: "big", bytes: 99999, threshold: 16384 },
    }, HINT);
    expect(result).toHaveLength(2);
    expect(result?.[0]).toEqual(existing[0]);
    expect(result?.[1]?.action_hint).toBe(HINT);
  });
});

import { test, fc } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { enforcePayloadLimit } from "../../src/node/mcp-payload-guard";
import { MCPError } from "../../src/errors/index";

// ---------------------------------------------------------------------------
// Property-based invariants for mcp-payload-guard (shared.md I4).
//
// Implementation note (verified by reading mcp-payload-guard.ts):
//   - bytes > hardAt  → throws MCPError (code MCP_PAYLOAD_TOO_LARGE)
//   - bytes > warnAt  → returns { bytes, warning: { code: 'mcp_payload_warn', ... } }
//   - otherwise        → returns { bytes } (no warning)
// Comparisons are strict `>`; hence size === warnAt is a no-warn boundary,
// and size === hardAt is a warn-but-no-throw boundary.
//
// Defaults: warnAt = 16384 (16 KiB), hardAt = 65536 (64 KiB).
// ---------------------------------------------------------------------------

const WARN_BYTES = 16 * 1024; // 16384
const HARD_BYTES = 64 * 1024; // 65536

function makePayload(size: number): string {
  // 'x' is one byte in UTF-8; explicit byteLength assertion would be redundant.
  return "x".repeat(size);
}

describe("mcp-payload-guard invariants (shared.md I4)", () => {
  // shared.md I4 — payloads <= warn threshold pass with no warning.
  test.prop([fc.integer({ min: 0, max: WARN_BYTES })])(
    "size in [0, warnBytes] (≤ 16KB): no warning, no throw",
    (size) => {
      const result = enforcePayloadLimit(makePayload(size));
      expect(result.bytes).toBe(size);
      expect(result.warning).toBeUndefined();
    },
  );

  // shared.md I4 — payloads in (warn, hard] window emit a warning, do not throw.
  test.prop([fc.integer({ min: WARN_BYTES + 1, max: HARD_BYTES })])(
    "size in (warnBytes, hardBytes] (16KB..64KB): warning is emitted, no throw",
    (size) => {
      const result = enforcePayloadLimit(makePayload(size));
      expect(result.bytes).toBe(size);
      expect(result.warning).toBeDefined();
      expect(result.warning?.code).toBe("mcp_payload_warn");
      expect(result.warning?.bytes).toBe(size);
      expect(result.warning?.threshold).toBe(WARN_BYTES);
    },
  );

  // shared.md I4 — payloads strictly greater than hard limit throw MCPError.
  test.prop([fc.integer({ min: HARD_BYTES + 1, max: HARD_BYTES + 4096 })])(
    "size > hardBytes (>64KB): throws MCPError with code MCP_PAYLOAD_TOO_LARGE",
    (size) => {
      const payload = makePayload(size);
      let caught: unknown = null;
      try {
        enforcePayloadLimit(payload);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MCPError);
      const code = (caught as MCPError & { code: string }).code;
      expect(code).toBe("MCP_PAYLOAD_TOO_LARGE");
    },
  );
});

import { test, fc } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { fabricConfigSchema } from "../../src/schemas/fabric-config";
import { aiLedgerEntrySchema } from "../../src/schemas/ledger-entry";
import { structuredWarningSchema } from "../../src/schemas/api-contracts";

// ---------------------------------------------------------------------------
// Property-based round-trip tests for zod schemas (shared.md I1).
//
// I1: For any schema-valid input x,
//     parse(JSON.parse(JSON.stringify(parse(x)))) deep-equals parse(x).
// ---------------------------------------------------------------------------

// NOTE: zod's `.optional()` keeps an undefined-valued key on the parsed
// output when the input carries an explicit `undefined`; JSON serialization
// drops such keys, breaking strict-equal round-trips. We therefore generate
// optional fields by *omitting them entirely* (via fc.record requiredKeys),
// rather than producing `undefined`. This matches the I1 invariant intent —
// canonical shapes that survive a JSON.stringify/parse round trip.

// Arbitrary that produces inputs accepted by fabricConfigSchema. All fields
// are optional in the schema; the arbitrary samples present-or-absent for
// each key, including the legacy-passthrough clientPaths block.
const clientPathsArbitrary = fc.record(
  {
    claudeCodeCLI: fc.string(),
    claudeCodeDesktop: fc.string(),
    cursor: fc.string(),
    codexCLI: fc.string(),
  },
  { requiredKeys: [] },
);

const mcpPayloadLimitsArbitrary = fc.record(
  {
    warnBytes: fc.integer({ min: 1, max: 1_000_000 }),
    hardBytes: fc.integer({ min: 1, max: 1_000_000 }),
  },
  { requiredKeys: [] },
);

const fabricConfigArbitrary = fc.record(
  {
    clientPaths: clientPathsArbitrary,
    externalFixturePath: fc.string(),
    scanIgnores: fc.array(fc.string()),
    auditMode: fc.constantFrom(
      "strict" as const,
      "warn" as const,
      "off" as const,
    ),
    audit_mode: fc.constantFrom(
      "strict" as const,
      "warn" as const,
      "off" as const,
    ),
    mcpPayloadLimits: mcpPayloadLimitsArbitrary,
  },
  { requiredKeys: [] },
);

// Arbitrary for the ai branch of ledger entries. Avoids the discriminated-union
// preprocess that auto-injects source for objects without one. Optional `id`
// and `commit_sha` are omitted (not undefined) when absent.
const aiLedgerEntryArbitrary = fc.record(
  {
    id: fc.string(),
    ts: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    intent: fc.string(),
    affected_paths: fc.array(fc.string()),
    source: fc.constant("ai" as const),
    commit_sha: fc.string(),
  },
  { requiredKeys: ["ts", "intent", "affected_paths", "source"] },
);

const structuredWarningArbitrary = fc.record(
  {
    code: fc.string(),
    file: fc.string(),
    line: fc.integer({ min: 0, max: 1_000_000 }),
    action_hint: fc.string(),
  },
  { requiredKeys: ["code", "file", "action_hint"] },
);

describe("zod schema round-trip invariants (shared.md I1)", () => {
  // shared.md I1 — fabricConfigSchema
  test.prop([fabricConfigArbitrary])(
    "fabricConfigSchema: parse → JSON serialize → parse is a fixed point",
    (input) => {
      const a = fabricConfigSchema.parse(input);
      const b = fabricConfigSchema.parse(JSON.parse(JSON.stringify(a)));
      expect(b).toStrictEqual(a);
    },
  );

  // shared.md I1 — aiLedgerEntrySchema (event-ledger family / ledger-entry)
  test.prop([aiLedgerEntryArbitrary])(
    "aiLedgerEntrySchema: parse → JSON serialize → parse is a fixed point",
    (input) => {
      const a = aiLedgerEntrySchema.parse(input);
      const b = aiLedgerEntrySchema.parse(JSON.parse(JSON.stringify(a)));
      expect(b).toStrictEqual(a);
    },
  );

  // shared.md I1 — structuredWarningSchema (api-contracts)
  test.prop([structuredWarningArbitrary])(
    "structuredWarningSchema: parse → JSON serialize → parse is a fixed point",
    (input) => {
      const a = structuredWarningSchema.parse(input);
      const b = structuredWarningSchema.parse(JSON.parse(JSON.stringify(a)));
      expect(b).toStrictEqual(a);
    },
  );
});

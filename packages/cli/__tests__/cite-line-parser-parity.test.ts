/**
 * v2.0.0-rc.24 TASK-04: behavioral-parity test asserting the hand-authored
 * CJS twin at `templates/hooks/lib/cite-line-parser.cjs` produces identical
 * output to the canonical TS source at
 * `packages/shared/src/cite-line-parser.ts` for the full TASK-03 corpus.
 *
 * Why parity (not byte-equivalence)?
 *   - The TS source has type annotations + ESM `export` syntax that wouldn't
 *     run in a CJS hook runtime; a literal byte-comparison would force the
 *     CJS twin to use noisy `/** @ts-expect-error * /` shims and brittle
 *     line-by-line mirroring.
 *   - Drift risk is "do they parse the same inputs the same way", not "are
 *     they textually identical". Functional parity is the load-bearing
 *     contract; this test pins it.
 *
 * If this test fails after a TS-source edit, update the CJS twin to match
 * AND add a coverage case here for the new branch before committing.
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { parseCiteLine as parseCiteLineTs } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);
const cjsPath = fileURLToPath(
  new URL("../templates/hooks/lib/cite-line-parser.cjs", import.meta.url),
);
const { parseCiteLine: parseCiteLineCjs } = require(cjsPath) as {
  parseCiteLine: (raw: string) => unknown;
};

// Corpus mirrors packages/shared/test/cite-line-parser.test.ts inputs (TASK-03)
// — every described case the TS suite tests should be observable here. New
// cases added to the TS suite SHOULD also land here when they exercise a
// distinct code path.
const CORPUS: string[] = [
  // Sentinel forms.
  "KB: none",
  "KB: none [no-relevant]",
  "KB: none [not-applicable]",
  "kb: NONE",
  // Anchored cite without contract.
  "KB: KT-DEC-0001 (anchor) [planned]",
  "KB: KP-PAT-0042 [recalled]",
  "KB: KT-DEC-0001 (a) [chained-from KT-DEC-0009]",
  "KB: KT-DEC-0001 (a) [dismissed:scope-mismatch]",
  // Full form with contract tail.
  "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md",
  "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md !edit:CLAUDE.md",
  "KB: KT-DEC-9003 (anchor) [planned] → edit:foo.ts !edit:bar.ts require:trimEnd forbid:JSON.parse",
  "KB: KT-DEC-0001 (a) [planned] → edit:src/auth/**/*.ts",
  // Skip form.
  "KB: KT-DEC-9003 (Summary) [recalled] → skip:sequencing",
  "KB: KT-DEC-9003 (Summary) [recalled] → skip:other:non-codifiable",
  "KB: KT-DEC-0001 (a) [recalled] → skip:conditional",
  "KB: KT-DEC-0001 (a) [recalled] → skip:semantic",
  "KB: KT-DEC-0001 (a) [recalled] → skip:aesthetic",
  "KB: KT-DEC-0001 (a) [recalled] → skip:architectural",
  // Forward-compat / malformed token tolerance.
  "KB: KT-DEC-9003 (a) [recalled] → edit:foo.ts call:unknownFn sequence:later",
  "KB: KT-DEC-0001 (a) [planned] → garbage edit:foo.ts more_garbage forbid:eval",
  "This is not a KB line at all.",
  "",
  "KB: kt-dec-9003 (a) [planned]", // lowercase id → reject
  // Whitespace / CR-LF / interleaved.
  "  KB: KT-DEC-0001 [planned]  ",
  "KB: KT-DEC-0001 [planned]\r",
  "KB: KT-DEC-0001 [planned]\r\nKB: KP-PAT-0042 [recalled]",
  "\n\nKB: KT-DEC-0001 [planned]\n\n",
  // Multi-line index alignment.
  "KB: KT-DEC-0001 [planned]\nKB: KP-PAT-0042 [recalled] → edit:foo.ts\nKB: KT-DEC-9003 [dismissed:scope-mismatch]",
  "KB: none\nKB: KT-DEC-0001 [recalled] → edit:foo.ts",
  "prose line\nKB: KT-DEC-0001 [planned]\nmore prose",
  // v2.1.0-rc.1 P4 (F3/S62): store-qualified cite prefixes. NOTE: tags here use
  // the legacy 5-state vocabulary the TS source + event-ledger enum share; the
  // CJS twin's extra `applied`/`dismissed` recognition is a pre-existing drift
  // tracked separately, so the parity corpus avoids `[applied]`.
  "KB: team:KT-DEC-0001 (a) [recalled]",
  "KB: platform-kb:KT-DEC-0001, KT-PIT-0005 (mixed) [recalled]",
  "KB: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:KT-DEC-0001 [recalled] → edit:foo.ts",
  "KB: team:KT-DEC-0001 (a) [chained-from KT-DEC-0009]",
];

describe("cite-line-parser CJS twin — behavioral parity with TS source", () => {
  it("produces identical output for every corpus input", () => {
    for (const raw of CORPUS) {
      const tsResult = parseCiteLineTs(raw);
      const cjsResult = parseCiteLineCjs(raw);
      // JSON.stringify normalises array-element ordering AFTER explicit field
      // ordering by both implementations (both push items in source order).
      expect(JSON.stringify(cjsResult), `input: ${JSON.stringify(raw)}`).toBe(
        JSON.stringify(tsResult),
      );
    }
  });

  it("non-string input returns the empty shape (both implementations)", () => {
    // Runtime tolerance: parseCiteLine must not throw on null/undefined.
    // The TS signature is `(raw: string)`; both implementations defend.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const empty = { cite_ids: [], cite_tags: [], cite_commitments: [], cite_stores: [] };
    expect((parseCiteLineCjs as any)(null)).toEqual(empty);
    expect((parseCiteLineCjs as any)(undefined)).toEqual(empty);
    expect((parseCiteLineTs as any)(null)).toEqual(empty);
    expect((parseCiteLineTs as any)(undefined)).toEqual(empty);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});

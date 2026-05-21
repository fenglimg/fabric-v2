import { describe, expect, it } from "vitest";

import { parseCiteLine } from "../src/cite-line-parser.js";

// ---------------------------------------------------------------------------
// v2.0.0-rc.24 TASK-03 — shared cite-line parser.
//
// Covers the full vocabulary defined in `## Cite policy` of
// packages/shared/src/templates/bootstrap-canonical.ts (rc.24 contract
// syntax) and the index-alignment contract documented on
// assistantTurnObservedEventSchema.cite_commitments (rc.24 schema).
// ---------------------------------------------------------------------------

describe("parseCiteLine — sentinel forms", () => {
  it("parses bare `KB: none`", () => {
    const r = parseCiteLine("KB: none");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["none"]);
    expect(r.cite_commitments).toEqual([]);
  });

  it("parses `KB: none [no-relevant]` (sentinel reason kept in raw, not exported)", () => {
    const r = parseCiteLine("KB: none [no-relevant]");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["none"]);
    expect(r.cite_commitments).toEqual([]);
  });

  it("parses `KB: none [not-applicable]`", () => {
    const r = parseCiteLine("KB: none [not-applicable]");
    expect(r.cite_tags).toEqual(["none"]);
  });

  it("is case-insensitive on the `KB:` prefix and on `none`", () => {
    const r = parseCiteLine("kb: NONE");
    expect(r.cite_tags).toEqual(["none"]);
  });
});

describe("parseCiteLine — anchored cite without contract", () => {
  it("parses `KB: KT-DEC-0001 (anchor) [planned]`", () => {
    const r = parseCiteLine("KB: KT-DEC-0001 (anchor) [planned]");
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
    expect(r.cite_tags).toEqual(["planned"]);
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: null },
    ]);
  });

  it("parses cite without anchor: `KB: KP-PAT-0042 [recalled]`", () => {
    const r = parseCiteLine("KB: KP-PAT-0042 [recalled]");
    expect(r.cite_ids).toEqual(["KP-PAT-0042"]);
    expect(r.cite_tags).toEqual(["recalled"]);
  });

  it("normalizes `chained-from KT-DEC-0009` tag to `chained-from`", () => {
    const r = parseCiteLine("KB: KT-DEC-0001 (a) [chained-from KT-DEC-0009]");
    expect(r.cite_tags).toEqual(["chained-from"]);
  });

  it("normalizes `dismissed:scope-mismatch` tag to `dismissed`", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [dismissed:scope-mismatch]",
    );
    expect(r.cite_tags).toEqual(["dismissed"]);
  });
});

describe("parseCiteLine — full form with contract tail", () => {
  it("parses single edit operator", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-9003"]);
    expect(r.cite_tags).toEqual(["recalled"]);
    expect(r.cite_commitments).toEqual([
      {
        operators: [{ kind: "edit", target: ".fabric/AGENTS.md" }],
        skip_reason: null,
      },
    ]);
  });

  it("parses mixed operators: edit + !edit", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md !edit:CLAUDE.md",
    );
    expect(r.cite_commitments).toEqual([
      {
        operators: [
          { kind: "edit", target: ".fabric/AGENTS.md" },
          { kind: "not_edit", target: "CLAUDE.md" },
        ],
        skip_reason: null,
      },
    ]);
  });

  it("parses all 4 operator kinds in one cite", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (anchor) [planned] → edit:foo.ts !edit:bar.ts require:trimEnd forbid:JSON.parse",
    );
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "foo.ts" },
      { kind: "not_edit", target: "bar.ts" },
      { kind: "require", target: "trimEnd" },
      { kind: "forbid", target: "JSON.parse" },
    ]);
  });

  it("parses glob targets verbatim", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [planned] → edit:src/auth/**/*.ts",
    );
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "src/auth/**/*.ts" },
    ]);
  });
});

describe("parseCiteLine — skip form", () => {
  it("parses `→ skip:sequencing`", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (Summary) [recalled] → skip:sequencing",
    );
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: "sequencing" },
    ]);
  });

  it("parses `→ skip:other:non-codifiable` (colon in reason)", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (Summary) [recalled] → skip:other:non-codifiable",
    );
    expect(r.cite_commitments[0].skip_reason).toBe("other:non-codifiable");
  });

  it("parses each of the 6 documented skip-reason vocabulary values", () => {
    const reasons = [
      "sequencing",
      "conditional",
      "semantic",
      "aesthetic",
      "architectural",
      "other:custom",
    ];
    for (const reason of reasons) {
      const r = parseCiteLine(
        `KB: KT-DEC-0001 (a) [recalled] → skip:${reason}`,
      );
      expect(r.cite_commitments[0].skip_reason).toBe(reason);
    }
  });
});

describe("parseCiteLine — forward-compat / malformed token tolerance", () => {
  it("silently drops unknown operator tokens", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-9003 (a) [recalled] → edit:foo.ts call:unknownFn sequence:later",
    );
    // Only edit:foo.ts is retained; call: and sequence: are forward-compat
    // tokens silently ignored on rc.24-installed hooks.
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "foo.ts" },
    ]);
    expect(r.cite_commitments[0].skip_reason).toBeNull();
  });

  it("keeps valid operators when interleaved with unknown tokens", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [planned] → garbage edit:foo.ts more_garbage forbid:eval",
    );
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "foo.ts" },
      { kind: "forbid", target: "eval" },
    ]);
  });

  it("returns empty result on completely unrelated line", () => {
    const r = parseCiteLine("This is not a KB line at all.");
    expect(r).toEqual({
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
    });
  });

  it("returns empty result on empty string and on non-string input", () => {
    expect(parseCiteLine("")).toEqual({
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
    });
    // @ts-expect-error — runtime tolerance check
    expect(parseCiteLine(null)).toEqual({
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
    });
    // @ts-expect-error — runtime tolerance check
    expect(parseCiteLine(undefined)).toEqual({
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
    });
  });

  it("rejects malformed id pattern (lowercase prefix → no match)", () => {
    const r = parseCiteLine("KB: kt-dec-9003 (a) [planned]");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual([]);
  });
});

describe("parseCiteLine — whitespace and line-ending tolerance", () => {
  it("tolerates leading whitespace before `KB:`", () => {
    const r = parseCiteLine("    KB: KT-DEC-0001 (a) [planned]");
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
  });

  it("tolerates trailing whitespace and CR characters", () => {
    const r = parseCiteLine("KB: KT-DEC-0001 (a) [planned]   \r");
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
  });

  it("handles CRLF line endings", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [planned]\r\nKB: KP-PAT-0042 [recalled]",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KP-PAT-0042"]);
    expect(r.cite_tags).toEqual(["planned", "recalled"]);
  });

  it("skips blank lines in multi-line input", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [planned]\n\n   \nKB: KP-PAT-0042 [recalled]",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KP-PAT-0042"]);
  });
});

describe("parseCiteLine — multi-line input (index alignment)", () => {
  it("parses multiple cite lines with index-aligned commitments", () => {
    const input = [
      "KB: KT-DEC-0001 (Summary) [recalled] → edit:foo.ts",
      "KB: KP-PAT-0042 (Pattern) [planned] → require:trimEnd",
      "KB: KT-DEC-9003 (Other) [recalled] → skip:sequencing",
    ].join("\n");
    const r = parseCiteLine(input);
    expect(r.cite_ids).toEqual([
      "KT-DEC-0001",
      "KP-PAT-0042",
      "KT-DEC-9003",
    ]);
    expect(r.cite_tags).toEqual(["recalled", "planned", "recalled"]);
    expect(r.cite_commitments).toEqual([
      { operators: [{ kind: "edit", target: "foo.ts" }], skip_reason: null },
      {
        operators: [{ kind: "require", target: "trimEnd" }],
        skip_reason: null,
      },
      { operators: [], skip_reason: "sequencing" },
    ]);
  });

  it("mixes sentinel and full forms — sentinel adds tag only, not id/commitment", () => {
    const input = [
      "KB: none [not-applicable]",
      "KB: KT-DEC-0001 (a) [recalled] → edit:foo.ts",
    ].join("\n");
    const r = parseCiteLine(input);
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
    expect(r.cite_tags).toEqual(["none", "recalled"]);
    // cite_commitments is index-aligned with cite_ids (length 1), not tags.
    expect(r.cite_commitments).toEqual([
      { operators: [{ kind: "edit", target: "foo.ts" }], skip_reason: null },
    ]);
  });

  it("ignores non-KB lines interleaved with KB lines", () => {
    const input = [
      "Some preamble prose.",
      "KB: KT-DEC-0001 (a) [planned] → edit:foo.ts",
      "More prose between cites.",
      "KB: KP-PAT-0042 [recalled]",
    ].join("\n");
    const r = parseCiteLine(input);
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KP-PAT-0042"]);
    expect(r.cite_tags).toEqual(["planned", "recalled"]);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.27 TASK-003 (audit §2.18): multi-id + chained-from id extraction
// ---------------------------------------------------------------------------

describe("parseCiteLine — rc.27 multi-id + chained-from (audit §2.18)", () => {
  it("parses comma-separated multi-id citation into ordered cite_ids", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001, KT-PIT-0005 (combined) [recalled] → edit:src/foo.ts",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KT-PIT-0005"]);
    expect(r.cite_tags).toEqual(["recalled"]);
    // v2.0.0-rc.27.1 (Codex review fix): cite_commitments MUST be index-
    // aligned with cite_ids per schema doc — a shared contract propagates to
    // every id slot so doctor.ts + cite-contract-reminder.cjs can index by
    // cite_ids[i] without hitting an undefined slot.
    const sharedCommitment = {
      operators: [{ kind: "edit", target: "src/foo.ts" }],
      skip_reason: null,
    };
    expect(r.cite_commitments).toEqual([sharedCommitment, sharedCommitment]);
  });

  it("multi-id without contract emits one (empty) commitment per id (index alignment)", () => {
    const r = parseCiteLine("KB: KT-DEC-0001, KT-PIT-0005 [recalled]");
    expect(r.cite_ids).toHaveLength(2);
    // No `→ <ops>` tail → parseContractTail produces an empty commitment;
    // the empty commitment must still propagate to N slots so downstream
    // index lookups never see `undefined`.
    expect(r.cite_commitments).toHaveLength(2);
    for (const c of r.cite_commitments) {
      expect(c).toEqual({ operators: [], skip_reason: null });
    }
  });

  it("multi-id with three primaries — all surface in order", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001, KT-DEC-0002, KP-MOD-0007 (multi) [planned]",
    );
    expect(r.cite_ids).toEqual([
      "KT-DEC-0001",
      "KT-DEC-0002",
      "KP-MOD-0007",
    ]);
  });

  it("multi-id tolerates whitespace around the comma", () => {
    const r = parseCiteLine("KB: KT-DEC-0001 , KT-PIT-0005 [recalled]");
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KT-PIT-0005"]);
  });

  it("malformed id inside an otherwise-valid multi-id line → entire line drops", () => {
    const r = parseCiteLine("KB: KT-DEC-0001, NOT-AN-ID [recalled]");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual([]);
  });

  it("[chained-from <id>] surfaces the embedded id as a sibling cite_id", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001 (a) [chained-from KT-MOD-0007]",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KT-MOD-0007"]);
    expect(r.cite_tags).toEqual(["chained-from"]);
  });

  it("audit §2.18 reproduction — multi-id + chained-from + contract together", () => {
    const r = parseCiteLine(
      "KB: KT-DEC-0001, KT-PIT-0005 (combined) [chained-from KT-MOD-0007] → edit:src/foo.ts",
    );
    expect(r.cite_ids).toEqual([
      "KT-DEC-0001",
      "KT-PIT-0005",
      "KT-MOD-0007",
    ]);
    expect(r.cite_tags).toEqual(["chained-from"]);
    // v2.0.0-rc.27.1 (Codex review fix): commitments are index-aligned with
    // cite_ids — primary + chained ids each carry the shared parsed contract.
    const sharedCommitment = {
      operators: [{ kind: "edit", target: "src/foo.ts" }],
      skip_reason: null,
    };
    expect(r.cite_commitments).toEqual([
      sharedCommitment,
      sharedCommitment,
      sharedCommitment,
    ]);
  });
});

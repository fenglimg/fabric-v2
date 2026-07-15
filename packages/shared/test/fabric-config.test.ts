import { describe, expect, it } from "vitest";

import {
  defaultLayerFilterSchema,
  fabricConfigSchema,
  fabricLanguageSchema,
  nudgeModeSchema,
  observeConfigSchema,
} from "../src/schemas/fabric-config";

// ---------------------------------------------------------------------------
// fabric-config schema — fabric_language + default_layer_filter
//
// v2.0 grill-followup TASK-002 introduced two optional fields driving Q3
// (language policy) and Q6 (layer-filter default). rc.12 broad-gate-fabric-lang
// hard-renamed the language field from `knowledge_language` →
// `fabric_language` and added the `zh-CN-hybrid` enum value. Both fields stay
// `.optional().default(...)` so the new defaults still apply to minimal
// configs.
// ---------------------------------------------------------------------------

describe("fabricLanguageSchema — narrowed to zh-CN | en (grill-6fixes D2)", () => {
  it("accepts exactly the two concrete locales", () => {
    expect(fabricLanguageSchema.parse("zh-CN")).toBe("zh-CN");
    expect(fabricLanguageSchema.parse("en")).toBe("en");
  });

  it("rejects the removed match-existing / zh-CN-hybrid values", () => {
    expect(() => fabricLanguageSchema.parse("match-existing")).toThrow();
    expect(() => fabricLanguageSchema.parse("zh-CN-hybrid")).toThrow();
    expect(() => fabricLanguageSchema.parse("ja-JP")).toThrow();
    expect(() => fabricLanguageSchema.parse("")).toThrow();
  });

  it("the standalone domain is exactly [zh-CN, en]", () => {
    expect([...fabricLanguageSchema.options].sort()).toEqual(["en", "zh-CN"]);
  });
});

describe("fabricConfigSchema — fabric_language is no longer a project field (grill-6fixes D1)", () => {
  it("silently drops a stale fabric_language key (language is global now)", () => {
    const parsed = fabricConfigSchema.parse({
      fabric_language: "zh-CN",
    } as Record<string, unknown>) as Record<string, unknown>;
    expect(parsed.fabric_language).toBeUndefined();
  });
});

describe("fabricConfigSchema — default_layer_filter", () => {
  it("accepts all three default_layer_filter enum values", () => {
    for (const value of ["team", "personal", "both"] as const) {
      const parsed = fabricConfigSchema.parse({ default_layer_filter: value });
      expect(parsed.default_layer_filter).toBe(value);
    }
  });

  it("rejects an invalid default_layer_filter enum value", () => {
    expect(() =>
      fabricConfigSchema.parse({ default_layer_filter: "global" }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ default_layer_filter: "BOTH" }),
    ).toThrow();
  });

  it("standalone defaultLayerFilterSchema mirrors the enum domain", () => {
    expect(defaultLayerFilterSchema.parse("both")).toBe("both");
    expect(() => defaultLayerFilterSchema.parse("all")).toThrow();
  });
});

describe("fabricConfigSchema — defaults and backward compatibility", () => {
  it("missing fields apply default: both", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("partial config (only default_layer_filter) keeps the explicit value", () => {
    const parsed = fabricConfigSchema.parse({ default_layer_filter: "team" });
    expect(parsed.default_layer_filter).toBe("team");
  });

  it("previous-version fixture still parses (regression: no new fields supplied)", () => {
    // Snapshot of a v2.0-rc.1-shaped fabric-config.json — none of the
    // grill-followup fields are present. Must parse cleanly with defaults.
    const previousVersionFixture = {
      clientPaths: {
        claudeCodeCLI: "/usr/local/bin/claude",
        codexCLI: "/usr/local/bin/codex",
      },
      scanIgnores: ["node_modules", "dist", ".git"],
      audit_mode: "strict" as const,
      mcpPayloadLimits: { warnBytes: 8192, hardBytes: 32768 },
    };
    const parsed = fabricConfigSchema.parse(previousVersionFixture);

    // Existing fields preserved verbatim.
    expect(parsed.clientPaths).toEqual(previousVersionFixture.clientPaths);
    expect(parsed.scanIgnores).toEqual(["node_modules", "dist", ".git"]);
    expect(parsed.audit_mode).toBe("strict");
    expect(parsed.mcpPayloadLimits).toEqual({
      warnBytes: 8192,
      hardBytes: 32768,
    });

    // New fields filled by defaults.
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("explicit values override defaults across full config", () => {
    const parsed = fabricConfigSchema.parse({
      clientPaths: { claudeCodeCLI: "/usr/bin/claude" },
      default_layer_filter: "personal",
    });
    expect(parsed.default_layer_filter).toBe("personal");
    expect(parsed.clientPaths).toEqual({ claudeCodeCLI: "/usr/bin/claude" });
  });
});

// v2.1 ADJ-NEWN-4: user-override escape hatches for the two strong policies.
describe("fabricConfigSchema — cite/self-archive escape hatches", () => {
  it("defaults both policy flags to true (policies ON) when omitted", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.cite_policy_enabled).toBe(true);
    expect(parsed.self_archive_policy_enabled).toBe(true);
  });

  it("honors an explicit opt-out (false) for either policy", () => {
    const parsed = fabricConfigSchema.parse({
      cite_policy_enabled: false,
      self_archive_policy_enabled: false,
    });
    expect(parsed.cite_policy_enabled).toBe(false);
    expect(parsed.self_archive_policy_enabled).toBe(false);
  });

  it("rejects a non-boolean policy flag", () => {
    expect(() => fabricConfigSchema.parse({ cite_policy_enabled: "off" })).toThrow();
    expect(() => fabricConfigSchema.parse({ self_archive_policy_enabled: 0 })).toThrow();
  });
});

describe("fabricConfigSchema — altitude_propose_gate (peer micro-transfer P0-2)", () => {
  it("defaults altitude_propose_gate to false (warn-and-still-write)", () => {
    expect(fabricConfigSchema.parse({}).altitude_propose_gate).toBe(false);
  });

  it("accepts explicit true for hard refuse", () => {
    expect(fabricConfigSchema.parse({ altitude_propose_gate: true }).altitude_propose_gate).toBe(true);
  });

  it("rejects non-boolean altitude_propose_gate", () => {
    expect(() => fabricConfigSchema.parse({ altitude_propose_gate: "1" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// v2.2 dual-sink (Goal A / D4) — nudge_mode + observe.* human-output presets.
//
// nudge_mode is the headline human-output dial; observe.* are per-event
// overrides. Both gate ONLY the human-facing sink — the AI additionalContext
// sink is unaffected (D5 invariant, enforced in lib/nudge-policy.cjs and its
// dedicated invariant test). Here we cover the schema surface: enum domain,
// default, per-event toggle shape, strictness, and back-compat.
// ---------------------------------------------------------------------------

describe("fabricConfigSchema — nudge_mode (dual-sink D4)", () => {
  it("defaults to normal when absent", () => {
    expect(fabricConfigSchema.parse({}).nudge_mode).toBe("normal");
  });

  it("accepts all four preset levels", () => {
    for (const value of ["silent", "minimal", "normal", "verbose"] as const) {
      expect(fabricConfigSchema.parse({ nudge_mode: value }).nudge_mode).toBe(value);
    }
  });

  it("rejects an unknown level", () => {
    expect(() => fabricConfigSchema.parse({ nudge_mode: "loud" })).toThrow();
    expect(() => fabricConfigSchema.parse({ nudge_mode: "NORMAL" })).toThrow();
  });

  it("standalone nudgeModeSchema domain is exactly the four levels", () => {
    expect([...nudgeModeSchema.options].sort()).toEqual([
      "minimal",
      "normal",
      "silent",
      "verbose",
    ]);
  });
});

describe("fabricConfigSchema — observe.* per-event toggles (dual-sink D4)", () => {
  it("is undefined when absent (preset decides)", () => {
    expect(fabricConfigSchema.parse({}).observe).toBeUndefined();
  });

  it("accepts a partial per-event toggle set", () => {
    const parsed = fabricConfigSchema.parse({
      observe: { session_start: true, stop: false },
    });
    expect(parsed.observe).toEqual({ session_start: true, stop: false });
  });

  it("accepts all three event keys", () => {
    const parsed = fabricConfigSchema.parse({
      observe: { session_start: false, pre_tool_use: true, stop: true },
    });
    expect(parsed.observe).toEqual({
      session_start: false,
      pre_tool_use: true,
      stop: true,
    });
  });

  it("rejects an unknown event key (strict) and a non-boolean value", () => {
    expect(() =>
      fabricConfigSchema.parse({ observe: { session_stop: true } }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ observe: { stop: "yes" } }),
    ).toThrow();
  });

  it("standalone observeConfigSchema parses an empty object", () => {
    expect(observeConfigSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// archive_edit_threshold — rc.6 TASK-022 (E5)
//
// Drives fabric-hint Signal A's new edit-count branch. Default 20 reflects
// the rule-of-thumb "after ~20 Edit/Write operations there's probably
// something worth archiving." Must be positive integer; non-positive or
// non-integer values are rejected by the zod schema (hook itself also
// defends in depth at read time).
// ---------------------------------------------------------------------------

describe("fabricConfigSchema — archive_edit_threshold (rc.6 TASK-022)", () => {
  it("applies default 20 when absent", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.archive_edit_threshold).toBe(20);
  });

  it("accepts explicit positive integer override", () => {
    const parsed = fabricConfigSchema.parse({ archive_edit_threshold: 50 });
    expect(parsed.archive_edit_threshold).toBe(50);
  });

  it("rejects zero / negative / non-integer / non-number", () => {
    expect(() =>
      fabricConfigSchema.parse({ archive_edit_threshold: 0 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ archive_edit_threshold: -3 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ archive_edit_threshold: 1.5 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ archive_edit_threshold: "20" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// rc.9+ skill-contract-fix B1 — ten new pagination / threshold tunables
//
// All ten are optional + .default(N); existing fabric-config.json files
// (including the 7-key minimal layout shipped in rc.5+) must parse unchanged
// and resolve every new field to its documented default. min/max bounds
// reject out-of-range values explicitly.
// ---------------------------------------------------------------------------

describe("fabricConfigSchema — ux-w2-3: hardcoded skill thresholds dropped (lenient)", () => {
  // import_*/archive_max_*/review_topic_result_cap were ✂ hardcoded per census
  // Table 1 — never-tuned skill-internal pagination/window caps with no code
  // reader (the fabric-import/archive/review SKILL.md markdown consumed them).
  // The schema no longer declares them, so the lenient root parser silently
  // DROPS any stale on-disk value (zero migration); the skills fall to a
  // built-in default in their place.
  it("drops the retired skill-threshold keys instead of surfacing them", () => {
    const parsed = fabricConfigSchema.parse({
      import_window_first_run_months: 24,
      import_max_commits_scan: 1500,
      import_skip_canonical_threshold: 100,
      archive_max_candidates_per_batch: 15,
      archive_max_recent_paths: 50,
      archive_digest_max_sessions: 20,
      review_topic_result_cap: 15,
    }) as Record<string, unknown>;
    for (const k of [
      "import_window_first_run_months",
      "import_window_rerun_months",
      "import_max_pending_per_run",
      "import_max_commits_scan",
      "import_skip_canonical_threshold",
      "archive_max_candidates_per_batch",
      "archive_max_recent_paths",
      "archive_digest_max_sessions",
      "review_topic_result_cap",
    ]) {
      expect(parsed[k]).toBeUndefined();
    }
  });

  it("review_stale_pending_days (merge-target, kept) still defaults to 14", () => {
    expect(fabricConfigSchema.parse({}).review_stale_pending_days).toBe(14);
  });

  // W3-J: only hint_broad_top_k is removed. W2-1 made the broad banner show
  // everything (broad_index_backstop is the sole guard), leaving the field with
  // no code reader — its last references are retirement comments. Lenient root
  // parser drops any stale on-disk value (zero migration).
  //
  // The three hint_narrow_* knobs are NOT removed: knowledge-hint-narrow.cjs
  // actively reads them (readNarrowTopK / readNarrowDedupWindow /
  // readNarrowCooldownHours at template lines 929/940/951). Deleting them from
  // the schema would create unvalidated "ghost knobs" the hook still reads raw —
  // caught by the `fabric audit retired` producer-consumer round-trip oracle.
  it("drops the retired hint_broad_top_k knob instead of surfacing it (W3-J)", () => {
    const parsed = fabricConfigSchema.parse({ hint_broad_top_k: 8 }) as Record<string, unknown>;
    expect(parsed.hint_broad_top_k).toBeUndefined();
  });

  it("keeps the still-wired narrow knobs (read by knowledge-hint-narrow.cjs)", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.hint_narrow_top_k).toBe(5);
    expect(parsed.hint_narrow_dedup_window_turns).toBe(5);
    expect(parsed.hint_narrow_cooldown_hours).toBe(0);
    // ISS-20260713-033: broad SessionStart cooldown ships a non-zero quiet
    // default (24h) so repeat session-opens don't re-fire the full banner;
    // knowledge-hint-broad.cjs mirrors DEFAULT_HINT_BROAD_COOLDOWN_HOURS = 24.
    // Set 0 for verbose/debug.
    expect(parsed.hint_broad_cooldown_hours).toBe(24);
  });

  it("a minimal user config still parses with the retired keys absent", () => {
    const parsed = fabricConfigSchema.parse({
      fabric_language: "zh-CN-hybrid", // stale global key — dropped
      archive_hint_hours: 24,
      review_hint_pending_count: 10,
      review_hint_pending_age_days: 7,
    }) as Record<string, unknown>;
    expect(parsed.fabric_language).toBeUndefined();
    expect(parsed.archive_hint_hours).toBe(24);
    expect(parsed.review_hint_pending_count).toBe(10);
  });

  it("root schema remains lenient — unknown keys are silently dropped (no .strict())", () => {
    const parsed = fabricConfigSchema.parse({
      default_layer_filter: "both" as const,
      // A bogus key from a future rc that this schema does not know about.
      // Lenient parse means it is silently dropped, not rejected. This is
      // load-bearing: forward-compat for rc.13+ tunables that have not yet
      // landed in shared/src/schemas/fabric-config.ts.
      some_future_rc_knob: 42,
    });
    expect(parsed.default_layer_filter).toBe("both");
    expect((parsed as Record<string, unknown>).some_future_rc_knob).toBeUndefined();
  });
});

describe("fabricConfigSchema — fabric_event_retention_days boundary", () => {
  // ux-w2-3: the import_*/archive_max_* boundary tests were removed alongside
  // their schema fields (hardcoded per census Table 1). fabric_event_retention_days
  // stays in the schema (its rotation primitive still reads it), so its literal-
  // union boundary is still asserted below.

  // v2.0.0-rc.22 Scope A T3: fabric_event_retention_days literal union
  // (7 / 30 / 90). Optional with NO `.default()` — absence is meaningful
  // (the rotation primitive applies its own library-side default).
  it("fabric_event_retention_days accepts 7 / 30 / 90 and rejects everything else", () => {
    for (const value of [7, 30, 90] as const) {
      const parsed = fabricConfigSchema.parse({ fabric_event_retention_days: value });
      expect(parsed.fabric_event_retention_days).toBe(value);
    }
    expect(() =>
      fabricConfigSchema.parse({ fabric_event_retention_days: 14 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ fabric_event_retention_days: 0 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ fabric_event_retention_days: -1 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ fabric_event_retention_days: "30" }),
    ).toThrow();
  });

  it("fabric_event_retention_days is undefined when absent (no schema default)", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.fabric_event_retention_days).toBeUndefined();
  });

  it("positive-int fields reject zero, negative, non-integer, and non-number", () => {
    // ux-w2-3: import_skip_canonical_threshold / archive_max_* / review_topic_result_cap
    // were removed (hardcoded). review_stale_pending_days (merge-target, kept) still
    // enforces the positive-int contract.
    const positiveFields = ["review_stale_pending_days"] as const;
    for (const field of positiveFields) {
      expect(() => fabricConfigSchema.parse({ [field]: 0 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: -1 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: 1.5 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: "8" })).toThrow();
    }
  });
});

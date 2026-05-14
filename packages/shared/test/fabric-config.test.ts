import { describe, expect, it } from "vitest";

import {
  defaultLayerFilterSchema,
  fabricConfigSchema,
  knowledgeLanguageSchema,
} from "../src/schemas/fabric-config";

// ---------------------------------------------------------------------------
// fabric-config schema — knowledge_language + default_layer_filter
//
// v2.0 grill-followup TASK-002: two new optional fields drive Q3 (language
// policy) and Q6 (layer-filter default). Both are `.optional().default(...)`
// so existing fabric-config.json files parse unchanged (backward-compat).
// ---------------------------------------------------------------------------

describe("fabricConfigSchema — knowledge_language", () => {
  it("accepts all three knowledge_language enum values", () => {
    for (const value of ["match-existing", "zh-CN", "en"] as const) {
      const parsed = fabricConfigSchema.parse({ knowledge_language: value });
      expect(parsed.knowledge_language).toBe(value);
    }
  });

  it("rejects an invalid knowledge_language enum value", () => {
    expect(() =>
      fabricConfigSchema.parse({ knowledge_language: "japanese" }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ knowledge_language: "" }),
    ).toThrow();
  });

  it("standalone knowledgeLanguageSchema mirrors the enum domain", () => {
    expect(knowledgeLanguageSchema.parse("match-existing")).toBe(
      "match-existing",
    );
    expect(() => knowledgeLanguageSchema.parse("ja-JP")).toThrow();
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
  it("missing fields apply defaults: match-existing / both", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("partial config (only knowledge_language) defaults default_layer_filter", () => {
    const parsed = fabricConfigSchema.parse({ knowledge_language: "zh-CN" });
    expect(parsed.knowledge_language).toBe("zh-CN");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("partial config (only default_layer_filter) defaults knowledge_language", () => {
    const parsed = fabricConfigSchema.parse({ default_layer_filter: "team" });
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("team");
  });

  it("previous-version fixture still parses (regression: no new fields supplied)", () => {
    // Snapshot of a v2.0-rc.1-shaped fabric-config.json — none of the
    // grill-followup fields are present. Must parse cleanly with defaults.
    const previousVersionFixture = {
      clientPaths: {
        claudeCodeCLI: "/usr/local/bin/claude",
        cursor: "/Applications/Cursor.app/Contents/MacOS/Cursor",
      },
      externalFixturePath: "/tmp/fixtures",
      scanIgnores: ["node_modules", "dist", ".git"],
      auditMode: "strict" as const,
      mcpPayloadLimits: { warnBytes: 8192, hardBytes: 32768 },
    };
    const parsed = fabricConfigSchema.parse(previousVersionFixture);

    // Existing fields preserved verbatim.
    expect(parsed.clientPaths).toEqual(previousVersionFixture.clientPaths);
    expect(parsed.externalFixturePath).toBe("/tmp/fixtures");
    expect(parsed.scanIgnores).toEqual(["node_modules", "dist", ".git"]);
    expect(parsed.auditMode).toBe("strict");
    expect(parsed.mcpPayloadLimits).toEqual({
      warnBytes: 8192,
      hardBytes: 32768,
    });

    // New fields filled by defaults.
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("explicit values override defaults across full config", () => {
    const parsed = fabricConfigSchema.parse({
      clientPaths: { claudeCodeCLI: "/usr/bin/claude" },
      knowledge_language: "en",
      default_layer_filter: "personal",
    });
    expect(parsed.knowledge_language).toBe("en");
    expect(parsed.default_layer_filter).toBe("personal");
    expect(parsed.clientPaths).toEqual({ claudeCodeCLI: "/usr/bin/claude" });
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

describe("fabricConfigSchema — rc.9+ skill tunables defaults", () => {
  it("applies all ten defaults when fields are absent", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.import_window_first_run_months).toBe(60);
    expect(parsed.import_window_rerun_months).toBe(2);
    expect(parsed.import_max_pending_per_run).toBe(10);
    expect(parsed.import_max_commits_scan).toBe(500);
    expect(parsed.import_skip_canonical_threshold).toBe(50);
    expect(parsed.archive_max_candidates_per_batch).toBe(8);
    expect(parsed.archive_max_recent_paths).toBe(20);
    expect(parsed.archive_digest_max_sessions).toBe(10);
    expect(parsed.review_topic_result_cap).toBe(8);
    expect(parsed.review_stale_pending_days).toBe(14);
  });

  it("accepts explicit overrides for all ten fields", () => {
    const parsed = fabricConfigSchema.parse({
      import_window_first_run_months: 24,
      import_window_rerun_months: 6,
      import_max_pending_per_run: 20,
      import_max_commits_scan: 1500,
      import_skip_canonical_threshold: 100,
      archive_max_candidates_per_batch: 15,
      archive_max_recent_paths: 50,
      archive_digest_max_sessions: 20,
      review_topic_result_cap: 15,
      review_stale_pending_days: 30,
    });
    expect(parsed.import_window_first_run_months).toBe(24);
    expect(parsed.import_window_rerun_months).toBe(6);
    expect(parsed.import_max_pending_per_run).toBe(20);
    expect(parsed.import_max_commits_scan).toBe(1500);
    expect(parsed.import_skip_canonical_threshold).toBe(100);
    expect(parsed.archive_max_candidates_per_batch).toBe(15);
    expect(parsed.archive_max_recent_paths).toBe(50);
    expect(parsed.archive_digest_max_sessions).toBe(20);
    expect(parsed.review_topic_result_cap).toBe(15);
    expect(parsed.review_stale_pending_days).toBe(30);
  });

  it("user's 7-key minimal fabric-config.json still parses (back-compat regression)", () => {
    // Snapshot of the actual user config at .fabric/fabric-config.json as of
    // rc.9 — six keys (knowledge_language + five rc.7-era hint knobs). None
    // of the rc.9+ skill tunables are present and the schema must resolve
    // every one to its default.
    const minimalUserConfig = {
      knowledge_language: "zh-CN" as const,
      archive_hint_hours: 24,
      review_hint_pending_count: 10,
      review_hint_pending_age_days: 7,
      maintenance_hint_days: 14,
      maintenance_hint_cooldown_days: 7,
    };
    const parsed = fabricConfigSchema.parse(minimalUserConfig);
    expect(parsed.knowledge_language).toBe("zh-CN");
    expect(parsed.import_window_first_run_months).toBe(60);
    expect(parsed.import_window_rerun_months).toBe(2);
    expect(parsed.import_max_pending_per_run).toBe(10);
    expect(parsed.import_max_commits_scan).toBe(500);
    expect(parsed.import_skip_canonical_threshold).toBe(50);
    expect(parsed.archive_max_candidates_per_batch).toBe(8);
    expect(parsed.archive_max_recent_paths).toBe(20);
    expect(parsed.archive_digest_max_sessions).toBe(10);
    expect(parsed.review_topic_result_cap).toBe(8);
    expect(parsed.review_stale_pending_days).toBe(14);
  });

  it("root schema remains lenient — unknown keys are silently dropped (no .strict())", () => {
    const parsed = fabricConfigSchema.parse({
      knowledge_language: "en" as const,
      // A bogus key from a future rc that this schema does not know about.
      // Lenient parse means it is silently dropped, not rejected. This is
      // load-bearing: forward-compat for rc.10+ tunables that have not yet
      // landed in shared/src/schemas/fabric-config.ts.
      some_future_rc_knob: 42,
    });
    expect(parsed.knowledge_language).toBe("en");
    expect((parsed as Record<string, unknown>).some_future_rc_knob).toBeUndefined();
  });
});

describe("fabricConfigSchema — rc.9+ skill tunables boundaries", () => {
  it("import_window_first_run_months rejects values below min 1", () => {
    expect(() =>
      fabricConfigSchema.parse({ import_window_first_run_months: 0 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ import_window_first_run_months: -5 }),
    ).toThrow();
    // min 1 is inclusive
    expect(
      fabricConfigSchema.parse({ import_window_first_run_months: 1 })
        .import_window_first_run_months,
    ).toBe(1);
  });

  it("import_window_rerun_months rejects values below min 1", () => {
    expect(() =>
      fabricConfigSchema.parse({ import_window_rerun_months: 0 }),
    ).toThrow();
    expect(
      fabricConfigSchema.parse({ import_window_rerun_months: 1 })
        .import_window_rerun_months,
    ).toBe(1);
  });

  it("import_max_pending_per_run enforces range 1-50", () => {
    expect(() =>
      fabricConfigSchema.parse({ import_max_pending_per_run: 0 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ import_max_pending_per_run: 51 }),
    ).toThrow();
    // Inclusive endpoints
    expect(
      fabricConfigSchema.parse({ import_max_pending_per_run: 1 })
        .import_max_pending_per_run,
    ).toBe(1);
    expect(
      fabricConfigSchema.parse({ import_max_pending_per_run: 50 })
        .import_max_pending_per_run,
    ).toBe(50);
  });

  it("import_max_commits_scan enforces range 50-2000", () => {
    expect(() =>
      fabricConfigSchema.parse({ import_max_commits_scan: 49 }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ import_max_commits_scan: 2001 }),
    ).toThrow();
    // Inclusive endpoints
    expect(
      fabricConfigSchema.parse({ import_max_commits_scan: 50 })
        .import_max_commits_scan,
    ).toBe(50);
    expect(
      fabricConfigSchema.parse({ import_max_commits_scan: 2000 })
        .import_max_commits_scan,
    ).toBe(2000);
  });

  it("positive-int fields reject zero, negative, non-integer, and non-number", () => {
    const positiveFields = [
      "import_skip_canonical_threshold",
      "archive_max_candidates_per_batch",
      "archive_max_recent_paths",
      "archive_digest_max_sessions",
      "review_topic_result_cap",
      "review_stale_pending_days",
    ] as const;
    for (const field of positiveFields) {
      expect(() => fabricConfigSchema.parse({ [field]: 0 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: -1 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: 1.5 })).toThrow();
      expect(() => fabricConfigSchema.parse({ [field]: "8" })).toThrow();
    }
  });
});

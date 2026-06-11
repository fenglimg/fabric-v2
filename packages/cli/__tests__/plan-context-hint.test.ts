/**
 * Unit tests for `fabric plan-context-hint` CLI shim.
 *
 * v2.0.0-rc.22 Scope D T-D3 (TASK-010): cover the auto-heal banner pair
 * (`auto_healed` + `previous_revision_hash`) addition. The shim is a thin
 * adapter over the server's planContext() — we mock that surface and assert
 * the wire-shape projection for both steady-state and post-heal paths.
 *
 * Mock pattern mirrors doctor.test.ts: `vi.doMock` on `@fenglimg/fabric-server`
 * before the dynamic import of the command module, with afterEach teardown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  process.exitCode = originalExitCode;
});

// v2.0.0-rc.38 UX-1/UX-3: per-path description_index collapsed into top-level
// `candidates`; preflight_diagnostics lifted out of the removed `shared`
// wrapper; index item is now { stable_id, description }.
type ServerPlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{
    path: string;
    requirement_profile: Record<string, unknown>;
  }>;
  candidates: unknown[];
  preflight_diagnostics: unknown[];
  auto_healed?: boolean;
  previous_revision_hash?: string;
};

type MockAlwaysBody = {
  stable_id: string;
  type: string;
  layer: "team" | "personal";
  summary: string;
  body: string;
};

type MockCensus = {
  by_type: Record<string, number>;
  by_layer: { team: number; personal: number };
  dropped_other_project: number;
  total: number;
};

const EMPTY_CENSUS: MockCensus = {
  by_type: {},
  by_layer: { team: 0, personal: 0 },
  dropped_other_project: 0,
  total: 0,
};

function mockServer(
  result: ServerPlanContextResult,
  alwaysBodies: MockAlwaysBody[] = [],
  census: MockCensus = EMPTY_CENSUS,
): void {
  vi.doMock("@fenglimg/fabric-server", () => ({
    planContext: vi.fn().mockResolvedValue(result),
    // v2.2 dual-sink (Goal A / D9): plan-context-hint now also pulls the
    // always-active bodies for the AI sink — the mock must export it.
    buildAlwaysActiveBodies: vi.fn().mockResolvedValue(alwaysBodies),
    // v2.2 dual-sink (Goal A / D8): + the read-set census for the human sink.
    buildKnowledgeCensus: vi.fn().mockResolvedValue(census),
  }));
}

function freshResult(): ServerPlanContextResult {
  return {
    revision_hash: "rev-fresh-001",
    stale: false,
    selection_token: "tok-fresh",
    entries: [],
    candidates: [],
    preflight_diagnostics: [],
  };
}

function healedResult(): ServerPlanContextResult {
  return {
    revision_hash: "rev-healed-002",
    stale: false,
    selection_token: "tok-healed",
    entries: [],
    candidates: [],
    preflight_diagnostics: [],
    auto_healed: true,
    previous_revision_hash: "rev-stale-001",
  };
}

describe("plan-context-hint — auto_healed projection (TASK-010)", () => {
  it("hint_payload_no_auto_healed_when_fresh — steady-state response omits auto_healed + previous_revision_hash", async () => {
    mockServer(freshResult());

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });

    expect(output.version).toBe(2);
    expect(output.revision_hash).toBe("rev-fresh-001");
    expect(Object.prototype.hasOwnProperty.call(output, "auto_healed")).toBe(
      false,
    );
    expect(
      Object.prototype.hasOwnProperty.call(output, "previous_revision_hash"),
    ).toBe(false);
  });

  it("hint_payload_carries_auto_healed_when_set — heal pair forwarded to wire payload", async () => {
    mockServer(healedResult());

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });

    expect(output.version).toBe(2);
    expect(output.revision_hash).toBe("rev-healed-002");
    expect(output.auto_healed).toBe(true);
    expect(output.previous_revision_hash).toBe("rev-stale-001");
  });

  it("hint_payload_version_remains_2 — additive fields do NOT bump protocol version", async () => {
    // Fresh path
    mockServer(freshResult());
    const { runPlanContextHint: runFresh } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const freshOut = await runFresh({ all: true });
    expect(freshOut.version).toBe(2);

    // Reset and exercise healed path
    vi.doUnmock("@fenglimg/fabric-server");
    vi.resetModules();
    mockServer(healedResult());
    const { runPlanContextHint: runHealed } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const healedOut = await runHealed({ all: true });
    expect(healedOut.version).toBe(2);
  });

  it("hint_payload_round_trip_json — payload remains JSON-parseable in both modes", async () => {
    // Fresh: round-trip should preserve shape and omit the heal pair after
    // re-parse (omitted optional fields stay undefined on the parsed object).
    mockServer(freshResult());
    const { runPlanContextHint: runFresh } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const freshOut = await runFresh({ all: true });
    const freshSerialized = JSON.stringify(freshOut);
    const freshParsed = JSON.parse(freshSerialized) as Record<string, unknown>;
    expect(freshParsed.version).toBe(2);
    expect(freshParsed.revision_hash).toBe("rev-fresh-001");
    expect(freshParsed.auto_healed).toBeUndefined();
    expect(freshParsed.previous_revision_hash).toBeUndefined();

    // Healed: heal pair survives the JSON round-trip with exact values.
    vi.doUnmock("@fenglimg/fabric-server");
    vi.resetModules();
    mockServer(healedResult());
    const { runPlanContextHint: runHealed } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const healedOut = await runHealed({ all: true });
    const healedSerialized = JSON.stringify(healedOut);
    const healedParsed = JSON.parse(healedSerialized) as Record<
      string,
      unknown
    >;
    expect(healedParsed.version).toBe(2);
    expect(healedParsed.revision_hash).toBe("rev-healed-002");
    expect(healedParsed.auto_healed).toBe(true);
    expect(healedParsed.previous_revision_hash).toBe("rev-stale-001");
  });

  it("hint_payload_omits_previous_revision_hash_when_server_only_set_flag — defensive partial-shape handling", async () => {
    // If the server set auto_healed:true but failed to provide a previous
    // revision_hash (defensive — shouldn't happen post-T9 but the shim must
    // not synthesize a value), the CLI should emit auto_healed:true alone.
    mockServer({
      revision_hash: "rev-partial",
      stale: false,
      selection_token: "tok-partial",
      entries: [],
      candidates: [],
      preflight_diagnostics: [],
      auto_healed: true,
      // previous_revision_hash intentionally omitted
    });

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });

    expect(output.auto_healed).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(output, "previous_revision_hash"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.27 TASK-002 (audit §2.5/§2.7): scope expose + split counts.
// ---------------------------------------------------------------------------

// v2.0.0-rc.38 UX-3: top-level mirrors removed — type/maturity/relevance_scope/
// relevance_paths now live on description only.
function makeIndexItem(opts: {
  id: string;
  scope: "narrow" | "broad";
  type?: string;
  maturity?: string;
}): unknown {
  return {
    stable_id: opts.id,
    description: {
      summary: `summary for ${opts.id}`,
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: `summary for ${opts.id}`,
      knowledge_type: opts.type ?? "guideline",
      maturity: opts.maturity ?? "draft",
      relevance_scope: opts.scope,
      relevance_paths: opts.scope === "narrow" ? ["src/**/*.ts"] : [],
    },
  };
}

describe("plan-context-hint — relevance_scope expose (TASK-002 / audit §2.5/§2.7)", () => {
  it("entry shape carries relevance_scope per item", async () => {
    const narrow = makeIndexItem({ id: "KT-DEC-0001", scope: "narrow" });
    const broad = makeIndexItem({ id: "KT-GLD-0001", scope: "broad" });
    mockServer({
      revision_hash: "rev-scope",
      stale: false,
      selection_token: "tok-scope",
      entries: [],
      candidates: [narrow, broad],
      preflight_diagnostics: [],
    });

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });

    expect(output.entries).toHaveLength(2);
    const byId = Object.fromEntries(output.entries.map((e) => [e.id, e]));
    expect(byId["KT-DEC-0001"]?.relevance_scope).toBe("narrow");
    expect(byId["KT-GLD-0001"]?.relevance_scope).toBe("broad");
  });

  it("narrow_count + broad_only_count partition the entries set", async () => {
    const items = [
      makeIndexItem({ id: "KT-DEC-0001", scope: "narrow" }),
      makeIndexItem({ id: "KT-DEC-0002", scope: "narrow" }),
      makeIndexItem({ id: "KT-GLD-0001", scope: "broad" }),
    ];
    mockServer({
      revision_hash: "rev-counts",
      stale: false,
      selection_token: "tok-counts",
      entries: [],
      candidates: items,
      preflight_diagnostics: [],
    });

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });

    expect(output.narrow_count).toBe(2);
    expect(output.broad_only_count).toBe(1);
    expect(output.narrow_count + output.broad_only_count).toBe(
      output.entries.length,
    );
  });

  it("missing relevance_scope on a server-side item defaults to broad", async () => {
    // Defensive: a malformed item missing relevance_scope should not crash —
    // the CLI defaults to "broad" so the entry is still discoverable.
    const item = {
      stable_id: "KT-DEC-0999",
      level: "L2",
      required: false,
      selectable: false,
      description: {
        summary: "no scope item",
        intent_clues: [],
        tech_stack: [],
        impact: [],
        must_read_if: "no scope item",
      },
      type: "guideline",
      maturity: "draft",
      // relevance_scope intentionally omitted
    };
    mockServer({
      revision_hash: "rev-default",
      stale: false,
      selection_token: "tok-default",
      entries: [],
      candidates: [item],
      preflight_diagnostics: [],
    });

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    expect(output.entries[0]?.relevance_scope).toBe("broad");
    expect(output.broad_only_count).toBe(1);
    expect(output.narrow_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): the CLI
// projects the server's `related_appended` map onto per-entry `related_to`
// provenance, and stays an honest no-op when the server appended nothing.
// ---------------------------------------------------------------------------

describe("plan-context-hint — related二阶 provenance projection (W3-T2)", () => {
  it("projects related_appended onto the appended entry's related_to", async () => {
    const surfaced = makeIndexItem({ id: "KT-DEC-0001", scope: "broad" });
    const neighbour = makeIndexItem({ id: "KT-DEC-0002", scope: "broad" });
    mockServer({
      revision_hash: "rev-related",
      stale: false,
      selection_token: "tok-related",
      entries: [],
      candidates: [surfaced, neighbour],
      preflight_diagnostics: [],
      // server reports the neighbour was pulled in via the surfaced entry's edge.
      related_appended: { "KT-DEC-0002": "KT-DEC-0001" },
    } as unknown as Parameters<typeof mockServer>[0]);

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    const byId = Object.fromEntries(output.entries.map((e) => [e.id, e]));
    // The graph-pulled neighbour carries provenance; the ranked entry does not.
    expect(byId["KT-DEC-0002"]?.related_to).toBe("KT-DEC-0001");
    expect(
      Object.prototype.hasOwnProperty.call(byId["KT-DEC-0001"] ?? {}, "related_to"),
    ).toBe(false);
  });

  it("graph-empty honest no-op: no related_appended → no related_to on any entry", async () => {
    const item = makeIndexItem({ id: "KT-DEC-0001", scope: "broad" });
    mockServer({
      revision_hash: "rev-no-graph",
      stale: false,
      selection_token: "tok-no-graph",
      entries: [],
      candidates: [item],
      preflight_diagnostics: [],
      // no related_appended field — the steady-state / graph-empty path.
    });

    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    for (const e of output.entries) {
      expect(Object.prototype.hasOwnProperty.call(e, "related_to")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// v2.2 dual-sink (Goal A / D9): always_bodies projection — the AI sink's
// always-active (guideline/model) bodies, forwarded from buildAlwaysActiveBodies.
// ---------------------------------------------------------------------------
describe("plan-context-hint — always_bodies projection (dual-sink D9)", () => {
  it("forwards always-active bodies into the wire payload", async () => {
    mockServer(freshResult(), [
      {
        stable_id: "team:KT-GLD-0001",
        type: "guidelines",
        layer: "team",
        summary: "Code style guidelines",
        body: "# Code style\n\nUse 2-space indent.",
      },
      {
        stable_id: "personal:KP-MOD-9001",
        type: "models",
        layer: "personal",
        summary: "Domain model",
        body: "# Model\n\nThe Order aggregate …",
      },
    ]);
    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    expect(output.always_bodies).toHaveLength(2);
    expect(output.always_bodies[0]).toEqual({
      id: "team:KT-GLD-0001",
      type: "guidelines",
      layer: "team",
      summary: "Code style guidelines",
      body: "# Code style\n\nUse 2-space indent.",
    });
    expect(output.always_bodies[1].id).toBe("personal:KP-MOD-9001");
  });

  it("always_bodies is always present (empty array when none)", async () => {
    mockServer(freshResult(), []);
    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    expect(output.always_bodies).toEqual([]);
  });

  it("forwards the read-set census for the human sink", async () => {
    mockServer(freshResult(), [], {
      by_type: { guidelines: 2, models: 1, decisions: 5, pitfalls: 3, processes: 1 },
      by_layer: { team: 10, personal: 2 },
      dropped_other_project: 4,
      total: 12,
    });
    const { runPlanContextHint } = await import(
      "../src/commands/plan-context-hint.ts"
    );
    const output = await runPlanContextHint({ all: true });
    expect(output.census.by_type.decisions).toBe(5);
    expect(output.census.by_layer.team).toBe(10);
    expect(output.census.dropped_other_project).toBe(4);
    expect(output.census.total).toBe(12);
  });
});

/**
 * Unit tests for `fab plan-context-hint` CLI shim.
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

type ServerPlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{
    path: string;
    requirement_profile: Record<string, unknown>;
    description_index: unknown[];
  }>;
  shared: {
    description_index: unknown[];
    preflight_diagnostics: unknown[];
  };
  auto_healed?: boolean;
  previous_revision_hash?: string;
};

function mockServer(result: ServerPlanContextResult): void {
  vi.doMock("@fenglimg/fabric-server", () => ({
    planContext: vi.fn().mockResolvedValue(result),
  }));
}

function freshResult(): ServerPlanContextResult {
  return {
    revision_hash: "rev-fresh-001",
    stale: false,
    selection_token: "tok-fresh",
    entries: [],
    shared: {
      description_index: [],
      preflight_diagnostics: [],
    },
  };
}

function healedResult(): ServerPlanContextResult {
  return {
    revision_hash: "rev-healed-002",
    stale: false,
    selection_token: "tok-healed",
    entries: [],
    shared: {
      description_index: [],
      preflight_diagnostics: [],
    },
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
      shared: { description_index: [], preflight_diagnostics: [] },
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

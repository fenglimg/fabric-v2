/**
 * v2.2 dual-sink (Goal A / D4): unit tests for templates/hooks/lib/nudge-policy.cjs.
 *
 * The resolver governs ONLY the human sink (systemMessage). These tests pin:
 *   - the nudge_mode preset domain + "normal" fallback,
 *   - the observe.* per-event override (true/false) precedence,
 *   - the structural gates (PreToolUse hit / Stop highValue) being mode-independent,
 *   - the resolution-order truth table (mute > gate > opt-in > silent > preset),
 *   - the CORE INVARIANT (D5): the lib exposes NO AI-sink decision — the human
 *     channel volume is fully decoupled from what the model receives.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const configCache = require("../templates/hooks/lib/config-cache.cjs") as {
  clearConfigCache: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const nudgePolicy = require("../templates/hooks/lib/nudge-policy.cjs") as {
  readNudgeMode: (root: string) => string;
  readObserveOverride: (root: string, event: string) => boolean | undefined;
  resolveHumanSink: (
    root: string,
    event: string,
    gate?: { hit?: boolean; highValue?: boolean },
  ) => { emitHuman: boolean; verbosity: string; mode: string };
  NUDGE_MODES: string[];
  DEFAULT_NUDGE_MODE: string;
  OBSERVE_EVENTS: string[];
};

let tempDirs: string[] = [];
// G2 (GRL-STOPHOOK-AIONLY-20260709): env + global layer added. Isolate real
// user's HOME / FABRIC_NUDGE_MODE so tests are hermetic.
let originalHome: string | undefined;
let originalFabricNudgeMode: string | undefined;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalFabricNudgeMode === undefined) delete process.env.FABRIC_NUDGE_MODE;
  else process.env.FABRIC_NUDGE_MODE = originalFabricNudgeMode;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  configCache.clearConfigCache();
  originalHome = process.env.HOME;
  originalFabricNudgeMode = process.env.FABRIC_NUDGE_MODE;
  // Point HOME at an empty tmpdir so the new Layer 3 (global config) doesn't
  // leak the real user's ~/.fabric/fabric-global.json into these tests.
  const fakeHome = mkdtempSync(join(tmpdir(), "fabric-nudge-home-"));
  tempDirs.push(fakeHome);
  process.env.HOME = fakeHome;
  delete process.env.FABRIC_NUDGE_MODE;
});

function makeRoot(config?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-nudge-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  if (config !== undefined) {
    writeFileSync(
      join(dir, ".fabric", "fabric-config.json"),
      JSON.stringify(config),
      "utf8",
    );
  }
  return dir;
}

describe("nudge-policy — readNudgeMode", () => {
  it("defaults to normal when config is absent / empty / unknown", () => {
    // G2 boundary: DEFAULT stays "normal" (not "silent") so old installs
    // without nudge_mode field keep visible SS/PT hooks. New installs get
    // silent via G1 scaffold. See DEFAULT_NUDGE_MODE JSDoc in nudge-policy.cjs.
    expect(nudgePolicy.readNudgeMode(makeRoot())).toBe("normal");
    expect(nudgePolicy.readNudgeMode(makeRoot({}))).toBe("normal");
    expect(nudgePolicy.readNudgeMode(makeRoot({ nudge_mode: "loud" }))).toBe("normal");
    expect(nudgePolicy.readNudgeMode(makeRoot({ nudge_mode: 7 }))).toBe("normal");
  });

  it("reads each valid preset", () => {
    for (const mode of ["silent", "minimal", "normal", "verbose"]) {
      expect(nudgePolicy.readNudgeMode(makeRoot({ nudge_mode: mode }))).toBe(mode);
    }
  });
});

describe("nudge-policy — readObserveOverride", () => {
  it("returns undefined when observe is absent / malformed", () => {
    expect(nudgePolicy.readObserveOverride(makeRoot(), "stop")).toBeUndefined();
    expect(nudgePolicy.readObserveOverride(makeRoot({ observe: 3 }), "stop")).toBeUndefined();
    expect(
      nudgePolicy.readObserveOverride(makeRoot({ observe: { stop: "yes" } }), "stop"),
    ).toBeUndefined();
  });

  it("returns the explicit per-event boolean", () => {
    const root = makeRoot({ observe: { session_start: false, stop: true } });
    expect(nudgePolicy.readObserveOverride(root, "session_start")).toBe(false);
    expect(nudgePolicy.readObserveOverride(root, "stop")).toBe(true);
    expect(nudgePolicy.readObserveOverride(root, "pre_tool_use")).toBeUndefined();
  });
});

describe("nudge-policy — resolveHumanSink preset behavior", () => {
  it("silent suppresses every event's human sink", () => {
    const root = makeRoot({ nudge_mode: "silent" });
    expect(nudgePolicy.resolveHumanSink(root, "session_start", {}).emitHuman).toBe(false);
    expect(nudgePolicy.resolveHumanSink(root, "pre_tool_use", { hit: true }).emitHuman).toBe(false);
    expect(nudgePolicy.resolveHumanSink(root, "stop", { highValue: true }).emitHuman).toBe(false);
  });

  it("normal/minimal/verbose emit session_start (no structural gate)", () => {
    for (const mode of ["minimal", "normal", "verbose"]) {
      const root = makeRoot({ nudge_mode: mode });
      const r = nudgePolicy.resolveHumanSink(root, "session_start", {});
      expect(r.emitHuman).toBe(true);
      expect(r.verbosity).toBe(mode);
    }
  });

  it("verbosity for silent collapses to minimal (moot — emitHuman false)", () => {
    const r = nudgePolicy.resolveHumanSink(makeRoot({ nudge_mode: "silent" }), "session_start", {});
    expect(r.verbosity).toBe("minimal");
    expect(r.emitHuman).toBe(false);
  });
});

describe("nudge-policy — structural gates (mode-independent, C5/D6)", () => {
  it("PreToolUse miss suppresses the human sink under any non-silent preset", () => {
    for (const mode of ["minimal", "normal", "verbose"]) {
      const root = makeRoot({ nudge_mode: mode });
      expect(nudgePolicy.resolveHumanSink(root, "pre_tool_use", { hit: false }).emitHuman).toBe(false);
      expect(nudgePolicy.resolveHumanSink(root, "pre_tool_use", { hit: true }).emitHuman).toBe(true);
    }
  });

  it("Stop low-value suppresses (value-gate)", () => {
    const root = makeRoot({ nudge_mode: "normal" });
    expect(nudgePolicy.resolveHumanSink(root, "stop", { highValue: false }).emitHuman).toBe(false);
  });

  // v2.2 C1 (W5): the Stop human nudge defaults to QUIET (observe-only telemetry)
  // even with a high-value signal — the edit-count/session lives in events.jsonl
  // for after-the-fact querying; the Stop hook should not interrupt with a
  // real-time human UI (user directive 2026-06-22). Opt back in via the verbose
  // preset or observe.stop=true.
  it("Stop high-value is QUIET by default; verbose / observe.stop=true opts back in", () => {
    expect(
      nudgePolicy.resolveHumanSink(makeRoot({ nudge_mode: "normal" }), "stop", { highValue: true })
        .emitHuman,
    ).toBe(false);
    expect(
      nudgePolicy.resolveHumanSink(makeRoot({ nudge_mode: "minimal" }), "stop", { highValue: true })
        .emitHuman,
    ).toBe(false);
    expect(
      nudgePolicy.resolveHumanSink(makeRoot({ nudge_mode: "verbose" }), "stop", { highValue: true })
        .emitHuman,
    ).toBe(true);
    expect(
      nudgePolicy.resolveHumanSink(
        makeRoot({ nudge_mode: "normal", observe: { stop: true } }),
        "stop",
        { highValue: true },
      ).emitHuman,
    ).toBe(true);
  });
});

describe("nudge-policy — resolution order / override precedence", () => {
  it("observe=false mutes even a PreToolUse hit", () => {
    const root = makeRoot({ nudge_mode: "verbose", observe: { pre_tool_use: false } });
    expect(nudgePolicy.resolveHumanSink(root, "pre_tool_use", { hit: true }).emitHuman).toBe(false);
  });

  it("observe=true opts in even under silent — but the structural gate still applies", () => {
    const root = makeRoot({ nudge_mode: "silent", observe: { stop: true, pre_tool_use: true } });
    // stop opt-in with high value → emits despite silent
    expect(nudgePolicy.resolveHumanSink(root, "stop", { highValue: true }).emitHuman).toBe(true);
    // pre_tool_use opt-in but a miss → structural gate still mutes
    expect(nudgePolicy.resolveHumanSink(root, "pre_tool_use", { hit: false }).emitHuman).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CORE INVARIANT (D5): the resolver has NO AI-sink decision surface. The human
// channel volume is fully decoupled from the AI additionalContext payload.
// ---------------------------------------------------------------------------
describe("nudge-policy — D5 invariant: no AI-sink gate exists", () => {
  it("exports only human-sink helpers — no emitAi / shouldEmitAi surface", () => {
    const keys = Object.keys(nudgePolicy);
    expect(keys.some((k) => /ai/i.test(k))).toBe(false);
  });

  it("resolveHumanSink return shape never carries an AI decision field", () => {
    const root = makeRoot({ nudge_mode: "silent" });
    const r = nudgePolicy.resolveHumanSink(root, "session_start", {});
    expect(Object.keys(r).sort()).toEqual(["emitHuman", "mode", "verbosity"]);
  });
});

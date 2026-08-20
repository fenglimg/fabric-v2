// Parity gate for the per-session `.fabric/.cache/` filename contract.
//
// These sidecars are written by standalone hook .cjs files (copied into the
// user's project, so they cannot import from this package) and read by the MCP
// server + doctor. The name is therefore spelled out independently on both
// sides, and nothing type-checks the two spellings against each other: writer
// and reader can silently drift apart while every unit test on each side stays
// green, because each side tests against its OWN constant. That is the
// producer/consumer false-green — only a round-trip assertion catches it.
//
// It also catches the other half of the same mistake: adding a per-session
// sidecar and forgetting the staleness sweep. A single shared slot was
// self-limiting at one file; one file per session grows without bound.

import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIVE_SESSION_FILE_PREFIX, ACTIVE_SESSION_FILE_SUFFIX } from "./active-session.js";
import {
  LIVE_SESSION_FAMILY_PREFIX,
  matchStaleSweepFamily,
  ON_DEMAND_SWEEP_FAMILIES,
  SESSION_HINTS_FILE_PREFIX,
  SESSION_HINTS_FILE_SUFFIX,
  STALE_SWEEP_FAMILIES,
} from "./doctor/doctor-session-hints-stale.js";

const require_ = createRequire(import.meta.url);
const HOOK_LIB = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "cli",
  "templates",
  "hooks",
  "lib",
);

const stateStore = require_(join(HOOK_LIB, "state-store.cjs")) as {
  ACTIVE_SESSION_FILE_PREFIX: string;
  ACTIVE_SESSION_FILE_SUFFIX: string;
  activeSessionFileName: (sessionId: string) => string;
};

const narrowHook = require_(join(HOOK_LIB, "knowledge-hint-narrow.cjs")) as {
  narrowDedupWindowPath: (projectRoot: string, sessionId: string) => string;
  CONSTANTS: {
    SESSION_HINTS_FILE_PREFIX: string;
    SESSION_HINTS_FILE_SUFFIX: string;
    NARROW_DEDUP_WINDOW_FILE_PREFIX: string;
    NARROW_DEDUP_WINDOW_FILE_SUFFIX: string;
  };
};

const signalState = require_(join(HOOK_LIB, "session-signal-state.cjs")) as {
  sessionScopedCacheFile: (baseRelPath: string, sessionId: string) => string;
  sessionDismissFileName: (sessionId: string) => string;
};

const hintConfig = require_(join(HOOK_LIB, "hint-config.cjs")) as {
  SHOWN_CACHE_FILE: string;
  MAINTENANCE_HINT_LAST_EMIT_FILE: string;
};

const ROUND_TRIP_SESSION = "sess-round-trip";

/**
 * Every per-session filename the hooks can write, produced by calling the REAL
 * writer helper — not by re-spelling its prefix here.
 *
 * The previous version of this gate listed three prefixes by hand and asserted
 * those three were swept. It was green while three OTHER per-session families
 * (`archive-hint-shown-*`, `hint-dismiss-*`, `maintenance-hint-last-emit-*`)
 * accumulated unswept, because a hand-written list verifies its own contents,
 * not the world. Adding a helper call here is the only maintenance step left.
 */
const WRITTEN_SIDECAR_NAMES: readonly string[] = [
  stateStore.activeSessionFileName(ROUND_TRIP_SESSION),
  basename(narrowHook.narrowDedupWindowPath("/tmp/parity", ROUND_TRIP_SESSION)),
  `${narrowHook.CONSTANTS.SESSION_HINTS_FILE_PREFIX}${ROUND_TRIP_SESSION}${narrowHook.CONSTANTS.SESSION_HINTS_FILE_SUFFIX}`,
  basename(signalState.sessionScopedCacheFile(hintConfig.SHOWN_CACHE_FILE, ROUND_TRIP_SESSION)),
  basename(
    signalState.sessionScopedCacheFile(
      hintConfig.MAINTENANCE_HINT_LAST_EMIT_FILE,
      ROUND_TRIP_SESSION,
    ),
  ),
  signalState.sessionDismissFileName(ROUND_TRIP_SESSION),
];

describe("per-session cache filename parity (writer hooks ↔ reader server)", () => {
  it("active-session: the name the hook writes is the name the server looks for", () => {
    expect(stateStore.ACTIVE_SESSION_FILE_PREFIX).toBe(ACTIVE_SESSION_FILE_PREFIX);
    expect(stateStore.ACTIVE_SESSION_FILE_SUFFIX).toBe(ACTIVE_SESSION_FILE_SUFFIX);
    // Round-trip the real writer helper, not just the constants.
    const written = stateStore.activeSessionFileName("sess-round-trip");
    expect(written.startsWith(ACTIVE_SESSION_FILE_PREFIX)).toBe(true);
    expect(written.endsWith(ACTIVE_SESSION_FILE_SUFFIX)).toBe(true);
  });

  it("session-hints: hook and doctor agree on the name", () => {
    expect(narrowHook.CONSTANTS.SESSION_HINTS_FILE_PREFIX).toBe(SESSION_HINTS_FILE_PREFIX);
    expect(narrowHook.CONSTANTS.SESSION_HINTS_FILE_SUFFIX).toBe(SESSION_HINTS_FILE_SUFFIX);
  });

  it.each(WRITTEN_SIDECAR_NAMES)("lint #27 sweeps %s", (name) => {
    // Round-trip: the writer produced this exact name, so the reader must claim
    // it. Prefix AND suffix are checked together — `maintenance-hint-last-emit-*`
    // has no extension, and a shared `.json` gate silently skipped it.
    expect(matchStaleSweepFamily(name)).not.toBeNull();
  });

  it("the on-demand sweep excludes a family that actually exists", () => {
    // The exclusion is by string prefix, so a rename of the family would turn it
    // into a no-op that still reads like a guard. Assert it still hits.
    expect(STALE_SWEEP_FAMILIES.some((f) => f.prefix === LIVE_SESSION_FAMILY_PREFIX)).toBe(true);
    expect(ON_DEMAND_SWEEP_FAMILIES.length).toBe(STALE_SWEEP_FAMILIES.length - 1);
  });

  it("the on-demand sweep does not claim a LIVE session's own file", () => {
    // Round-trip against the real writer, not the constant: this is the exact
    // name a running session has on disk right now. Doctor may take it once it
    // is a week old; the console button, which has no age floor, never may.
    const live = stateStore.activeSessionFileName(ROUND_TRIP_SESSION);
    expect(matchStaleSweepFamily(live)).not.toBeNull();
    expect(matchStaleSweepFamily(live, ON_DEMAND_SWEEP_FAMILIES)).toBeNull();
    // ...and it narrows ONLY that family — every other sidecar is still swept,
    // or the exclusion would be indistinguishable from disabling the button.
    for (const name of WRITTEN_SIDECAR_NAMES.filter((n) => n !== live)) {
      expect(matchStaleSweepFamily(name, ON_DEMAND_SWEEP_FAMILIES)).not.toBeNull();
    }
  });

  it("the sweep does not claim the legacy shared slots those families grew out of", () => {
    // Each per-session family replaced a single shared file. Those pre-split
    // names still exist in the wild and are self-limiting at one file; the DELETE
    // arm must not widen onto them (KT-PIT-0051).
    for (const legacy of ["archive-hint-shown.json", "narrow-dedup-window.json", "active-session.json"]) {
      expect(matchStaleSweepFamily(legacy)).toBeNull();
    }
    // A prefix hit with an empty session token is not a session file either.
    expect(matchStaleSweepFamily(`${SESSION_HINTS_FILE_PREFIX}${SESSION_HINTS_FILE_SUFFIX}`)).toBeNull();
  });
});

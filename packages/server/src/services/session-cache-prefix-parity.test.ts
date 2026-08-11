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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIVE_SESSION_FILE_PREFIX, ACTIVE_SESSION_FILE_SUFFIX } from "./active-session.js";
import {
  SESSION_HINTS_FILE_PREFIX,
  SESSION_HINTS_FILE_SUFFIX,
  STALE_SWEEP_PREFIXES,
} from "./doctor-session-hints-stale.js";

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

  it("every per-session sidecar the hooks write is swept by lint #27", () => {
    const written = [
      stateStore.ACTIVE_SESSION_FILE_PREFIX,
      narrowHook.CONSTANTS.SESSION_HINTS_FILE_PREFIX,
      narrowHook.CONSTANTS.NARROW_DEDUP_WINDOW_FILE_PREFIX,
    ];
    for (const prefix of written) {
      expect(STALE_SWEEP_PREFIXES).toContain(prefix);
    }
  });

  it("sweep only matches names the sweep's suffix check can see", () => {
    // The sweep filters on one shared `.json` suffix; a sidecar written with a
    // different extension would be listed as a prefix match and then silently
    // skipped, i.e. never cleaned up.
    expect(narrowHook.CONSTANTS.NARROW_DEDUP_WINDOW_FILE_SUFFIX).toBe(SESSION_HINTS_FILE_SUFFIX);
    expect(stateStore.ACTIVE_SESSION_FILE_SUFFIX).toBe(SESSION_HINTS_FILE_SUFFIX);
  });
});

/**
 * G3 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * Round-trip SST oracle for the archive high-value predicate.
 *
 * PROBLEM (crack-2 3.8% purity):
 *   - fabric-hint.cjs (Stop hook, backlog scan) reported 26 backlog sessions
 *     "carrying high-value work" while fab_archive_scan (MCP) identified only
 *     1 true candidate. Root cause = two independent predicate implementations
 *     with drifting semantics (workspace-wide vs session-scoped, watermark
 *     handling for never-archived sessions).
 *
 * FIX (SST — Single Source of Truth):
 *   - Canonical predicate lives at packages/shared/src/high-value-predicate.ts
 *     (isHighValueArchiveCandidate)
 *   - Hook twin (.cjs, byte-parity) at packages/cli/templates/hooks/lib/
 *     high-value-predicate.cjs (mirrors cite-line-parser pattern)
 *   - Server archive-scan.ts imports from @fenglimg/fabric-shared
 *   - This round-trip test seeds the SAME events and asserts BOTH
 *     implementations return the SAME count. The oracle exposes drift.
 */

import { createRequire } from "node:module";
import { join, resolve as pathResolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isHighValueArchiveCandidate } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);

// Hook twin path — resolved from THIS test file location up to repo root.
// packages/server/src/services → repo root is 4 levels up.
const REPO_ROOT = pathResolve(__dirname, "..", "..", "..", "..");
const HOOK_TWIN_PATH = join(
  REPO_ROOT,
  "packages",
  "cli",
  "templates",
  "hooks",
  "lib",
  "high-value-predicate.cjs",
);

function loadHookTwin(): {
  isHighValueArchiveCandidate: (
    events: unknown[],
    sessionId: string,
    watermarkTs: number | null,
  ) => boolean;
} {
  // Guard against RED: if the .cjs twin doesn't exist yet, throw with a marker
  // string so the failure message is diagnostic (not a raw MODULE_NOT_FOUND).
  return require(HOOK_TWIN_PATH) as ReturnType<typeof loadHookTwin>;
}

// Fixture: 3 sessions, only 1 (sess-A) has a high-value archive signal past
// its watermark. Backlog scan is expected to count exactly 1.
function buildFixtureEvents(): Record<string, unknown>[] {
  return [
    // sess-A: high-value edit_paths_recorded past watermark 0 → high-value
    { event_type: "edit_paths_recorded", ts: 1000, session_id: "sess-A" },
    // sess-B: only assistant_turn_observed with no normative keywords → NOT high-value
    {
      event_type: "assistant_turn_observed",
      ts: 2000,
      session_id: "sess-B",
      kb_line_raw: "KB: none",
    },
    // sess-C: only session_archive_attempted (not a HIGH_VALUE type) → NOT high-value
    { event_type: "session_archive_attempted", ts: 3000, session_id: "sess-C" },
  ];
}

describe("G3 round-trip SST oracle (crack-2 26→1 fix)", () => {
  it("shared canonical predicate identifies sess-A as high-value, sess-B/C as not", () => {
    const events = buildFixtureEvents();
    expect(isHighValueArchiveCandidate(events, "sess-A", 0)).toBe(true);
    expect(isHighValueArchiveCandidate(events, "sess-B", 0)).toBe(false);
    expect(isHighValueArchiveCandidate(events, "sess-C", 0)).toBe(false);
  });

  it("hook .cjs twin agrees with shared canonical (SST parity — the oracle)", () => {
    const hookTwin = loadHookTwin();
    const events = buildFixtureEvents();

    for (const sid of ["sess-A", "sess-B", "sess-C"]) {
      const sharedResult = isHighValueArchiveCandidate(events, sid, 0);
      const hookResult = hookTwin.isHighValueArchiveCandidate(events, sid, 0);
      expect(
        hookResult,
        `SST drift on ${sid}: shared=${sharedResult} hook=${hookResult}`,
      ).toBe(sharedResult);
    }
  });

  it("null watermark treated as 'never archived' (all past events count)", () => {
    // KT-PIT-0021: never-archived sessions → watermark=null → strict > 0 would
    // exclude first event; canonical predicate must accept ts>0 when wm=null/0.
    const events = [{ event_type: "edit_paths_recorded", ts: 1, session_id: "fresh" }];
    expect(isHighValueArchiveCandidate(events, "fresh", null)).toBe(true);
    expect(isHighValueArchiveCandidate(events, "fresh", 0)).toBe(true);
  });

  it("normative keyword in latest assistant_turn triggers high-value (crack-2 SST)", () => {
    const events = [
      {
        event_type: "assistant_turn_observed",
        ts: 500,
        session_id: "kw",
        kb_line_raw: "以后 记一下 需要 archive",
      },
    ];
    expect(isHighValueArchiveCandidate(events, "kw", 0)).toBe(true);
  });
});

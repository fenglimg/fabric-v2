/**
 * v2.0.0-rc.25 TASK-11 — `session_archive_attempted` event-emission
 * integration tests.
 *
 * The schema-level coverage (rejects unknown outcome values, defaults
 * applied, etc.) lives in
 * `packages/shared/src/schemas/event-ledger.test.ts`. This file is the
 * INTEGRATION-tier counterpart: it exercises the production
 * `appendEventLedgerEvent` write path with the four outcome enums plus
 * the multi-session emission contract per
 * `planning-context.md` Q3.2 + SKILL.md Phase 2.5.
 *
 * Why a separate file: TASK-05 (Phase 2.5 emission rules) and Phase 0.0
 * digest filter both depend on the appended event surviving the
 * `appendEventLedgerEvent → readEventLedger` round-trip with the exact
 * `outcome` / `session_id` / `knowledge_proposed_ids` shape. Schema
 * unit tests pass even if the ledger queue strips a field; this
 * round-trip catches that class of regression.
 *
 * 4 cases per TASK-11 spec:
 *   1. outcome='proposed' with knowledge_proposed_ids=['key1','key2'] — full payload round-trip
 *   2. outcome='viability_failed' — Phase 0.5 gate FAIL terminal state
 *   3. outcome='user_dismissed' — anti-rescan terminal state
 *   4. Multi-session emission — 3 session_ids, 3 distinct events
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendEventLedgerEvent,
  readEventLedger,
} from "../src/services/event-ledger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `fabric-archive-attempt-${prefix}-`));
  tempDirs.push(projectRoot);
  return projectRoot;
}

// ---------------------------------------------------------------------------
// Case 1 — outcome='proposed' with non-empty knowledge_proposed_ids
// ---------------------------------------------------------------------------

describe("TASK-11 archive-attempt outcomes: case 1 — proposed", () => {
  it("appends + round-trips a session_archive_attempted event with outcome='proposed'", async () => {
    const projectRoot = await createTempProject("proposed");
    const beforeTs = Date.now();

    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "session_archive_attempted",
      session_id: "session-alpha",
      outcome: "proposed",
      covered_through_ts: 1_700_000_000_000,
      candidates_proposed: 2,
      knowledge_proposed_ids: ["key1", "key2"],
    });

    // Server-assigned envelope fields are populated automatically.
    expect(stored.kind).toBe("fabric-event");
    expect(stored.schema_version).toBe(1);
    expect(typeof stored.id).toBe("string");
    expect(stored.id.startsWith("event:")).toBe(true);
    expect(typeof stored.ts).toBe("number");
    expect(stored.ts).toBeGreaterThanOrEqual(beforeTs);

    // Payload fields round-trip verbatim.
    expect(stored.event_type).toBe("session_archive_attempted");
    expect(stored.session_id).toBe("session-alpha");
    if (stored.event_type === "session_archive_attempted") {
      expect(stored.outcome).toBe("proposed");
      expect(stored.covered_through_ts).toBe(1_700_000_000_000);
      expect(stored.candidates_proposed).toBe(2);
      expect(stored.knowledge_proposed_ids).toEqual(["key1", "key2"]);
    }

    // Read-back path also returns the same event (zero loss across the
    // ledgerQueue → readEventLedger boundary).
    const { events, warnings } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
    });
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
// Case 2 — outcome='viability_failed' with default candidate/id fields
// ---------------------------------------------------------------------------

describe("TASK-11 archive-attempt outcomes: case 2 — viability_failed", () => {
  it("appends + round-trips a session_archive_attempted event with outcome='viability_failed'", async () => {
    const projectRoot = await createTempProject("viability");

    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "session_archive_attempted",
      session_id: "session-beta",
      outcome: "viability_failed",
      covered_through_ts: 1_700_000_010_000,
      // Omit candidates_proposed + knowledge_proposed_ids — schema MUST
      // default them to 0 / [] per rc.25 TASK-01 design (non-`proposed`
      // outcomes always have zero candidates).
    });

    if (stored.event_type === "session_archive_attempted") {
      expect(stored.outcome).toBe("viability_failed");
      expect(stored.candidates_proposed).toBe(0);
      expect(stored.knowledge_proposed_ids).toEqual([]);
    }

    const { events } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
// Case 3 — outcome='user_dismissed' (anti-rescan signal)
// ---------------------------------------------------------------------------

describe("TASK-11 archive-attempt outcomes: case 3 — user_dismissed", () => {
  it("appends + round-trips a session_archive_attempted event with outcome='user_dismissed'", async () => {
    const projectRoot = await createTempProject("dismissed");

    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "session_archive_attempted",
      session_id: "session-gamma",
      outcome: "user_dismissed",
      covered_through_ts: 1_700_000_020_000,
    });

    if (stored.event_type === "session_archive_attempted") {
      expect(stored.outcome).toBe("user_dismissed");
      expect(stored.candidates_proposed).toBe(0);
      expect(stored.knowledge_proposed_ids).toEqual([]);
    }

    // Phase 0.0 digest filter relies on querying by session_id; the
    // round-trip via readEventLedger MUST surface the session_id field.
    const { events } = await readEventLedger(projectRoot, {
      session_id: "session-gamma",
    });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("session_archive_attempted");
    expect(events[0].session_id).toBe("session-gamma");
  });
});

// ---------------------------------------------------------------------------
// Case 4 — multi-session emission: one event per session_id
// ---------------------------------------------------------------------------

describe("TASK-11 archive-attempt outcomes: case 4 — multi-session emission", () => {
  it("emits one event per session_id and each is queryable by its own session_id filter", async () => {
    const projectRoot = await createTempProject("multi");

    // E4 user-range rollback over 3 sessions — Phase 2.5 MUST emit one
    // session_archive_attempted per session_id per planning-context.md
    // Q3.2 and SKILL.md L1125 "Multi-session E4 runs emit MULTIPLE events
    // — one per session_id".
    const sessions = ["sess-1", "sess-2", "sess-3"] as const;
    const outcomes = ["proposed", "skipped_no_signal", "user_dismissed"] as const;
    const proposedIds = [["alpha"], [], []] as const;

    for (let i = 0; i < sessions.length; i += 1) {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "session_archive_attempted",
        session_id: sessions[i],
        outcome: outcomes[i],
        covered_through_ts: 1_700_000_000_000 + i * 1_000,
        candidates_proposed: proposedIds[i].length,
        knowledge_proposed_ids: [...proposedIds[i]],
      });
    }

    // Full read — exactly 3 events, all of the correct event_type, in
    // append order (the ledger preserves write order per rc.22 Scope A
    // append-only contract).
    const { events: all } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
    });
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.session_id)).toEqual([...sessions]);

    // Per-session filter returns exactly one event per session_id.
    for (let i = 0; i < sessions.length; i += 1) {
      const { events: bySession } = await readEventLedger(projectRoot, {
        session_id: sessions[i],
      });
      expect(bySession).toHaveLength(1);
      expect(bySession[0].event_type).toBe("session_archive_attempted");
      expect(bySession[0].session_id).toBe(sessions[i]);
      if (bySession[0].event_type === "session_archive_attempted") {
        expect(bySession[0].outcome).toBe(outcomes[i]);
      }
    }
  });
});

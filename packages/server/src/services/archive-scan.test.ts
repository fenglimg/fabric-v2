/**
 * v2.0.0-rc.37 NEW-9: unit tests for the deterministic Phase 1 ledger scan
 * (collectArchiveScan). Pins the anchor-find, forward-collect ordering, and the
 * outcome-ledger filter state machine (user_dismissed / cooldown /
 * covered_through_ts high-value-signal) + cross-session pending dedupe.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectArchiveScan } from "./archive-scan.js";

const HOUR = 3_600_000;
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop() as string, { recursive: true, force: true });
});

// Inject per-event-type required schema fields so readEventLedger's safeParse
// keeps each seeded line (invalid events are silently dropped).
function fillRequired(e: Record<string, unknown>): Record<string, unknown> {
  const ts = typeof e.ts === "number" ? e.ts : 0;
  switch (e.event_type) {
    case "knowledge_proposed":
      return { timestamp: new Date(ts).toISOString(), ...e };
    case "assistant_turn_observed":
      return {
        kb_line_raw: "",
        cite_ids: [],
        cite_tags: [],
        cite_commitments: [],
        turn_id: `turn-${ts}`,
        timestamp: new Date(ts).toISOString(),
        ...e,
      };
    case "knowledge_context_planned":
      return {
        target_paths: [],
        required_stable_ids: [],
        ai_selectable_stable_ids: [],
        final_stable_ids: [],
        ...e,
      };
    case "session_archive_attempted":
      return { candidates_proposed: 0, knowledge_proposed_ids: [], ...e };
    default:
      return e;
  }
}

function seed(events: Record<string, unknown>[]): string {
  const root = mkdtempSync(join(tmpdir(), "rc37-new9-archscan-"));
  tempRoots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  const lines = events
    .map((e, i) =>
      JSON.stringify({ kind: "fabric-event", id: `event:${i}`, schema_version: 1, ...fillRequired(e) }),
    )
    .join("\n");
  writeFileSync(join(root, ".fabric", "events.jsonl"), lines.length ? `${lines}\n` : "");
  return root;
}

describe("collectArchiveScan (rc.37 NEW-9)", () => {
  it("empty/missing ledger → scan-everything defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "rc37-new9-empty-"));
    tempRoots.push(root);
    const r = await collectArchiveScan(root);
    expect(r).toEqual({
      anchor_ts: null,
      session_ids: [],
      dropped: [],
      covered_through_ts: null,
      already_proposed_keys: [],
    });
  });

  it("finds anchor + forward-collects distinct session_ids in first-seen order", async () => {
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "old" },
      { event_type: "assistant_turn_observed", ts: 2000, session_id: "B" },
      { event_type: "assistant_turn_observed", ts: 3000, session_id: "A" },
      { event_type: "assistant_turn_observed", ts: 4000, session_id: "B" },
    ]);
    const r = await collectArchiveScan(root, { now_ms: 1_000_000_000 });
    expect(r.anchor_ts).toBe(1000);
    expect(r.session_ids).toEqual(["B", "A"]); // first-seen order, distinct
    expect(r.covered_through_ts).toBe(4000);
  });

  it("drops user_dismissed sessions permanently", async () => {
    const now = 100 * 24 * HOUR;
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "anchor" },
      { event_type: "assistant_turn_observed", ts: 5000, session_id: "X" },
      {
        event_type: "session_archive_attempted",
        ts: now - 50 * HOUR,
        session_id: "X",
        outcome: "user_dismissed",
        covered_through_ts: 0,
        knowledge_proposed_ids: [],
      },
    ]);
    const r = await collectArchiveScan(root, { now_ms: now });
    expect(r.session_ids).not.toContain("X");
    expect(r.dropped).toContainEqual({ session_id: "X", reason: "user_dismissed" });
  });

  it("drops sessions inside the 12h anti-loop cooldown", async () => {
    const now = 100 * 24 * HOUR;
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "anchor" },
      { event_type: "assistant_turn_observed", ts: 5000, session_id: "Y" },
      {
        event_type: "session_archive_attempted",
        ts: now - 6 * HOUR, // 6h < 12h cooldown
        session_id: "Y",
        outcome: "proposed",
        covered_through_ts: 5000,
        knowledge_proposed_ids: ["k1"],
      },
    ]);
    const r = await collectArchiveScan(root, { now_ms: now });
    expect(r.dropped).toContainEqual({ session_id: "Y", reason: "cooldown" });
    expect(r.already_proposed_keys).toContain("k1");
  });

  it("keeps a watermarked session only when new high-value signal accrued", async () => {
    const now = 100 * 24 * HOUR;
    // Z has a viability_failed attempt 14h ago (cooldown passed), watermark=5000.
    // A new knowledge_context_planned at ts 9000 > watermark → keep.
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "anchor" },
      { event_type: "assistant_turn_observed", ts: 5000, session_id: "Z" },
      {
        event_type: "session_archive_attempted",
        ts: now - 14 * HOUR,
        session_id: "Z",
        outcome: "viability_failed",
        covered_through_ts: 5000,
        knowledge_proposed_ids: [],
      },
      { event_type: "knowledge_context_planned", ts: 9000, session_id: "Z" },
    ]);
    const r = await collectArchiveScan(root, { now_ms: now });
    expect(r.session_ids).toContain("Z");
  });

  it("drops a watermarked session with no new high-value signal", async () => {
    const now = 100 * 24 * HOUR;
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "anchor" },
      { event_type: "assistant_turn_observed", ts: 5000, session_id: "W" },
      {
        event_type: "session_archive_attempted",
        ts: now - 14 * HOUR,
        session_id: "W",
        outcome: "viability_failed",
        covered_through_ts: 9999, // watermark beyond the turn → no new signal
        knowledge_proposed_ids: [],
      },
    ]);
    const r = await collectArchiveScan(root, { now_ms: now });
    expect(r.dropped).toContainEqual({ session_id: "W", reason: "no_new_signal" });
  });

  it("honours an explicit range constraint", async () => {
    const root = seed([
      { event_type: "knowledge_proposed", ts: 1000, session_id: "anchor" },
      { event_type: "assistant_turn_observed", ts: 2000, session_id: "A" },
      { event_type: "assistant_turn_observed", ts: 3000, session_id: "B" },
    ]);
    const r = await collectArchiveScan(root, { now_ms: 1_000_000_000, range: ["A"] });
    expect(r.session_ids).toEqual(["A"]);
  });
});

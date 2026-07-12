import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CANONICAL_EN,
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  ensureCiteContractPolicyActivatedMarker,
  ensureCitePolicyActivatedMarker,
  purgeEmptyShellTurnsIfNeeded,
  rollupCiteAuditIfNeeded,
  runDoctorCiteCoverage,
} from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { readCiteRollup } from "./cite-rollup.js";
import {
  createInitializedProject,
  writeFile,
} from "./doctor-test-helpers.js";

describe("rollupCiteAuditIfNeeded", () => {
  function appendLedgerLines(target: string, lines: Record<string, unknown>[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = readFileSync(ledgerPath, "utf8");
    writeFileSync(ledgerPath, `${existing}${lines.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  }
  function turnEvent(id: string, ts: number, citeId: string | null): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: citeId ? `KB: ${citeId}` : null,
      cite_ids: citeId ? [citeId] : [],
      cite_tags: citeId ? ["applied"] : ["none"],
      client: "cc",
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("rolls up + drops old turns, keeps recent, and cite-coverage merges the rollup", async () => {
    const target = createInitializedProject("cite-rollup-basic");
    writeFile(".fabric/events.jsonl", "", target);

    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0); // fixed clock
    const day = 86_400_000;
    // Marker predates all turns so they are coverable.
    appendLedgerLines(target, [
      {
        kind: "fabric-event",
        id: "event:marker",
        ts: nowMs - 20 * day,
        schema_version: 1,
        event_type: "cite_policy_activated",
        policy_version: "rc39-test",
        timestamp: new Date(nowMs - 20 * day).toISOString(),
      },
    ]);
    // Two OLD turns (10d ago, same UTC day, > 7d cutoff) + one RECENT turn (1d ago).
    appendLedgerLines(target, [
      turnEvent("old-1", nowMs - 10 * day, "KT-DEC-0001"),
      turnEvent("old-2", nowMs - 10 * day, null),
      turnEvent("recent-1", nowMs - 1 * day, "KT-DEC-0002"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(2);
    expect(result.days_rolled_up).toBe(1);

    // Old turns dropped from the main ledger, recent turn kept.
    const { events } = await readEventLedger(target);
    const turnIds = events
      .filter((e) => e.event_type === "assistant_turn_observed")
      .map((e) => (e as { turn_id?: string }).turn_id);
    expect(turnIds).toEqual(["recent-1"]);

    // One rollup row capturing the old day's 2 turns.
    const rollup = await readCiteRollup(target);
    expect(rollup).toHaveLength(1);
    expect(rollup[0].metrics.total_turns).toBe(2);

    // Long-window cite-coverage merges rollup + raw: 2 rolled + 1 raw = 3 turns.
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(3);
    expect(report.rollup_days_merged).toBe(1);
  });

  it("does NOT drop turns when there is no cite-policy marker (un-rollable)", async () => {
    // werewolf-minigame repro: old turns but no cite_policy_activated marker →
    // per-day cite-coverage is 'skipped' → nothing rolls up → nothing dropped.
    const target = createInitializedProject("cite-rollup-no-marker");
    writeFile(".fabric/events.jsonl", "", target);
    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0);
    appendLedgerLines(target, [
      turnEvent("old-1", nowMs - 10 * 86_400_000, "KT-DEC-0001"),
      turnEvent("old-2", nowMs - 10 * 86_400_000, "KT-DEC-0002"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(0);
    expect(result.days_rolled_up).toBe(0);
    expect(await readCiteRollup(target)).toHaveLength(0);
    // Turns are LEFT in the ledger (fall to general 30d rotation instead).
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "assistant_turn_observed")).toHaveLength(2);
  });

  it("is a no-op when no turn is older than the cutoff", async () => {
    const target = createInitializedProject("cite-rollup-noop");
    writeFile(".fabric/events.jsonl", "", target);
    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0);
    appendLedgerLines(target, [
      {
        kind: "fabric-event",
        id: "event:marker",
        ts: nowMs - 20 * 86_400_000,
        schema_version: 1,
        event_type: "cite_policy_activated",
        policy_version: "rc39-test",
        timestamp: new Date(nowMs - 20 * 86_400_000).toISOString(),
      },
      turnEvent("recent-1", nowMs - 1 * 86_400_000, "KT-DEC-0001"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(0);
    expect(result.days_rolled_up).toBe(0);
    expect(await readCiteRollup(target)).toHaveLength(0);
  });
});

// lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): cite-coverage
// breaks qualifying cites down per store via the cite_stores[i] qualifier, as a
// PURE diagnostic split that never touches the compliance numerator.
describe("cite-coverage by_store breakdown (W3-T4)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function storeTurn(
    id: string,
    ts: number,
    cites: Array<{ id: string; store: string | null }>,
  ): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: `KB: ${cites.map((c) => (c.store ? `${c.store}:${c.id}` : c.id)).join(", ")} [applied]`,
      cite_ids: cites.map((c) => c.id),
      cite_tags: cites.map(() => "applied"),
      cite_stores: cites.map((c) => c.store),
      client: "cc",
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("buckets qualifying cites per store; bare ids fall under 'local'; never touches compliance", async () => {
    const target = createInitializedProject("cite-by-store");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      // one team-store cite, one personal-store cite, one bare (project-local) cite.
      storeTurn("t1", marker.marker_ts + 10, [{ id: "KT-DEC-0001", store: "team" }]),
      storeTurn("t2", marker.marker_ts + 20, [{ id: "KP-DEC-0009", store: "personal" }]),
      storeTurn("t3", marker.marker_ts + 30, [{ id: "KT-DEC-0002", store: null }]),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    // 3 applied cites total — the compliance count is unchanged by the split.
    expect(report.metrics.qualifying_cites).toBe(3);
    expect(report.metrics.by_store).toEqual({
      team: { qualifying_cites: 1 },
      personal: { qualifying_cites: 1 },
      local: { qualifying_cites: 1 },
    });
    // by_store is a sibling of qualifying_cites — summing the buckets matches it.
    const summed = Object.values(report.metrics.by_store ?? {}).reduce(
      (a, b) => a + b.qualifying_cites,
      0,
    );
    expect(summed).toBe(report.metrics.qualifying_cites);
  });

  it("omits by_store when no cite is observed (steady-state shape unchanged)", async () => {
    const target = createInitializedProject("cite-by-store-empty");
    writeFile(".fabric/events.jsonl", "", target);
    await ensureCitePolicyActivatedMarker(target);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics).not.toHaveProperty("by_store");
  });
});

// v2.0.0-rc.39 (P1 emit-fold): empty-shell turns fold into metrics.jsonl counter
// rows; the live cite-coverage / emit-cadence readers add them back so the
// metric stays invariant across the fold.
describe("rc.39 emit-fold counter merge", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function writeMetricsRows(target: string, rows: unknown[]): void {
    const metricsPath = join(target, ".fabric", "metrics.jsonl");
    writeFileSync(metricsPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  function citeTurn(id: string, ts: number, client: string): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: KT-DEC-0001 [applied]",
      cite_ids: ["KT-DEC-0001"],
      cite_tags: ["applied"],
      client,
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("adds in-window folded counters to total_turns (invariant: events + counter)", async () => {
    const target = createInitializedProject("emit-fold-merge-basic");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    // 1 cite-bearing event + a folded counter of 40 empty shells (same client).
    seedEvents(target, [citeTurn("c1", marker.marker_ts + 10, "cc")]);
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 40 },
      },
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    // 1 raw cite event + 40 folded empty shells = 41 total turns.
    expect(report.metrics.total_turns).toBe(41);
    // Compliance is unaffected by empty shells (they touch only total_turns).
    expect(report.metrics.qualifying_cites).toBe(1);
  });

  it("honours the client filter (a narrowed query sums only that client's namespaced counter)", async () => {
    const target = createInitializedProject("emit-fold-merge-client");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      citeTurn("cc1", marker.marker_ts + 10, "cc"),
      citeTurn("cx1", marker.marker_ts + 11, "codex"),
    ]);
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 5, "assistant_turn_observed:codex": 7 },
      },
    ]);

    const all = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(all.metrics.total_turns).toBe(2 + 5 + 7); // 2 events + 12 folded

    const ccOnly = await runDoctorCiteCoverage(target, { since: 0, client: "cc" });
    expect(ccOnly.metrics.total_turns).toBe(1 + 5); // cc event + cc fold only

    const codexOnly = await runDoctorCiteCoverage(target, { since: 0, client: "codex" });
    expect(codexOnly.metrics.total_turns).toBe(1 + 7);
  });

  it("excludes folded counters older than the window (since filter)", async () => {
    const target = createInitializedProject("emit-fold-merge-window");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [citeTurn("c1", marker.marker_ts + 10, "cc")]);
    // One counter inside the window, one stamped far in the past (before marker).
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 3 },
      },
      {
        timestamp: new Date(marker.marker_ts - 10_000).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 99 },
      },
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // effectiveSince = marker_ts, so the pre-marker counter (99) is excluded.
    expect(report.metrics.total_turns).toBe(1 + 3);
  });


  function emptyTurn(id: string, ts: number, client: string): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: ["none"],
      client,
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("purge: folds existing empty-shell backlog to counters, drops events, keeps cite-coverage total_turns invariant", async () => {
    const target = createInitializedProject("emit-fold-purge");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    // 1 cite-bearing turn + 5 empty shells (recent, same day, same client).
    seedEvents(target, [
      citeTurn("c1", marker.marker_ts + 10, "cc"),
      emptyTurn("e1", marker.marker_ts + 20, "cc"),
      emptyTurn("e2", marker.marker_ts + 21, "cc"),
      emptyTurn("e3", marker.marker_ts + 22, "cc"),
      emptyTurn("e4", marker.marker_ts + 23, "cc"),
      emptyTurn("e5", marker.marker_ts + 24, "cc"),
    ]);

    // Baseline total_turns (empties still raw events): 1 cite + 5 empty = 6.
    const before = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(before.metrics.total_turns).toBe(6);

    const result = await purgeEmptyShellTurnsIfNeeded(target);
    expect(result.turns_folded).toBe(5);
    expect(result.groups_written).toBe(1); // one (day, client) group

    // Empty shells dropped from the ledger; only the cite turn remains.
    const { events } = await readEventLedger(target);
    const turnIds = events
      .filter((e) => e.event_type === "assistant_turn_observed")
      .map((e) => (e as { turn_id?: string }).turn_id);
    expect(turnIds).toEqual(["c1"]);

    // INVARIANT: total_turns unchanged across the purge (1 raw + 5 folded = 6).
    const after = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(after.metrics.total_turns).toBe(6);
    expect(after.metrics.cite_compliance_rate).toBe(before.metrics.cite_compliance_rate);
  });

  it("purge: idempotent — a second run finds no empties and is a no-op", async () => {
    const target = createInitializedProject("emit-fold-purge-idem");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [emptyTurn("e1", marker.marker_ts + 20, "cc")]);

    const first = await purgeEmptyShellTurnsIfNeeded(target);
    expect(first.turns_folded).toBe(1);
    const second = await purgeEmptyShellTurnsIfNeeded(target);
    expect(second.turns_folded).toBe(0);
    expect(second.groups_written).toBe(0);
  });
});

describe("runDoctorCiteCoverage (smoke)", () => {
  it("aggregates total_turns + qualifying_cites + dismissed_histogram from seeded turns", async () => {
    const target = createInitializedProject("cite-coverage-smoke-turns");
    writeFile(".fabric/events.jsonl", "", target);

    // Seed the marker first so effectiveSince = marker_ts (window covers all
    // subsequent appends). All appends use Date.now() so they sort after the
    // marker timestamp.
    const marker = await ensureCitePolicyActivatedMarker(target);
    expect(marker.marker_ts).toBeGreaterThan(0);

    // Hand-craft a few assistant_turn_observed events. Mix planned / recalled /
    // dismissed:scope-mismatch / none to exercise the categorize branch.
    const seedLines = [
      {
        kind: "fabric-event",
        id: "event:smoke-turn-1",
        ts: marker.marker_ts + 10,
        schema_version: 1,
        session_id: "sess-A",
        event_type: "assistant_turn_observed",
        kb_line_raw: "KB: KT-DEC-0001",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["applied"],
        client: "cc",
        turn_id: "turn-1",
        timestamp: new Date(marker.marker_ts + 10).toISOString(),
      },
      {
        // NOTE: cite_tags here is the bare 'dismissed' literal — TASK-02's
        // schema enum locks the on-ledger vocabulary to 5 values. The reason
        // payload ('scope-mismatch'/'other:...') is a TASK-09 schema widening;
        // until then the histogram aggregates under the 'unspecified' key.
        kind: "fabric-event",
        id: "event:smoke-turn-2",
        ts: marker.marker_ts + 20,
        schema_version: 1,
        session_id: "sess-B",
        event_type: "assistant_turn_observed",
        kb_line_raw: "KB: KT-DEC-0002 (dismissed)",
        cite_ids: ["KT-DEC-0002"],
        cite_tags: ["dismissed"],
        client: "codex",
        turn_id: "turn-2",
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
      },
      {
        kind: "fabric-event",
        id: "event:smoke-turn-3",
        ts: marker.marker_ts + 30,
        schema_version: 1,
        session_id: "sess-C",
        event_type: "assistant_turn_observed",
        kb_line_raw: null,
        cite_ids: [],
        cite_tags: ["none"],
        client: "cc",
        turn_id: "turn-3",
        timestamp: new Date(marker.marker_ts + 30).toISOString(),
      },
    ];
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = readFileSync(ledgerPath, "utf8");
    writeFileSync(
      ledgerPath,
      `${existing}${seedLines.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf8",
    );

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(3);
    // planned counts; dismissed and none do not.
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 1 });
    // per_client surfaces when client filter is 'all'.
    expect(report.per_client).toBeDefined();
    expect(report.per_client?.cc?.total_turns).toBe(2);
    expect(report.per_client?.codex?.total_turns).toBe(1);
  });

  it("returns status:'skipped' with zero metrics when marker write degrades", async () => {
    // Same nonexistent-root trick as ensureCitePolicyActivatedMarker's failure
    // test — both ledger read and append fail, marker_ts collapses to 0.
    const report = await runDoctorCiteCoverage("/nonexistent-cite-coverage-fabric-root-xyzzy", {
      since: 0,
      client: "all",
    });
    expect(report.status).toBe("skipped");
    expect(report.marker_ts).toBe(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    });
  });
});

// v2.0.0-rc.20 TASK-08: comprehensive runDoctorCiteCoverage coverage.
//
// Locks the contract for every metric the report tabulates plus the two CLI
// filters (--since / --client). Each test seeds a fresh initialized project
// (FABRIC_HOME is isolated per-test by the top-level beforeEach), emits a
// cite_policy_activated marker, then appends one or more hand-crafted events
// directly via writeFileSync. We bypass `appendEventLedgerEvent` because the
// queue serializes via Promise chaining + Date.now() and we need exact `ts`
// control to test the window logic.
//
// NOTE on `dismissed` reasons: the on-ledger schema (TASK-02) constrains
// `cite_tags` to {planned, recalled, chained-from, dismissed, none}.
// Colon-suffixed reasons (e.g. `dismissed:scope-mismatch`) fail Zod and the
// event is dropped by `readEventLedger`. TASK-09 will widen the schema to
// carry a per-reason payload; until then the histogram tests assert the
// current shape (bare `dismissed` → `unspecified` bucket).
describe("runDoctorCiteCoverage", () => {
  // -------------------------------------------------------------------------
  // Helpers — extracted at the top of the block so all 14 tests share them.
  // -------------------------------------------------------------------------

  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  // v2.2 W5 R2/R7 (agents.meta decolo): the cite-coverage kb relevance index is
  // built from the read-set STORES, not the retired co-location agents.meta.json.
  // Seed each node as a real store .md carrying the relevance frontmatter the
  // cite denominator reads, bind the project to the team store, and register it.
  // The index is keyed under both the local stable_id and `team:<id>`, so the
  // bare cite ids these tests emit still resolve.
  const CITE_STORE_UUID_A = "55555555-5555-4555-8555-555555555555";

  function seedAgentsMeta(
    target: string,
    nodes: Array<{
      stable_id: string;
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const dir = join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: CITE_STORE_UUID_A }),
      STORE_LAYOUT.knowledgeDir,
      "decisions",
    );
    mkdirSync(dir, { recursive: true });
    for (const node of nodes) {
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        "type: decision",
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID_A, alias: "team", remote: "git@e:cite-a.git" }],
    });
  }

  function mkTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    kbLineRaw: string | null;
    citeIds: string[];
    citeTags: string[];
    client?: "cc" | "codex";
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: opts.kbLineRaw,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      ...(opts.client !== undefined ? { client: opts.client } : {}),
      turn_id: opts.turnId ?? `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  function mkEditEvent(opts: {
    path: string;
    ts: number;
    sessionId?: string;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
      event_type: "edit_intent_checked",
      path: opts.path,
      compliant: true,
      intent: "test edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 60_000,
    };
  }

  // KT-DEC-0030: the [applied] verification signal is now knowledge_body_read
  // (native Read of the store body), not the retired knowledge_sections_fetched.
  // recalled_unverified correlation is session_id + ±60s based (not id-matched),
  // so one body_read per session in-window suffices to mark a cite verified.
  function mkKnowledgeBodyReadEvent(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:bodyread:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "knowledge_body_read",
      stable_id: opts.ids[0] ?? "KT-DEC-0000",
      store: "team",
      path: `~/.fabric/stores/team/kb/knowledge/decisions/${opts.ids[0] ?? "KT-DEC-0000"}--x.md`,
    };
  }

  // -------------------------------------------------------------------------
  // 14 tests
  // -------------------------------------------------------------------------

  // 1. Missing .fabric/ dir → ledger read + append both fail → marker_ts=0 →
  //    status='skipped' with zero metrics.
  it("status='skipped' when the project root has no .fabric/ tree (marker write fails)", async () => {
    const report = await runDoctorCiteCoverage(
      "/nonexistent-cite-coverage-task-08-skipped-xyzzy",
      { since: 0, client: "all" },
    );
    expect(report.status).toBe("skipped");
    expect(report.marker_ts).toBe(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    });
  });

  // 1b. Empty events.jsonl + first invocation → marker emitted, no turns yet
  //     → status='ok' with zero metrics, marker_emitted_now=true.
  it("status='ok' with zero metrics + marker_emitted_now=true on first invocation against empty ledger", async () => {
    const target = createInitializedProject("cite-coverage-empty-ledger");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.marker_emitted_now).toBe(true);
    expect(report.marker_ts).toBeGreaterThan(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
      // v2.0.0-rc.38 UX-8 (C): compliance metric — null on no cite-expected turns.
      cite_compliance_rate: null,
      compliant_cites: 0,
      noncompliant_cites: 0,
      uncorrelatable_edits: 0,
      // v2.1 ⑤ cite-redesign (P5): recall-based口径 — 0 edits → 0 backed, null rate.
      recall_backed_edits: 0,
      recall_coverage_rate: null,
      // session-mismatch self-diagnosis counts — all zero on an empty ledger.
      recall_diagnostics: { recalls_in_window: 0, recall_sessions: 0, recall_sessions_correlated: 0 },
      // v2.2.0-rc.1 W1-T3 (cite 诚实拆分): WEAK exposed_and_mutated signal —
      // always emitted (count 0 here, no narrow surface events). `ids` omitted
      // when empty.
      exposed_and_mutated: { count: 0 },
      // lifecycle-refactor W2-T4: PostToolUse mutation funnel — always emitted
      // (zero here, no file_mutated/session_ended events). Observability markers,
      // never folded into compliance.
      mutations_observed: { count: 0 },
      mutation_pool: { attributed: 0, unattributed_workspace_dirty: 0 },
      sessions_closed: { count: 0 },
    });
  });

  // 2. Marker present, no turns/edits → metrics all zero, status='ok'.
  it("marker present without any turns produces zero metrics, status='ok'", async () => {
    const target = createInitializedProject("cite-coverage-marker-only");
    writeFile(".fabric/events.jsonl", "", target);

    // First call seeds the marker; second call exercises the "marker exists,
    // no work to do" path with emitted_now=false.
    await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.marker_emitted_now).toBe(false);
    expect(report.metrics.total_turns).toBe(0);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.metrics.edits_touched).toBe(0);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.recalled_unverified).toBe(0);
  });

  // 3. Single planned cite + 1 matching edit (broad KB) → qualifying_cites=1,
  //    edits_touched=1, no expected_but_missed contribution.
  it("aggregates a single planned cite + a matching edit", async () => {
    const target = createInitializedProject("cite-coverage-single-planned");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0001", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-A",
        kbLineRaw: "KB: KT-DEC-0001",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkEditEvent({
        path: "src/foo.ts",
        sessionId: "sess-A",
        ts: marker.marker_ts + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    // v2.0.0-rc.38 UX-8 (C): compliance metric — 1 qualifying cite, 0 missed → 100%.
    expect(report.metrics.compliant_cites).toBe(1);
    expect(report.metrics.noncompliant_cites).toBe(0);
    expect(report.metrics.cite_compliance_rate).toBe(1);
  });

  // 4. Narrow KB with relevance_paths=['src/foo/**'] + edit on src/foo/bar.ts
  //    + a turn that DID cite the kb in the same session → no missed entry
  //    (the cite covered the narrow obligation).
  it("narrow KB covered by a same-session cite produces zero expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-narrow-covered");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0042", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-N",
        kbLineRaw: "KB: KT-DEC-0042",
        citeIds: ["KT-DEC-0042"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkEditEvent({
        path: "src/foo/bar.ts",
        sessionId: "sess-N",
        ts: marker.marker_ts + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 5. Narrow KB + edit on UNMATCHED path → no contribution to
  //    expected_but_missed (path didn't match the kb's relevance_paths).
  it("narrow KB with edit on unmatched path produces zero expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-narrow-unmatched");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0043", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      mkEditEvent({
        path: "src/bar/baz.ts",
        sessionId: "sess-U",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 6. Broad KB (no relevance_paths) + 3 edits → broad kbs never contribute
  //    to expected_but_missed (per TASK-06 narrow-only design).
  it("broad KB with multiple edits never contributes to expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-broad-edits");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0050", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkEditEvent({ path: "src/a.ts", sessionId: "sess-B", ts: marker.marker_ts + 10 }),
      mkEditEvent({ path: "src/b.ts", sessionId: "sess-B", ts: marker.marker_ts + 20 }),
      mkEditEvent({ path: "src/c.ts", sessionId: "sess-B", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(3);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 7. Recalled tag + matching knowledge_body_read in same session
  //    within ±60s → recalled_unverified does NOT increment (KT-DEC-0030).
  it("recalled tag verified by a same-session body_read within +/-60s does not increment recalled_unverified", async () => {
    const target = createInitializedProject("cite-coverage-recall-verified");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0099", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-R",
        kbLineRaw: "KB: KT-DEC-0099",
        citeIds: ["KT-DEC-0099"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 1_000,
      }),
      // Body read 30s after the turn — well inside the 60s window.
      mkKnowledgeBodyReadEvent({
        sessionId: "sess-R",
        ids: ["KT-DEC-0099"],
        ts: marker.marker_ts + 31_000,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.recalled_unverified).toBe(0);
  });

  // 8. Recalled tag + NO matching fetch (or fetch outside +/-60s) →
  //    recalled_unverified increments.
  it("recalled tag with no same-session fetch increments recalled_unverified", async () => {
    const target = createInitializedProject("cite-coverage-recall-unverified");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-U2",
        kbLineRaw: "KB: KT-DEC-0100",
        citeIds: ["KT-DEC-0100"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      // No knowledge_sections_fetched in sess-U2 → unverified.
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.recalled_unverified).toBe(1);
  });

  // 9. Dismissed histogram: per TASK-06's inline note, the on-ledger enum
  //    only carries bare 'dismissed'. Colon-suffixed reasons would be
  //    rejected by Zod and dropped from `readEventLedger`. Today, every
  //    `dismissed` tag lands in the 'unspecified' bucket. This test pins
  //    the current shape; TASK-09 widens the schema and updates the
  //    expectation to per-reason buckets.
  it("dismissed_reason_histogram aggregates bare 'dismissed' tags under the 'unspecified' bucket", async () => {
    const target = createInitializedProject("cite-coverage-dismissed-histogram");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-D1",
        kbLineRaw: "KB: KT-DEC-0201 (dismissed)",
        citeIds: ["KT-DEC-0201"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-D2",
        kbLineRaw: "KB: KT-DEC-0202 (dismissed)",
        citeIds: ["KT-DEC-0202"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-D3",
        kbLineRaw: "KB: KT-DEC-0203 (dismissed)",
        citeIds: ["KT-DEC-0203"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.total_turns).toBe(3);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 3 });
  });

  // 9b. rc.23 T8c: KB: none sentinel breakdown. Parser pulls the bracket
  //     payload from `kb_line_raw` since the on-ledger cite_tags enum still
  //     emits the bare `none` token (schema-bound). Three forms must
  //     tabulate: `[no-relevant]`, `[not-applicable]`, and bare `KB: none`
  //     (→ unspecified bucket for legacy/lazy emissions).
  it("none_reason_histogram aggregates KB: none sentinels into no-relevant / not-applicable / unspecified buckets", async () => {
    const target = createInitializedProject("cite-coverage-none-sentinel");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-N1",
        kbLineRaw: "KB: none [no-relevant]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-N2",
        kbLineRaw: "KB: none [no-relevant]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-N3",
        kbLineRaw: "KB: none [not-applicable]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 30,
      }),
      // Bare legacy form → unspecified bucket.
      mkTurnEvent({
        sessionId: "sess-N4",
        kbLineRaw: "KB: none",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 40,
      }),
      // Unknown bracket payload also collapses to unspecified (bounded
      // histogram; new enums must come via bootstrap doc updates).
      mkTurnEvent({
        sessionId: "sess-N5",
        kbLineRaw: "KB: none [bogus-reason]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 50,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.total_turns).toBe(5);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.none_reason_histogram).toEqual({
      "no-relevant": 2,
      "not-applicable": 1,
      unspecified: 2,
    });
  });

  // 10. Per-client split: 2 cc turns + 1 codex turn → per_client.cc=2,
  //     per_client.codex=1. per_client is only emitted when client='all'.
  it("per_client split tabulates total_turns separately for each client when client='all'", async () => {
    const target = createInitializedProject("cite-coverage-per-client");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-P1",
        kbLineRaw: "KB: KT-DEC-0301",
        citeIds: ["KT-DEC-0301"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-P2",
        kbLineRaw: "KB: KT-DEC-0302",
        citeIds: ["KT-DEC-0302"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-P3",
        kbLineRaw: "KB: KT-DEC-0303",
        citeIds: ["KT-DEC-0303"],
        citeTags: ["none"],
        client: "codex",
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_client).toBeDefined();
    expect(report.per_client?.cc?.total_turns).toBe(2);
    expect(report.per_client?.cc?.qualifying_cites).toBe(2);
    expect(report.per_client?.codex?.total_turns).toBe(1);
    expect(report.per_client?.codex?.qualifying_cites).toBe(0);
  });

  // 11. --since=<future> filter: events with `ts < since` are excluded from
  //     the window. effectiveSince = max(marker_ts, options.since), so we
  //     pick `since` > marker_ts.
  it("--since filter excludes events older than the cutoff", async () => {
    const target = createInitializedProject("cite-coverage-since-filter");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    // Pick a cutoff far after the marker. Old turn lands BEFORE the cutoff;
    // new turn lands AFTER it. Only the new turn should survive the filter.
    const cutoff = marker.marker_ts + 100_000;

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-OLD",
        kbLineRaw: "KB: old",
        citeIds: ["KT-DEC-0401"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10, // < cutoff → excluded
      }),
      mkTurnEvent({
        sessionId: "sess-NEW",
        kbLineRaw: "KB: new",
        citeIds: ["KT-DEC-0402"],
        citeTags: ["applied"],
        client: "cc",
        ts: cutoff + 10, // >= cutoff → included
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: cutoff, client: "all" });

    expect(report.since_ts).toBe(cutoff);
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
  });

  // 12. --client=cc filter: codex turns excluded from top-level metrics,
  //     and edits from codex-only sessions are excluded from edits_touched +
  //     expected_but_missed (cross-client denominator guard). per_client is
  //     suppressed when the client filter is narrowed.
  it("--client=cc filter excludes codex turns and codex-session edits, suppresses per_client", async () => {
    const target = createInitializedProject("cite-coverage-client-filter");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    // Seed a narrow kb so codex-session edits would otherwise be flagged as
    // expected_but_missed under a polluted cc filter.
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0599", relevance_scope: "narrow", relevance_paths: ["src/codex-only/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-CC",
        kbLineRaw: "KB: cc",
        citeIds: ["KT-DEC-0501"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0502"],
        citeTags: ["applied"],
        client: "codex",
        ts: marker.marker_ts + 20,
      }),
      // One edit on a cc session — should count.
      mkEditEvent({
        path: "src/cc-only/a.ts",
        sessionId: "sess-CC",
        ts: marker.marker_ts + 30,
      }),
      // Two edits on a codex session — must be skipped under --client=cc.
      // The second one targets a narrow-kb-relevant path; if the cross-client
      // guard regressed it would surface as expected_but_missed=1.
      mkEditEvent({
        path: "src/codex-only/x.ts",
        sessionId: "sess-CX",
        ts: marker.marker_ts + 31,
      }),
      mkEditEvent({
        path: "src/codex-only/y.ts",
        sessionId: "sess-CX",
        ts: marker.marker_ts + 32,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "cc" });

    expect(report.client_filter).toBe("cc");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    // Denominator guard: only the cc-session edit counts.
    expect(report.metrics.edits_touched).toBe(1);
    // expected_but_missed must NOT be polluted by codex-session edits hitting
    // the narrow kb's relevance_paths against an empty cc cited-kb map.
    expect(report.metrics.expected_but_missed).toBe(0);
    // Narrowed filter — per_client suppressed (a single-entry record would
    // duplicate the top-level metrics).
    expect(report.per_client).toBeUndefined();
  });

  // 12b. Mirror of #12 against --client=codex: codex edits counted, cc edits
  //      skipped. Same cross-client guard, opposite filter.
  it("--client=codex filter excludes cc turns and cc-session edits", async () => {
    const target = createInitializedProject("cite-coverage-client-filter-codex");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0699", relevance_scope: "narrow", relevance_paths: ["src/cc-only/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-CC2",
        kbLineRaw: "KB: cc",
        citeIds: ["KT-DEC-0601"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX2",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0602"],
        citeTags: ["applied"],
        client: "codex",
        ts: marker.marker_ts + 20,
      }),
      // cc-only edits — must be skipped under --client=codex; one of them
      // targets a narrow-kb path that would otherwise pollute
      // expected_but_missed under the codex filter.
      mkEditEvent({
        path: "src/cc-only/a.ts",
        sessionId: "sess-CC2",
        ts: marker.marker_ts + 30,
      }),
      mkEditEvent({
        path: "src/cc-only/b.ts",
        sessionId: "sess-CC2",
        ts: marker.marker_ts + 31,
      }),
      // One codex-session edit — should count.
      mkEditEvent({
        path: "src/codex-only/z.ts",
        sessionId: "sess-CX2",
        ts: marker.marker_ts + 32,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "codex" });

    expect(report.client_filter).toBe("codex");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.per_client).toBeUndefined();
  });

  // 13. expected_but_missed: edit on src/foo/x.ts matches a narrow KB whose
  //     stable_id was NOT cited in the same session → counter increments.
  it("narrow KB with matching edit but no same-session cite increments expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-expected-missed");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0601", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      // Turn in sess-M that cites a DIFFERENT kb (or cites nothing).
      mkTurnEvent({
        sessionId: "sess-M",
        kbLineRaw: null,
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 5,
      }),
      // Edit in the same session, path matches the narrow kb's
      // relevance_paths — but KT-DEC-0601 was not cited, so this should
      // be flagged as expected_but_missed=1.
      mkEditEvent({
        path: "src/foo/x.ts",
        sessionId: "sess-M",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(1);
    // v2.0.0-rc.38 UX-8 (C): the compliance metric MUST drop below 100% when a
    // cite-expected edit is missed. 1 compliant (none sentinel) / (1 + 1 miss)
    // = 0.5. This is the discrimination proof — without a session_id on the
    // edit event the correlation never fires and this would falsely read 1.0.
    expect(report.metrics.cite_compliance_rate).toBe(0.5);
  });

  // 13b. v2.0.0-rc.38 UX-8 (C, hardening): an edit event WITHOUT session_id is
  //      uncorrelatable — it must be surfaced via uncorrelatable_edits rather
  //      than silently excluded (the stale-hook confound). It must NOT inflate
  //      expected_but_missed (no false positive without a correlation key).
  it("edit without session_id is counted in uncorrelatable_edits, not expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-uncorrelatable");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0701", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      // Edit on a narrow-covered path but with NO session_id (stale pre-fix
      // hook). Cannot be correlated → must not become a false missed.
      mkEditEvent({
        path: "src/foo/x.ts",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.uncorrelatable_edits).toBe(1);
  });

  // 14. Performance: seed 10k assistant_turn_observed events and assert the
  //     full report builds in well under 2s. The single-pass aggregator
  //     (TASK-06) should land closer to ~100ms locally; the 2s ceiling is
  //     CI-tolerant. Adjust downward once we have stable CI numbers.
  it("runs in under 2s for 10k seeded events (performance smoke)", async () => {
    const target = createInitializedProject("cite-coverage-perf-10k");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    const N = 10_000;
    const events: unknown[] = [];
    for (let i = 0; i < N; i += 1) {
      events.push(
        mkTurnEvent({
          sessionId: `sess-${i % 50}`,
          turnId: `turn-${i}`,
          kbLineRaw: i % 2 === 0 ? `KB: KT-DEC-${String(i).padStart(4, "0")}` : null,
          citeIds: i % 2 === 0 ? [`KT-DEC-${String(i).padStart(4, "0")}`] : [],
          citeTags: i % 3 === 0 ? ["applied"] : i % 3 === 1 ? ["none"] : ["dismissed"],
          client: i % 2 === 0 ? "cc" : "codex",
          ts: marker.marker_ts + i + 1,
        }),
      );
    }
    seedEvents(target, events);

    const t0 = Date.now();
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    const elapsedMs = Date.now() - t0;

    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(N);
    // Lenient ceiling — CI fluctuates. Local runs should be well under 500ms;
    // 2s leaves headroom for slow-spinning runners.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

// v2.0.0-rc.24 TASK-08: runDoctorCiteCoverage contract-policy metrics.
//
// Locks the contract for the five new accumulators (contract_with /
// contract_missing / hard_violated / cite_id_unresolved / skip_count), the
// per-(layer, type) cross-tab, the --layer filter (team/personal/all), the
// contract_metrics_status discriminator (ok / skipped:bootstrap_drift /
// awaiting_marker), and the operator-vs-edits comparator (edit/not_edit/
// require/forbid).
//
// Fixture invariants that differ from rc.20 TASK-08:
//   - `.fabric/AGENTS.md` must byte-equal BOOTSTRAP_CANONICAL_EN for the
//     contract marker to emit. Tests that need the marker call
//     `seedCleanBootstrap`; tests asserting the drift-skip path either omit
//     the snapshot or write a mutated copy.
//   - agents.meta.json fixtures carry `description.knowledge_type` so
//     loadKbIdTypeMap returns the SINGULAR enum value (TASK-07 contract).
//     `seedAgentsMetaWithTypes` handles this.
//   - Turn events optionally carry `cite_commitments[]` (operators + skip
//     reason). `mkContractTurnEvent` is the index-aligned constructor.
//
// require:/forbid: SCOPE NOTE: edit_intent_checked events carry no diff
// content (only path/intent/diff_stat), so require:<symbol> and
// forbid:<symbol> are evaluated as "<symbol present as substring of any
// changed file PATH>". Documented at the comparator definition in doctor.ts
// — these tests assert that documented behavior, not the planned
// diff-content match.
describe("runDoctorCiteCoverage (rc.24 contract metrics)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  function seedCleanBootstrap(target: string): void {
    // Drift gate requires `.fabric/AGENTS.md` byte-equal to BOOTSTRAP_CANONICAL_EN.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
  }

  // v2.2 W5 R2/R7 (agents.meta decolo): the cite-coverage kb relevance index is
  // built from the read-set STORES (cross-store canonical entries), not the
  // retired co-location agents.meta.json. This helper writes each node as a real
  // store .md (with the relevance frontmatter the cite denominator reads), binds
  // the project to the team store, and registers it in the global config. The
  // index is keyed under both the local stable_id and `team:<id>`, so the bare
  // cite ids these tests emit still resolve.
  const CITE_STORE_UUID = "33333333-3333-4333-8333-333333333333";

  function seedAgentsMetaWithTypes(
    target: string,
    nodes: Array<{
      stable_id: string;
      knowledge_type: "decisions" | "pitfalls" | "models" | "guidelines" | "processes";
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    // Bind the project to the team store (idempotent — safe to re-write).
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: CITE_STORE_UUID }));
    // knowledge_type is the plural subdir form ("decisions"); the singular
    // frontmatter `type` drops the trailing "s".
    for (const node of nodes) {
      const dir = join(storeRoot, STORE_LAYOUT.knowledgeDir, node.knowledge_type);
      mkdirSync(dir, { recursive: true });
      const singularType = node.knowledge_type.replace(/s$/u, "");
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        `type: ${singularType}`,
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID, alias: "team", remote: "git@e:cite.git" }],
    });
  }

  type ContractOperator = { kind: "edit" | "not_edit" | "require" | "forbid"; target: string };
  type ContractCommitment = { operators: ContractOperator[]; skip_reason: string | null };

  function mkContractTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    citeIds: string[];
    citeTags: string[];
    citeCommitments?: ContractCommitment[];
    client?: "cc" | "codex";
    ts: number;
    kbLineRaw?: string | null;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:contract-turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: opts.kbLineRaw ?? null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: opts.citeCommitments ?? [],
      ...(opts.client !== undefined ? { client: opts.client } : {}),
      turn_id: opts.turnId ?? `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  function mkContractEditEvent(opts: { path: string; ts: number; sessionId: string }): object {
    return {
      kind: "fabric-event",
      id: `event:contract-edit:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "edit_intent_checked",
      path: opts.path,
      compliant: true,
      intent: "test edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 60_000,
    };
  }

  // -------------------------------------------------------------------------
  // 17 tests — exceeds the 15-case minimum required by the task spec.
  // -------------------------------------------------------------------------

  // 1. Drift-gate path → contract_metrics_status='skipped:bootstrap_drift';
  //    rc.20 metrics still populated (independent windows per plan B4).
  it("bootstrap drift → contract_metrics_status='skipped:bootstrap_drift', rc.20 metrics still computed", async () => {
    const target = createInitializedProject("contract-drift-skip");
    writeFile(".fabric/events.jsonl", "", target);
    // Mutate .fabric/AGENTS.md so it no longer byte-equals BOOTSTRAP_CANONICAL_EN.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL_EN}drift`, "utf8");

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-1",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["applied"],
        // Even though commitments are EMPTY (would be contract_missing under
        // 'ok' state), drift skips the contract walk entirely.
        citeCommitments: [{ operators: [], skip_reason: null }],
        client: "cc",
        ts: rcMarker.marker_ts + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.contract_metrics_status).toBe("skipped:bootstrap_drift");
    // rc.20 still computed — the planned cite registered as a qualifying cite.
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.total_turns).toBe(1);
    // Contract metrics are zeroed (shape present, all counters 0).
    expect(report.contract_metrics).toEqual({
      decisions_cited: 0,
      pitfalls_cited: 0,
      contract_with: 0,
      contract_missing: 0,
      hard_violated: 0,
      cite_id_unresolved: 0,
      skip_count: {},
    });
    expect(report.per_layer_type).toEqual({ team: {}, personal: {} });
  });

  // 2. Decisions cite with valid operator + matching session edit →
  //    contract_with=1, hard_violated=0.
  it("decision cite with edit:foo.ts operator and matching session edit → contract_with=1, hard_violated=0", async () => {
    const target = createInitializedProject("contract-with-ok");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    // Force-emit contract marker before the loop calls runDoctor — keeps
    // ordering deterministic and lets us seed turns AFTER the marker_ts.
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    expect(cMarker.blocked_by).toBe(null);
    expect(cMarker.marker_ts).toBeGreaterThan(0);

    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0100", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-OK",
        citeIds: ["KT-DEC-0100"],
        citeTags: ["applied"],
        citeCommitments: [{
          operators: [{ kind: "edit", target: "src/auth/**" }],
          skip_reason: null,
        }],
        client: "cc",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
      mkContractEditEvent({
        path: "src/auth/login.ts",
        sessionId: "sess-OK",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics_status).toBe("ok");
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.contract_metrics?.hard_violated).toBe(0);
    expect(report.per_layer_type?.team?.decisions).toBe(1);
  });

  // 3. Decisions cite with operator but mismatched edits → hard_violated=1.
  it("decision cite with edit:foo.ts operator but no matching edit → hard_violated=1", async () => {
    const target = createInitializedProject("contract-hard-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0200", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-V",
        citeIds: ["KT-DEC-0200"],
        citeTags: ["applied"],
        citeCommitments: [{
          operators: [{ kind: "edit", target: "src/auth/**" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
      // Edit hits a DIFFERENT path — operator fails.
      mkContractEditEvent({
        path: "src/billing/checkout.ts",
        sessionId: "sess-V",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics_status).toBe("ok");
    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 4. Pitfall cite missing operator → contract_missing=1.
  it("pitfall cite with empty operators and no skip_reason → contract_missing=1, pitfalls_cited=1", async () => {
    const target = createInitializedProject("contract-missing");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-PIT-0001", knowledge_type: "pitfalls" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-M",
        citeIds: ["KT-PIT-0001"],
        citeTags: ["applied"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.pitfalls_cited).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.per_layer_type?.team?.pitfalls).toBe(1);
  });

  // 5. Model cite → no contract check (decisions/pitfalls counters stay 0)
  //    but cross-tab still bumps under team.model.
  it("model cite → no contract bump, cross-tab still counts the type", async () => {
    const target = createInitializedProject("contract-model-noop");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-MOD-0001", knowledge_type: "models" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-MOD",
        citeIds: ["KT-MOD-0001"],
        citeTags: ["applied"],
        // Even with operators, models are reference cites — no contract eval.
        citeCommitments: [{ operators: [{ kind: "edit", target: "**" }], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.decisions_cited).toBe(0);
    expect(report.contract_metrics?.pitfalls_cited).toBe(0);
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.per_layer_type?.team?.models).toBe(1);
  });

  // 6. Guideline cite → deferred bucket, no contract check.
  it("guideline cite → deferred bucket, no contract check", async () => {
    const target = createInitializedProject("contract-guideline-deferred");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-GLD-0001", knowledge_type: "guidelines" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-G",
        citeIds: ["KT-GLD-0001"],
        citeTags: ["applied"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.per_layer_type?.team?.guidelines).toBe(1);
  });

  // v2.0.0-rc.27.1 (Codex review fix): multi-id contract walk must look up
  // commitments[i] for EVERY i < cite_ids.length. Prior to the fix, the
  // parser only emitted one commitment for a shared contract — the 2nd id
  // got a `commitments[1] === undefined` lookup and was counted as
  // contract_missing, even though the line carried a valid `→ edit:...`
  // operator. This test guards against re-introducing that regression by
  // synthesizing the post-fix event shape (commitment duplicated per id)
  // and asserting contract_with=2, contract_missing=0.
  it("multi-id cite with shared contract → contract_with bumps for every id, contract_missing=0 (rc.27.1)", async () => {
    const target = createInitializedProject("contract-multi-id-shared");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
      { stable_id: "KT-PIT-0005", knowledge_type: "pitfalls" },
    ]);
    // Post-fix wire shape: one commitment slot per id, sharing the parsed
    // contract verbatim. `mkContractTurnEvent` accepts the array directly.
    const sharedCommitment = {
      operators: [{ kind: "edit" as const, target: "src/foo.ts" }],
      skip_reason: null,
    };
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-multi",
        citeIds: ["KT-DEC-0001", "KT-PIT-0005"],
        citeTags: ["applied"],
        citeCommitments: [sharedCommitment, sharedCommitment],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.pitfalls_cited).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(2);
    expect(report.contract_metrics?.contract_missing).toBe(0);
  });

  // 7. Unresolved cite_id → cite_id_unresolved bucket, NOT contract_missing.
  it("unresolved cite_id (not in idTypeMap) → cite_id_unresolved=1, contract_missing=0", async () => {
    const target = createInitializedProject("contract-unresolved-id");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    // Note: agents.meta.json deliberately does NOT include KT-DEC-9999.
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-U",
        citeIds: ["KT-DEC-9999"],
        citeTags: ["applied"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.cite_id_unresolved).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.contract_metrics?.decisions_cited).toBe(0);
    expect(report.per_layer_type?.team?.unresolved).toBe(1);
  });

  // 8. skip:sequencing → skip_count.sequencing=1, NOT contract_with/missing.
  it("decision cite with skip_reason='sequencing' → skip_count.sequencing=1", async () => {
    const target = createInitializedProject("contract-skip-sequencing");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0300", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-S",
        citeIds: ["KT-DEC-0300"],
        citeTags: ["applied"],
        citeCommitments: [{ operators: [], skip_reason: "sequencing" }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.skip_count).toEqual({ sequencing: 1 });
    // skip:<reason> exits the contract_with/missing partition.
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    // decisions_cited still bumps — the cite was emitted under the strict
    // bucket, the skip just records that the operator was explicitly waived.
    expect(report.contract_metrics?.decisions_cited).toBe(1);
  });

  // 9. Personal-layer (KP-*) cite breakdown.
  it("personal-layer KP-* cite counted under per_layer_type.personal", async () => {
    const target = createInitializedProject("contract-personal-layer");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KP-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-P",
        citeIds: ["KP-DEC-0001"],
        citeTags: ["applied"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_layer_type?.personal?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.decisions ?? 0).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(1);
  });

  // 10. --layer=team filter → KP-* excluded from contract metrics.
  it("--layer=team filter → KP-* cites excluded from contract counters but still tracked in per_layer_type", async () => {
    const target = createInitializedProject("contract-layer-team");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0400", knowledge_type: "decisions" },
      { stable_id: "KP-DEC-0400", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-T",
        citeIds: ["KT-DEC-0400", "KP-DEC-0400"],
        citeTags: ["applied", "applied"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, {
      since: 0,
      client: "all",
      layer: "team",
    });

    expect(report.layer_filter).toBe("team");
    // Only the team cite contributes to contract counters.
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(1);
    // Per-layer cross-tab is NOT bumped for the filtered-out KP- cite.
    expect(report.per_layer_type?.team?.decisions).toBe(1);
    expect(report.per_layer_type?.personal?.decisions ?? 0).toBe(0);
  });

  // 11. --layer=personal filter → KT-* excluded.
  it("--layer=personal filter → KT-* cites excluded from contract counters", async () => {
    const target = createInitializedProject("contract-layer-personal");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0500", knowledge_type: "decisions" },
      { stable_id: "KP-DEC-0500", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-Pers",
        citeIds: ["KT-DEC-0500", "KP-DEC-0500"],
        citeTags: ["applied", "applied"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, {
      since: 0,
      client: "all",
      layer: "personal",
    });

    expect(report.layer_filter).toBe("personal");
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.per_layer_type?.personal?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.decisions ?? 0).toBe(0);
  });

  // 12. Cross-tab shape sanity: mixed types both layers.
  it("cross-tab populated with both layers and multiple types in one report", async () => {
    const target = createInitializedProject("contract-crosstab");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0601", knowledge_type: "decisions" },
      { stable_id: "KT-PIT-0601", knowledge_type: "pitfalls" },
      { stable_id: "KT-MOD-0601", knowledge_type: "models" },
      { stable_id: "KP-GLD-0601", knowledge_type: "guidelines" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-X",
        citeIds: ["KT-DEC-0601", "KT-PIT-0601", "KT-MOD-0601", "KP-GLD-0601"],
        citeTags: ["applied", "applied", "applied", "applied"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_layer_type?.team?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.pitfalls).toBe(1);
    expect(report.per_layer_type?.team?.models).toBe(1);
    expect(report.per_layer_type?.personal?.guidelines).toBe(1);
  });

  // 13. require:<symbol> operator — matches when symbol appears in any
  //     session edit PATH (the documented scoped fallback — diff content
  //     not in ledger).
  it("require:<symbol> passes when symbol appears as substring of any session edit path", async () => {
    const target = createInitializedProject("contract-require-match");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0701", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-R",
        citeIds: ["KT-DEC-0701"],
        citeTags: ["applied"],
        citeCommitments: [{
          operators: [{ kind: "require", target: "auth" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      // Path contains 'auth' substring → operator passes.
      mkContractEditEvent({
        path: "src/auth/handler.ts",
        sessionId: "sess-R",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(0);
  });

  // 14. forbid:<symbol> operator — violates when symbol appears in any
  //     session edit path.
  it("forbid:<symbol> violates when symbol appears in a session edit path", async () => {
    const target = createInitializedProject("contract-forbid-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0801", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-F",
        citeIds: ["KT-DEC-0801"],
        citeTags: ["applied"],
        citeCommitments: [{
          operators: [{ kind: "forbid", target: "legacy" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      // Path contains 'legacy' → operator violates.
      mkContractEditEvent({
        path: "src/legacy/old.ts",
        sessionId: "sess-F",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 15. not_edit:<glob> operator — violates when matching file is edited.
  it("not_edit:<glob> violates when a session edit hits the forbidden glob", async () => {
    const target = createInitializedProject("contract-notedit-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0901", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-NE",
        citeIds: ["KT-DEC-0901"],
        citeTags: ["applied"],
        citeCommitments: [{
          operators: [{ kind: "not_edit", target: "src/billing/**" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      mkContractEditEvent({
        path: "src/billing/charge.ts",
        sessionId: "sess-NE",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 16. Existing rc.20 metrics survive the rc.24 extension byte-for-byte —
  //     contract_metrics is purely additive.
  it("rc.20 metrics (qualifying_cites/recalled_unverified/dismissed_reason_histogram) unchanged in shape", async () => {
    const target = createInitializedProject("contract-rc20-untouched");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    await ensureCiteContractPolicyActivatedMarker(target);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-RC20",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["applied"],
        kbLineRaw: "KB: KT-DEC-0001 (anchor) [applied]",
        client: "cc",
        ts: rcMarker.marker_ts + 5,
      }),
      mkContractTurnEvent({
        sessionId: "sess-RC20",
        citeIds: ["KT-DEC-0002"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: rcMarker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    // rc.20 fields populated as before.
    expect(report.metrics.total_turns).toBe(2);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 1 });
    // rc.24 additive fields present.
    expect(report.contract_metrics).toBeDefined();
    expect(report.contract_metrics_status).toBe("ok");
    expect(report.per_layer_type).toBeDefined();
  });

  // 17. awaiting_marker state — degraded path where the marker emitter
  //     returns marker_ts=0 with blocked_by=null (e.g. nonexistent root
  //     after drift is conceptually 'ok' but ledger I/O degrades).
  //     Constructed by pointing at a nonexistent root → marker collapse.
  it("nonexistent project root → contract_metrics_status='skipped:bootstrap_drift' (missing snapshot folded into drift)", async () => {
    // Note: rc.20 marker also returns marker_ts=0 here, which collapses to
    // the rc.20 'skipped' top-level status. We still expect the contract
    // status to surface — the early-return preserves the contract block.
    const report = await runDoctorCiteCoverage(
      "/nonexistent-contract-coverage-fabric-root-xyzzy",
      { since: 0, client: "all" },
    );

    expect(report.status).toBe("skipped");
    // L1 inspector says 'missing' → drift gate fires → 'skipped:bootstrap_drift'.
    expect(report.contract_metrics_status).toBe("skipped:bootstrap_drift");
    expect(report.contract_metrics).toEqual({
      decisions_cited: 0,
      pitfalls_cited: 0,
      contract_with: 0,
      contract_missing: 0,
      hard_violated: 0,
      cite_id_unresolved: 0,
      skip_count: {},
    });
    expect(report.layer_filter).toBe("all");
  });
});

// v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): exposed_and_mutated WEAK
// auxiliary signal. Locks the honesty 铁律 (this weak signal NEVER contaminates
// cite_compliance_rate) and the three-condition join filter:
//   (1) narrow-surfaced — hook_surface_emitted with hook_name=knowledge-hint-narrow
//   (2) contract glob specific — narrow kb, relevance_paths not `**/*`, type not guideline
//   (3) mutated + not dismissed — same-session edit hit the specific glob, id not [dismissed]
describe("runDoctorCiteCoverage (W1-T3 exposed_and_mutated weak signal)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  // v2.2 W5 R2/R7 (agents.meta decolo): cite-coverage reads its kb relevance
  // index from the read-set STORES. Seed each node as a store .md, bind the
  // project to the team store, and register it. Index is keyed under both the
  // local stable_id and `team:<id>`, so bare cite ids still resolve.
  const CITE_STORE_UUID_W1T3 = "66666666-6666-4666-8666-666666666666";

  function seedMeta(
    target: string,
    nodes: Array<{
      stable_id: string;
      knowledge_type: "decisions" | "pitfalls" | "models" | "guidelines" | "processes";
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: CITE_STORE_UUID_W1T3 }));
    for (const node of nodes) {
      const dir = join(storeRoot, STORE_LAYOUT.knowledgeDir, node.knowledge_type);
      mkdirSync(dir, { recursive: true });
      const singularType = node.knowledge_type.replace(/s$/u, "");
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        `type: ${singularType}`,
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID_W1T3, alias: "team", remote: "git@e:cite-w1t3.git" }],
    });
  }

  function mkNarrowSurface(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
    hookName?: string;
    deliveryStatus?: "delivered" | "suppressed" | "error";
  }): object {
    return {
      kind: "fabric-event",
      id: `event:surface:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "hook_surface_emitted",
      hook_name: opts.hookName ?? "knowledge-hint-narrow",
      client: "cc",
      target_channel: "preToolUse",
      rendered_ids: opts.ids,
      delivery_status: opts.deliveryStatus ?? "delivered",
    };
  }

  function mkEdit(opts: { path: string; ts: number; sessionId: string }): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "edit_intent_checked",
      path: opts.path,
      compliant: true,
      intent: "test edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 60_000,
    };
  }

  function mkTurn(opts: {
    sessionId: string;
    citeIds: string[];
    citeTags: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: [],
      client: "cc",
      turn_id: `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  // Positive case: narrow-surfaced + specific glob (decisions) + same-session
  // edit hit + not dismissed → count=1, id captured. AND the explicit
  // compliance rate is untouched (no `KB:` cite written this round).
  it("counts a qualifying exposed_and_mutated pair WITHOUT polluting compliance", async () => {
    const target = createInitializedProject("cite-exposed-positive");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0001",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-X", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-X", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.exposed_and_mutated).toEqual({
      count: 1,
      ids: ["KT-DEC-0001"],
    });
    // Honesty 铁律: no explicit `KB:` cite was written. The narrow KB WAS
    // applicable + edited but uncited → it correctly registers as a missed
    // explicit obligation (expected_but_missed=1, compliance=0/1=0%). The weak
    // exposed_and_mutated=1 signal does NOT credit toward — nor dilute — that
    // true compliance number: compliance stays an honest 0%, never inflated.
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.metrics.compliant_cites).toBe(0);
    expect(report.metrics.expected_but_missed).toBe(1);
    expect(report.metrics.noncompliant_cites).toBe(1);
    expect(report.metrics.cite_compliance_rate).toBe(0);
  });

  // Negative (condition 2): relevance_paths is the `**/*` catch-all → not
  // specific → excluded even though surfaced + edited.
  it("does NOT count a `**/*` wildcard glob (not specific)", async () => {
    const target = createInitializedProject("cite-exposed-wildcard");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0002",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["**/*"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-W", ids: ["KT-DEC-0002"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-W", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 2): guideline-type entry is broad-by-nature → excluded
  // even with a specific glob + surface + edit.
  it("does NOT count a generic guideline-type entry", async () => {
    const target = createInitializedProject("cite-exposed-guideline");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-GLD-0001",
        knowledge_type: "guidelines",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-G", ids: ["KT-GLD-0001"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-G", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 3): the id was [dismissed] this session → excluded.
  it("does NOT count an id dismissed in the same session", async () => {
    const target = createInitializedProject("cite-exposed-dismissed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0003",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-D", ids: ["KT-DEC-0003"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-D", ts: marker.marker_ts + 20 }),
      // index-aligned: cite_ids[0] dismissed
      mkTurn({
        sessionId: "sess-D",
        citeIds: ["KT-DEC-0003"],
        citeTags: ["dismissed"],
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 1): the surface came from the BROAD hook, not the
  // narrow PreToolUse hook → excluded even with specific glob + edit.
  it("does NOT count a non-narrow (broad) surface", async () => {
    const target = createInitializedProject("cite-exposed-broad-surface");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0004",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({
        sessionId: "sess-B",
        ids: ["KT-DEC-0004"],
        ts: marker.marker_ts + 10,
        hookName: "knowledge-hint-broad",
      }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-B", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (join): surfaced + specific glob but the same-session edit did NOT
  // hit the glob path → not mutated → excluded.
  it("does NOT count when the edit path is outside the specific glob", async () => {
    const target = createInitializedProject("cite-exposed-no-mutation");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0005",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-M", ids: ["KT-DEC-0005"], ts: marker.marker_ts + 10 }),
      // edit a path NOT under src/auth
      mkEdit({ path: "src/billing/charge.ts", sessionId: "sess-M", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Honesty cross-check: a real explicit cite (compliance) AND a separate
  // exposed_and_mutated pair coexist in the same report — neither inflates the
  // other. Compliance counts the cited id; exposed counts only the surfaced-but-
  // uncited id, on its own field.
  it("keeps compliance and exposed_and_mutated as independent counts", async () => {
    const target = createInitializedProject("cite-exposed-independence");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0010",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
      {
        stable_id: "KT-DEC-0011",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/pay/**"],
      },
    ]);
    seedEvents(target, [
      // explicit applied cite for KT-DEC-0010 (compliance signal)
      mkTurn({
        sessionId: "sess-I",
        citeIds: ["KT-DEC-0010"],
        citeTags: ["applied"],
        ts: marker.marker_ts + 5,
      }),
      // KT-DEC-0011 surfaced-but-uncited + mutated (exposed signal only)
      mkNarrowSurface({ sessionId: "sess-I", ids: ["KT-DEC-0011"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/pay/charge.ts", sessionId: "sess-I", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    // explicit compliance credits ONLY the applied cite
    expect(report.metrics.qualifying_cites).toBe(1);
    // exposed weak signal credits ONLY the surfaced-but-uncited id
    expect(report.metrics.exposed_and_mutated).toEqual({
      count: 1,
      ids: ["KT-DEC-0011"],
    });
  });
});

// lifecycle-refactor W2-T4 (§5 row7 PostToolUse / row2 SessionEnd / §0 下沉 doctor):
// doctor consumes the new `file_mutated` + `session_ended` markers OFFLINE.
// Locks: (1) mutations_observed counts distinct file_mutated (tool_call_id dedup);
// (2) mutation_pool splits attributed (source_event_id → surfaced) vs
// unattributed_workspace_dirty; (3) attribution key store_id+stable_id+source_event_id
// dedups multi-store; (4) sessions_closed counts distinct session_ended;
// (5) the honesty 铁律 — none of these touch cite_compliance_rate.
describe("runDoctorCiteCoverage (W2-T4 PostToolUse mutation funnel)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  // A narrow surface event with a KNOWN envelope id so file_mutated can link to
  // it via source_event_id. Returns { event, id } so the caller wires the link.
  function mkSurface(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
  }): { event: object; id: string } {
    const id = `event:surface:${randomUUID()}`;
    return {
      id,
      event: {
        kind: "fabric-event",
        id,
        ts: opts.ts,
        schema_version: 1,
        session_id: opts.sessionId,
        event_type: "hook_surface_emitted",
        hook_name: "knowledge-hint-narrow",
        client: "cc",
        target_channel: "preToolUse",
        rendered_ids: opts.ids,
        delivery_status: "delivered",
      },
    };
  }

  function mkFileMutated(opts: {
    sessionId: string;
    path: string;
    toolCallId: string;
    ts: number;
    sourceEventId?: string;
    storeId?: string;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:mutated:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "file_mutated",
      path: opts.path,
      tool_call_id: opts.toolCallId,
      tool_name: "Edit",
      ...(opts.sourceEventId !== undefined ? { source_event_id: opts.sourceEventId } : {}),
      ...(opts.storeId !== undefined ? { store_id: opts.storeId } : {}),
    };
  }

  function mkSessionEnded(opts: { sessionId: string; ts: number }): object {
    return {
      kind: "fabric-event",
      id: `event:ended:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "session_ended",
    };
  }

  function mkTurn(opts: {
    sessionId: string;
    citeIds: string[];
    citeTags: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: [],
      client: "cc",
      turn_id: `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  // mutations_observed counts every distinct file_mutated; tool_call_id dedups.
  it("counts distinct file_mutated events with tool_call_id dedup", async () => {
    const target = createInitializedProject("mut-observed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 10 }),
      mkFileMutated({ sessionId: "s1", path: "b.ts", toolCallId: "call-2", ts: marker.marker_ts + 20 }),
      // duplicate tool_call_id (retry append) → collapses to one
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 2 });
  });

  // No source_event_id → unattributed_workspace_dirty, never attributed.
  it("downgrades a file_mutated without source_event_id to unattributed_workspace_dirty", async () => {
    const target = createInitializedProject("mut-unattributed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 10 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 0,
      unattributed_workspace_dirty: 1,
    });
  });

  // source_event_id linking to a real surfaced event → attributed.
  it("attributes a file_mutated whose source_event_id resolves to a surfaced event", async () => {
    const target = createInitializedProject("mut-attributed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      surface.event,
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 1,
      unattributed_workspace_dirty: 0,
    });
  });

  // A source_event_id that links to NO surfaced event (dangling) → unattributed.
  it("downgrades a file_mutated whose source_event_id resolves to nothing", async () => {
    const target = createInitializedProject("mut-dangling-source");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({
        sessionId: "s1",
        path: "a.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: "event:surface:does-not-exist",
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 0,
      unattributed_workspace_dirty: 1,
    });
  });

  // Attribution key = store_id + stable_id + source_event_id: two file_mutated
  // events from DIFFERENT stores sharing the same surfaced id + source must count
  // as TWO attributions (cross-store), while a true duplicate (same store + id +
  // source) collapses to one.
  it("dedups attribution by store_id+stable_id+source_event_id (no multi-store double-count collapse)", async () => {
    const target = createInitializedProject("mut-multistore-key");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      surface.event,
      // store team
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
        storeId: "team",
      }),
      // store other — same surfaced id + source but different store → distinct key
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-2",
        ts: marker.marker_ts + 11,
        sourceEventId: surface.id,
        storeId: "other",
      }),
      // exact duplicate of the team one (different tool_call_id so it's a distinct
      // mutation, but same store+id+source) → attribution key collapses to one
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-3",
        ts: marker.marker_ts + 12,
        sourceEventId: surface.id,
        storeId: "team",
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // 3 distinct tool_call_ids → 3 mutations observed
    expect(report.metrics.mutations_observed).toEqual({ count: 3 });
    // attribution keys: team|KT-DEC-0001|src + other|KT-DEC-0001|src = 2 distinct
    expect(report.metrics.mutation_pool?.attributed).toBe(2);
    expect(report.metrics.mutation_pool?.unattributed_workspace_dirty).toBe(0);
  });

  // sessions_closed counts distinct session_ended markers.
  it("counts distinct session_ended markers as sessions_closed", async () => {
    const target = createInitializedProject("mut-sessions-closed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 10 }),
      mkSessionEnded({ sessionId: "s2", ts: marker.marker_ts + 20 }),
      // duplicate session_ended for s1 → same session, counts once
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.sessions_closed).toEqual({ count: 2 });
  });

  // Honesty 铁律: the mutation funnel NEVER feeds cite_compliance_rate. An
  // explicit applied cite stands alone; file_mutated/session_ended add no
  // compliance credit and no contamination.
  it("keeps the mutation funnel strictly separate from cite_compliance_rate", async () => {
    const target = createInitializedProject("mut-honesty");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      // one explicit applied cite → compliance = 1/1 = 100%
      mkTurn({ sessionId: "s1", citeIds: ["KT-DEC-0001"], citeTags: ["applied"], ts: marker.marker_ts + 6 }),
      // a fully attributed mutation + a session close — pure observability, no
      // compliance effect
      surface.event,
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
      }),
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // mutation funnel populated
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({ attributed: 1, unattributed_workspace_dirty: 0 });
    expect(report.metrics.sessions_closed).toEqual({ count: 1 });
    // compliance untouched: still 1 qualifying cite, 0 missed, 100%
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.cite_compliance_rate).toBe(1);
  });
});

// v2.0.0-rc.23 TASK-007 (a-C2): enrichDescriptions back-fill suite.

describe("runDoctorCiteCoverage recall-based口径 (v2.1 ⑤)", () => {
  function seedRecallEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function planned(sessionId: string, ts: number, targetPaths: string[], ids: string[]): object {
    return {
      kind: "fabric-event",
      id: `event:planned:${randomUUID()}`,
      ts,
      schema_version: 1,
      session_id: sessionId,
      event_type: "knowledge_context_planned",
      target_paths: targetPaths,
      required_stable_ids: [],
      ai_selectable_stable_ids: ids,
      final_stable_ids: ids,
    };
  }
  function edit(sessionId: string | undefined, ts: number, path: string): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
      ts,
      schema_version: 1,
      ...(sessionId !== undefined ? { session_id: sessionId } : {}),
      event_type: "edit_intent_checked",
      path,
      compliant: true,
      intent: "Edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 0,
    };
  }

  it("recall→edit overlap (same session, in-window) → recall-backed", async () => {
    const target = createInitializedProject("cite-recall-backed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.recall_backed_edits).toBe(1);
    expect(report.metrics.recall_coverage_rate).toBe(1);
  });

  it("edit with NO preceding recall → not recall-backed (coverage 0)", async () => {
    const target = createInitializedProject("cite-recall-none");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedRecallEvents(target, [edit("S1", marker.marker_ts + 2_000, "src/a.ts")]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.recall_backed_edits).toBe(0);
    expect(report.metrics.recall_coverage_rate).toBe(0);
  });

  it("recall of a different path → not recall-backed", async () => {
    const target = createInitializedProject("cite-recall-otherpath");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/other.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
  });

  it("recall in a different session → not recall-backed", async () => {
    const target = createInitializedProject("cite-recall-othersession");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("OTHER", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
    // recall_diagnostics self-diagnoses the session_id mismatch: a recall happened
    // in-window (under "OTHER") but no recall session is also an edit session, so
    // coverage's 0 is a mismatch artifact, not a recall-discipline gap.
    expect(report.metrics.recall_diagnostics).toEqual({
      recalls_in_window: 1,
      recall_sessions: 1,
      recall_sessions_correlated: 0,
    });
  });

  it("recall AFTER the edit does not back it (ordering)", async () => {
    const target = createInitializedProject("cite-recall-afteredit");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 10_000;
    seedRecallEvents(target, [
      edit("S1", base, "src/a.ts"),
      planned("S1", base + 5_000, ["src/a.ts"], ["KT-DEC-0007"]),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
  });

  it("recall outside recallWindowMs does not back the edit", async () => {
    const target = createInitializedProject("cite-recall-window");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 20 * 60_000, "src/a.ts"),
    ]);
    // 10-minute window — the recall is 20min before the edit → out of window.
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all", recallWindowMs: 10 * 60_000 });
    expect(report.metrics.recall_backed_edits).toBe(0);
    // ...but an unbounded window (0) backs it.
    const unbounded = await runDoctorCiteCoverage(target, { since: 0, client: "all", recallWindowMs: 0 });
    expect(unbounded.metrics.recall_backed_edits).toBe(1);
  });

  it("mixed: 2 edits, 1 recall-backed → coverage 0.5", async () => {
    const target = createInitializedProject("cite-recall-mixed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 1_000, "src/a.ts"),
      edit("S1", base + 2_000, "src/b.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(2);
    expect(report.metrics.recall_backed_edits).toBe(1);
    expect(report.metrics.recall_coverage_rate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.30 TASK-003 (H2 deferred-from-rc.29): emit-cadence sub-check.
//
// Pins the function contract — fetched=0 vacuously OK; observed/fetched <
// EMIT_CADENCE_WARN_THRESHOLD (0.8) yields warn; healthy ratio yields ok.
// Wired-into-main-doctor decision deferred to v2.1 design doc per
// memory/project_l0_l1_l2_redesign_v21.md.
// ---------------------------------------------------------------------------


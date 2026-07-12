import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  enrichDescriptions,
  runDoctorArchiveHistory,
  runDoctorBodyReadMisfireCheck,
  runDoctorHistoryAll,
  runDoctorReport,
} from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import {
  createForensic,
  createInitializedProject,
  createProject,
  tempRoots,
  writeFile,
} from "./doctor-test-helpers.js";

describe("enrichDescriptions", () => {
  const ENRICH_STORE_UUID = "77777777-7777-4777-8777-777777777777";

  function createStoreBoundEnrichProject(name: string): string {
    const target = createInitializedProject(name);
    writeFile(
      ".fabric/fabric-config.json",
      JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2),
      target,
    );
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: ENRICH_STORE_UUID, alias: "team", remote: "git@example.com:team.git" }],
    });
    return target;
  }

  function storePath(...parts: string[]): string {
    return join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: ENRICH_STORE_UUID }),
      STORE_LAYOUT.knowledgeDir,
      ...parts,
    );
  }

  // Helper — seed a canonical entry whose frontmatter is missing N of the
  // four rc.23 description-grade fields in the mounted store read-set.
  function seedLegacyEntry(
    absPath: string,
    overrides: { withFields?: string[]; body?: string } = {},
  ): void {
    const withFields = overrides.withFields ?? [];
    const lines = [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "maturity: draft",
      "layer: team",
      "created_at: 2026-05-10T00:00:00Z",
    ];
    if (withFields.includes("intent_clues")) lines.push('intent_clues: ["foo"]');
    if (withFields.includes("tech_stack")) lines.push('tech_stack: ["bar"]');
    if (withFields.includes("impact")) lines.push('impact: ["baz"]');
    if (withFields.includes("must_read_if")) lines.push('must_read_if: "existing"');
    lines.push("---", overrides.body ?? "# Legacy Entry\n\nBody.\n");
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, `${lines.join("\n")}\n`, "utf8");
  }

  it("auto mode back-fills all four fields with deterministic stubs", async () => {
    const target = createStoreBoundEnrichProject("enrich-auto-missing-all");
    const absPath = storePath("decisions", "KT-DEC-0001--legacy.md");
    seedLegacyEntry(absPath);

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.mode).toBe("auto");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.candidates).toHaveLength(1);
    const candidate = report.candidates[0];
    expect(candidate.modified).toBe(true);
    expect(candidate.missing).toEqual([
      "intent_clues",
      "tech_stack",
      "impact",
      "must_read_if",
    ]);
    expect(candidate.added_fields).toEqual([
      "intent_clues",
      "tech_stack",
      "impact",
      "must_read_if",
    ]);

    // Verify on-disk frontmatter now carries all four fields.
    const rewritten = readFileSync(absPath, "utf8");
    expect(rewritten).toMatch(/^intent_clues:\s*\[\]/m);
    expect(rewritten).toMatch(/^tech_stack:\s*\[\]/m);
    expect(rewritten).toMatch(/^impact:\s*\[\]/m);
    expect(rewritten).toMatch(/^must_read_if:\s*Legacy Entry/m);

    // knowledge_enriched event emitted to the ledger.
    const { events } = await readEventLedger(target);
    const enrichEvents = events.filter((e) => e.event_type === "knowledge_enriched");
    expect(enrichEvents).toHaveLength(1);
    expect(enrichEvents[0]).toMatchObject({
      mode: "auto",
      path: "store:team:KT-DEC-0001",
      added_fields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
  });

  it("auto mode is no-op (idempotent) on entries that already have all four fields", async () => {
    const target = createStoreBoundEnrichProject("enrich-auto-noop");
    const absPath = storePath("decisions", "KT-DEC-0001--complete.md");
    seedLegacyEntry(absPath, {
      withFields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
    const before = readFileSync(absPath, "utf8");
    const beforeMtime = statSync(absPath).mtimeMs;

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.candidates).toEqual([]);

    // File content unchanged byte-for-byte.
    const after = readFileSync(absPath, "utf8");
    expect(after).toBe(before);
    // mtime invariant (the convergence criteria's idempotency check). On some
    // filesystems mtime resolution is coarse, so we assert <= rather than ==.
    const afterMtime = statSync(absPath).mtimeMs;
    expect(afterMtime).toBeLessThanOrEqual(beforeMtime);

    // No knowledge_enriched event emitted.
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "knowledge_enriched")).toHaveLength(0);
  });

  it("dry-run mode reports missing fields without writing", async () => {
    const target = createStoreBoundEnrichProject("enrich-dry-run");
    const absPath = storePath("decisions", "KT-DEC-0001--legacy.md");
    seedLegacyEntry(absPath, {
      withFields: ["intent_clues"],
    });
    const before = readFileSync(absPath, "utf8");

    const report = await enrichDescriptions(target, { auto: true, dryRun: true });

    expect(report.dryRun).toBe(true);
    // v2.0.0-rc.29 TASK-007 (BUG-M1): --auto + --dry-run reports as `preview`.
    expect(report.mode).toBe("preview");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].modified).toBe(false);
    expect(report.candidates[0].missing).toEqual(["tech_stack", "impact", "must_read_if"]);

    // File unchanged.
    expect(readFileSync(absPath, "utf8")).toBe(before);

    // No ledger event emitted in dry-run mode.
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "knowledge_enriched")).toHaveLength(0);
  });

  // v2.0.0-rc.29 TASK-007 (BUG-M1): mode label now reflects what actually
  // happens — readonly when no `--auto` is passed (writes nothing). The
  // previous "interactive" label was misleading because no prompt actually
  // ran. Legacy `"interactive"` literal is kept in the type union as a
  // deprecated alias for downstream consumers.
  it("readonly (default) mode reports missing fields without writing", async () => {
    const target = createStoreBoundEnrichProject("enrich-readonly");
    const absPath = storePath("pitfalls", "KP-PIT-0001--gotcha.md");
    seedLegacyEntry(absPath, {
      withFields: ["tech_stack", "impact"],
    });
    const before = readFileSync(absPath, "utf8");

    const report = await enrichDescriptions(target, {}); // no auto

    expect(report.mode).toBe("readonly");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].missing).toEqual(["intent_clues", "must_read_if"]);
    expect(report.candidates[0].modified).toBe(false);
    expect(report.candidates[0].added_fields).toEqual([]);

    // File unchanged.
    expect(readFileSync(absPath, "utf8")).toBe(before);
  });

  it("auto mode is idempotent across two runs (second pass writes nothing)", async () => {
    const target = createStoreBoundEnrichProject("enrich-idempotent");
    seedLegacyEntry(storePath("guidelines", "KT-GLD-0001.md"));

    const first = await enrichDescriptions(target, { auto: true });
    expect(first.modified).toBe(1);

    const second = await enrichDescriptions(target, { auto: true });
    expect(second.modified).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.candidates).toEqual([]);
  });

  it("skips pending/ subtree (Skill owns pending shape)", async () => {
    const target = createStoreBoundEnrichProject("enrich-skip-pending");
    // Pending entries use bare-slug filenames; iterateCanonicalFilenames is
    // scoped to KNOWLEDGE_CANONICAL_TYPE_DIRS which deliberately excludes
    // pending/. Belt-and-suspenders: even if a Skill landed a pending entry
    // missing all four fields, enrichDescriptions must not touch it.
    const pendingPath = storePath("pending", "decisions", "draft.md");
    mkdirSync(dirname(pendingPath), { recursive: true });
    writeFileSync(
      pendingPath,
      "---\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Draft\n",
      "utf8",
    );

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.scanned).toBe(0);
    expect(report.candidates).toEqual([]);
  });
});

// v2.0.0-rc.25 TASK-10: runDoctorArchiveHistory — per-session archive attempt
// audit. Covers the four core cases: basic distinct-session aggregation,
// most-recent-wins for multi-attempt sessions, --since window exclusion, and
// empty-ledger no-crash. Helpers seed raw JSONL rows the same way the
// runDoctorCiteCoverage tests do so we control `ts` precisely.
describe("runDoctorArchiveHistory", () => {
  function seedArchiveEvents(
    target: string,
    rows: Array<{
      sessionId: string;
      ts: number;
      outcome: "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal";
      candidatesProposed?: number;
      coveredThroughTs?: number;
      knowledgeProposedIds?: string[];
    }>,
  ): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines =
      rows
        .map((row) =>
          JSON.stringify({
            kind: "fabric-event",
            id: `event:arch:${randomUUID()}`,
            ts: row.ts,
            schema_version: 1,
            session_id: row.sessionId,
            event_type: "session_archive_attempted",
            outcome: row.outcome,
            covered_through_ts: row.coveredThroughTs ?? row.ts,
            candidates_proposed: row.candidatesProposed ?? 0,
            knowledge_proposed_ids: row.knowledgeProposedIds ?? [],
          }),
        )
        .join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  it("aggregates one entry per session when each session has a single attempt", async () => {
    // Imported lazily to avoid a top-of-file edit that conflicts with parallel
    // tasks. Once the module evaluates, subsequent calls reuse the same binding.
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-basic");
    writeFile(".fabric/events.jsonl", "", target);

    const now = Date.now();
    seedArchiveEvents(target, [
      { sessionId: "sess-A", ts: now - 60_000, outcome: "proposed", candidatesProposed: 3 },
      { sessionId: "sess-B", ts: now - 30_000, outcome: "skipped_no_signal" },
      { sessionId: "sess-C", ts: now - 10_000, outcome: "user_dismissed" },
    ]);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(3);
    expect(report.entries).toHaveLength(3);
    // Descending by last_attempted_at — sess-C is most recent.
    expect(report.entries[0].outcome).toBe("user_dismissed");
    expect(report.entries[1].outcome).toBe("skipped_no_signal");
    expect(report.entries[2].outcome).toBe("proposed");
    // session_id_short truncation: all our seeded ids are <= 8 chars so they
    // render verbatim (no `...` suffix).
    expect(report.entries[0].session_id_short).toBe("sess-C");
    expect(report.entries[2].candidates_proposed).toBe(3);
  });

  it("keeps only the most recent attempt when the same session retries", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-most-recent");
    writeFile(".fabric/events.jsonl", "", target);

    const base = Date.now() - 60_000;
    seedArchiveEvents(target, [
      // Earliest attempt — skipped_no_signal, will lose.
      { sessionId: "sess-retry", ts: base, outcome: "skipped_no_signal" },
      // Middle attempt — viability_failed, will lose.
      { sessionId: "sess-retry", ts: base + 10_000, outcome: "viability_failed" },
      // Latest attempt — proposed, MUST win.
      {
        sessionId: "sess-retry",
        ts: base + 20_000,
        outcome: "proposed",
        candidatesProposed: 2,
      },
    ]);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(1);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].outcome).toBe("proposed");
    expect(report.entries[0].candidates_proposed).toBe(2);
    // last_attempted_at corresponds to the latest ts.
    expect(report.entries[0].last_attempted_at).toBe(new Date(base + 20_000).toISOString());
  });

  it("excludes events older than the --since floor", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-since");
    writeFile(".fabric/events.jsonl", "", target);

    const now = Date.now();
    const oneDayMs = 86_400_000;
    seedArchiveEvents(target, [
      // 10d ago — outside a 7d window.
      { sessionId: "sess-old", ts: now - 10 * oneDayMs, outcome: "proposed" },
      // 2d ago — inside a 7d window.
      { sessionId: "sess-recent", ts: now - 2 * oneDayMs, outcome: "proposed" },
    ]);

    const sevenDayFloor = now - 7 * oneDayMs;
    const report = await runDoctorArchiveHistory(target, { since: sevenDayFloor });
    expect(report.total).toBe(1);
    expect(report.entries[0].session_id_short).toBe("sess-rec...");
    // since_ms is echoed back verbatim.
    expect(report.since_ms).toBe(sevenDayFloor);
  });

  it("returns an empty report (no crash) when events.jsonl is empty", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-empty");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.since_ms).toBe(0);
    // generated_at must be a parseable ISO timestamp.
    expect(Number.isNaN(new Date(report.generated_at).getTime())).toBe(false);
  });
});

// rc.37 NEW-33: runDoctorHistoryAll — unified per-day rollup across doctor_run
// + session_archive_attempted events. Validates the bucket aggregation +
// sort + empty-window fast-path.
describe("runDoctorHistoryAll", () => {
  function seedDoctorRunEvent(
    target: string,
    ts: number,
    mode: "lint" | "fix-knowledge",
    issues: number,
    mutations?: number,
  ): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const payload: Record<string, unknown> = {
      kind: "fabric-event",
      id: `event:doc:${randomUUID()}`,
      ts,
      schema_version: 1,
      event_type: "doctor_run",
      mode,
      issues,
      timestamp: new Date(ts).toISOString(),
    };
    if (mutations !== undefined) payload.mutations = mutations;
    writeFileSync(ledgerPath, existing + JSON.stringify(payload) + "\n", "utf8");
  }

  function seedArchiveEvent(target: string, ts: number, proposed: number): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const payload = {
      kind: "fabric-event",
      id: `event:arch:${randomUUID()}`,
      ts,
      schema_version: 1,
      session_id: `sess-${ts}`,
      event_type: "session_archive_attempted",
      outcome: proposed > 0 ? "proposed" : "skipped_no_signal",
      covered_through_ts: ts,
      candidates_proposed: proposed,
      knowledge_proposed_ids: [],
    };
    writeFileSync(ledgerPath, existing + JSON.stringify(payload) + "\n", "utf8");
  }

  it("returns empty rows when no doctor or archive events sit in the window", async () => {
    const { runDoctorHistoryAll } = await import("./doctor.js");
    const target = createInitializedProject("history-all-empty");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorHistoryAll(target, { since: 0 });
    expect(report.rows).toHaveLength(0);
    expect(report.since_ms).toBe(0);
    expect(Number.isNaN(new Date(report.generated_at).getTime())).toBe(false);
  });

  it("buckets doctor_run and archive events by UTC date and sorts desc", async () => {
    const { runDoctorHistoryAll } = await import("./doctor.js");
    const target = createInitializedProject("history-all-buckets");
    writeFile(".fabric/events.jsonl", "", target);

    // Two UTC dates: day A (older) and day B (newer). Crafted in epoch-ms.
    const dayA = Date.UTC(2026, 0, 10, 12, 0, 0);
    const dayB = Date.UTC(2026, 0, 11, 12, 0, 0);
    seedDoctorRunEvent(target, dayA, "lint", 5);
    seedDoctorRunEvent(target, dayA, "fix-knowledge", 3, 2);
    seedArchiveEvent(target, dayA, 4);
    seedDoctorRunEvent(target, dayB, "lint", 1);
    seedArchiveEvent(target, dayB, 0);

    const report = await runDoctorHistoryAll(target, { since: 0 });
    expect(report.rows).toHaveLength(2);
    // Sorted descending — newer first.
    expect(report.rows[0].date).toBe("2026-01-11");
    expect(report.rows[1].date).toBe("2026-01-10");
    // Day B aggregates: 1 lint, 0 fix, 1 issue, 0 mut, 1 archive attempt, 0 proposed.
    expect(report.rows[0].doctor_runs_lint).toBe(1);
    expect(report.rows[0].doctor_runs_fix).toBe(0);
    expect(report.rows[0].archive_attempts).toBe(1);
    expect(report.rows[0].archive_proposed).toBe(0);
    // Day A aggregates: 1 lint + 1 fix, 5+3 issues, 2 mut, 1 archive, 4 proposed.
    expect(report.rows[1].doctor_runs_lint).toBe(1);
    expect(report.rows[1].doctor_runs_fix).toBe(1);
    expect(report.rows[1].doctor_total_issues).toBe(8);
    expect(report.rows[1].doctor_total_mutations).toBe(2);
    expect(report.rows[1].archive_attempts).toBe(1);
    expect(report.rows[1].archive_proposed).toBe(4);
  });
});

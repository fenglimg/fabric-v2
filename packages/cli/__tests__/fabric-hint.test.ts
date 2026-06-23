/**
 * Contract tests for templates/hooks/fabric-hint.cjs (formerly
 * archive-hint.cjs — renamed in rc.5 TASK-010 to reflect its expanded
 * three-signal scope: archive / review / import).
 *
 * Per signal-handler.test.ts:1-14 policy: in-process invocation only,
 * NO child_process.spawn in CI. We load the .cjs via createRequire so
 * Vitest's ESM resolver does not interfere.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
);

type PendingStats = { count: number; oldestAgeMs: number | null };

type UnderseedStats = { nodeCount: number; threshold: number };

type HookDecision =
  | {
      // ux-w0-3: signals are SOFT (reminder layer), never decision:block.
      decision: "soft";
      reason: string;
      signal: "archive" | "archive_backlog" | "review" | "import";
      recommended_skill: "fabric-archive" | "fabric-review" | "fabric-import";
    }
  | null;

// crack 1: per-session edit view. editsSinceArchive = current session's
// file_mutated count since its own archive anchor; anchorPresent gates the
// trigger (the session has ledger activity to count from).
type EditCounterStats = {
  editsSinceArchive: number;
  threshold: number;
  anchorPresent: boolean;
};
// crack 2: cross-session backlog view (dead sessions with unarchived work).
type BacklogStats = { deadSessionCount: number; threshold: number };

type HookModule = {
  main: (
    env: { cwd: string; now: Date; stdin_payload?: unknown },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
  // observability grill (a): session-scoped activity tally for the status line.
  tallySessionActivity: (
    events: Array<Record<string, unknown>>,
    sessionId: string,
  ) => { edits: number; consumed: number };
  readLedger: (projectRoot: string) => Array<Record<string, unknown>>;
  readPendingStats: (projectRoot: string, now: Date) => PendingStats;
  countCanonicalNodes: (projectRoot: string) => number;
  countEditsSince: (projectRoot: string, anchorTs: number | null) => number;
  decide: (
    events: Array<Record<string, unknown>>,
    now: Date,
    pendingStats?: PendingStats,
    underseedStats?: UnderseedStats,
    editCounterStats?: EditCounterStats,
    thresholds?: {
      archiveHintHours?: number;
      reviewHintPendingCount?: number;
      reviewHintPendingAgeDays?: number;
    },
    banner?: { activityOverview?: string },
    importInFlight?: boolean,
    backlogStats?: BacklogStats,
  ) => HookDecision;
  // v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B.
  isImportInFlight: (projectRoot: string, now?: Date) => boolean;
  // crack 1 + 2: two-lane archive strategy helpers.
  sessionArchiveWatermark: (
    events: Array<Record<string, unknown>>,
    sessionId: string,
  ) => number | null;
  sessionFirstActivityTs: (
    events: Array<Record<string, unknown>>,
    sessionId: string,
  ) => number | null;
  sessionAnchorTs: (
    events: Array<Record<string, unknown>>,
    sessionId: string,
  ) => number | null;
  countSessionMutationsSince: (
    events: Array<Record<string, unknown>>,
    sessionId: string,
    anchorTs: number | null,
  ) => number;
  countBacklogSessions: (
    events: Array<Record<string, unknown>>,
    nowMs: number,
    currentSessionId: string | null,
    idleHours?: number,
  ) => number;
  readArchiveBacklogSessionCount: (projectRoot: string) => number;
  readArchiveBacklogIdleHours: (projectRoot: string) => number;
  readUnderseedThreshold: (projectRoot: string) => number;
  readArchiveEditThreshold: (projectRoot: string) => number;
  // rc.7 T7: externalized-threshold readers.
  readArchiveHintHours: (projectRoot: string) => number;
  readReviewHintPendingCount: (projectRoot: string) => number;
  readReviewHintPendingAgeDays: (projectRoot: string) => number;
  readMaintenanceHintDays: (projectRoot: string) => number;
  readMaintenanceHintCooldownDays: (projectRoot: string) => number;
  // rc.7 T10: Signal D helpers.
  evaluateMaintenanceSignal: (
    events: Array<Record<string, unknown>>,
    now: Date,
    canonicalCount: number,
    lastEmitMs: number | null,
    thresholds?: {
      maintenanceHintDays?: number;
      maintenanceHintCooldownDays?: number;
    },
  ) => HookDecision | { decision: "soft"; reason: string; signal: "maintenance"; recommended_skill: null } | null;
  findLastDoctorRunTs: (events: Array<Record<string, unknown>>) => number | null;
  readMaintenanceLastEmit: (projectRoot: string, sessionId?: string | null) => number | null;
  writeMaintenanceLastEmit: (projectRoot: string, nowMs: number, sessionId?: string | null) => void;
  CONSTANTS: {
    FABRIC_DIR: string;
    EVENT_LEDGER_FILE: string;
    EVENT_TYPE_PROPOSED: string;
    EVENT_TYPE_INIT_SCAN_COMPLETED: string;
    THRESHOLD_HOURS: number;
    PENDING_DIR: string;
    PENDING_TYPES: string[];
    THRESHOLD_PENDING_COUNT: number;
    THRESHOLD_PENDING_AGE_DAYS: number;
    DEFAULT_ARCHIVE_HINT_HOURS: number;
    DEFAULT_REVIEW_HINT_PENDING_COUNT: number;
    DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS: number;
    DEFAULT_MAINTENANCE_HINT_DAYS: number;
    DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS: number;
    KNOWLEDGE_CANONICAL_TYPES: string[];
    DEFAULT_UNDERSEED_NODE_THRESHOLD: number;
    UNDERSEED_POST_INIT_QUIET_HOURS: number;
    UNDERSEED_NO_PROPOSED_HOURS: number;
    EDIT_COUNTER_FILE_REL: string;
    DEFAULT_ARCHIVE_EDIT_THRESHOLD: number;
    // v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B.
    IMPORT_STATE_FILE_REL: string;
    IMPORT_IN_FLIGHT_MAX_AGE_HOURS: number;
  };
};

const hook = require(hookPath) as HookModule;

const HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");
const NOW_MS = FIXED_NOW.getTime();

function writeProjectConfig(root: string, projectId: string): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId, fabric_language: "en" }),
    "utf8",
  );
}

function writeBindingsSnapshot(
  home: string,
  projectId: string,
  knowledgeStats?: Record<string, unknown>,
): void {
  mkdirSync(join(home, ".fabric", "state", "bindings"), { recursive: true });
  const snapshot: Record<string, unknown> = {
    version: 1,
    project_id: projectId,
    generated_at: "2026-05-30T00:00:00.000Z",
    read_set: { stores: [] },
    write_target: null,
  };
  if (knowledgeStats !== undefined) {
    // #3: the hooks recount LIVE off knowledge_store_dirs (the cached
    // knowledge_stats projection is no longer trusted). Seed a real store dir
    // with the requested canonical / pending *.md counts so the live walk
    // reproduces the numbers these tests assert. An old snapshot WITHOUT
    // knowledge_store_dirs now yields skip (undeterminable), covered separately.
    const canonical = Number(knowledgeStats.canonical_count ?? 0);
    const pending = Number(knowledgeStats.pending_count ?? 0);
    const root = join(home, ".fabric", "state", "test-store", projectId);
    const types = ["decisions", "pitfalls", "guidelines", "models", "processes"];
    for (let i = 0; i < canonical; i++) {
      const typeDir = join(root, "knowledge", types[i % types.length]);
      mkdirSync(typeDir, { recursive: true });
      writeFileSync(join(typeDir, `K-${i}.md`), "# node\n", "utf8");
    }
    if (pending > 0) {
      const pendingDir = join(root, "knowledge", "pending", "decisions");
      mkdirSync(pendingDir, { recursive: true });
      // #3: live recount derives oldestPendingMtimeMs from REAL file mtimes (not
      // the cached projection). Stamp the seeded files to oldest_pending_mtime_ms
      // so tests asserting oldestAgeMs (= now − oldest) stay valid post-cutover.
      const oldestMs = Number(knowledgeStats.oldest_pending_mtime_ms ?? 0);
      for (let i = 0; i < pending; i++) {
        const p = join(pendingDir, `p-${i}.md`);
        writeFileSync(p, "# pending\n", "utf8");
        if (oldestMs > 0) {
          const t = new Date(oldestMs);
          utimesSync(p, t, t);
        }
      }
    }
    snapshot.knowledge_stats = knowledgeStats;
    snapshot.knowledge_store_dirs = [root];
  }
  writeFileSync(
    join(home, ".fabric", "state", "bindings", `${projectId}_resolved.json`),
    JSON.stringify(snapshot),
    "utf8",
  );
}

function withIsolatedFabricHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "fabric-hint-home-"));
  const prevHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.FABRIC_HOME;
    else process.env.FABRIC_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function makeEvent(
  event_type: string,
  ts: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "fabric-event",
    schema_version: 1,
    id: `event:${event_type}:${ts}`,
    event_type,
    ts,
    ...extra,
  };
}

describe("fabric-hint.cjs — readLedger", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-archive-hint-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns [] when .fabric/events.jsonl does not exist (ENOENT)", () => {
    const events = hook.readLedger(tempRoot);
    expect(events).toEqual([]);
  });

  it("drops a partial-tail line that lacks a trailing newline", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const goodLine = JSON.stringify(makeEvent("knowledge_context_planned", 100));
    // Two complete lines + one partial line (no trailing newline).
    const partial = '{"event_type":"knowledge_proposed","ts":';
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${goodLine}\n${goodLine}\n${partial}`,
      "utf8",
    );

    const events = hook.readLedger(tempRoot);
    expect(events).toHaveLength(2);
    expect(events[0]?.event_type).toBe("knowledge_context_planned");
  });

  it("drops corrupt JSON lines but keeps surrounding good lines", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const goodA = JSON.stringify(makeEvent("knowledge_context_planned", 100));
    const goodB = JSON.stringify(makeEvent("knowledge_proposed", 200));
    const corrupt = "this-is-not-json{{{";
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${goodA}\n${corrupt}\n${goodB}\n`,
      "utf8",
    );

    const events = hook.readLedger(tempRoot);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.event_type)).toEqual([
      "knowledge_context_planned",
      "knowledge_proposed",
    ]);
  });
});

// rc.5 TASK-015 (C6): Signal A pure-24h baseline tests. rc.6 TASK-022 (E5)
// adds an OR-branch on edit count from the PreToolUse sidecar; these tests
// pass `editCounterStats` undefined so they exercise the time-only branch.
// plan_context events present in the ledger MUST NOT influence Signal A
// (auto-fire-resistant — see TASK-015 rationale).
// crack 1: Signal A is now a PER-SESSION edit-count nudge. `editStats` carries
// the current session's file_mutated count since its own archive anchor +
// `anchorPresent` (the session has ledger activity). The old global
// 24h-OR-N-edits trigger is retired — the cross-session case moved to the
// archive_backlog signal (crack 2). decide() stays pure: it consumes synthetic
// editStats, so these tests never seed file_mutated events.
describe("fabric-hint.cjs — decide (Signal A: per-session edit count, crack 1)", () => {
  const edits = (editsSinceArchive: number, threshold = 20, anchorPresent = true) => ({
    editsSinceArchive,
    threshold,
    anchorPresent,
  });

  it("returns null on empty ledger + no edit stats", () => {
    expect(hook.decide([], FIXED_NOW)).toBeNull();
  });

  it("silent when session edits < threshold", () => {
    expect(hook.decide([], FIXED_NOW, undefined, undefined, edits(5, 20))).toBeNull();
  });

  it("fires archive when session edits >= threshold", () => {
    const r = hook.decide([], FIXED_NOW, undefined, undefined, edits(20, 20));
    expect(r).not.toBeNull();
    expect(r?.decision).toBe("soft");
    expect(r?.signal).toBe("archive");
    expect(r?.recommended_skill).toBe("fabric-archive");
    expect(r?.reason).toMatch(/20 次编辑/);
    expect(r?.reason).toMatch(/fabric-archive/);
  });

  it("silent when anchorPresent is false even with a huge edit count", () => {
    // A session with zero ledger activity has no anchor to count from.
    expect(hook.decide([], FIXED_NOW, undefined, undefined, edits(100, 20, false))).toBeNull();
  });

  it("no longer fires on the retired global 24h timer", () => {
    // knowledge_proposed 25h ago used to trigger archive; with the hours branch
    // retired (crack 2 owns cross-session), it is silent absent a session edit
    // count.
    const events = [
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });

  it("honours a custom threshold", () => {
    expect(hook.decide([], FIXED_NOW, undefined, undefined, edits(30, 50))).toBeNull();
    const fired = hook.decide([], FIXED_NOW, undefined, undefined, edits(50, 50));
    expect(fired?.signal).toBe("archive");
    expect(fired?.reason).toMatch(/50 次编辑/);
    expect(fired?.reason).toMatch(/阈值 50/);
  });

  it("reason mentions edits, never hours", () => {
    const r = hook.decide([], FIXED_NOW, undefined, undefined, edits(25, 20));
    expect(r?.reason).toMatch(/25 次编辑/);
    expect(r?.reason).not.toMatch(/h（阈值/);
  });
});

// crack 2: the archive_backlog signal — cross-session safety net replacing the
// retired global-24h timer. decide() consumes a synthetic backlogStats (the
// 9th positional arg) so the precedence + threshold logic is testable in
// isolation; countBacklogSessions() is tested separately against real ledgers.
describe("fabric-hint.cjs — decide (archive_backlog signal, crack 2)", () => {
  const noEdits = { editsSinceArchive: 0, threshold: 20, anchorPresent: false };
  const backlog = (deadSessionCount: number, threshold = 2) => ({ deadSessionCount, threshold });

  it("silent when dead-session count < threshold", () => {
    expect(
      hook.decide([], FIXED_NOW, undefined, undefined, noEdits, undefined, undefined, undefined, backlog(1, 2)),
    ).toBeNull();
  });

  it("fires archive_backlog when dead-session count >= threshold", () => {
    const r = hook.decide(
      [], FIXED_NOW, undefined, undefined, noEdits, undefined, undefined, undefined, backlog(2, 2),
    );
    expect(r).not.toBeNull();
    expect(r?.decision).toBe("soft");
    expect(r?.signal).toBe("archive_backlog");
    expect(r?.recommended_skill).toBe("fabric-archive");
    expect(r?.reason).toMatch(/2 个已结束/);
    expect(r?.reason).toMatch(/fabric-archive/);
  });

  it("in-session archive takes precedence over backlog", () => {
    const r = hook.decide(
      [], FIXED_NOW, undefined, undefined,
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
      undefined, undefined, undefined, backlog(5, 2),
    );
    expect(r?.signal).toBe("archive");
  });

  it("backlog takes precedence over review", () => {
    const r = hook.decide(
      [], FIXED_NOW, { count: 12, oldestAgeMs: 9 * DAY_MS }, undefined, noEdits,
      undefined, undefined, undefined, backlog(2, 2),
    );
    expect(r?.signal).toBe("archive_backlog");
  });

  it("threshold 0 disables the backlog signal", () => {
    expect(
      hook.decide([], FIXED_NOW, undefined, undefined, noEdits, undefined, undefined, undefined, backlog(5, 0)),
    ).toBeNull();
  });
});

// crack 1 + 2: deterministic unit tests for the per-session anchor + count
// helpers and the cross-session backlog scan. These pin the concurrency
// semantics the design brief mandates (a neighbour window's archive must not
// zero this window's unarchived count).
describe("fabric-hint.cjs — two-lane archive helpers (crack 1 + 2)", () => {
  const mut = (sid: string, ts: number) =>
    makeEvent("file_mutated", ts, { session_id: sid, path: `f${ts}.ts`, tool_call_id: `tc-${sid}-${ts}` });
  const attempt = (sid: string, ts: number, coveredThrough: number, outcome = "proposed") =>
    makeEvent("session_archive_attempted", ts, {
      session_id: sid,
      outcome,
      covered_through_ts: coveredThrough,
      candidates_proposed: outcome === "proposed" ? 1 : 0,
      knowledge_proposed_ids: outcome === "proposed" ? ["k1"] : [],
    });
  const hv = (sid: string, ts: number) =>
    makeEvent("edit_intent_checked", ts, { session_id: sid, path: `hv${ts}.ts` });

  it("sessionAnchorTs prefers the session's own archive watermark over first activity", () => {
    const events = [hv("A", 1000), attempt("A", 2000, 1500), mut("A", 3000)];
    expect(hook.sessionAnchorTs(events, "A")).toBe(1500);
  });

  it("sessionAnchorTs falls back to first activity when never archived", () => {
    const events = [hv("A", 1000), mut("A", 2000), mut("A", 3000)];
    expect(hook.sessionAnchorTs(events, "A")).toBe(1000);
  });

  it("countSessionMutationsSince counts only this session's file_mutated past the anchor", () => {
    const events = [
      mut("A", 1000), // at/below anchor → excluded
      mut("A", 2000),
      mut("A", 3000),
      mut("B", 2500), // other session → excluded
    ];
    expect(hook.countSessionMutationsSince(events, "A", 1000)).toBe(2);
  });

  it("crack 1 concurrency: session B's count is NOT zeroed by neighbour A's archive", () => {
    // A archives at ts 5000 (covered_through 5000). B has done 3 edits, never
    // archived. The session-blind global anchor would jump to 5000 and wipe B's
    // pre-5000 edits; the per-session anchor keeps B's first-activity anchor.
    const events = [
      hv("B", 1000), // B first activity
      mut("B", 1100),
      mut("B", 1200),
      mut("B", 1300),
      hv("A", 4000),
      attempt("A", 5000, 5000), // neighbour A archives — global watermark jumps
    ];
    const anchorB = hook.sessionAnchorTs(events, "B");
    expect(anchorB).toBe(1000);
    expect(hook.countSessionMutationsSince(events, "B", anchorB)).toBe(3);
  });

  it("countBacklogSessions counts a dead (session_ended) neighbour with unarchived high-value work", () => {
    const now = 100 * HOUR_MS;
    const events = [
      hv("dead", now - 50 * HOUR_MS),
      mut("dead", now - 49 * HOUR_MS),
      makeEvent("session_ended", now - 48 * HOUR_MS, { session_id: "dead" }),
    ];
    expect(hook.countBacklogSessions(events, now, "current", 24)).toBe(1);
  });

  it("countBacklogSessions counts an idle neighbour past the idle horizon", () => {
    const now = 100 * HOUR_MS;
    const events = [
      hv("idle", now - 50 * HOUR_MS),
      mut("idle", now - 49 * HOUR_MS), // last activity 49h ago > 24h idle
    ];
    expect(hook.countBacklogSessions(events, now, "current", 24)).toBe(1);
  });

  it("countBacklogSessions excludes the current session", () => {
    const now = 100 * HOUR_MS;
    const events = [
      hv("current", now - 50 * HOUR_MS),
      mut("current", now - 49 * HOUR_MS),
      makeEvent("session_ended", now - 48 * HOUR_MS, { session_id: "current" }),
    ];
    expect(hook.countBacklogSessions(events, now, "current", 24)).toBe(0);
  });

  it("countBacklogSessions skips a still-active (not idle, not ended) neighbour", () => {
    const now = 100 * HOUR_MS;
    const events = [hv("live", now - 1 * HOUR_MS), mut("live", now - 30 * 60 * 1000)];
    expect(hook.countBacklogSessions(events, now, "current", 24)).toBe(0);
  });

  it("countBacklogSessions respects user_dismissed and the 12h cooldown", () => {
    const now = 100 * HOUR_MS;
    const dismissed = [
      hv("d", now - 50 * HOUR_MS),
      mut("d", now - 49 * HOUR_MS),
      makeEvent("session_ended", now - 48 * HOUR_MS, { session_id: "d" }),
      attempt("d", now - 40 * HOUR_MS, 0, "user_dismissed"),
    ];
    expect(hook.countBacklogSessions(dismissed, now, "current", 24)).toBe(0);

    const cooling = [
      hv("c", now - 50 * HOUR_MS),
      mut("c", now - 49 * HOUR_MS),
      makeEvent("session_ended", now - 48 * HOUR_MS, { session_id: "c" }),
      // attempted 6h ago (< 12h cooldown), new high-value since → still cooling.
      attempt("c", now - 6 * HOUR_MS, now - 49 * HOUR_MS),
      hv("c", now - 5 * HOUR_MS),
    ];
    expect(hook.countBacklogSessions(cooling, now, "current", 24)).toBe(0);
  });

  it("countBacklogSessions skips a dead session with no unarchived high-value work", () => {
    const now = 100 * HOUR_MS;
    const events = [
      // only file_mutated (not a high-value type) → value-gate fails.
      mut("dead", now - 50 * HOUR_MS),
      makeEvent("session_ended", now - 48 * HOUR_MS, { session_id: "dead" }),
    ];
    expect(hook.countBacklogSessions(events, now, "current", 24)).toBe(0);
  });
});

// rc.6 TASK-022 (E5): countEditsSince — edit-counter sidecar parser.
describe("fabric-hint.cjs — countEditsSince", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-edit-counter-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function seedEditCounter(root: string, isoLines: string[]): void {
    const dir = join(root, ".fabric", ".cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "edit-counter"),
      isoLines.map((l) => `${l}\n`).join(""),
      "utf8",
    );
  }

  it("returns 0 when edit-counter file does not exist", () => {
    expect(hook.countEditsSince(tempRoot, NOW_MS)).toBe(0);
  });

  it("counts only lines with ts > anchor (strict inequality)", () => {
    const anchor = NOW_MS - 10 * HOUR_MS;
    seedEditCounter(tempRoot, [
      new Date(anchor - 1 * HOUR_MS).toISOString(), // before anchor → excluded
      new Date(anchor).toISOString(), // equal to anchor → excluded (strict >)
      new Date(anchor + 1 * HOUR_MS).toISOString(), // after → counted
      new Date(anchor + 2 * HOUR_MS).toISOString(), // after → counted
    ]);
    expect(hook.countEditsSince(tempRoot, anchor)).toBe(2);
  });

  it("skips malformed lines but keeps surrounding valid ones", () => {
    const anchor = NOW_MS - 10 * HOUR_MS;
    seedEditCounter(tempRoot, [
      new Date(anchor + 1 * HOUR_MS).toISOString(),
      "not-an-iso-timestamp",
      "{{garbage",
      new Date(anchor + 2 * HOUR_MS).toISOString(),
      "", // blank line — also skipped silently
      new Date(anchor + 3 * HOUR_MS).toISOString(),
    ]);
    expect(hook.countEditsSince(tempRoot, anchor)).toBe(3);
  });

  it("counts all parseable lines when anchorTs is null (no anchor event)", () => {
    seedEditCounter(tempRoot, [
      new Date(NOW_MS - 5 * HOUR_MS).toISOString(),
      new Date(NOW_MS - 3 * HOUR_MS).toISOString(),
      new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
    ]);
    expect(hook.countEditsSince(tempRoot, null)).toBe(3);
  });
});

// rc.6 TASK-022 (E5): readArchiveEditThreshold — fabric-config.json reader.
describe("fabric-hint.cjs — readArchiveEditThreshold", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-edit-thresh-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns default 20 when config file is missing", () => {
    expect(hook.readArchiveEditThreshold(tempRoot)).toBe(20);
    expect(hook.readArchiveEditThreshold(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_ARCHIVE_EDIT_THRESHOLD,
    );
  });

  it("returns config override when present and positive", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ archive_edit_threshold: 50 }),
      "utf8",
    );
    expect(hook.readArchiveEditThreshold(tempRoot)).toBe(50);
  });

  it("falls back to default on non-positive override", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ archive_edit_threshold: -5 }),
      "utf8",
    );
    expect(hook.readArchiveEditThreshold(tempRoot)).toBe(20);
  });

  it("falls back to default on parse failure", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      "{not valid json",
      "utf8",
    );
    expect(hook.readArchiveEditThreshold(tempRoot)).toBe(20);
  });
});

// rc.6 TASK-022 (E5): end-to-end main() integration with edit-counter sidecar.
describe("fabric-hint.cjs — main (Signal A edit-count integration)", () => {
  let tempRoot: string;
  // v2.2 dual-sink (Goal A): the archive nudge now emits a SOFT dual-sink envelope
  // (systemMessage + additionalContext), not decision:block. Force cc so the
  // envelope lands on the captured stdout; restore after.
  let savedHintClient: string | undefined;
  let savedProjDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-main-edits-"));
    savedHintClient = process.env.FABRIC_HINT_CLIENT;
    savedProjDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(() => {
    if (savedHintClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
    else process.env.FABRIC_HINT_CLIENT = savedHintClient;
    if (savedProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjDir;
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  // crack 1: seed a per-session ledger. The archive trigger counts THIS
  // session's `file_mutated` events since its own anchor; the value-gate needs
  // an `edit_intent_checked` (high-value) past the anchor in the SAME session.
  // anchor = the session's session_archive_attempted watermark when present,
  // else its first ledger activity.
  function seedSessionLedger(
    root: string,
    sid: string,
    mutations: number,
    opts: { base?: number; watermark?: number; extra?: Record<string, unknown>[] } = {},
  ): void {
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const base = opts.base ?? NOW_MS - 5 * HOUR_MS;
    const lines: string[] = [
      // first ledger activity → the first-activity anchor when no watermark.
      JSON.stringify(makeEvent("edit_intent_checked", base, { session_id: sid, path: "src/anchor.ts" })),
    ];
    if (opts.watermark !== undefined) {
      lines.push(
        JSON.stringify(
          makeEvent("session_archive_attempted", opts.watermark, {
            session_id: sid,
            outcome: "proposed",
            covered_through_ts: opts.watermark,
            candidates_proposed: 1,
            knowledge_proposed_ids: ["k1"],
          }),
        ),
      );
    }
    const start = opts.watermark ?? base;
    // high-value signal AFTER the anchor so the value-gate passes.
    lines.push(
      JSON.stringify(makeEvent("edit_intent_checked", start + 30 * 1000, { session_id: sid, path: "src/hv.ts" })),
    );
    for (let i = 1; i <= mutations; i += 1) {
      lines.push(
        JSON.stringify(
          makeEvent("file_mutated", start + i * 60 * 1000, {
            session_id: sid,
            path: `src/f${i}.ts`,
            tool_call_id: `tc-${sid}-${i}`,
          }),
        ),
      );
    }
    for (const e of opts.extra ?? []) lines.push(JSON.stringify(e));
    writeFileSync(join(root, ".fabric", "events.jsonl"), `${lines.join("\n")}\n`, "utf8");
  }

  // v2.2 dual-sink (Goal A): extract the archive nudge reason text from the soft
  // dual-sink envelope (systemMessage == human; additionalContext == AI). The
  // legacy decision:block contract is gone for the archive signal (D3).
  function archiveEmit(writes: string[]): { systemMessage?: string; ai?: string } {
    const env = JSON.parse(writes[0] as string);
    return {
      systemMessage: env.systemMessage,
      ai: env.hookSpecificOutput ? env.hookSpecificOutput.additionalContext : undefined,
    };
  }

  it("fires archive signal (soft dual-sink) when 20 session mutations accumulate since the session anchor", () => {
    seedSessionLedger(tempRoot, "s1", 20);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

    expect(writes).toHaveLength(1);
    // v2.2 dual-sink (Goal A / D3): soft envelope, NOT decision:block.
    const emit = archiveEmit(writes);
    expect(JSON.parse(writes[0] as string).decision).toBeUndefined();
    // v2.2 C1 (W5): Stop human nudge is QUIET by default — the archive signal
    // lives in the always-on AI/observation sink + events.jsonl telemetry, not a
    // real-time human banner (opt back in via observe.stop=true / verbose).
    expect(emit.systemMessage).toBeUndefined(); // human sink gated quiet
    expect(emit.ai).toMatch(/20 次编辑/); // AI sink (always-on, observation)
  });

  it("crack 1 regression: a neighbour session's mutations do NOT count toward this session", () => {
    // Session s1 has 5 mutations (< 20); a busy neighbour s2 has 30. The old
    // session-blind counter would have summed to 35 and fired; the per-session
    // anchor must keep s1's archive nudge silent. nudge_mode silent mutes the
    // (orthogonal) human session-activity breadcrumb so we isolate the nudge.
    const base = NOW_MS - 5 * HOUR_MS;
    const extra: Record<string, unknown>[] = [
      makeEvent("edit_intent_checked", base + 10 * 1000, { session_id: "s2", path: "src/n.ts" }),
    ];
    for (let i = 1; i <= 30; i += 1) {
      extra.push(
        makeEvent("file_mutated", base + i * 60 * 1000, {
          session_id: "s2",
          path: `src/n${i}.ts`,
          tool_call_id: `tc-s2-${i}`,
        }),
      );
    }
    seedSessionLedger(tempRoot, "s1", 5, { base, extra });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ nudge_mode: "silent" }),
      "utf8",
    );

    const writes: string[] = [];
    hook.main(
      { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
      { stdout: { write: (c: string) => writes.push(c) } },
    );
    expect(writes).toEqual([]);
  });

  it("crack 1: this session's own archive watermark excludes pre-watermark mutations", () => {
    // s1 archived at watermark; 5 stale mutations sit BEFORE it, 20 fresh ones
    // AFTER. Only the 20 post-watermark mutations count.
    const base = NOW_MS - 8 * HOUR_MS;
    const watermark = NOW_MS - 5 * HOUR_MS;
    const extra: Record<string, unknown>[] = [];
    for (let i = 1; i <= 5; i += 1) {
      extra.push(
        makeEvent("file_mutated", base + i * 60 * 1000, {
          session_id: "s1",
          path: `src/stale${i}.ts`,
          tool_call_id: `tc-stale-${i}`,
        }),
      );
    }
    seedSessionLedger(tempRoot, "s1", 20, { base, watermark, extra });

    const writes: string[] = [];
    hook.main(
      { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
      { stdout: { write: (c: string) => writes.push(c) } },
    );
    expect(writes).toHaveLength(1);
    expect(archiveEmit(writes).ai).toMatch(/20 次编辑/); // W5: AI sink carries it; human quiet by default
  });

  it("appends per-store read-set label to the Stop hint reason (v2.1 P4, F4/S63)", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    seedSessionLedger(tempRoot, "s1", 20);
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: projectId }),
      "utf8",
    );

    const home = mkdtempSync(join(tmpdir(), "fabric-hint-store-home-"));
    const prevHome = process.env.FABRIC_HOME;
    process.env.FABRIC_HOME = home;
    mkdirSync(join(home, ".fabric", "state", "bindings"), { recursive: true });
    writeFileSync(
      join(home, ".fabric", "state", "bindings", `${projectId}_resolved.json`),
      JSON.stringify({
        version: 1,
        project_id: projectId,
        generated_at: "2026-05-30T00:00:00.000Z",
        read_set: {
          stores: [
            { store_uuid: "p", alias: "personal", writable: true },
            { store_uuid: "t", alias: "team", writable: true },
          ],
          warnings: [],
        },
        write_target: { store_uuid: "t", alias: "team" },
      }),
      "utf8",
    );
    try {
      const writes: string[] = [];
      hook.main(
        { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
        { stdout: { write: (c: string) => writes.push(c) } },
      );
      expect(writes).toHaveLength(1);
      const emit = archiveEmit(writes);
      expect(emit.ai).toContain("read-set stores:"); // W5: reason on AI sink; human quiet by default
      expect(emit.ai).toContain("team (write)");
    } finally {
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("stays silent when 19 session mutations accumulate (just below default threshold 20)", () => {
    seedSessionLedger(tempRoot, "s1", 19);
    // Mute the orthogonal human activity breadcrumb so we isolate the nudge.
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ nudge_mode: "silent" }),
      "utf8",
    );

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

    expect(writes).toEqual([]);
  });

  it("stays silent when the session has no file_mutated activity", () => {
    // edit_intent_checked anchor + high-value but zero file_mutated → nothing to
    // count → no trigger (the per-session safe-degrade contract).
    seedSessionLedger(tempRoot, "s1", 0);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

    expect(writes).toEqual([]);
  });

  it("honours custom archive_edit_threshold=10 from fabric-config.json", () => {
    seedSessionLedger(tempRoot, "s1", 10, { base: NOW_MS - 2 * HOUR_MS });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ archive_edit_threshold: 10 }),
      "utf8",
    );

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

    expect(writes).toHaveLength(1);
    // soft dual-sink envelope carries the archive reason (no decision:block).
    // W5: AI sink carries it; the human banner is quiet by default.
    expect(archiveEmit(writes).ai).toMatch(/fabric-archive/);
  });
});

describe("fabric-hint.cjs — main", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-archive-hint-main-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("emits the SOFT archive dual-sink envelope (no decision:block) when the session crosses the edit threshold", () => {
    // v2.2 dual-sink (Goal A / D3): the archive nudge is a soft envelope
    // (systemMessage + additionalContext), never decision:block. crack 1: the
    // trigger is now per-session file_mutated count, not the global 24h timer.
    const prevClient = process.env.FABRIC_HINT_CLIENT;
    const prevProjDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
      const base = NOW_MS - 5 * HOUR_MS;
      const lines = [
        JSON.stringify(makeEvent("edit_intent_checked", base, { session_id: "s1", path: "src/anchor.ts" })),
        JSON.stringify(makeEvent("edit_intent_checked", base + 30 * 1000, { session_id: "s1", path: "src/hv.ts" })),
      ];
      for (let i = 1; i <= 20; i += 1) {
        lines.push(
          JSON.stringify(
            makeEvent("file_mutated", base + i * 60 * 1000, {
              session_id: "s1",
              path: `src/f${i}.ts`,
              tool_call_id: `tc-${i}`,
            }),
          ),
        );
      }
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${lines.join("\n")}\n`, "utf8");

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

      expect(writes).toHaveLength(1);
      const env = JSON.parse(writes[0] as string);
      expect(env.decision).toBeUndefined(); // NOT a block contract
      // W5: human sink quiet by default; AI sink (always-on) carries the reason.
      expect(env.systemMessage).toBeUndefined(); // human sink gated quiet
      expect(env.hookSpecificOutput.additionalContext).toMatch(/fabric-archive/); // AI sink
    } finally {
      if (prevClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
      else process.env.FABRIC_HINT_CLIENT = prevClient;
      if (prevProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prevProjDir;
    }
  });

  it("writes nothing to stdout on no-trigger (silent exit 0 path)", () => {
    // No .fabric/ directory at all → ENOENT → readLedger returns [] → decide returns null.
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    expect(writes).toEqual([]);
  });
});

// rc.3 TASK-004 — second-signal (pending-overflow → fabric-review skill)
const DAY_MS = 24 * 60 * 60 * 1000;

function seedPendingFile(
  root: string,
  type: string,
  slug: string,
  mtimeMs?: number,
): string {
  const dir = join(root, ".fabric", "knowledge", "pending", type);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.md`);
  writeFileSync(filePath, `# ${slug}\n`, "utf8");
  if (typeof mtimeMs === "number") {
    const seconds = mtimeMs / 1000;
    utimesSync(filePath, seconds, seconds);
  }
  return filePath;
}

describe("fabric-hint.cjs — readPendingStats", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-archive-hint-pending-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns {count:0, oldestAgeMs:null} when pending dir does not exist", () => {
    const stats = hook.readPendingStats(tempRoot, FIXED_NOW);
    expect(stats).toEqual({ count: 0, oldestAgeMs: null });
  });

  it("walks all five pending type subdirs and counts only .md files", () => {
    seedPendingFile(tempRoot, "decisions", "d1", NOW_MS - 1 * DAY_MS);
    seedPendingFile(tempRoot, "pitfalls", "p1", NOW_MS - 2 * DAY_MS);
    seedPendingFile(tempRoot, "guidelines", "g1", NOW_MS - 3 * DAY_MS);
    seedPendingFile(tempRoot, "models", "m1", NOW_MS - 4 * DAY_MS);
    seedPendingFile(tempRoot, "processes", "pr1", NOW_MS - 5 * DAY_MS);
    // Non-.md noise — must be ignored.
    const decisionsDir = join(
      tempRoot,
      ".fabric",
      "knowledge",
      "pending",
      "decisions",
    );
    writeFileSync(join(decisionsDir, "README.txt"), "ignore me", "utf8");

    const stats = hook.readPendingStats(tempRoot, FIXED_NOW);
    expect(stats.count).toBe(5);
    // Oldest is the 5-day-old processes file.
    expect(stats.oldestAgeMs).not.toBeNull();
    const ageDays = (stats.oldestAgeMs as number) / DAY_MS;
    expect(ageDays).toBeGreaterThanOrEqual(4.99);
    expect(ageDays).toBeLessThanOrEqual(5.01);
  });

  it("returns oldest mtime correctly when multiple files exist in same type", () => {
    seedPendingFile(tempRoot, "decisions", "d-newest", NOW_MS - 1 * DAY_MS);
    seedPendingFile(tempRoot, "decisions", "d-oldest", NOW_MS - 9 * DAY_MS);
    seedPendingFile(tempRoot, "decisions", "d-middle", NOW_MS - 5 * DAY_MS);

    const stats = hook.readPendingStats(tempRoot, FIXED_NOW);
    expect(stats.count).toBe(3);
    const ageDays = (stats.oldestAgeMs as number) / DAY_MS;
    expect(ageDays).toBeGreaterThanOrEqual(8.99);
    expect(ageDays).toBeLessThanOrEqual(9.01);
  });

  it("ignores project-local pending leftovers for store-era projects without snapshot stats", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    writeProjectConfig(tempRoot, projectId);
    seedPendingFile(
      tempRoot,
      "decisions",
      "local-leftover",
      NOW_MS - 9 * DAY_MS,
    );

    withIsolatedFabricHome(() => {
      const stats = hook.readPendingStats(tempRoot, FIXED_NOW);
      expect(stats).toEqual({ count: 0, oldestAgeMs: null });
    });
  });

  it("reads pending stats from resolved-bindings snapshot for store-era projects", () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    writeProjectConfig(tempRoot, projectId);
    seedPendingFile(
      tempRoot,
      "decisions",
      "local-leftover",
      NOW_MS - 2 * DAY_MS,
    );

    withIsolatedFabricHome((home) => {
      writeBindingsSnapshot(home, projectId, {
        pending_count: 12,
        oldest_pending_mtime_ms: NOW_MS - 8 * DAY_MS,
        canonical_count: 3,
      });

      const stats = hook.readPendingStats(tempRoot, FIXED_NOW);
      expect(stats.count).toBe(12);
      expect(stats.oldestAgeMs).toBe(8 * DAY_MS);
    });
  });
});

describe("fabric-hint.cjs — decide (review signal)", () => {
  it("returns null when no archive trigger and no pending entries (NEW-1)", () => {
    const result = hook.decide([], FIXED_NOW, { count: 0, oldestAgeMs: null });
    expect(result).toBeNull();
  });

  it("returns null when 9 pending entries (just below count threshold) and ages <7d (NEW-2)", () => {
    const result = hook.decide([], FIXED_NOW, {
      count: 9,
      oldestAgeMs: 1 * DAY_MS,
    });
    expect(result).toBeNull();
  });

  it("returns review signal when pending count >= 10 (NEW-3)", () => {
    const result = hook.decide([], FIXED_NOW, {
      count: 10,
      oldestAgeMs: 1 * DAY_MS,
    });
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("soft");
    expect(result?.signal).toBe("review");
    expect(result?.reason).toMatch(/fabric-review/);
    expect(result?.reason).toMatch(/10/);
  });

  it("returns review signal when oldest pending age >= 7 days (NEW-4)", () => {
    const result = hook.decide([], FIXED_NOW, {
      count: 5,
      oldestAgeMs: 8 * DAY_MS,
    });
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("soft");
    expect(result?.signal).toBe("review");
    expect(result?.reason).toMatch(/fabric-review/);
  });

  it("returns null when 5 pending entries and oldest <7 days (NEW-5)", () => {
    const result = hook.decide([], FIXED_NOW, {
      count: 5,
      oldestAgeMs: 3 * DAY_MS,
    });
    expect(result).toBeNull();
  });

  it("archive precedence: in-session archive wins when both archive AND review triggers fire (NEW-6)", () => {
    // crack 1: archive now fires on the per-session edit count, not the 24h
    // timer. Pending stats also trigger review; in-session archive must win.
    const result = hook.decide(
      [],
      FIXED_NOW,
      { count: 12, oldestAgeMs: 9 * DAY_MS },
      undefined,
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
    );
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("soft");
    expect(result?.signal).toBe("archive");
    expect(result?.reason).toMatch(/fabric-archive/);
    expect(result?.reason).not.toMatch(/fabric-review/);
  });
});

describe("fabric-hint.cjs — main (review signal integration)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-archive-hint-review-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("emits the SOFT review dual-sink envelope (no decision:block) when pending count >= 10 and no archive trigger", () => {
    // ux-w0-3 (KT-DEC-0007): review is now a soft nudge (additionalContext, human
    // gated by nudge_mode), never decision:block.
    const prevClient = process.env.FABRIC_HINT_CLIENT;
    process.env.FABRIC_HINT_CLIENT = "cc";
    try {
      for (let i = 0; i < 10; i += 1) {
        seedPendingFile(tempRoot, "decisions", `d-${i}`, NOW_MS - 1 * DAY_MS);
      }

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const env = JSON.parse(writes[0] as string);
      expect(env.decision).toBeUndefined(); // NOT a block contract
      expect(env.hookSpecificOutput.additionalContext).toMatch(/fabric-review/); // AI sink
    } finally {
      if (prevClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
      else process.env.FABRIC_HINT_CLIENT = prevClient;
    }
  });

  it("silent exit 0 when pending dir does not exist and no events (NEW-7)", () => {
    // Empty tmp dir — no .fabric/ at all.
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    expect(() =>
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout }),
    ).not.toThrow();
    expect(writes).toEqual([]);
  });
});

// rc.5 TASK-010 — third-signal (underseeded-corpus → fabric-import skill).

function seedCanonicalFile(
  root: string,
  type: string,
  slug: string,
): string {
  const dir = join(root, ".fabric", "knowledge", type);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.md`);
  writeFileSync(filePath, `# ${slug}\n`, "utf8");
  return filePath;
}

describe("fabric-hint.cjs — countCanonicalNodes", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-count-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns 0 when no resolved-bindings snapshot exists (store-only cutover)", () => {
    // No fabric-config binding + no snapshot → store path degrades to 0.
    // The legacy project-local .fabric/knowledge walk is retired.
    expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
  });

  it("ignores project-local canonical leftovers for store-era projects without snapshot stats", () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    writeProjectConfig(tempRoot, projectId);
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0001--leftover");

    withIsolatedFabricHome(() => {
      expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
    });
  });

  it("reads canonical count from resolved-bindings snapshot for store-era projects", () => {
    const projectId = "55555555-5555-4555-8555-555555555555";
    writeProjectConfig(tempRoot, projectId);
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0001--leftover");

    withIsolatedFabricHome((home) => {
      writeBindingsSnapshot(home, projectId, { canonical_count: 9 });
      expect(hook.countCanonicalNodes(tempRoot)).toBe(9);
    });
  });
});

describe("fabric-hint.cjs — decide (import signal)", () => {
  const initTs = NOW_MS - 48 * HOUR_MS; // 48h before NOW — past the 24h post-init quiet window
  const initEvent = makeEvent("init_scan_completed", initTs);

  it("returns null when node count >= threshold even with quiet init", () => {
    const result = hook.decide([initEvent], FIXED_NOW, undefined, {
      nodeCount: 10,
      threshold: 10,
    });
    expect(result).toBeNull();
  });

  it("returns null when no init_scan_completed event recorded", () => {
    const result = hook.decide([], FIXED_NOW, undefined, {
      nodeCount: 3,
      threshold: 10,
    });
    expect(result).toBeNull();
  });

  it("returns null when init_scan_completed <24h ago", () => {
    const recentInit = makeEvent("init_scan_completed", NOW_MS - 5 * HOUR_MS);
    const result = hook.decide([recentInit], FIXED_NOW, undefined, {
      nodeCount: 2,
      threshold: 10,
    });
    expect(result).toBeNull();
  });

  it("returns import signal when node count < threshold AND init >=24h AND no recent knowledge_proposed", () => {
    const result = hook.decide([initEvent], FIXED_NOW, undefined, {
      nodeCount: 4,
      threshold: 10,
    });
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("soft");
    expect(result?.signal).toBe("import");
    expect(result?.recommended_skill).toBe("fabric-import");
    expect(result?.reason).toMatch(/fabric-import/);
    expect(result?.reason).toMatch(/4/);
  });

  it("returns null when knowledge_proposed <24h ago even with sparse corpus", () => {
    const recentProposed = makeEvent("knowledge_proposed", NOW_MS - 2 * HOUR_MS, {
      timestamp: new Date(NOW_MS - 2 * HOUR_MS).toISOString(),
    });
    // No archive trigger (only 1 plan_context, <5 threshold). But the
    // knowledge_proposed-within-24h guard MUST suppress the import signal.
    const result = hook.decide([initEvent, recentProposed], FIXED_NOW, undefined, {
      nodeCount: 4,
      threshold: 10,
    });
    expect(result).toBeNull();
  });

  it("archive precedence: in-session archive wins when both archive AND import triggers fire", () => {
    // crack 1: archive fires on the per-session edit count. A sparse corpus +
    // init >=24h ago + knowledge_proposed >24h ago would also trigger import,
    // but in-session archive supersedes it.
    const events: Array<Record<string, unknown>> = [
      initEvent,
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    const result = hook.decide(
      events,
      FIXED_NOW,
      undefined,
      { nodeCount: 1, threshold: 10 },
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
    );
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
    expect(result?.recommended_skill).toBe("fabric-archive");
  });

  it("review precedence: review wins when both review AND import triggers fire", () => {
    // No archive trigger. Pending count 10 → review fires. Sparse corpus.
    const result = hook.decide([initEvent], FIXED_NOW, {
      count: 10,
      oldestAgeMs: 1 * 24 * 60 * 60 * 1000,
    }, {
      nodeCount: 1,
      threshold: 10,
    });
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("review");
    expect(result?.recommended_skill).toBe("fabric-review");
  });

  it("includes recommended_skill='fabric-archive' on archive trigger", () => {
    const result = hook.decide([], FIXED_NOW, undefined, undefined, {
      editsSinceArchive: 20,
      threshold: 20,
      anchorPresent: true,
    });
    expect(result?.recommended_skill).toBe("fabric-archive");
  });

  it("includes recommended_skill='fabric-review' on review trigger", () => {
    const result = hook.decide([], FIXED_NOW, { count: 10, oldestAgeMs: null });
    expect(result?.recommended_skill).toBe("fabric-review");
  });
});

describe("fabric-hint.cjs — readUnderseedThreshold", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-config-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns default 10 when config file is missing", () => {
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(10);
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_UNDERSEED_NODE_THRESHOLD,
    );
  });

  it("returns config override when present and positive", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ underseed_node_threshold: 25 }),
      "utf8",
    );
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(25);
  });

  it("falls back to default when override is non-positive", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ underseed_node_threshold: 0 }),
      "utf8",
    );
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(10);
  });

  it("falls back to default on parse failure", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      "{{not valid json",
      "utf8",
    );
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(10);
  });
});

describe("fabric-hint.cjs — main (import signal integration)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-import-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  // Store-only cutover: canonical count comes from the resolved-bindings
  // snapshot under an isolated FABRIC_HOME, not a project-local .fabric/knowledge
  // walk. Workspace is bound via fabric-config.json project_id.
  const PROJECT_ID = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

  it("emits the SOFT import dual-sink envelope (no decision:block) on underseeded corpus", () => {
    // ux-w0-3 (KT-DEC-0007): import is now a soft nudge, never decision:block.
    const prevClient = process.env.FABRIC_HINT_CLIENT;
    process.env.FABRIC_HINT_CLIENT = "cc";
    try {
      withIsolatedFabricHome((home) => {
        writeProjectConfig(tempRoot, PROJECT_ID);
        // Seed an init_scan_completed event 48h before NOW.
        const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
        writeFileSync(
          join(tempRoot, ".fabric", "events.jsonl"),
          `${JSON.stringify(initEvent)}\n`,
          "utf8",
        );
        // 3 canonical entries (< default threshold 10) via snapshot stats.
        writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 3 });

        const writes: string[] = [];
        const stdout = { write: (chunk: string) => writes.push(chunk) };
        hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

        expect(writes).toHaveLength(1);
        const env = JSON.parse(writes[0] as string);
        expect(env.decision).toBeUndefined(); // NOT a block contract
        expect(env.hookSpecificOutput.additionalContext).toMatch(/fabric-import/); // AI sink
        expect(env.hookSpecificOutput.additionalContext).toMatch(/3\/10/);
      });
    } finally {
      if (prevClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
      else process.env.FABRIC_HINT_CLIENT = prevClient;
    }
  });

  it("silent exit 0 when corpus is well-seeded (>= threshold)", () => {
    withIsolatedFabricHome((home) => {
      writeProjectConfig(tempRoot, PROJECT_ID);
      const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
      // rc.7 T10: also seed a recent doctor_run so Signal D stays silent;
      // otherwise a well-seeded workspace with no doctor_run history would
      // (correctly) trip the maintenance signal and this test would no longer
      // assert silence.
      const recentDoctor = makeEvent("doctor_run", NOW_MS - 1 * HOUR_MS, {
        mode: "lint",
        issues: 0,
        timestamp: new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
      });
      writeFileSync(
        join(tempRoot, ".fabric", "events.jsonl"),
        `${JSON.stringify(initEvent)}\n${JSON.stringify(recentDoctor)}\n`,
        "utf8",
      );
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 12 });

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toEqual([]);
    });
  });

  it("honours custom underseed_node_threshold from fabric-config.json", () => {
    withIsolatedFabricHome((home) => {
      writeProjectConfig(tempRoot, PROJECT_ID);
      // merge the threshold override into the bound fabric-config.json
      writeFileSync(
        join(tempRoot, ".fabric", "fabric-config.json"),
        JSON.stringify({
          project_id: PROJECT_ID,
          fabric_language: "en",
          underseed_node_threshold: 3,
        }),
        "utf8",
      );
      const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
      writeFileSync(
        join(tempRoot, ".fabric", "events.jsonl"),
        `${JSON.stringify(initEvent)}\n`,
        "utf8",
      );
      // 2 canonical entries: < threshold(3) so import fires.
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const payload = JSON.parse(writes[0] as string) as { signal: string };
      expect(payload.signal).toBe("import");
    });
  });
});

// ---------------------------------------------------------------------------
// rc.7 T7: externalized hook-threshold readers
// ---------------------------------------------------------------------------

describe("fabric-hint.cjs — rc.7 T7 externalized threshold readers", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-t7-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("readArchiveHintHours returns default 24 when config file is missing", () => {
    expect(hook.readArchiveHintHours(tempRoot)).toBe(24);
    expect(hook.readArchiveHintHours(tempRoot)).toBe(hook.CONSTANTS.DEFAULT_ARCHIVE_HINT_HOURS);
  });

  it("readArchiveHintHours honors archive_hint_hours override", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ archive_hint_hours: 48 }),
      "utf8",
    );
    expect(hook.readArchiveHintHours(tempRoot)).toBe(48);
  });

  it("readReviewHintPendingCount returns default 10 when config file is missing", () => {
    expect(hook.readReviewHintPendingCount(tempRoot)).toBe(10);
    expect(hook.readReviewHintPendingCount(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_REVIEW_HINT_PENDING_COUNT,
    );
  });

  it("readReviewHintPendingAgeDays returns default 7 when config file is missing", () => {
    expect(hook.readReviewHintPendingAgeDays(tempRoot)).toBe(7);
  });

  it("readMaintenanceHintDays returns default 14 when config file is missing", () => {
    expect(hook.readMaintenanceHintDays(tempRoot)).toBe(14);
    expect(hook.readMaintenanceHintDays(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_MAINTENANCE_HINT_DAYS,
    );
  });

  it("readMaintenanceHintCooldownDays returns default 7 when config file is missing", () => {
    expect(hook.readMaintenanceHintCooldownDays(tempRoot)).toBe(7);
    expect(hook.readMaintenanceHintCooldownDays(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
    );
  });

  it("readers fall back to defaults when config file is malformed JSON", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(join(tempRoot, ".fabric", "fabric-config.json"), "{{not json", "utf8");
    expect(hook.readArchiveHintHours(tempRoot)).toBe(24);
    expect(hook.readReviewHintPendingCount(tempRoot)).toBe(10);
    expect(hook.readReviewHintPendingAgeDays(tempRoot)).toBe(7);
    expect(hook.readMaintenanceHintDays(tempRoot)).toBe(14);
    expect(hook.readMaintenanceHintCooldownDays(tempRoot)).toBe(7);
  });

  it("readers fall back to defaults when override is non-positive", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({
        archive_hint_hours: 0,
        review_hint_pending_count: -1,
        review_hint_pending_age_days: "seven",
        maintenance_hint_days: 0,
        maintenance_hint_cooldown_days: null,
      }),
      "utf8",
    );
    expect(hook.readArchiveHintHours(tempRoot)).toBe(24);
    expect(hook.readReviewHintPendingCount(tempRoot)).toBe(10);
    expect(hook.readReviewHintPendingAgeDays(tempRoot)).toBe(7);
    expect(hook.readMaintenanceHintDays(tempRoot)).toBe(14);
    expect(hook.readMaintenanceHintCooldownDays(tempRoot)).toBe(7);
  });

  it("archive_hint_hours is retired — a 25h-old knowledge_proposed no longer triggers archive (crack 2)", () => {
    // The global 24h timer moved to the archive_backlog signal. A stale
    // knowledge_proposed with no per-session edit count stays silent regardless
    // of archive_hint_hours (the knob no longer drives Signal A).
    const events = [makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS)];
    const result = hook.decide(
      events,
      FIXED_NOW,
      { count: 0, oldestAgeMs: null },
      { nodeCount: 50, threshold: 10 },
      { editsSinceArchive: 0, threshold: 20, anchorPresent: false },
      { archiveHintHours: 24 },
    );
    expect(result).toBeNull();
  });

  it("decide threads externalized reviewHintPendingCount through Signal B trigger", () => {
    // 11 pending entries; default threshold 10 → fires. Raise threshold to
    // 20 → signal stays silent (no other triggers).
    const result = hook.decide(
      [],
      FIXED_NOW,
      { count: 11, oldestAgeMs: 1000 },
      { nodeCount: 50, threshold: 10 },
      { editsSinceArchive: 0, threshold: 20, anchorPresent: false },
      { reviewHintPendingCount: 20 },
    );
    expect(result).toBeNull();
  });

  it("decide uses defaults when thresholds arg is omitted (back-compat) — fires on per-session edits", () => {
    // Pre-T7 call shape: no thresholds arg. crack 1: archive fires on the
    // per-session edit count, so the default-threshold path is exercised via
    // editStats rather than the retired 24h timer.
    const result = hook.decide(
      [],
      FIXED_NOW,
      { count: 0, oldestAgeMs: null },
      { nodeCount: 50, threshold: 10 },
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
    );
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
  });
});

// ---------------------------------------------------------------------------
// rc.7 T10 — Signal D (maintenance hint) + doctor_run event integration.
// ---------------------------------------------------------------------------

describe("fabric-hint.cjs — evaluateMaintenanceSignal (rc.7 T10)", () => {
  it("returns null when canonical_count < 5 (fresh workspace has nothing to lint)", () => {
    const result = hook.evaluateMaintenanceSignal([], FIXED_NOW, 3, null);
    expect(result).toBeNull();
  });

  it("returns null when last doctor_run was within maintenance_hint_days", () => {
    const recentDoctor = NOW_MS - 5 * DAY_MS; // 5d ago, threshold 14d → silent
    const events = [makeEvent("doctor_run", recentDoctor)];
    const result = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, null);
    expect(result).toBeNull();
  });

  it("fires when doctor_run >= maintenance_hint_days AND canonical_count >= 5", () => {
    const staleDoctor = NOW_MS - 20 * DAY_MS; // 20d ago, threshold 14d → fires
    const events = [makeEvent("doctor_run", staleDoctor)];
    const result = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, null);
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("maintenance");
    expect(result?.recommended_skill).toBeNull();
    expect(result?.reason).toMatch(/已 14 天未跑 lint/);
    expect(result?.reason).toMatch(/fabric doctor --lint/);
  });

  it("fires when no doctor_run event has ever been recorded AND canonical_count >= 5", () => {
    const result = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("maintenance");
    // Different message branch for the "never ran" case.
    expect(result?.reason).toMatch(/从未运行 lint 检查/);
  });

  it("respects cooldown sidecar: silent within cooldown_days of last emit", () => {
    // Doctor_run >14d ago triggers, but Signal D was emitted 3d ago — silent
    // due to 7d default cooldown.
    const staleDoctor = NOW_MS - 30 * DAY_MS;
    const recentEmit = NOW_MS - 3 * DAY_MS;
    const events = [makeEvent("doctor_run", staleDoctor)];
    const result = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, recentEmit);
    expect(result).toBeNull();
  });

  it("re-fires after cooldown elapses (8d > 7d default cooldown)", () => {
    const staleDoctor = NOW_MS - 30 * DAY_MS;
    const oldEmit = NOW_MS - 8 * DAY_MS;
    const events = [makeEvent("doctor_run", staleDoctor)];
    const result = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, oldEmit);
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("maintenance");
  });

  it("honours custom maintenance_hint_days override", () => {
    // 10d-old doctor_run; default 14d would be silent, but custom 7d fires.
    const doctorTs = NOW_MS - 10 * DAY_MS;
    const events = [makeEvent("doctor_run", doctorTs)];
    const silent = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, null, {
      maintenanceHintDays: 14,
    });
    expect(silent).toBeNull();
    const fired = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, null, {
      maintenanceHintDays: 7,
    });
    expect(fired).not.toBeNull();
    expect(fired?.signal).toBe("maintenance");
  });

  it("honours custom maintenance_hint_cooldown_days override (1d cooldown re-fires faster)", () => {
    const staleDoctor = NOW_MS - 30 * DAY_MS;
    const recentEmit = NOW_MS - 2 * DAY_MS; // 2d ago
    const events = [makeEvent("doctor_run", staleDoctor)];
    // 7d default cooldown → silent
    expect(
      hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, recentEmit),
    ).toBeNull();
    // 1d override → fires
    const r = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, recentEmit, {
      maintenanceHintCooldownDays: 1,
    });
    expect(r).not.toBeNull();
    expect(r?.signal).toBe("maintenance");
  });

  it("rc.34 TASK-01 + review-fix: future-stamped lastEmit (backward clock skew) bypasses cooldown — fires immediately", () => {
    // Scenario: laptop wakes from suspend, NTP corrects clock backward, or
    // user crosses TZ boundary. The cooldown sidecar's lastEmitMs is now in
    // the "future" relative to nowMs (delta < 0).
    //
    // Contract (post Gemini P1 review-fix): future-stamped sidecar is treated
    // as expired — gate FIRES on the next invocation so the signal heals
    // immediately instead of waiting (cooldown + |skew|) real-time. Pre-fix
    // (Math.max(0, …)) was a no-op that left silence at cooldown + |skew|;
    // current logic uses `nowMs >= lastEmitMs && delta < cooldown` so the
    // first conjunct short-circuits false on backward skew.
    const staleDoctor = NOW_MS - 30 * DAY_MS;
    const futureEmit = NOW_MS + 6 * HOUR_MS; // 6h forward = backward clock skew
    const events = [makeEvent("doctor_run", staleDoctor)];

    expect(() =>
      hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, futureEmit),
    ).not.toThrow();

    // Backward skew should FIRE (not stay silent for cooldown + skew window).
    const result = hook.evaluateMaintenanceSignal(events, FIXED_NOW, 10, futureEmit);
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("maintenance");
  });
});

describe("fabric-hint.cjs — findLastDoctorRunTs (rc.7 T10)", () => {
  it("returns null on empty ledger", () => {
    expect(hook.findLastDoctorRunTs([])).toBeNull();
  });

  it("returns null when no doctor_run event exists", () => {
    const events = [
      makeEvent("knowledge_proposed", 100),
      makeEvent("knowledge_context_planned", 200),
    ];
    expect(hook.findLastDoctorRunTs(events)).toBeNull();
  });

  it("returns the most recent doctor_run ts (tail-first scan)", () => {
    const events = [
      makeEvent("doctor_run", 100),
      makeEvent("knowledge_proposed", 200),
      makeEvent("doctor_run", 300),
      makeEvent("knowledge_proposed", 400),
    ];
    expect(hook.findLastDoctorRunTs(events)).toBe(300);
  });
});

describe("fabric-hint.cjs — main (Signal D end-to-end, rc.7 T10)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-sigd-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  // Store-only cutover: canonical count comes from the resolved-bindings
  // snapshot under an isolated FABRIC_HOME. bindCanonical binds the workspace
  // (fabric-config project_id) and writes the snapshot canonical_count.
  const PROJECT_ID = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
  function bindCanonical(home: string, count: number): void {
    writeProjectConfig(tempRoot, PROJECT_ID);
    writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: count });
  }

  it("emits Signal D when no doctor_run ever AND canonical >= 5", () => {
    withIsolatedFabricHome((home) => {
      // Bind WITHOUT forcing fabric_language so the reason renders in the
      // default locale (this test asserts the localized reason string).
      mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
      writeFileSync(
        join(tempRoot, ".fabric", "fabric-config.json"),
        JSON.stringify({ project_id: PROJECT_ID }),
        "utf8",
      );
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 5 });
      // Empty events.jsonl is fine — no doctor_run, no archive triggers.
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), "", "utf8");

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const payload = JSON.parse(writes[0] as string) as {
        signal: string;
        recommended_skill: unknown;
        reason: string;
      };
      expect(payload.signal).toBe("maintenance");
      expect(payload.recommended_skill).toBeNull();
      expect(payload.reason).toMatch(/从未运行 lint 检查/);
      // Cooldown sidecar written.
      const sidecar = join(tempRoot, ".fabric", ".cache", "maintenance-hint-last-emit");
      expect(existsSync(sidecar)).toBe(true);
    });
  });

  // F13 (ISS-20260531-038): the cooldown sidecar must be session-scoped so a
  // nudge fired in one window does not silence the same nudge in a concurrent
  // window. Two distinct sessionIds get independent sidecars; an absent
  // sessionId keeps the legacy non-scoped path (upgrade compatibility).
  it("F13: maintenance cooldown sidecar is session-scoped (concurrent windows independent)", () => {
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    const tStamp = NOW_MS - 1000;

    hook.writeMaintenanceLastEmit(tempRoot, tStamp, "session-A");
    // Window A's emit is visible to A...
    expect(hook.readMaintenanceLastEmit(tempRoot, "session-A")).toBe(tStamp);
    // ...but NOT to window B (B would still fire its own nudge).
    expect(hook.readMaintenanceLastEmit(tempRoot, "session-B")).toBeNull();
    // The scoped file exists; the legacy non-scoped file was NOT written.
    expect(existsSync(join(tempRoot, ".fabric", ".cache", "maintenance-hint-last-emit-session-A"))).toBe(true);
    expect(existsSync(join(tempRoot, ".fabric", ".cache", "maintenance-hint-last-emit"))).toBe(false);

    // Backward-compat: a null sessionId still uses the legacy non-scoped path.
    hook.writeMaintenanceLastEmit(tempRoot, tStamp, null);
    expect(existsSync(join(tempRoot, ".fabric", ".cache", "maintenance-hint-last-emit"))).toBe(true);
    expect(hook.readMaintenanceLastEmit(tempRoot, null)).toBe(tStamp);
  });

  it("does NOT fire Signal D when canonical < 5 (fresh-init guard)", () => {
    withIsolatedFabricHome((home) => {
      bindCanonical(home, 3); // below threshold
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), "", "utf8");

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
      expect(writes).toEqual([]);
    });
  });

  it("does NOT fire Signal D when doctor_run < 14d ago", () => {
    withIsolatedFabricHome((home) => {
      bindCanonical(home, 10);
      const recentDoctor = NOW_MS - 5 * DAY_MS;
      const line = JSON.stringify(makeEvent("doctor_run", recentDoctor));
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${line}\n`, "utf8");

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
      expect(writes).toEqual([]);
    });
  });

  it("does NOT re-fire Signal D within 7d cooldown (sidecar present)", () => {
    withIsolatedFabricHome((home) => {
      bindCanonical(home, 10);
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), "", "utf8");

      // Sidecar: emitted 3d ago.
      const sidecarDir = join(tempRoot, ".fabric", ".cache");
      mkdirSync(sidecarDir, { recursive: true });
      writeFileSync(
        join(sidecarDir, "maintenance-hint-last-emit"),
        new Date(NOW_MS - 3 * DAY_MS).toISOString(),
        "utf8",
      );

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
      expect(writes).toEqual([]);
    });
  });

  it("emits Signal D AFTER A/B/C are silent (precedence: maintenance is last)", () => {
    // Build a workspace where:
    //   - knowledge_proposed fired 5h ago (Signal A silent)
    //   - 0 pending entries (Signal B silent)
    //   - init_scan_completed 2d ago, 50 canonical entries (Signal C silent)
    //   - No doctor_run event (Signal D fires)
    withIsolatedFabricHome((home) => {
      bindCanonical(home, 50);
      const proposedTs = NOW_MS - 5 * HOUR_MS;
      const initTs = NOW_MS - 2 * DAY_MS;
      const lines = [
        JSON.stringify(makeEvent("init_scan_completed", initTs)),
        JSON.stringify(makeEvent("knowledge_proposed", proposedTs)),
      ];
      writeFileSync(
        join(tempRoot, ".fabric", "events.jsonl"),
        lines.map((l) => `${l}\n`).join(""),
        "utf8",
      );

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const payload = JSON.parse(writes[0] as string) as { signal: string };
      expect(payload.signal).toBe("maintenance");
    });
  });

  it("honours fabric-config.json maintenance_hint_days override", () => {
    withIsolatedFabricHome((home) => {
      // Doctor ran 10d ago; default 14d → silent. Override 7d → fires.
      writeProjectConfig(tempRoot, PROJECT_ID);
      writeFileSync(
        join(tempRoot, ".fabric", "fabric-config.json"),
        JSON.stringify({
          project_id: PROJECT_ID,
          fabric_language: "en",
          maintenance_hint_days: 7,
        }),
        "utf8",
      );
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 10 });
      const doctorTs = NOW_MS - 10 * DAY_MS;
      writeFileSync(
        join(tempRoot, ".fabric", "events.jsonl"),
        `${JSON.stringify(makeEvent("doctor_run", doctorTs))}\n`,
        "utf8",
      );

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
      expect(writes).toHaveLength(1);
      const payload = JSON.parse(writes[0] as string) as { signal: string };
      expect(payload.signal).toBe("maintenance");
    });
  });
});

// ---------------------------------------------------------------------------
// rc.7 T4 — 人-first banner reformat + edit-counter activity overview.
//
// New contract: stderr reason text is human-first (banner-style), drops any
// "candidates detected" framing, and includes a top-N most-edited-directory
// overview derived from the JSON-line edit-counter sidecar.
// ---------------------------------------------------------------------------

describe("fabric-hint.cjs — rc.7 T4 banner reformat", () => {
  const t4Hook = hook as HookModule & {
    getTopEditedDirectories: (
      projectRoot: string,
      topN: number,
      anchorTs: number | null,
    ) => Array<{ dir: string; count: number }>;
    formatActivityOverview: (projectRoot: string, anchorTs: number | null) => string;
  };
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-t4-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function seedEditCounterJson(
    root: string,
    entries: Array<{ ts: number; paths: string[] }>,
  ): void {
    const dir = join(root, ".fabric", ".cache");
    mkdirSync(dir, { recursive: true });
    const lines = entries
      .map((e) => JSON.stringify({ ts: new Date(e.ts).toISOString(), paths: e.paths }))
      .join("\n");
    writeFileSync(join(dir, "edit-counter"), `${lines}\n`, "utf8");
  }

  it("getTopEditedDirectories aggregates JSON-line edits into top-N 2-level dir buckets", () => {
    const anchor = NOW_MS - 24 * HOUR_MS;
    seedEditCounterJson(tempRoot, [
      // 12 fires under packages/server/services/
      ...Array.from({ length: 12 }, (_, i) => ({
        ts: anchor + (i + 1) * 60 * 1000,
        paths: [`packages/server/services/file${i}.ts`],
      })),
      // 8 fires under packages/cli/
      ...Array.from({ length: 8 }, (_, i) => ({
        ts: anchor + (i + 13) * 60 * 1000,
        paths: [`packages/cli/cmd${i}.ts`],
      })),
      // 2 fires under docs/
      ...Array.from({ length: 2 }, (_, i) => ({
        ts: anchor + (i + 21) * 60 * 1000,
        paths: [`docs/notes/x${i}.md`],
      })),
    ]);

    const top = t4Hook.getTopEditedDirectories(tempRoot, 3, anchor);
    expect(top).toHaveLength(3);
    expect(top[0]).toEqual({ dir: "packages/server/", count: 12 });
    expect(top[1]).toEqual({ dir: "packages/cli/", count: 8 });
    expect(top[2]).toEqual({ dir: "docs/notes/", count: 2 });
  });

  it("getTopEditedDirectories returns [] when sidecar absent", () => {
    expect(t4Hook.getTopEditedDirectories(tempRoot, 3, NOW_MS)).toEqual([]);
  });

  it("getTopEditedDirectories ignores legacy bare-ISO lines (no aggregable paths)", () => {
    const dir = join(tempRoot, ".fabric", ".cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "edit-counter"),
      [
        new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
        new Date(NOW_MS - 2 * HOUR_MS).toISOString(),
      ].join("\n") + "\n",
      "utf8",
    );
    expect(t4Hook.getTopEditedDirectories(tempRoot, 3, null)).toEqual([]);
  });

  it("getTopEditedDirectories anchor-gates ts strictly greater than anchor", () => {
    const anchor = NOW_MS - 10 * HOUR_MS;
    seedEditCounterJson(tempRoot, [
      { ts: anchor - 1 * HOUR_MS, paths: ["packages/server/a.ts"] }, // pre-anchor
      { ts: anchor, paths: ["packages/server/b.ts"] }, // equal — excluded
      { ts: anchor + 1 * HOUR_MS, paths: ["packages/cli/c.ts"] }, // counted
    ]);
    const top = t4Hook.getTopEditedDirectories(tempRoot, 3, anchor);
    expect(top).toEqual([{ dir: "packages/cli/", count: 1 }]);
  });

  it("getTopEditedDirectories dedupes within a single fire (MultiEdit on same dir)", () => {
    seedEditCounterJson(tempRoot, [
      {
        ts: NOW_MS - 1 * HOUR_MS,
        // Five files under the same 2-level bucket — counts as ONE fire
        // contribution, not five.
        paths: [
          "packages/cli/a.ts",
          "packages/cli/b.ts",
          "packages/cli/c.ts",
          "packages/cli/d.ts",
          "packages/cli/e.ts",
        ],
      },
    ]);
    const top = t4Hook.getTopEditedDirectories(tempRoot, 3, null);
    expect(top).toEqual([{ dir: "packages/cli/", count: 1 }]);
  });

  it("formatActivityOverview emits the expected 'dir (N edits), ...' fragment", () => {
    const anchor = NOW_MS - 24 * HOUR_MS;
    seedEditCounterJson(tempRoot, [
      ...Array.from({ length: 3 }, (_, i) => ({
        ts: anchor + (i + 1) * 60 * 1000,
        paths: [`packages/server/x${i}.ts`],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        ts: anchor + (i + 4) * 60 * 1000,
        paths: [`packages/cli/y${i}.ts`],
      })),
    ]);
    const overview = t4Hook.formatActivityOverview(tempRoot, anchor);
    expect(overview).toBe("packages/server/ (3 edits), packages/cli/ (2 edits)");
  });

  it("formatActivityOverview returns empty string when sidecar absent", () => {
    expect(t4Hook.formatActivityOverview(tempRoot, NOW_MS)).toBe("");
  });

  const archiveEdits = { editsSinceArchive: 20, threshold: 20, anchorPresent: true };

  it("Signal A banner uses 人-first format with emoji prefix and question framing", () => {
    const result = hook.decide([], FIXED_NOW, undefined, undefined, archiveEdits, undefined);
    expect(result).not.toBeNull();
    expect(result?.reason.startsWith("📋 Fabric:")).toBe(true);
    // Question framing — uses 是否 not 建议调用.
    expect(result?.reason).toMatch(/是否调 \/fabric-archive/);
    expect(result?.reason).not.toMatch(/建议调用/);
    // crack 1: edit-count substring contract (the hours fragment is retired).
    expect(result?.reason).toMatch(/20 次编辑/);
    // No fabricated content-aware framing.
    expect(result?.reason.toLowerCase()).not.toMatch(/candidates detected/);
  });

  it("Signal A banner injects activity overview when supplied via banner arg", () => {
    const result = hook.decide(
      [],
      FIXED_NOW,
      undefined,
      undefined,
      archiveEdits,
      undefined,
      // 7th arg: banner overlay supplying the activity overview.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ activityOverview: "packages/server/ (12 edits), packages/cli/ (8 edits)" } as any),
    );
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/最近活动集中在:/);
    expect(result?.reason).toMatch(/packages\/server\/ \(12 edits\)/);
    expect(result?.reason).toMatch(/packages\/cli\/ \(8 edits\)/);
  });

  it("Signal A banner omits activity line when overview is empty (back-compat)", () => {
    const result = hook.decide([], FIXED_NOW, undefined, undefined, archiveEdits, undefined);
    expect(result).not.toBeNull();
    expect(result?.reason).not.toMatch(/最近活动集中在/);
    // Banner is still well-formed (line1 + line3 only).
    const lineCount = (result?.reason.match(/\n/g) || []).length + 1;
    expect(lineCount).toBe(2);
  });

  it("Signal B (review) banner uses 人-first format with question framing", () => {
    const result = hook.decide([], FIXED_NOW, { count: 12, oldestAgeMs: 8 * 24 * HOUR_MS });
    expect(result).not.toBeNull();
    expect(result?.reason.startsWith("📋 Fabric:")).toBe(true);
    expect(result?.reason).toMatch(/是否调 \/fabric-review/);
    expect(result?.reason).not.toMatch(/建议调用/);
    expect(result?.reason).toMatch(/12 条/);
  });

  it("Signal C (import) banner uses 人-first format with question framing", () => {
    const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
    const result = hook.decide(
      [initEvent],
      FIXED_NOW,
      undefined,
      { nodeCount: 3, threshold: 10 },
    );
    expect(result).not.toBeNull();
    expect(result?.reason.startsWith("📋 Fabric:")).toBe(true);
    expect(result?.reason).toMatch(/是否调 \/fabric-import/);
    expect(result?.reason).not.toMatch(/建议调用/);
    expect(result?.reason).toMatch(/3\/10/);
  });

  it("main() injects activity overview end-to-end into Signal A banner (soft dual-sink)", () => {
    const prevClient = process.env.FABRIC_HINT_CLIENT;
    const prevProjDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
      const base = NOW_MS - 5 * HOUR_MS;
      // crack 1: the trigger count is now per-session file_mutated events. The
      // activity overview ("最近活动集中在") still reads the edit-counter sidecar
      // (display only). Seed both: 28 session file_mutated events for the count,
      // and a matching 28-entry edit-counter for the dir distribution.
      const ledger = [
        JSON.stringify(makeEvent("edit_intent_checked", base, { session_id: "s1", path: "packages/server/services/anchor.ts" })),
        JSON.stringify(makeEvent("edit_intent_checked", base + 30 * 1000, { session_id: "s1", path: "packages/server/services/hv.ts" })),
      ];
      for (let i = 1; i <= 28; i += 1) {
        ledger.push(
          JSON.stringify(
            makeEvent("file_mutated", base + i * 60 * 1000, {
              session_id: "s1",
              path: `packages/x/f${i}.ts`,
              tool_call_id: `tc-${i}`,
            }),
          ),
        );
      }
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${ledger.join("\n")}\n`, "utf8");
      // Edit counter (display only): 20 fires under packages/server/, 8 under packages/cli/.
      seedEditCounterJson(tempRoot, [
        ...Array.from({ length: 20 }, (_, i) => ({
          ts: base + (i + 1) * 60 * 1000,
          paths: [`packages/server/services/file${i}.ts`],
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          ts: base + (i + 21) * 60 * 1000,
          paths: [`packages/cli/x${i}.ts`],
        })),
      ]);

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } }, { stdout });

      expect(writes).toHaveLength(1);
      // W5: human banner quiet by default; the identical reason text rides the
      // always-on AI/observation sink, so assert the banner content there.
      const reason = JSON.parse(writes[0] as string).hookSpecificOutput.additionalContext as string;
      expect(reason).toMatch(/📋 Fabric:/);
      expect(reason).toMatch(/最近活动集中在:/);
      // 2-level dir bucketing: packages/server/* collapses to "packages/server/".
      expect(reason).toMatch(/packages\/server\/ \(20 edits\)/);
      expect(reason).toMatch(/packages\/cli\/ \(8 edits\)/);
      expect(reason).toMatch(/是否调 \/fabric-archive/);
      // 28 session file_mutated events since the anchor drive the count.
      expect(reason).toMatch(/28 次编辑/);
    } finally {
      if (prevClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
      else process.env.FABRIC_HINT_CLIENT = prevClient;
      if (prevProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prevProjDir;
    }
  });

  it("Signal D banner reformat keeps required substrings + adds question line", () => {
    const result = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/📋 Fabric:/);
    expect(result?.reason).toMatch(/从未运行 lint 检查/);
    expect(result?.reason).toMatch(/fabric doctor --lint/);
    expect(result?.reason).toMatch(/是否调/);
  });

  it("countEditsSince also parses the new JSON-line shape", () => {
    const anchor = NOW_MS - 10 * HOUR_MS;
    seedEditCounterJson(tempRoot, [
      { ts: anchor - 1 * HOUR_MS, paths: ["a/b.ts"] }, // pre-anchor
      { ts: anchor + 1 * HOUR_MS, paths: ["a/b.ts"] }, // counted
      { ts: anchor + 2 * HOUR_MS, paths: ["a/c.ts"] }, // counted
    ]);
    expect(hook.countEditsSince(tempRoot, anchor)).toBe(2);
  });

  it("countEditsSince still parses legacy bare-ISO lines mixed with new JSON lines", () => {
    const anchor = NOW_MS - 10 * HOUR_MS;
    const dir = join(tempRoot, ".fabric", ".cache");
    mkdirSync(dir, { recursive: true });
    const lines = [
      new Date(anchor + 1 * HOUR_MS).toISOString(), // legacy ISO
      JSON.stringify({
        ts: new Date(anchor + 2 * HOUR_MS).toISOString(),
        paths: ["x/y.ts"],
      }),
      "garbage{{{not-json",
      new Date(anchor + 3 * HOUR_MS).toISOString(),
    ];
    writeFileSync(join(dir, "edit-counter"), `${lines.join("\n")}\n`, "utf8");
    expect(hook.countEditsSince(tempRoot, anchor)).toBe(3);
  });

  // v2.0.0-rc.8 (TASK-002) — Signal B in-flight import gate. Truth table for
  // isImportInFlight() (see helper docstring for the canonical version):
  //   .import-state.json missing                 → false (B fires)
  //   phase=in-progress + checkpoint <24h        → true  (B silent)
  //   phase==="complete"                         → false (B fires)
  //   last_checkpoint_at >24h ago                → false (B fires)
  //   malformed JSON / read error                → false (B fires; never-block)
  //
  // Each test seeds the pending dir to satisfy Signal B's count threshold
  // (>=10 entries) so the gate is the ONLY variable under test.
  function seedTenPending(root: string): void {
    for (let i = 0; i < 10; i += 1) {
      seedPendingFile(root, "decisions", `b-${i}`, NOW_MS - 1 * DAY_MS);
    }
  }

  it("test_signal_b_baseline_fires_when_import_state_missing_and_pending_overflow", () => {
    seedTenPending(tempRoot);
    // No .import-state.json planted at all.
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as { signal: string };
    expect(payload.signal).toBe("review");
  });

  it("test_signal_b_silenced_when_import_state_phase_in_progress_and_checkpoint_fresh", () => {
    seedTenPending(tempRoot);
    // Phase mid-run + recent checkpoint (1h ago) → gate fires, B silenced.
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({
        phase: "P2-done",
        started_at: new Date(NOW_MS - 4 * HOUR_MS).toISOString(),
        last_checkpoint_at: new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
      }),
      "utf8",
    );
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    // Nothing else fires (no events, fresh init not present), so silence.
    expect(writes).toEqual([]);
  });

  it("test_signal_b_fires_when_import_state_phase_complete", () => {
    seedTenPending(tempRoot);
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({
        phase: "complete",
        started_at: new Date(NOW_MS - 4 * HOUR_MS).toISOString(),
        last_checkpoint_at: new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
      }),
      "utf8",
    );
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as { signal: string };
    expect(payload.signal).toBe("review");
  });

  it("test_signal_b_fires_when_import_state_checkpoint_older_than_24h", () => {
    seedTenPending(tempRoot);
    // Phase mid-run BUT checkpoint >24h ago → treated as stale, B fires.
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({
        phase: "P2-done",
        started_at: new Date(NOW_MS - 30 * HOUR_MS).toISOString(),
        last_checkpoint_at: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
      "utf8",
    );
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as { signal: string };
    expect(payload.signal).toBe("review");
  });

  it("test_signal_b_fires_when_import_state_json_malformed_never_block", () => {
    seedTenPending(tempRoot);
    // Malformed JSON → helper returns false → B is NOT gated → B fires.
    // This is the never-block invariant: corruption must not permanently
    // silence Signal B.
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      "{not-valid-json{{{",
      "utf8",
    );
    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as { signal: string };
    expect(payload.signal).toBe("review");
  });

  it("test_signal_a_c_d_behaviour_unchanged_with_import_in_flight", () => {
    // Plant a fresh in-flight import-state — gate is active.
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({
        phase: "P2-done",
        last_checkpoint_at: new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
      }),
      "utf8",
    );

    // Signal A: per-session edit count crosses threshold → must still fire
    // even with importInFlight=true (gate only suppresses Signal B).
    const a = hook.decide(
      [],
      FIXED_NOW,
      undefined,
      undefined,
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
      undefined,
      undefined,
      true,
    );
    expect(a?.signal).toBe("archive");

    // Signal C: underseeded + init_scan_completed >24h ago + no proposed
    // → must still fire even with importInFlight=true.
    const c = hook.decide(
      [makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS)],
      FIXED_NOW,
      undefined,
      { nodeCount: 3, threshold: 10 },
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(c?.signal).toBe("import");

    // Signal D: helper is independent of decide(); verify it still fires.
    const d = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    expect(d?.signal).toBe("maintenance");
  });

  it("test_no_sentinel_constant_or_helper_exported", () => {
    const exported = hook as unknown as Record<string, unknown>;
    expect(exported.isImportRequestedSentinelPresent).toBeUndefined();
    expect(exported.makeImportSentinelResult).toBeUndefined();
    const consts = hook.CONSTANTS as unknown as Record<string, unknown>;
    expect(consts.IMPORT_REQUESTED_SENTINEL_FILE).toBeUndefined();
  });

  it("test_module_exports_contain_no_sentinel_keys", () => {
    const allKeys = Object.keys(hook as unknown as Record<string, unknown>);
    for (const k of allKeys) {
      expect(k.toLowerCase()).not.toMatch(/sentinel/);
      expect(k).not.toMatch(/import.?requested/i);
    }
    const constKeys = Object.keys(hook.CONSTANTS as unknown as Record<string, unknown>);
    for (const k of constKeys) {
      expect(k.toLowerCase()).not.toMatch(/sentinel/);
      expect(k).not.toMatch(/import.?requested/i);
    }
    // Positive: the new in-flight gate identifiers ARE exported.
    expect(typeof (hook as unknown as Record<string, unknown>).isImportInFlight).toBe(
      "function",
    );
    expect(hook.CONSTANTS.IMPORT_IN_FLIGHT_MAX_AGE_HOURS).toBe(24);
    expect(typeof hook.CONSTANTS.IMPORT_STATE_FILE_REL).toBe("string");
  });

  it("none of the rendered reason strings mention 'candidates detected'", () => {
    // Drive all 4 signals and assert. Signal A first (per-session edits).
    const archive = hook.decide(
      [],
      FIXED_NOW,
      undefined,
      undefined,
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
    );
    const review = hook.decide([], FIXED_NOW, { count: 10, oldestAgeMs: 1 * 24 * HOUR_MS });
    const importSig = hook.decide(
      [makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS)],
      FIXED_NOW,
      undefined,
      { nodeCount: 3, threshold: 10 },
    );
    const maint = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    for (const r of [archive, review, importSig, maint]) {
      expect(r).not.toBeNull();
      expect(r?.reason.toLowerCase()).not.toMatch(/candidates detected/);
    }
  });
});

// observability grill (a + Q4): the no-signal Stop now surfaces a session-
// activity status breadcrumb (human sink) so Fabric stops feeling inert, plus a
// nudge_mode tier-guidance line so the volume knob is discoverable.
describe("fabric-hint.cjs — session status breadcrumb (observability grill)", () => {
  let tempRoot: string;
  let savedHintClient: string | undefined;
  let savedProjDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-status-"));
    savedHintClient = process.env.FABRIC_HINT_CLIENT;
    savedProjDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc"; // force the cc dual-sink envelope onto stdout
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(() => {
    if (savedHintClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
    else process.env.FABRIC_HINT_CLIENT = savedHintClient;
    if (savedProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjDir;
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  // A minimal no-signal ledger: a couple of session-tagged activity events, no
  // archive/review/import/maintenance trigger, so decide() returns null and the
  // status path runs.
  function seedActivityLedger(root: string, sessionId: string): void {
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const lines = [
      JSON.stringify(makeEvent("file_mutated", NOW_MS - 3 * HOUR_MS, { session_id: sessionId })),
      JSON.stringify(makeEvent("file_mutated", NOW_MS - 2 * HOUR_MS, { session_id: sessionId })),
      JSON.stringify(makeEvent("knowledge_consumed", NOW_MS - 1 * HOUR_MS, { session_id: sessionId })),
    ];
    writeFileSync(join(root, ".fabric", "events.jsonl"), `${lines.join("\n")}\n`, "utf8");
  }

  function writeNudgeMode(root: string, mode: string): void {
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({ nudge_mode: mode }),
      "utf8",
    );
  }

  it("tallySessionActivity counts only session-scoped file_mutated + knowledge_consumed", () => {
    const events = [
      makeEvent("file_mutated", 1, { session_id: "s1" }),
      makeEvent("file_mutated", 2, { session_id: "s1" }),
      makeEvent("file_mutated", 3, { session_id: "other" }), // different session — ignored
      makeEvent("knowledge_consumed", 4, { session_id: "s1" }),
      makeEvent("knowledge_proposed", 5, { session_id: "s1" }), // not counted (no sid in prod anyway)
      makeEvent("file_mutated", 6, {}), // sessionless — ignored
    ];
    expect(hook.tallySessionActivity(events, "s1")).toEqual({ edits: 2, consumed: 1 });
    expect(hook.tallySessionActivity(events, "")).toEqual({ edits: 0, consumed: 0 });
  });

  it("emits the status line + tier guidance on a no-signal Stop (nudge_mode normal)", () => {
    seedActivityLedger(tempRoot, "s1");
    writeNudgeMode(tempRoot, "normal");

    const writes: string[] = [];
    hook.main(
      { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
      { stdout: { write: (chunk: string) => writes.push(chunk) } },
    );

    expect(writes).toHaveLength(1);
    const env = JSON.parse(writes[0] as string);
    // human sink carries the status; the AI sink gets NO activity recap (D5).
    expect(env.systemMessage).toMatch(/Fabric 本会话/);
    expect(env.systemMessage).toMatch(/改 2 文件/);
    expect(env.systemMessage).toMatch(/AI 取用知识 1 次/);
    expect(env.systemMessage).toMatch(/nudge_mode/); // tier-guidance discoverability
    expect(env.hookSpecificOutput).toBeUndefined();
  });

  it("stays silent when nudge_mode is silent", () => {
    seedActivityLedger(tempRoot, "s1");
    writeNudgeMode(tempRoot, "silent");

    const writes: string[] = [];
    hook.main(
      { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
      { stdout: { write: (chunk: string) => writes.push(chunk) } },
    );

    expect(writes).toHaveLength(0);
  });

  it("stays silent when the session has no activity and no backlog", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), "", "utf8");
    writeNudgeMode(tempRoot, "normal");

    const writes: string[] = [];
    hook.main(
      { cwd: tempRoot, now: FIXED_NOW, stdin_payload: { session_id: "s1" } },
      { stdout: { write: (chunk: string) => writes.push(chunk) } },
    );

    expect(writes).toHaveLength(0);
  });
});


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
      decision: "block";
      reason: string;
      signal: "archive" | "review" | "import";
      recommended_skill: "fabric-archive" | "fabric-review" | "fabric-import";
    }
  | null;

type EditCounterStats = { editsSinceLastProposed: number; threshold: number };

type HookModule = {
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
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
  ) => HookDecision;
  // v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B.
  isImportInFlight: (projectRoot: string, now?: Date) => boolean;
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
  ) => HookDecision | { decision: "block"; reason: string; signal: "maintenance"; recommended_skill: null } | null;
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
  writeFileSync(
    join(home, ".fabric", "state", "bindings", `${projectId}_resolved.json`),
    JSON.stringify({
      version: 1,
      project_id: projectId,
      generated_at: "2026-05-30T00:00:00.000Z",
      read_set: { stores: [] },
      write_target: null,
      ...(knowledgeStats === undefined
        ? {}
        : { knowledge_stats: knowledgeStats }),
    }),
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
describe("fabric-hint.cjs — decide (Signal A: 24h-only path)", () => {
  it("returns null on empty ledger (no-trigger silence)", () => {
    expect(hook.decide([], FIXED_NOW)).toBeNull();
  });

  it("returns null when no knowledge_proposed event has ever been recorded (never-archived workspace is Signal C's domain)", () => {
    // Ten plan_contexts and zero knowledge_proposed → Signal A stays silent.
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        makeEvent("knowledge_context_planned", NOW_MS - (10 - i) * HOUR_MS),
      );
    }
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });

  it("triggers when knowledge_proposed >=24h ago", () => {
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [
      makeEvent("knowledge_proposed", proposedTs, {
        timestamp: new Date(proposedTs).toISOString(),
      }),
    ];
    const result = hook.decide(events, FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("block");
    expect(result?.signal).toBe("archive");
    expect(result?.recommended_skill).toBe("fabric-archive");
    expect(result?.reason).toMatch(/fabric-archive/);
    expect(result?.reason).toMatch(/25\.0h/);
  });

  it("returns null when knowledge_proposed <24h ago (regardless of plan_context count since)", () => {
    const proposedTs = NOW_MS - 23 * HOUR_MS;
    const events: Array<Record<string, unknown>> = [
      makeEvent("knowledge_proposed", proposedTs, {
        timestamp: new Date(proposedTs).toISOString(),
      }),
    ];
    // Sprinkle in 20 plan_contexts since the last archive — MUST NOT trigger.
    for (let i = 0; i < 20; i += 1) {
      events.push(
        makeEvent(
          "knowledge_context_planned",
          proposedTs + (i + 1) * 30 * 60 * 1000,
        ),
      );
    }
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });

  it("plan_context count does NOT influence Signal A (auto-fire-resistant)", () => {
    // knowledge_proposed exactly 12h ago (within 24h window). 50 auto-fired
    // plan_contexts after it MUST NOT trigger Signal A in rc.5.
    const proposedTs = NOW_MS - 12 * HOUR_MS;
    const events: Array<Record<string, unknown>> = [
      makeEvent("knowledge_proposed", proposedTs),
    ];
    for (let i = 0; i < 50; i += 1) {
      events.push(
        makeEvent("knowledge_context_planned", proposedTs + i * 60 * 1000),
      );
    }
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });
});

// rc.6 TASK-022 (E5): Signal A upgrade to 24h-OR-N-edits.
// New OR-branch fires when edit-counter line count since last
// knowledge_proposed ts >= archive_edit_threshold (default 20). Time-only
// behaviour preserved when edit count < threshold. Missing/malformed
// edit-counter → editsSinceLastProposed=0 → degrades to 24h-only.
describe("fabric-hint.cjs — decide (Signal A: edit-count OR branch)", () => {
  it("silent when edits<threshold AND <24h elapsed (both branches below)", () => {
    const proposedTs = NOW_MS - 5 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 5,
      threshold: 20,
    });
    expect(result).toBeNull();
  });

  it("fires (24h branch) when edits<threshold AND >=24h elapsed", () => {
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 3,
      threshold: 20,
    });
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
    expect(result?.recommended_skill).toBe("fabric-archive");
    expect(result?.reason).toMatch(/25\.0h/);
  });

  it("fires (edit-count branch) when edits>=threshold AND <24h elapsed", () => {
    const proposedTs = NOW_MS - 3 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 20,
      threshold: 20,
    });
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
    expect(result?.recommended_skill).toBe("fabric-archive");
    // Reason should mention edit count, NOT hours (since 24h branch silent).
    expect(result?.reason).toMatch(/20 次编辑/);
    expect(result?.reason).not.toMatch(/\bh（阈值/);
  });

  it("fires (both branches) when edits>=threshold AND >=24h elapsed — reason mentions both", () => {
    const proposedTs = NOW_MS - 30 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 25,
      threshold: 20,
    });
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
    expect(result?.reason).toMatch(/30\.0h/);
    expect(result?.reason).toMatch(/25 次编辑/);
  });

  it("silent when no knowledge_proposed event recorded, even with huge edit count", () => {
    // Anchor-less workspace: edit count is meaningless without an anchor
    // because we can't say "edits since archive" if there's never been one.
    // Signal A stays silent; Signal C (import) is the right reminder.
    const result = hook.decide([], FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 100,
      threshold: 20,
    });
    expect(result).toBeNull();
  });

  it("honours custom threshold (50) — fires only when edits>=50", () => {
    const proposedTs = NOW_MS - 3 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];

    // 30 edits, threshold 50 → silent
    expect(
      hook.decide(events, FIXED_NOW, undefined, undefined, {
        editsSinceLastProposed: 30,
        threshold: 50,
      }),
    ).toBeNull();

    // 50 edits, threshold 50 → fires
    const fired = hook.decide(events, FIXED_NOW, undefined, undefined, {
      editsSinceLastProposed: 50,
      threshold: 50,
    });
    expect(fired).not.toBeNull();
    expect(fired?.signal).toBe("archive");
    expect(fired?.reason).toMatch(/50 次编辑/);
    expect(fired?.reason).toMatch(/阈值 50/);
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

  function seedEditCounter(root: string, isoLines: string[]): void {
    const dir = join(root, ".fabric", ".cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "edit-counter"),
      isoLines.map((l) => `${l}\n`).join(""),
      "utf8",
    );
  }

  // v2.2 dual-sink (Goal A / D6): write the archive ledger with a high-value
  // signal AFTER the watermark so the value-gate passes. Without a high-value
  // event (edit_intent_checked) the archive nudge is correctly suppressed.
  function seedArchiveLedger(root: string, proposedTs: number): void {
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const lines = [
      JSON.stringify(makeEvent("knowledge_proposed", proposedTs)),
      JSON.stringify(makeEvent("edit_intent_checked", proposedTs + 60 * 1000, { path: "src/foo.ts" })),
    ];
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

  it("fires archive signal (soft dual-sink) when 20 edits accumulated since knowledge_proposed (within 24h)", () => {
    const proposedTs = NOW_MS - 5 * HOUR_MS;
    seedArchiveLedger(tempRoot, proposedTs);

    // 20 edits all AFTER proposedTs.
    const editLines: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      editLines.push(new Date(proposedTs + i * 60 * 1000).toISOString());
    }
    seedEditCounter(tempRoot, editLines);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    // v2.2 dual-sink (Goal A / D3): soft envelope, NOT decision:block.
    const emit = archiveEmit(writes);
    expect(JSON.parse(writes[0] as string).decision).toBeUndefined();
    expect(emit.systemMessage).toMatch(/20 次编辑/); // human sink
    expect(emit.ai).toMatch(/20 次编辑/); // AI sink
  });

  it("appends per-store read-set label to the Stop hint reason (v2.1 P4, F4/S63)", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const projectId = "11111111-1111-4111-8111-111111111111";
    const proposedTs = NOW_MS - 5 * HOUR_MS;
    seedArchiveLedger(tempRoot, proposedTs);
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: projectId }),
      "utf8",
    );
    const editLines: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      editLines.push(new Date(proposedTs + i * 60 * 1000).toISOString());
    }
    seedEditCounter(tempRoot, editLines);

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
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout: { write: (c: string) => writes.push(c) } });
      expect(writes).toHaveLength(1);
      const emit = archiveEmit(writes);
      expect(emit.systemMessage).toContain("read-set stores:");
      expect(emit.systemMessage).toContain("team (write)");
    } finally {
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("stays silent when 19 edits accumulated (just below default threshold 20) and <24h", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const proposedTs = NOW_MS - 5 * HOUR_MS;
    const line = JSON.stringify(makeEvent("knowledge_proposed", proposedTs));
    writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${line}\n`, "utf8");

    const editLines: string[] = [];
    for (let i = 1; i <= 19; i += 1) {
      editLines.push(new Date(proposedTs + i * 60 * 1000).toISOString());
    }
    seedEditCounter(tempRoot, editLines);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toEqual([]);
  });

  it("missing edit-counter degrades to 24h-only (existing rc.5 behaviour preserved)", () => {
    // No edit-counter file. knowledge_proposed 5h ago → no time trigger.
    // Hook MUST be silent — verifies safe-degrade contract.
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const proposedTs = NOW_MS - 5 * HOUR_MS;
    const line = JSON.stringify(makeEvent("knowledge_proposed", proposedTs));
    writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${line}\n`, "utf8");

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toEqual([]);
  });

  it("honours custom archive_edit_threshold=10 from fabric-config.json", () => {
    const proposedTs = NOW_MS - 2 * HOUR_MS;
    seedArchiveLedger(tempRoot, proposedTs);
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ archive_edit_threshold: 10 }),
      "utf8",
    );

    // 10 edits — exactly at custom threshold, well within 24h.
    const editLines: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      editLines.push(new Date(proposedTs + i * 60 * 1000).toISOString());
    }
    seedEditCounter(tempRoot, editLines);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    // soft dual-sink envelope carries the archive reason (no decision:block).
    expect(archiveEmit(writes).systemMessage).toMatch(/fabric-archive/);
  });

  it("malformed lines in edit-counter are skipped; valid count still drives trigger", () => {
    const proposedTs = NOW_MS - 4 * HOUR_MS;
    seedArchiveLedger(tempRoot, proposedTs);

    const editLines: string[] = [];
    // 20 valid lines.
    for (let i = 1; i <= 20; i += 1) {
      editLines.push(new Date(proposedTs + i * 60 * 1000).toISOString());
    }
    // Mix in 5 malformed lines that MUST be skipped (not count toward trigger).
    editLines.push("bogus", "not-a-date", "{{{", "", "2026/05/12 broken");

    seedEditCounter(tempRoot, editLines);

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    expect(archiveEmit(writes).systemMessage).toMatch(/20 次编辑/);
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

  it("emits the SOFT archive dual-sink envelope (no decision:block) when last knowledge_proposed >=24h ago", () => {
    // v2.2 dual-sink (Goal A / D3): the archive nudge is now a soft envelope
    // (systemMessage + additionalContext), never decision:block. Force cc so the
    // envelope lands on stdout; seed a high-value event so the value-gate passes.
    const prevClient = process.env.FABRIC_HINT_CLIENT;
    const prevProjDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
      const proposedTs = NOW_MS - 26 * HOUR_MS;
      const lines = [
        JSON.stringify(makeEvent("knowledge_proposed", proposedTs, { timestamp: new Date(proposedTs).toISOString() })),
        JSON.stringify(makeEvent("edit_intent_checked", proposedTs + 60 * 1000, { path: "src/foo.ts" })),
      ];
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${lines.join("\n")}\n`, "utf8");

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const env = JSON.parse(writes[0] as string);
      expect(env.decision).toBeUndefined(); // NOT a block contract
      expect(env.systemMessage).toMatch(/fabric-archive/); // human sink
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
    expect(result?.decision).toBe("block");
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
    expect(result?.decision).toBe("block");
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

  it("archive precedence: archive wins when both archive AND review triggers fire (NEW-6)", () => {
    // Build events that trigger archive under rc.5 Signal A (24h-only):
    // knowledge_proposed 25h ago.
    const events: Array<Record<string, unknown>> = [
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    // Pending stats also trigger review.
    const result = hook.decide(events, FIXED_NOW, {
      count: 12,
      oldestAgeMs: 9 * DAY_MS,
    });
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("block");
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

  it("emits review JSON with signal:'review' when pending count >= 10 and no archive trigger", () => {
    for (let i = 0; i < 10; i += 1) {
      seedPendingFile(tempRoot, "decisions", `d-${i}`, NOW_MS - 1 * DAY_MS);
    }

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as {
      decision: string;
      reason: string;
      signal: string;
    };
    expect(payload.decision).toBe("block");
    expect(payload.signal).toBe("review");
    expect(payload.reason).toMatch(/fabric-review/);
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
    expect(result?.decision).toBe("block");
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

  it("archive precedence: archive wins when both archive AND import triggers fire", () => {
    // knowledge_proposed 25h ago → Signal A (archive) triggers under rc.5.
    // Sparse corpus + init >=24h ago would also trigger import, but archive wins.
    const events: Array<Record<string, unknown>> = [
      initEvent,
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    // NOTE: knowledge_proposed 25h ago > 24h NO_PROPOSED window, so the import
    // signal's "no recent knowledge_proposed" guard still allows import to fire
    // — but archive precedence supersedes it.
    const result = hook.decide(events, FIXED_NOW, undefined, {
      nodeCount: 1,
      threshold: 10,
    });
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
    const events: Array<Record<string, unknown>> = [
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    const result = hook.decide(events, FIXED_NOW);
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

  it("emits import JSON with signal:'import' + recommended_skill:'fabric-import' on underseeded corpus", () => {
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
      const payload = JSON.parse(writes[0] as string) as {
        decision: string;
        reason: string;
        signal: string;
        recommended_skill: string;
      };
      expect(payload.decision).toBe("block");
      expect(payload.signal).toBe("import");
      expect(payload.recommended_skill).toBe("fabric-import");
      expect(payload.reason).toMatch(/fabric-import/);
      expect(payload.reason).toMatch(/3\/10/);
    });
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

  it("decide threads externalized archiveHintHours through Signal A trigger", () => {
    // 25h elapsed > default 24h would trigger; but raise threshold to 48h →
    // signal stays silent.
    const events = [
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS),
    ];
    const result = hook.decide(
      events,
      FIXED_NOW,
      { count: 0, oldestAgeMs: null },
      { nodeCount: 50, threshold: 10 },
      { editsSinceLastProposed: 0, threshold: 20 },
      { archiveHintHours: 48 },
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
      { editsSinceLastProposed: 0, threshold: 20 },
      { reviewHintPendingCount: 20 },
    );
    expect(result).toBeNull();
  });

  it("decide uses defaults when thresholds arg is omitted (back-compat)", () => {
    // Pre-T7 call shape: no thresholds arg. Must still trigger Signal A at
    // 25h elapsed using the documented default of 24h.
    const events = [makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS)];
    const result = hook.decide(
      events,
      FIXED_NOW,
      { count: 0, oldestAgeMs: null },
      { nodeCount: 50, threshold: 10 },
      { editsSinceLastProposed: 0, threshold: 20 },
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

  it("Signal A banner uses 人-first format with emoji prefix and question framing", () => {
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, undefined, undefined);
    expect(result).not.toBeNull();
    expect(result?.reason.startsWith("📋 Fabric:")).toBe(true);
    // Question framing — uses 是否 not 建议调用.
    expect(result?.reason).toMatch(/是否调 \/fabric-archive/);
    expect(result?.reason).not.toMatch(/建议调用/);
    // Substring contract preserved.
    expect(result?.reason).toMatch(/25\.0h/);
    // No fabricated content-aware framing.
    expect(result?.reason.toLowerCase()).not.toMatch(/candidates detected/);
  });

  it("Signal A banner injects activity overview when supplied via banner arg", () => {
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(
      events,
      FIXED_NOW,
      undefined,
      undefined,
      undefined,
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
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [makeEvent("knowledge_proposed", proposedTs)];
    const result = hook.decide(events, FIXED_NOW, undefined, undefined, undefined, undefined);
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
      const proposedTs = NOW_MS - 5 * HOUR_MS;
      // v2.2 dual-sink (Goal A / D6): high-value event after the watermark so the
      // archive value-gate passes.
      const ledger = [
        JSON.stringify(makeEvent("knowledge_proposed", proposedTs)),
        JSON.stringify(makeEvent("edit_intent_checked", proposedTs + 30 * 1000, { path: "packages/server/services/x.ts" })),
      ];
      writeFileSync(join(tempRoot, ".fabric", "events.jsonl"), `${ledger.join("\n")}\n`, "utf8");
      // Edit counter: 20 fires under packages/server/services/, 8 under packages/cli/
      seedEditCounterJson(tempRoot, [
        ...Array.from({ length: 20 }, (_, i) => ({
          ts: proposedTs + (i + 1) * 60 * 1000,
          paths: [`packages/server/services/file${i}.ts`],
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          ts: proposedTs + (i + 21) * 60 * 1000,
          paths: [`packages/cli/x${i}.ts`],
        })),
      ]);

      const writes: string[] = [];
      const stdout = { write: (chunk: string) => writes.push(chunk) };
      hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

      expect(writes).toHaveLength(1);
      const reason = JSON.parse(writes[0] as string).systemMessage as string;
      expect(reason).toMatch(/📋 Fabric:/);
      expect(reason).toMatch(/最近活动集中在:/);
      // 2-level dir bucketing: packages/server/* collapses to "packages/server/".
      expect(reason).toMatch(/packages\/server\/ \(20 edits\)/);
      expect(reason).toMatch(/packages\/cli\/ \(8 edits\)/);
      expect(reason).toMatch(/是否调 \/fabric-archive/);
      // 20 + 8 = 28 fires post-anchor (each entry one fire).
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

    // Signal A: knowledge_proposed 25h ago → must still fire.
    const archiveEvents = [
      makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS, {
        timestamp: new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
      }),
    ];
    const a = hook.decide(archiveEvents, FIXED_NOW, undefined, undefined, undefined, undefined, undefined, true);
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
    // Drive all 4 signals and assert. Signal A first.
    const archive = hook.decide(
      [makeEvent("knowledge_proposed", NOW_MS - 25 * HOUR_MS)],
      FIXED_NOW,
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


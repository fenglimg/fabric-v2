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
  mkdirSync,
  mkdtempSync,
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

type HookModule = {
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
  readLedger: (projectRoot: string) => Array<Record<string, unknown>>;
  readPendingStats: (projectRoot: string, now: Date) => PendingStats;
  countCanonicalNodes: (projectRoot: string) => number;
  decide: (
    events: Array<Record<string, unknown>>,
    now: Date,
    pendingStats?: PendingStats,
    underseedStats?: UnderseedStats,
  ) => HookDecision;
  readUnderseedThreshold: (projectRoot: string) => number;
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
    KNOWLEDGE_CANONICAL_TYPES: string[];
    DEFAULT_UNDERSEED_NODE_THRESHOLD: number;
    UNDERSEED_POST_INIT_QUIET_HOURS: number;
    UNDERSEED_NO_PROPOSED_HOURS: number;
  };
};

const hook = require(hookPath) as HookModule;

const HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");
const NOW_MS = FIXED_NOW.getTime();

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

// rc.5 TASK-015 (C6): Signal A is pure 24h-since-last-knowledge_proposed.
// The previous plan_context-count branch was dropped — rc.5+ hooks auto-fire
// plan_context events, making the count unreliable. plan_context events
// present in the ledger MUST NOT influence Signal A.
describe("fabric-hint.cjs — decide (Signal A: 24h-only)", () => {
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

  it("writes JSON {decision:'block', reason} to stdout when last knowledge_proposed >=24h ago", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const proposedTs = NOW_MS - 26 * HOUR_MS;
    const line = JSON.stringify(
      makeEvent("knowledge_proposed", proposedTs, {
        timestamp: new Date(proposedTs).toISOString(),
      }),
    );
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${line}\n`,
      "utf8",
    );

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
    expect(payload.signal).toBe("archive");
    expect(typeof payload.reason).toBe("string");
    expect(payload.reason).toMatch(/fabric-archive/);
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

  it("returns 0 when .fabric/knowledge does not exist", () => {
    expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
  });

  it("counts .md files across all five canonical type subdirs (excludes pending)", () => {
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0001--a");
    seedCanonicalFile(tempRoot, "pitfalls", "KT-PIT-0001--b");
    seedCanonicalFile(tempRoot, "guidelines", "KT-GLD-0001--c");
    seedCanonicalFile(tempRoot, "models", "KT-MOD-0001--d");
    seedCanonicalFile(tempRoot, "processes", "KT-PRO-0001--e");
    // pending/ entries MUST NOT count.
    seedCanonicalFile(tempRoot, "pending/decisions", "pending-proposal");
    // Non-.md noise MUST be ignored.
    writeFileSync(
      join(tempRoot, ".fabric", "knowledge", "decisions", "README.txt"),
      "ignore me",
      "utf8",
    );

    expect(hook.countCanonicalNodes(tempRoot)).toBe(5);
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

  it("emits import JSON with signal:'import' + recommended_skill:'fabric-import' on underseeded corpus", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    // Seed an init_scan_completed event 48h before NOW.
    const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${JSON.stringify(initEvent)}\n`,
      "utf8",
    );
    // Seed 3 canonical entries (< default threshold 10).
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0001--a");
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0002--b");
    seedCanonicalFile(tempRoot, "pitfalls", "KT-PIT-0001--c");

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

  it("silent exit 0 when corpus is well-seeded (>= threshold)", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${JSON.stringify(initEvent)}\n`,
      "utf8",
    );
    for (let i = 0; i < 12; i += 1) {
      seedCanonicalFile(tempRoot, "decisions", `KT-DEC-${1000 + i}--entry-${i}`);
    }

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toEqual([]);
  });

  it("honours custom underseed_node_threshold from fabric-config.json", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ underseed_node_threshold: 3 }),
      "utf8",
    );
    const initEvent = makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS);
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${JSON.stringify(initEvent)}\n`,
      "utf8",
    );
    // 2 canonical entries: < threshold(3) so import fires.
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0001--a");
    seedCanonicalFile(tempRoot, "decisions", "KT-DEC-0002--b");

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as { signal: string };
    expect(payload.signal).toBe("import");
  });
});


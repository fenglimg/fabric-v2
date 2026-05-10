/**
 * Contract tests for templates/hooks/archive-hint.cjs.
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
  new URL("../templates/hooks/archive-hint.cjs", import.meta.url),
);

type PendingStats = { count: number; oldestAgeMs: number | null };

type HookDecision =
  | { decision: "block"; reason: string; signal: "archive" | "review" }
  | null;

type HookModule = {
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
  readLedger: (projectRoot: string) => Array<Record<string, unknown>>;
  readPendingStats: (projectRoot: string, now: Date) => PendingStats;
  decide: (
    events: Array<Record<string, unknown>>,
    now: Date,
    pendingStats?: PendingStats,
  ) => HookDecision;
  CONSTANTS: {
    FABRIC_DIR: string;
    EVENT_LEDGER_FILE: string;
    EVENT_TYPE_PROPOSED: string;
    EVENT_TYPE_PLAN_CONTEXT: string;
    THRESHOLD_PLAN_CONTEXTS: number;
    THRESHOLD_HOURS: number;
    PENDING_DIR: string;
    PENDING_TYPES: string[];
    THRESHOLD_PENDING_COUNT: number;
    THRESHOLD_PENDING_AGE_DAYS: number;
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

describe("archive-hint.cjs — readLedger", () => {
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

describe("archive-hint.cjs — decide", () => {
  it("returns null on empty ledger (no-trigger silence)", () => {
    expect(hook.decide([], FIXED_NOW)).toBeNull();
  });

  it("returns null when 4 plan_contexts and 0 knowledge_proposed (under count threshold)", () => {
    const events = [
      makeEvent("knowledge_context_planned", NOW_MS - 4 * HOUR_MS),
      makeEvent("knowledge_context_planned", NOW_MS - 3 * HOUR_MS),
      makeEvent("knowledge_context_planned", NOW_MS - 2 * HOUR_MS),
      makeEvent("knowledge_context_planned", NOW_MS - 1 * HOUR_MS),
    ];
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });

  it("triggers on count threshold: 6 plan_contexts after last knowledge_proposed", () => {
    const baseTs = NOW_MS - 5 * HOUR_MS;
    const events: Array<Record<string, unknown>> = [
      makeEvent("knowledge_proposed", baseTs - HOUR_MS, {
        timestamp: new Date(baseTs - HOUR_MS).toISOString(),
      }),
    ];
    for (let i = 0; i < 6; i += 1) {
      events.push(
        makeEvent("knowledge_context_planned", baseTs + i * 60 * 1000),
      );
    }
    const result = hook.decide(events, FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("block");
    expect(result?.reason).toMatch(/fabric-archive/);
    expect(result?.reason).toMatch(/6/);
  });

  it("triggers on hours threshold: knowledge_proposed >25h ago, 1 plan_context since", () => {
    const proposedTs = NOW_MS - 25 * HOUR_MS;
    const events = [
      makeEvent("knowledge_proposed", proposedTs, {
        timestamp: new Date(proposedTs).toISOString(),
      }),
      makeEvent("knowledge_context_planned", proposedTs + HOUR_MS),
    ];
    const result = hook.decide(events, FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("block");
    expect(result?.reason).toMatch(/fabric-archive/);
  });

  it("returns null when knowledge_proposed <24h ago and only 2 plan_contexts since", () => {
    const proposedTs = NOW_MS - 2 * HOUR_MS;
    const events = [
      makeEvent("knowledge_proposed", proposedTs, {
        timestamp: new Date(proposedTs).toISOString(),
      }),
      makeEvent("knowledge_context_planned", proposedTs + 30 * 60 * 1000),
      makeEvent("knowledge_context_planned", proposedTs + 60 * 60 * 1000),
    ];
    expect(hook.decide(events, FIXED_NOW)).toBeNull();
  });

  it("triggers when never archived AND plan_context count >= 5", () => {
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i += 1) {
      events.push(
        makeEvent("knowledge_context_planned", NOW_MS - (5 - i) * HOUR_MS),
      );
    }
    const result = hook.decide(events, FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("block");
  });
});

describe("archive-hint.cjs — main", () => {
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

  it("writes JSON {decision:'block', reason} to stdout on trigger", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    const baseTs = NOW_MS - 5 * HOUR_MS;
    const lines: string[] = [
      JSON.stringify(
        makeEvent("knowledge_proposed", baseTs - HOUR_MS, {
          timestamp: new Date(baseTs - HOUR_MS).toISOString(),
        }),
      ),
    ];
    for (let i = 0; i < 6; i += 1) {
      lines.push(
        JSON.stringify(
          makeEvent("knowledge_context_planned", baseTs + i * 60 * 1000),
        ),
      );
    }
    writeFileSync(
      join(tempRoot, ".fabric", "events.jsonl"),
      `${lines.join("\n")}\n`,
      "utf8",
    );

    const writes: string[] = [];
    const stdout = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, now: FIXED_NOW }, { stdout });

    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0] as string) as {
      decision: string;
      reason: string;
    };
    expect(payload.decision).toBe("block");
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

describe("archive-hint.cjs — readPendingStats", () => {
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

describe("archive-hint.cjs — decide (review signal)", () => {
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
    // Build events that trigger archive (>=5 plan_contexts, never archived).
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i += 1) {
      events.push(
        makeEvent("knowledge_context_planned", NOW_MS - (5 - i) * HOUR_MS),
      );
    }
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

describe("archive-hint.cjs — main (review signal integration)", () => {
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

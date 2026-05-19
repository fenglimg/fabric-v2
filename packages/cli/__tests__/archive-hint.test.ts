/**
 * Contract tests for templates/hooks/archive-hint.cjs (rc.25 TASK-03).
 *
 * Loads the .cjs via createRequire mirroring fabric-hint.test.ts:1-29 policy:
 * in-process invocation only, NO child_process.spawn in CI.
 *
 * Covers the 6 cases enumerated in TASK-03.test.unit:
 *   1. events with session_id present → reason contains "跨 N 个会话"
 *   2. events without session_id → reason contains "跨多个会话累计"
 *   3. lastProposedTs=null + rotation scenario → reason contains
 *      "watermark 已被 rotation 清理"
 *   4. en variant when fabric_language='en'
 *   5. zh-CN variant when fabric_language='zh-CN'
 *   6. cooldown regression (12h gate suppresses re-emit)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

type HookDecision =
  | { decision: "block"; reason: string; signal: "archive" }
  | null;

type HookModule = {
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
  readLedger: (projectRoot: string) => Array<Record<string, unknown>>;
  countDistinctSessions: (
    events: Array<Record<string, unknown>>,
    lastProposedTs: number | null,
  ) => { count: number; coverage_ratio: number; total: number };
  readFabricLanguage: (projectRoot: string) => "zh-CN" | "en";
  decide: (
    events: Array<Record<string, unknown>>,
    now: Date,
    language?: string,
  ) => HookDecision;
  readCooldownHours: (projectRoot: string) => number;
  readShownCache: (projectRoot: string) => Record<string, number>;
  writeShownCache: (projectRoot: string, cache: Record<string, number>) => void;
  CONSTANTS: {
    FABRIC_DIR: string;
    EVENT_LEDGER_FILE: string;
    EVENT_TYPE_PROPOSED: string;
    EVENT_TYPE_PLAN_CONTEXT: string;
    THRESHOLD_PLAN_CONTEXTS: number;
    THRESHOLD_HOURS: number;
    DEFAULT_COOLDOWN_HOURS: number;
    SHOWN_CACHE_FILE: string;
  };
};

const hook = require(hookPath) as HookModule;

// ---------------------------------------------------------------------------
// Test scaffolding helpers — temp project root with synthesised events.jsonl
// ---------------------------------------------------------------------------

function setupProject(): string {
  const root = mkdtempSync(join(tmpdir(), "archive-hint-rc25-"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  return root;
}

function teardownProject(root: string): void {
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeEvents(root: string, events: Array<Record<string, unknown>>): void {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(root, ".fabric", "events.jsonl"), lines);
}

function writeFabricConfig(
  root: string,
  config: Record<string, unknown>,
): void {
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify(config),
  );
}

const NOW_MS = Date.UTC(2026, 4, 19, 12, 0, 0);
const NOW = new Date(NOW_MS);

function planContextEvent(
  tsOffsetHours: number,
  sessionId?: string,
): Record<string, unknown> {
  const ev: Record<string, unknown> = {
    event_type: "knowledge_context_planned",
    ts: NOW_MS - tsOffsetHours * 60 * 60 * 1000,
  };
  if (sessionId !== undefined) {
    ev.session_id = sessionId;
  }
  return ev;
}

function proposedEvent(tsOffsetHours: number): Record<string, unknown> {
  return {
    event_type: "knowledge_proposed",
    ts: NOW_MS - tsOffsetHours * 60 * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Case 1: cross-session count via session_id
// ---------------------------------------------------------------------------

describe("archive-hint decide() — cross-session count via session_id", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("renders '跨 N 个会话累计' when ≥50% of plan_context events carry session_id", () => {
    // Watermark 30h ago. 6 plan_context events since, all with session_id
    // (3 distinct sessions). Triggers Signal A by both count (>=5) and
    // hours (30 >= 24), and coverage_ratio=1.0 > 0.5 → distinct-count wording.
    const events: Array<Record<string, unknown>> = [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
      planContextEvent(1, "session-C"),
    ];
    const result = hook.decide(events, NOW, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.signal).toBe("archive");
    expect(result?.reason).toMatch(/跨 3 个会话累计/);
    expect(result?.reason).toMatch(/6 次 plan_context/);
    expect(result?.reason).toMatch(/项目级长期欠债/);
  });
});

// ---------------------------------------------------------------------------
// Case 2: degrade to "跨多个会话累计" when session_id coverage <50%
// ---------------------------------------------------------------------------

describe("archive-hint decide() — degrade to '多个' when session_id missing", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("renders '跨多个会话累计' when <50% of plan_context events carry session_id", () => {
    // 6 plan_context events since watermark, only 1 has session_id (16%
    // coverage < 50% threshold) → degraded wording.
    const events: Array<Record<string, unknown>> = [
      proposedEvent(30),
      planContextEvent(25),
      planContextEvent(20),
      planContextEvent(15),
      planContextEvent(10),
      planContextEvent(5),
      planContextEvent(1, "session-A"),
    ];
    const result = hook.decide(events, NOW, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/跨多个会话累计/);
    expect(result?.reason).not.toMatch(/跨 \d+ 个会话累计/);
  });
});

// ---------------------------------------------------------------------------
// Case 3: rotation watermark fallback
// ---------------------------------------------------------------------------

describe("archive-hint decide() — rotation watermark fallback", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("uses events[0].ts as virtual watermark and appends '(watermark 已被 rotation 清理)' when no knowledge_proposed present", () => {
    // No knowledge_proposed event (simulates post-rotation state). 5
    // plan_context events; first one at 40h ago becomes virtual watermark.
    const events: Array<Record<string, unknown>> = [
      planContextEvent(40),
      planContextEvent(30),
      planContextEvent(20),
      planContextEvent(10),
      planContextEvent(5),
      planContextEvent(1),
    ];
    const result = hook.decide(events, NOW, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/watermark 已被 rotation 清理/);
    // hoursElapsed computed from events[0].ts = 40h ago
    expect(result?.reason).toMatch(/40\.0h/);
  });
});

// ---------------------------------------------------------------------------
// Case 4: en variant
// ---------------------------------------------------------------------------

describe("archive-hint decide() — en variant", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("renders English copy when language='en'", () => {
    const events: Array<Record<string, unknown>> = [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ];
    const result = hook.decide(events, NOW, "en");
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/Across 3 sessions/);
    expect(result?.reason).toMatch(/project-level long-term debt/);
    // English copy must NOT contain Chinese substrings
    expect(result?.reason).not.toMatch(/项目级长期欠债/);
  });

  it("readFabricLanguage returns 'en' when fabric-config.json sets fabric_language='en'", () => {
    writeFabricConfig(root, { fabric_language: "en" });
    expect(hook.readFabricLanguage(root)).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// Case 5: zh-CN variant
// ---------------------------------------------------------------------------

describe("archive-hint decide() — zh-CN variant", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("renders Chinese copy when language='zh-CN'", () => {
    const events: Array<Record<string, unknown>> = [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ];
    const result = hook.decide(events, NOW, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/项目级长期欠债/);
    expect(result?.reason).toMatch(/可调用 fabric-archive/);
  });

  it("readFabricLanguage returns 'zh-CN' when fabric-config.json sets fabric_language='zh-CN'", () => {
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    expect(hook.readFabricLanguage(root)).toBe("zh-CN");
  });

  it("readFabricLanguage defaults to 'en' when fabric-config.json missing", () => {
    expect(hook.readFabricLanguage(root)).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// Case 6: cooldown regression
// ---------------------------------------------------------------------------

describe("archive-hint main() — cooldown regression", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("suppresses re-emission within 12h cooldown window", () => {
    // Seed events that fire Signal A by both count and hours.
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ]);
    writeFabricConfig(root, { fabric_language: "zh-CN" });

    let firstStdout = "";
    hook.main(
      { cwd: root, now: NOW },
      { stdout: { write: (chunk: string) => { firstStdout += chunk; } } },
    );
    expect(firstStdout.length).toBeGreaterThan(0);
    const firstPayload = JSON.parse(firstStdout);
    expect(firstPayload.signal).toBe("archive");
    expect(firstPayload.decision).toBe("block");

    // Re-invoke 1h later — still inside the 12h cooldown → silent.
    let secondStdout = "";
    hook.main(
      { cwd: root, now: new Date(NOW_MS + 60 * 60 * 1000) },
      { stdout: { write: (chunk: string) => { secondStdout += chunk; } } },
    );
    expect(secondStdout).toBe("");

    // Re-invoke 13h later — past cooldown → emits again.
    let thirdStdout = "";
    hook.main(
      { cwd: root, now: new Date(NOW_MS + 13 * 60 * 60 * 1000) },
      { stdout: { write: (chunk: string) => { thirdStdout += chunk; } } },
    );
    expect(thirdStdout.length).toBeGreaterThan(0);
    const thirdPayload = JSON.parse(thirdStdout);
    expect(thirdPayload.signal).toBe("archive");
  });
});

// ---------------------------------------------------------------------------
// Supplementary: stdout JSON shape regression — must remain
// {decision, reason, signal} unchanged from rc.2 contract.
// ---------------------------------------------------------------------------

describe("archive-hint contract — stdout JSON shape unchanged", () => {
  let root: string;
  beforeEach(() => {
    root = setupProject();
  });
  afterEach(() => {
    teardownProject(root);
  });

  it("emits {decision:'block', reason:string, signal:'archive'} shape", () => {
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ]);
    let captured = "";
    hook.main(
      { cwd: root, now: NOW },
      { stdout: { write: (chunk: string) => { captured += chunk; } } },
    );
    const payload = JSON.parse(captured);
    expect(payload.decision).toBe("block");
    expect(typeof payload.reason).toBe("string");
    expect(payload.signal).toBe("archive");
    // No extra fields beyond the 3-key contract.
    expect(Object.keys(payload).sort()).toEqual(["decision", "reason", "signal"]);
  });
});

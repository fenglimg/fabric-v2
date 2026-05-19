/**
 * v2.0.0-rc.25 TASK-11 — archive-hint stdout copy integration tests.
 *
 * Complements the in-process contract suite at
 * `packages/cli/__tests__/archive-hint.test.ts`. This file is the
 * INTEGRATION-tier counterpart: it spawns the hook via createRequire +
 * `main()` (the production CLI entry point), captures stdout, parses the
 * JSON payload, and locks the rendered `reason` copy with Vitest
 * snapshots. A drift in any of the 6 wording axes (zh-CN / en / distinct
 * vs degraded session count / rotation watermark suffix / cooldown
 * suppression) surfaces as a focused snapshot diff.
 *
 * Why integration: the unit test asserts substring matches (good for
 * intent), while these tests pin the EXACT JSON shape + multi-line
 * formatting downstream LLM clients see at runtime. The two layers
 * defend different regressions — unit catches logic drift, snapshot
 * catches wording drift.
 *
 * 6 cases per TASK-11 spec:
 *   1. events with session_id present (≥50% coverage) → "跨 N 个会话"
 *   2. events without session_id (<50% coverage) → "跨多个会话累计"
 *   3. lastProposedTs=null + rotation cutoff → "watermark 已被 rotation 清理"
 *   4. fabric_language='en' → English copy ("project-level long-term debt")
 *   5. fabric_language='zh-CN' → Chinese copy ("项目级长期欠债")
 *   6. cooldown regression — second invoke within 12h emits nothing
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../../templates/hooks/archive-hint.cjs", import.meta.url),
);

type HookModule = {
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (chunk: string) => void } },
  ) => void;
};

const hook = require(hookPath) as HookModule;

// Fixed clock — keeps the snapshot deterministic across CI runs.
const NOW_MS = Date.UTC(2026, 4, 19, 12, 0, 0);
const NOW = new Date(NOW_MS);

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop() as string;
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function setupProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `archive-hint-copy-${prefix}-`));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeEvents(root: string, events: Array<Record<string, unknown>>): void {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(root, ".fabric", "events.jsonl"), lines);
}

function writeFabricConfig(root: string, config: Record<string, unknown>): void {
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify(config),
  );
}

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

/**
 * Run the production `main()` entry point in-process, capture stdout, and
 * return the parsed JSON payload (or null when the hook stayed silent).
 */
function runHook(root: string, now: Date = NOW): unknown | null {
  let captured = "";
  hook.main(
    { cwd: root, now },
    { stdout: { write: (chunk: string) => { captured += chunk; } } },
  );
  if (captured.length === 0) return null;
  return JSON.parse(captured);
}

// ---------------------------------------------------------------------------
// Case 1 — distinct-session count rendering (zh-CN default)
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 1 — distinct session count", () => {
  it("renders '跨 N 个会话累计' when session_id coverage ≥50%", () => {
    const root = setupProject("case1");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
      planContextEvent(1, "session-C"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Case 2 — degraded "跨多个会话累计" wording when coverage <50%
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 2 — degraded session phrase", () => {
  it("renders '跨多个会话累计' when session_id coverage <50%", () => {
    const root = setupProject("case2");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25),
      planContextEvent(20),
      planContextEvent(15),
      planContextEvent(10),
      planContextEvent(5),
      planContextEvent(1, "session-A"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Case 3 — rotation cutoff watermark fallback
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 3 — rotation watermark fallback", () => {
  it("appends '(watermark 已被 rotation 清理)' when no knowledge_proposed exists + rotation marker", () => {
    const root = setupProject("case3");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    // No knowledge_proposed event present — simulates a post-rotation ledger.
    // rc.25 review remediation: inject an explicit `events_rotated` event so
    // the hook classifies this fixture as rotation-cut rather than truly-fresh
    // (the truly-fresh branch no longer renders the rotation suffix).
    writeEvents(root, [
      planContextEvent(40, "session-A"),
      { event_type: "events_rotated", ts: NOW_MS - 35 * 60 * 60 * 1000 },
      planContextEvent(30, "session-B"),
      planContextEvent(20, "session-C"),
      planContextEvent(10, "session-A"),
      planContextEvent(5, "session-B"),
      planContextEvent(1, "session-C"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
  });

  it("omits the rotation suffix when ledger is truly fresh", () => {
    // Brand-new project: never archived, no rotation marker, small ledger.
    // The fallback still fires so hoursElapsed renders, but the suffix MUST
    // be suppressed — claiming rotation cleared the watermark would
    // mislead first-time users.
    const root = setupProject("case3-fresh");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    writeEvents(root, [
      planContextEvent(40, "session-A"),
      planContextEvent(30, "session-B"),
      planContextEvent(20, "session-C"),
      planContextEvent(10, "session-A"),
      planContextEvent(5, "session-B"),
      planContextEvent(1, "session-C"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Case 4 — English variant
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 4 — fabric_language=en", () => {
  it("renders English copy with 'project-level long-term debt' phrase", () => {
    const root = setupProject("case4");
    writeFabricConfig(root, { fabric_language: "en" });
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
    // Belt-and-braces invariant — snapshot may drift independently of this
    // contract, but the en variant MUST always contain this load-bearing
    // substring per rc.25 TASK-03 spec.
    expect(JSON.stringify(payload)).toContain("project-level long-term debt");
  });
});

// ---------------------------------------------------------------------------
// Case 5 — zh-CN explicit
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 5 — fabric_language=zh-CN explicit", () => {
  it("renders Chinese copy with '项目级长期欠债' phrase", () => {
    const root = setupProject("case5");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ]);

    const payload = runHook(root);
    expect(payload).toMatchSnapshot();
    // Belt-and-braces invariant on the load-bearing substring.
    expect(JSON.stringify(payload)).toContain("项目级长期欠债");
  });
});

// ---------------------------------------------------------------------------
// Case 6 — cooldown regression
// ---------------------------------------------------------------------------

describe("TASK-11 archive-hint copy: case 6 — cooldown regression", () => {
  it("suppresses stdout on second invoke within 12h cooldown window", () => {
    const root = setupProject("case6");
    writeFabricConfig(root, { fabric_language: "zh-CN" });
    writeEvents(root, [
      proposedEvent(30),
      planContextEvent(25, "session-A"),
      planContextEvent(20, "session-B"),
      planContextEvent(15, "session-A"),
      planContextEvent(10, "session-C"),
      planContextEvent(5, "session-B"),
    ]);

    const first = runHook(root);
    expect(first).not.toBeNull();
    expect(first).toMatchSnapshot("first invoke (writes cache)");

    // 1h later — still inside 12h cooldown → silent.
    const second = runHook(root, new Date(NOW_MS + 60 * 60 * 1000));
    expect(second).toBeNull();

    // 13h later — past cooldown → emits again.
    const third = runHook(root, new Date(NOW_MS + 13 * 60 * 60 * 1000));
    expect(third).not.toBeNull();
  });
});

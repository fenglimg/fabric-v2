/**
 * v2.0.0-rc.34 TASK-06: unit tests for cite-policy long-session evict sidecar
 * (packages/cli/templates/hooks/cite-policy-evict.cjs).
 *
 * Covers:
 *   1. `evaluateCiteEvict` pure helper contract (window math, off-state, guards)
 *   2. State sidecar read/write round-trip + corruption tolerance
 *   3. Config read defaults + override
 *   4. main() end-to-end via stdin payload injection + stdout envelope check
 *   5. Reminder body contract (cite-policy keywords present)
 *
 * The hook script is invoked thousands of times in long sessions; defensive
 * exits MUST keep it silent on every failure mode (per rc.34 plan §7 risk
 * mitigation + the never-block-on-failure invariant shared with all fabric
 * hooks). Tests pin each defensive branch.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hook = require("../templates/hooks/cite-policy-evict.cjs") as {
  evaluateCiteEvict: (turnCount: unknown, interval: unknown) => boolean;
  renderReminder: (turnCount: number, interval: number) => string;
  readEvictInterval: (cwd: string) => number;
  readEvictState: (cwd: string) => { session_id: string; turn_count: number } | null;
  writeEvictState: (cwd: string, sessionId: string, turnCount: number) => void;
  main: (env?: {
    cwd?: string;
    payload?: { session_id?: string } | null;
    forceClaudeCode?: boolean;
    stdio?: { stdout?: { write: (s: string) => boolean | void } };
  }) => Promise<void>;
};

let tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rc34-task06-cite-evict-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(cwd: string, body: object): void {
  const dir = join(cwd, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fabric-config.json"), JSON.stringify(body));
}

class StdoutCapture {
  chunks: string[] = [];
  write = (s: string): boolean => {
    this.chunks.push(s);
    return true;
  };
  joined(): string {
    return this.chunks.join("");
  }
}

describe("evaluateCiteEvict (rc.34 TASK-06)", () => {
  it("emits when turn_count divides interval", () => {
    expect(hook.evaluateCiteEvict(10, 10)).toBe(true);
    expect(hook.evaluateCiteEvict(20, 10)).toBe(true);
    expect(hook.evaluateCiteEvict(30, 10)).toBe(true);
  });

  it("does NOT emit on non-boundary turns", () => {
    expect(hook.evaluateCiteEvict(5, 10)).toBe(false);
    expect(hook.evaluateCiteEvict(15, 10)).toBe(false);
    expect(hook.evaluateCiteEvict(1, 10)).toBe(false);
    expect(hook.evaluateCiteEvict(9, 10)).toBe(false);
  });

  it("interval <= 0 → never emit (feature off)", () => {
    expect(hook.evaluateCiteEvict(10, 0)).toBe(false);
    expect(hook.evaluateCiteEvict(10, -1)).toBe(false);
    expect(hook.evaluateCiteEvict(100, 0)).toBe(false);
  });

  it("turnCount <= 0 → never emit (guard against bogus state)", () => {
    expect(hook.evaluateCiteEvict(0, 10)).toBe(false);
    expect(hook.evaluateCiteEvict(-5, 10)).toBe(false);
  });

  it("non-number inputs → never emit (defensive)", () => {
    expect(hook.evaluateCiteEvict("10", 10)).toBe(false);
    expect(hook.evaluateCiteEvict(10, "10")).toBe(false);
    expect(hook.evaluateCiteEvict(null, 10)).toBe(false);
    expect(hook.evaluateCiteEvict(undefined, undefined)).toBe(false);
  });
});

describe("readEvictInterval (rc.34 TASK-06 / rc.37 NEW-18 default flip)", () => {
  // v2.0.0-rc.37 NEW-18: DEFAULT_CITE_EVICT_INTERVAL flipped 0 (opt-in OFF) →
  // 10 (default ON every 10 turns). Operators can still set cite_evict_interval=0
  // explicitly to opt back out. The 'default' assertions below now pin the new 10.
  it("returns default 10 when fabric-config.json missing (rc.37 NEW-18)", () => {
    const cwd = mkTemp();
    expect(hook.readEvictInterval(cwd)).toBe(10);
  });

  it("returns parsed value when config has cite_evict_interval", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 15 });
    expect(hook.readEvictInterval(cwd)).toBe(15);
  });

  it("explicit opt-out (cite_evict_interval=0) is honored — disables emission", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 0 });
    expect(hook.readEvictInterval(cwd)).toBe(0);
  });

  it("returns default 10 when config value is non-integer or negative", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: -5 });
    expect(hook.readEvictInterval(cwd)).toBe(10);
    writeConfig(cwd, { cite_evict_interval: "10" });
    expect(hook.readEvictInterval(cwd)).toBe(10);
    writeConfig(cwd, { cite_evict_interval: 3.14 });
    expect(hook.readEvictInterval(cwd)).toBe(10);
  });

  it("returns default 10 on malformed JSON (defensive)", () => {
    const cwd = mkTemp();
    mkdirSync(join(cwd, ".fabric"), { recursive: true });
    writeFileSync(join(cwd, ".fabric", "fabric-config.json"), "{ not valid json");
    expect(hook.readEvictInterval(cwd)).toBe(10);
  });
});

describe("readEvictState / writeEvictState round-trip (rc.34 TASK-06)", () => {
  it("returns null when sidecar missing", () => {
    const cwd = mkTemp();
    expect(hook.readEvictState(cwd)).toBeNull();
  });

  it("writes + reads back same shape", () => {
    const cwd = mkTemp();
    hook.writeEvictState(cwd, "session-abc", 7);
    const state = hook.readEvictState(cwd);
    expect(state).toEqual({ session_id: "session-abc", turn_count: 7 });
  });

  it("creates .fabric/.cache/ if absent (defensive mkdir)", () => {
    const cwd = mkTemp();
    hook.writeEvictState(cwd, "session-xyz", 3);
    expect(existsSync(join(cwd, ".fabric", ".cache", "cite-evict-state.json"))).toBe(true);
  });

  it("returns null on corrupted sidecar (malformed JSON)", () => {
    const cwd = mkTemp();
    const sidecarPath = join(cwd, ".fabric", ".cache", "cite-evict-state.json");
    mkdirSync(dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, "not json");
    expect(hook.readEvictState(cwd)).toBeNull();
  });

  it("returns null when sidecar schema invalid (missing turn_count)", () => {
    const cwd = mkTemp();
    const sidecarPath = join(cwd, ".fabric", ".cache", "cite-evict-state.json");
    mkdirSync(dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, JSON.stringify({ session_id: "x" }));
    expect(hook.readEvictState(cwd)).toBeNull();
  });
});

describe("renderReminder (rc.34 TASK-06)", () => {
  const body = hook.renderReminder(20, 10);

  it("includes the cite contract format anchor", () => {
    expect(body).toContain("KB: <id>");
    expect(body).toContain("KB: none");
  });

  it("references the two-step verification for [recalled]", () => {
    expect(body).toContain("fab_plan_context");
    expect(body).toContain("fab_get_knowledge_sections");
  });

  it("documents the contract operator vocabulary", () => {
    expect(body).toContain("edit:<glob>");
    expect(body).toContain("require:<symbol>");
    expect(body).toContain("forbid:<symbol>");
  });

  it("includes skip reason dictionary", () => {
    expect(body).toMatch(/sequencing.*conditional.*semantic/);
  });

  it("includes turn+interval context for operator awareness", () => {
    expect(body).toContain("turn 20");
    expect(body).toContain("interval 10");
  });

  it("declares non-blocking nature (audit only)", () => {
    expect(body).toContain("does not block");
  });
});

describe("main() end-to-end (rc.34 TASK-06)", () => {
  it("silent exit when interval is 0 (feature off)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 0 });
    const stdout = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "test-session" },
      forceClaudeCode: true,
      stdio: { stdout },
    });
    expect(stdout.joined()).toBe("");
  });

  it("on first invocation with interval=1, fires immediately + writes state", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 1 });
    const stdout = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "session-1" },
      forceClaudeCode: true,
      stdio: { stdout },
    });
    const output = stdout.joined();
    expect(output).toContain("hookSpecificOutput");
    expect(output).toContain("UserPromptSubmit");
    expect(output).toContain("additionalContext");
    expect(output).toContain("cite-evict");
    const state = hook.readEvictState(cwd);
    expect(state).toEqual({ session_id: "session-1", turn_count: 1 });
  });

  it("does NOT fire on turn 5 when interval=10, but fires on turn 10", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 10 });

    // Simulate 9 turns already accumulated.
    hook.writeEvictState(cwd, "session-long", 9);

    // 10th turn — should fire.
    const stdout10 = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "session-long" },
      forceClaudeCode: true,
      stdio: { stdout: stdout10 },
    });
    expect(stdout10.joined()).toContain("turn 10");
    expect(stdout10.joined()).toContain("interval 10");
    expect(hook.readEvictState(cwd)?.turn_count).toBe(10);

    // 11th turn — should NOT fire.
    const stdout11 = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "session-long" },
      forceClaudeCode: true,
      stdio: { stdout: stdout11 },
    });
    expect(stdout11.joined()).toBe("");
    expect(hook.readEvictState(cwd)?.turn_count).toBe(11);
  });

  it("resets counter to 1 on new session_id (session boundary)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 10 });
    hook.writeEvictState(cwd, "session-A", 7);

    const stdout = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "session-B" },
      forceClaudeCode: true,
      stdio: { stdout },
    });

    const state = hook.readEvictState(cwd);
    expect(state?.session_id).toBe("session-B");
    expect(state?.turn_count).toBe(1);
    // turn 1 % 10 !== 0 → no reminder
    expect(stdout.joined()).toBe("");
  });

  it("simulated 30-turn session, interval=10, reminder fires exactly 3 times", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 10 });
    const sessionId = "session-stress";

    let fireCount = 0;
    for (let i = 1; i <= 30; i++) {
      const stdout = new StdoutCapture();
      await hook.main({
        cwd,
        payload: { session_id: sessionId },
        forceClaudeCode: true,
        stdio: { stdout },
      });
      if (stdout.joined().includes("hookSpecificOutput")) {
        fireCount++;
      }
    }
    expect(fireCount).toBe(3); // turns 10, 20, 30
    expect(hook.readEvictState(cwd)?.turn_count).toBe(30);
  });

  it("silent exit on non-Claude-Code clients (CLAUDE_PROJECT_DIR absent + forceClaudeCode=false)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 1 });
    const stdout = new StdoutCapture();
    const prevEnv = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      await hook.main({
        cwd,
        payload: { session_id: "test" },
        stdio: { stdout },
      });
      expect(stdout.joined()).toBe("");
    } finally {
      if (prevEnv !== undefined) process.env.CLAUDE_PROJECT_DIR = prevEnv;
    }
  });

  it("handles missing payload (anonymous session_id) without crashing", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 1 });
    const stdout = new StdoutCapture();
    await hook.main({
      cwd,
      payload: null,
      forceClaudeCode: true,
      stdio: { stdout },
    });
    // interval=1 fires on turn 1 — should produce output despite anonymous session
    expect(stdout.joined()).toContain("hookSpecificOutput");
    const state = hook.readEvictState(cwd);
    expect(state?.session_id).toBe("anonymous");
  });
});

describe("read JSON envelope content (rc.34 TASK-06)", () => {
  it("emitted envelope is valid JSON parseable by hostHook", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_evict_interval: 1 });
    const stdout = new StdoutCapture();
    await hook.main({
      cwd,
      payload: { session_id: "json-test" },
      forceClaudeCode: true,
      stdio: { stdout },
    });
    const raw = stdout.joined().trim();
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("KB: <id>");
  });
});

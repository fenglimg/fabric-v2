/**
 * v2.0.0-rc.37 NEW-16: unit + integration tests for fabric-hint per-signal
 * dismiss (config-durable hint_dismiss_signals + session-scoped sidecar).
 *
 * Pins: dismiss-set union (config ∪ sidecar), writeSessionDismiss additive
 * merge, bilingual dismiss-option line, and end-to-end main() suppression of
 * a triggering archive signal when its type is dismissed.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hook = require("../templates/hooks/fabric-hint.cjs") as {
  readDismissedSignals: (cwd: string, sessionId: string | null) => Set<string>;
  writeSessionDismiss: (cwd: string, sessionId: string, signals: string[]) => void;
  sessionDismissFileName: (sessionId: string) => string;
  renderDismissOption: (signal: string, variant: string) => string;
  DISMISSABLE_SIGNALS: string[];
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (s: string) => void } },
  ) => void;
};

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "rc37-new16-dismiss-"));
  mkdirSync(join(cwd, ".fabric"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeConfig(body: object): void {
  writeFileSync(join(cwd, ".fabric", "fabric-config.json"), JSON.stringify(body));
}

describe("fabric-hint dismiss helpers (rc.37 NEW-16)", () => {
  it("DISMISSABLE_SIGNALS covers the five signal types (crack 2 added archive_backlog)", () => {
    expect(new Set(hook.DISMISSABLE_SIGNALS)).toEqual(
      new Set(["archive", "archive_backlog", "review", "import", "maintenance"]),
    );
  });

  it("reads config-durable hint_dismiss_signals (filtered to known types)", () => {
    writeConfig({ hint_dismiss_signals: ["archive", "bogus", "review"] });
    const d = hook.readDismissedSignals(cwd, null);
    expect(d.has("archive")).toBe(true);
    expect(d.has("review")).toBe(true);
    expect(d.has("bogus")).toBe(false);
  });

  it("unions config + session sidecar", () => {
    writeConfig({ hint_dismiss_signals: ["archive"] });
    hook.writeSessionDismiss(cwd, "sess-1", ["import"]);
    const d = hook.readDismissedSignals(cwd, "sess-1");
    expect([...d].sort()).toEqual(["archive", "import"]);
  });

  it("writeSessionDismiss merges additively + filters unknown", () => {
    hook.writeSessionDismiss(cwd, "s", ["review", "nope"]);
    hook.writeSessionDismiss(cwd, "s", ["maintenance"]);
    expect([...hook.readDismissedSignals(cwd, "s")].sort()).toEqual(["maintenance", "review"]);
  });

  it("renderDismissOption is bilingual + names the signal", () => {
    expect(hook.renderDismissOption("archive", "zh-CN")).toContain("hint_dismiss_signals");
    expect(hook.renderDismissOption("archive", "zh-CN")).toContain("archive");
    expect(hook.renderDismissOption("review", "en")).toMatch(/Silence this nudge/);
  });

  it("sanitises unsafe session ids into the sidecar filename", () => {
    expect(hook.sessionDismissFileName("a/b")).toBe("hint-dismiss-a-b.json");
  });
});

describe("fabric-hint main() dismiss suppression (rc.37 NEW-16)", () => {
  const NOW_MS = 1_750_000_000_000;
  const now = new Date(NOW_MS);

  function seedArchiveTrigger(): void {
    // crack 1: archive Signal A fires on the per-session file_mutated count.
    // Seed session "s1" with a first-activity anchor + a high-value event (so
    // the D6 value-gate passes) + 20 mutations past the anchor.
    const base = NOW_MS - 5 * 60 * 60 * 1000;
    const lines: Record<string, unknown>[] = [
      { kind: "fabric-event", schema_version: 1, id: "event:eic:anchor", event_type: "edit_intent_checked", ts: base, session_id: "s1", path: "src/anchor.ts" },
      { kind: "fabric-event", schema_version: 1, id: "event:eic:hv", event_type: "edit_intent_checked", ts: base + 30000, session_id: "s1", path: "src/hv.ts" },
    ];
    for (let i = 1; i <= 20; i += 1) {
      lines.push({ kind: "fabric-event", schema_version: 1, id: `event:fm:${i}`, event_type: "file_mutated", ts: base + i * 60000, session_id: "s1", path: `src/f${i}.ts`, tool_call_id: `tc-${i}` });
    }
    writeFileSync(join(cwd, ".fabric", "events.jsonl"), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  }

  it("emits archive nudge (soft dual-sink, with dismiss-option line) when NOT dismissed", () => {
    const prev = process.env.FABRIC_HINT_CLIENT;
    const prevDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      seedArchiveTrigger();
      const writes: string[] = [];
      hook.main({ cwd, now, stdin_payload: { session_id: "s1" } }, { stdout: { write: (s) => writes.push(s) } });
      expect(writes).toHaveLength(1);
      const env = JSON.parse(writes[0]) as { decision?: string; systemMessage?: string };
      expect(env.decision).toBeUndefined(); // soft, not block (D3)
      expect(env.systemMessage).toContain("hint_dismiss_signals");
    } finally {
      if (prev === undefined) delete process.env.FABRIC_HINT_CLIENT;
      else process.env.FABRIC_HINT_CLIENT = prev;
      if (prevDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prevDir;
    }
  });

  it("stays silent when archive is dismissed via config", () => {
    seedArchiveTrigger();
    writeConfig({ hint_dismiss_signals: ["archive"] });
    const writes: string[] = [];
    hook.main({ cwd, now, stdin_payload: { session_id: "s1" } }, { stdout: { write: (s) => writes.push(s) } });
    expect(writes).toEqual([]);
  });

  it("value-gate (D6): Signal A trigger but NO high-value signal → silent", () => {
    // crack 1: 21 session mutations cross the threshold (anchor = first mutation,
    // 20 counted past it), but with NO high-value event the value-gate suppresses
    // the nudge. nudge_mode silent mutes the orthogonal activity breadcrumb.
    const base = NOW_MS - 5 * 60 * 60 * 1000;
    const lines: Record<string, unknown>[] = [];
    for (let i = 0; i <= 20; i += 1) {
      lines.push({ kind: "fabric-event", schema_version: 1, id: `event:fm:${i}`, event_type: "file_mutated", ts: base + i * 60000, session_id: "s1", path: `src/f${i}.ts`, tool_call_id: `tc-${i}` });
    }
    writeFileSync(join(cwd, ".fabric", "events.jsonl"), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    writeConfig({ nudge_mode: "silent" });
    const writes: string[] = [];
    hook.main({ cwd, now, stdin_payload: { session_id: "s1" } }, { stdout: { write: (s) => writes.push(s) } });
    expect(writes).toEqual([]);
  });
});

/**
 * v2.0.0-rc.37 NEW-30: unit tests for the shared client-protocol adapter
 * (templates/hooks/lib/client-adapter.cjs).
 *
 * Pins the 3-tier client detection (env override → CLAUDE_PROJECT_DIR → path
 * heuristic), and the channel-aware emitContext (Claude Code stdout JSON
 * envelope vs Codex stderr, plus forceStderr override).
 * Never-throw contract is implicit — emitContext swallows write failures.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const adapter = require("../templates/hooks/lib/client-adapter.cjs") as {
  isClaudeCode: () => boolean;
  detectClient: (dirnameHint?: string) => "cc" | "codex" | undefined;
  emitContext: (
    text: string,
    opts?: {
      client?: string;
      eventName?: string;
      streams?: { stdout?: { write: (s: string) => void }; stderr?: { write: (s: string) => void } };
      forceStderr?: boolean;
    },
  ) => void;
  emitDualSink: (
    payload: { human?: string | null; ai?: string | null },
    opts?: {
      client?: string;
      eventName?: string;
      streams?: { stdout?: { write: (s: string) => void }; stderr?: { write: (s: string) => void } };
    },
  ) => void;
};

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

beforeEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.FABRIC_HINT_CLIENT;
});

function capture(): { lines: string[]; stream: { write: (s: string) => void } } {
  const lines: string[] = [];
  return { lines, stream: { write: (s: string) => lines.push(s) } };
}

describe("client-adapter.cjs detectClient", () => {
  it("FABRIC_HINT_CLIENT env override wins", () => {
    process.env.FABRIC_HINT_CLIENT = "codex";
    expect(adapter.detectClient("/whatever/.claude/hooks/lib")).toBe("codex");
  });

  it("CLAUDE_PROJECT_DIR presence → cc", () => {
    process.env.CLAUDE_PROJECT_DIR = "/repo";
    expect(adapter.detectClient()).toBe("cc");
    expect(adapter.isClaudeCode()).toBe(true);
  });

  it("path heuristic resolves cc / codex", () => {
    expect(adapter.detectClient("/x/.claude/hooks/lib")).toBe("cc");
    expect(adapter.detectClient("/x/.codex/hooks/lib")).toBe("codex");
  });

  it("returns undefined when no signal fires", () => {
    expect(adapter.detectClient("/x/somewhere/else")).toBeUndefined();
  });
});

describe("client-adapter.cjs emitContext", () => {
  it("Claude Code → stdout JSON envelope", () => {
    const out = capture();
    adapter.emitContext("hello", { client: "cc", eventName: "UserPromptSubmit", streams: { stdout: out.stream } });
    expect(out.lines).toHaveLength(1);
    const parsed = JSON.parse(out.lines[0]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("hello");
  });

  it("Codex (non-cc client) → plain stderr", () => {
    const err = capture();
    adapter.emitContext("nudge", { client: "codex", streams: { stderr: err.stream } });
    expect(err.lines).toEqual(["nudge\n"]);
  });

  it("forceStderr pins stderr even when client is cc", () => {
    const out = capture();
    const err = capture();
    adapter.emitContext("oneshot", {
      client: "cc",
      forceStderr: true,
      streams: { stdout: out.stream, stderr: err.stream },
    });
    expect(out.lines).toHaveLength(0);
    expect(err.lines).toEqual(["oneshot\n"]);
  });
});

// ---------------------------------------------------------------------------
// v2.2 dual-sink (Goal A / D7): emitDualSink — two-channel emit.
// ---------------------------------------------------------------------------
describe("client-adapter.cjs emitDualSink", () => {
  it("cc → one stdout envelope with systemMessage(human) + nested additionalContext(ai)", () => {
    const out = capture();
    adapter.emitDualSink(
      { human: "▸ banner", ai: "RULES …" },
      { client: "cc", eventName: "SessionStart", streams: { stdout: out.stream } },
    );
    expect(out.lines).toHaveLength(1);
    const parsed = JSON.parse(out.lines[0]);
    expect(parsed.systemMessage).toBe("▸ banner");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("RULES …");
  });

  it("codex → symmetric with cc (same camelCase nested envelope)", () => {
    const out = capture();
    adapter.emitDualSink(
      { human: "H", ai: "A" },
      { client: "codex", eventName: "PreToolUse", streams: { stdout: out.stream } },
    );
    expect(out.lines).toHaveLength(1);
    const parsed = JSON.parse(out.lines[0]);
    expect(parsed.systemMessage).toBe("H");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("A");
  });

  it("cc human-only (ai null) → envelope carries only systemMessage", () => {
    const out = capture();
    adapter.emitDualSink({ human: "H", ai: null }, { client: "cc", streams: { stdout: out.stream } });
    const parsed = JSON.parse(out.lines[0]);
    expect(parsed.systemMessage).toBe("H");
    expect(parsed.hookSpecificOutput).toBeUndefined();
  });

  it("cc ai-only (human null, e.g. PreToolUse miss / silent mode) → only additionalContext", () => {
    const out = capture();
    adapter.emitDualSink({ human: null, ai: "A" }, { client: "cc", streams: { stdout: out.stream } });
    const parsed = JSON.parse(out.lines[0]);
    expect(parsed.systemMessage).toBeUndefined();
    expect(parsed.hookSpecificOutput.additionalContext).toBe("A");
  });

  it("cc both-empty → writes nothing", () => {
    const out = capture();
    adapter.emitDualSink({ human: null, ai: null }, { client: "cc", streams: { stdout: out.stream } });
    expect(out.lines).toHaveLength(0);
  });

  it("unknown client → stderr fallback breadcrumb (human preferred)", () => {
    const out = capture();
    const err = capture();
    adapter.emitDualSink(
      { human: "H", ai: "A" },
      { client: undefined, streams: { stdout: out.stream, stderr: err.stream } },
    );
    // detection falls through to undefined (no env, dirnameHint default not cc) in CI;
    // guard against the test host happening to set CLAUDE_PROJECT_DIR.
    if (out.lines.length === 0) {
      expect(err.lines).toEqual(["H\n"]);
    } else {
      // host detected as cc — envelope path; still no throw, systemMessage present
      expect(JSON.parse(out.lines[0]).systemMessage).toBe("H");
    }
  });
});

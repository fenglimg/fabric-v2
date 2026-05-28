/**
 * v2.0.0-rc.37 NEW-30: unit tests for the shared client-protocol adapter
 * (templates/hooks/lib/client-adapter.cjs).
 *
 * Pins the 3-tier client detection (env override → CLAUDE_PROJECT_DIR → path
 * heuristic incl. .cursor), and the channel-aware emitContext (Claude Code
 * stdout JSON envelope vs Codex/Cursor stderr, plus forceStderr override).
 * Never-throw contract is implicit — emitContext swallows write failures.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const adapter = require("../templates/hooks/lib/client-adapter.cjs") as {
  isClaudeCode: () => boolean;
  detectClient: (dirnameHint?: string) => "cc" | "codex" | "cursor" | undefined;
  emitContext: (
    text: string,
    opts?: {
      client?: string;
      eventName?: string;
      streams?: { stdout?: { write: (s: string) => void }; stderr?: { write: (s: string) => void } };
      forceStderr?: boolean;
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
    process.env.FABRIC_HINT_CLIENT = "Cursor";
    expect(adapter.detectClient("/whatever/.codex/hooks/lib")).toBe("cursor");
  });

  it("CLAUDE_PROJECT_DIR presence → cc", () => {
    process.env.CLAUDE_PROJECT_DIR = "/repo";
    expect(adapter.detectClient()).toBe("cc");
    expect(adapter.isClaudeCode()).toBe(true);
  });

  it("path heuristic resolves cc / codex / cursor", () => {
    expect(adapter.detectClient("/x/.claude/hooks/lib")).toBe("cc");
    expect(adapter.detectClient("/x/.codex/hooks/lib")).toBe("codex");
    expect(adapter.detectClient("/x/.cursor/hooks/lib")).toBe("cursor");
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

  it("Codex/Cursor (non-cc client) → plain stderr", () => {
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

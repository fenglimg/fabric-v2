/**
 * Contract tests for templates/hooks/knowledge-hint-subagent.cjs (W5 #6 —
 * SubagentStart knowledge injection).
 *
 * In-process invocation only (no child_process.spawn in CI); the CLI call is
 * stubbed through the same `env.payload` seam knowledge-hint-broad uses.
 *
 * These assert BEHAVIOUR, not the presence of constants. The hook was written
 * with a full wiring pass — config templates, install/uninstall steps, validate
 * rows — and every one of those was green while the hook itself emitted
 * nothing: install tests only prove the FILE arrives, never that running it
 * produces an envelope. So each test here fails if the hook goes silent.
 */

import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/knowledge-hint-subagent.cjs", import.meta.url),
);
const broadPath = fileURLToPath(
  new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url),
);

type Env = Record<string, unknown>;
type Hook = {
  main: (env: Env, stdio: { stdout: Sink; stderr: Sink }) => void;
  preamble: (zh: boolean) => string;
};
type Sink = { write: (chunk: string) => void };

const hook = require_(hookPath) as Hook;
const broad = require_(broadPath) as {
  readBroadLastEmit: (cwd: string) => number | null;
};

function capture(): { sink: Sink; text: () => string } {
  const chunks: string[] = [];
  return { sink: { write: (c: string) => chunks.push(String(c)) }, text: () => chunks.join("") };
}

function payloadWith(ids: string[]) {
  return {
    version: 2 as const,
    revision_hash: "rev-subagent",
    target_paths: ["**"],
    entries: ids.map((id) => ({
      id,
      type: "decisions",
      maturity: "proven",
      summary: `standing rule for ${id}`,
      relevance_scope: "broad",
    })),
    broad_count: ids.length,
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fabric-subagent-hook-"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  // detectClient() reads the environment; pin the CC envelope shape so the
  // assertions below are about the hook, not about ambient client detection.
  process.env.CLAUDE_PROJECT_DIR = root;
});

afterEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  rmSync(root, { recursive: true, force: true });
});

function run(env: Env = {}) {
  const out = capture();
  const err = capture();
  hook.main({ cwd: root, payload: payloadWith(["KT-DEC-0001"]), ...env }, {
    stdout: out.sink,
    stderr: err.sink,
  });
  return { out: out.text(), err: err.text() };
}

describe("knowledge-hint-subagent: emits the standing index into the sub-agent", () => {
  it("writes a stdout envelope carrying the broad entry the dispatcher would have seen", () => {
    const { out } = run();
    expect(out.length).toBeGreaterThan(0);
    const envelope = JSON.parse(out.trim()) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(envelope.hookSpecificOutput?.additionalContext).toContain("KT-DEC-0001");
  });

  it("tags the envelope SubagentStart, not SessionStart", () => {
    // The renderer is shared with the SessionStart hook, so the event name is
    // the one field a copy-paste would silently get wrong — and a mislabelled
    // envelope is dropped by the client rather than erroring.
    const { out } = run();
    const envelope = JSON.parse(out.trim()) as {
      hookSpecificOutput?: { hookEventName?: string };
    };
    expect(envelope.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
  });

  it("emits no systemMessage — the human already got this census at SessionStart", () => {
    const { out } = run();
    const envelope = JSON.parse(out.trim()) as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("systemMessage");
  });

  it("prefixes the index with the no-inheritance framing", () => {
    // Without this the sub-agent has no way to know the block is new
    // information rather than a recap of context it already holds.
    const { out } = run();
    const envelope = JSON.parse(out.trim()) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = envelope.hookSpecificOutput?.additionalContext ?? "";
    // Language-agnostic on purpose: readFabricLanguage prefers the machine-wide
    // ~/.fabric/fabric-global.json, so pinning one language here would make the
    // test pass or fail on the developer's own settings. startsWith is also
    // stronger than a contains — it pins the framing AHEAD of the index, which
    // is the whole point of a preamble.
    const framings = [hook.preamble(true), hook.preamble(false)];
    expect(framings.some((p) => context.startsWith(p))).toBe(true);
  });

  it("frames fab_recall conditionally, since edit-capable sub-agents often lack MCP tools", () => {
    const en = hook.preamble(false);
    expect(en).toContain("fab_recall");
    expect(en).toMatch(/if it is not/i);
    const zh = hook.preamble(true);
    expect(zh).toContain("fab_recall");
    expect(zh).toContain("若没有");
  });
});

describe("knowledge-hint-subagent: never blocks the sub-agent", () => {
  it("stays silent when the payload is unavailable", () => {
    const { out, err } = run({ payload: null });
    expect(out).toBe("");
    expect(err).toBe("");
  });

  it("swallows a renderer throw rather than failing the dispatch", () => {
    // A malformed payload reaches the shared renderer; the sub-agent must
    // still start.
    expect(() => run({ payload: { version: 2, entries: "not-an-array" } })).not.toThrow();
  });
});

describe("knowledge-hint-subagent: does not disturb SessionStart state", () => {
  it("leaves the broad cooldown sidecar untouched", () => {
    // The broad banner's cooldown is a single shared slot. If a dispatch
    // stamped it, the human's next real SessionStart banner would be silently
    // suppressed — one hook quietly eating another hook's output. This is the
    // whole reason the sub-agent path reuses the renderer but NOT broad's
    // main().
    expect(broad.readBroadLastEmit(root)).toBeNull();
    run();
    expect(broad.readBroadLastEmit(root)).toBeNull();
  });

  it("writes no sidecar files at all under .fabric/.cache", () => {
    run();
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, ".fabric", ".cache"));
    } catch {
      entries = [];
    }
    expect(entries).toEqual([]);
  });
});

describe("knowledge-hint-subagent: language follows the machine-wide setting", () => {
  it("renders the zh-CN framing when fabric_language is zh-CN", () => {
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_language: "zh-CN" }),
    );
    const { out } = run();
    const envelope = JSON.parse(out.trim()) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = envelope.hookSpecificOutput?.additionalContext ?? "";
    // Only assert when the global config did not already pin a language —
    // readFabricLanguage prefers ~/.fabric/fabric-global.json over the repo.
    if (context.includes("你是被派发的子代理")) {
      expect(context).toContain(hook.preamble(true));
    } else {
      expect(context).toContain(hook.preamble(false));
    }
  });
});

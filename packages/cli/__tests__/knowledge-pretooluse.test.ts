/**
 * ux-w2-6: contract tests for templates/hooks/knowledge-pretooluse.cjs — the
 * single PreToolUse orchestrator that folds the narrow KB hint + the cite-recall
 * nudge into ONE envelope (was two hooks = 双弹). Loaded via createRequire, the
 * same in-process pattern as the sibling hook tests.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const hook = require(
  fileURLToPath(new URL("../templates/hooks/knowledge-pretooluse.cjs", import.meta.url)),
) as {
  mergeEnvelopes: (narrow: string, cite: string) => string | null;
  parseEnvelope: (text: string) => Record<string, unknown> | null;
};

const env = (additionalContext?: string, systemMessage?: string): string => {
  const e: Record<string, unknown> = {};
  if (systemMessage !== undefined) e.systemMessage = systemMessage;
  if (additionalContext !== undefined) {
    e.hookSpecificOutput = { hookEventName: "PreToolUse", additionalContext };
  }
  return `${JSON.stringify(e)}\n`;
};

describe("knowledge-pretooluse orchestrator — merge (ux-w2-6)", () => {
  it("returns null when neither sub-hook emitted", () => {
    expect(hook.mergeEnvelopes("", "")).toBeNull();
    expect(hook.mergeEnvelopes("   ", "not json")).toBeNull();
  });

  it("passes a single sub-hook's envelope through (narrow-only)", () => {
    const merged = hook.mergeEnvelopes(env("narrow hint"), "");
    const parsed = JSON.parse(merged as string);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("narrow hint");
  });

  it("passes a single sub-hook's envelope through (cite-only)", () => {
    const merged = hook.mergeEnvelopes("", env("改前先 fab_recall"));
    const parsed = JSON.parse(merged as string);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("改前先 fab_recall");
  });

  it("CONCATENATES both additionalContext sinks into ONE envelope (no 双弹)", () => {
    const merged = hook.mergeEnvelopes(env("narrow hint"), env("cite nudge"));
    const parsed = JSON.parse(merged as string);
    // Exactly one JSON envelope is emitted (single newline-terminated line).
    expect((merged as string).trimEnd().split("\n")).toHaveLength(1);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("narrow hint\ncite nudge");
  });

  it("merges the human systemMessage sinks too", () => {
    const merged = hook.mergeEnvelopes(env("ai-a", "human-a"), env("ai-b", "human-b"));
    const parsed = JSON.parse(merged as string);
    expect(parsed.systemMessage).toBe("human-a\nhuman-b");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("ai-a\nai-b");
  });

  it("parseEnvelope tolerates empty / malformed output", () => {
    expect(hook.parseEnvelope("")).toBeNull();
    expect(hook.parseEnvelope("garbage{")).toBeNull();
    expect(hook.parseEnvelope('{"systemMessage":"x"}')).toEqual({ systemMessage: "x" });
  });
});

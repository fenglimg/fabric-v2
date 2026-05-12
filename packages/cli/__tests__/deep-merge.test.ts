/**
 * Unit tests for the rc.2 extension to packages/cli/src/config/json.ts
 * `deepMerge`: optional `arrayAppendPaths` option that switches array-REPLACE
 * to array-APPEND-WITH-DEDUPE at specific dotted paths.
 *
 * Existing call sites pass no options and continue to see the v1 REPLACE
 * semantics (verified by mcp-config-merge.test.ts — no fixture changed).
 */

import { describe, expect, it } from "vitest";

import { deepMerge } from "../src/config/json.ts";

describe("deepMerge — backward compatibility (no options)", () => {
  it("merges plain objects recursively", () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { b: { d: 3 }, e: 4 };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
  });

  it("REPLACES arrays by default (preserves v1 semantics)", () => {
    const target = { items: [1, 2, 3] };
    const source = { items: [9] };
    expect(deepMerge(target, source)).toEqual({ items: [9] });
  });

  it("source primitives win over target objects", () => {
    expect(deepMerge({ a: { nested: true } }, { a: 7 })).toEqual({ a: 7 });
  });

  it("returns source when target is non-object", () => {
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("deepMerge — arrayAppendPaths option", () => {
  it("appends at the configured path instead of replacing", () => {
    const target = { hooks: { Stop: [{ matcher: "*", hooks: [{ command: "user-hook.sh" }] }] } };
    const source = {
      hooks: { Stop: [{ matcher: "*", hooks: [{ command: ".claude/hooks/fabric-hint.cjs" }] }] },
    };
    const result = deepMerge(target, source, { arrayAppendPaths: ["hooks.Stop"] });
    expect(result).toEqual({
      hooks: {
        Stop: [
          { matcher: "*", hooks: [{ command: "user-hook.sh" }] },
          { matcher: "*", hooks: [{ command: ".claude/hooks/fabric-hint.cjs" }] },
        ],
      },
    });
  });

  it("dedupes by inner hooks[0].command (Claude Stop shape) — re-merge is no-op", () => {
    const initial = { hooks: { Stop: [] as unknown[] } };
    const fragment = {
      hooks: { Stop: [{ matcher: "*", hooks: [{ command: ".claude/hooks/fabric-hint.cjs" }] }] },
    };
    const once = deepMerge(initial, fragment, { arrayAppendPaths: ["hooks.Stop"] });
    const twice = deepMerge(once, fragment, { arrayAppendPaths: ["hooks.Stop"] });
    expect(twice).toEqual(once);
    expect((twice.hooks.Stop as unknown[]).length).toBe(1);
  });

  it("dedupes by top-level .command (Codex Stop shape) — re-merge is no-op", () => {
    const initial: Record<string, unknown> = { events: { Stop: [] as unknown[] } };
    const fragment = { events: { Stop: [{ command: ".codex/hooks/fabric-hint.cjs" }] } };
    const once = deepMerge(initial, fragment, { arrayAppendPaths: ["events.Stop"] });
    const twice = deepMerge(once, fragment, { arrayAppendPaths: ["events.Stop"] });
    expect(twice).toEqual(once);
    const stop = (twice.events as { Stop: unknown[] }).Stop;
    expect(stop.length).toBe(1);
  });

  it("preserves user-authored Stop entries when appending fabric-archive", () => {
    const userSettings = {
      hooks: {
        Stop: [
          { matcher: "src/**", hooks: [{ command: "format.sh" }] },
          { matcher: "*", hooks: [{ command: "lint.sh" }] },
        ],
      },
    };
    const fabricFragment = {
      hooks: { Stop: [{ matcher: "*", hooks: [{ command: ".claude/hooks/fabric-hint.cjs" }] }] },
    };
    const merged = deepMerge(userSettings, fabricFragment, { arrayAppendPaths: ["hooks.Stop"] });
    expect((merged.hooks.Stop as unknown[]).length).toBe(3);
    expect(merged.hooks.Stop).toEqual([
      { matcher: "src/**", hooks: [{ command: "format.sh" }] },
      { matcher: "*", hooks: [{ command: "lint.sh" }] },
      { matcher: "*", hooks: [{ command: ".claude/hooks/fabric-hint.cjs" }] },
    ]);
  });

  it("does NOT append at unrelated array paths even when option set", () => {
    // arrayAppendPaths=['hooks.Stop'] should not change behaviour at 'plugins'
    const target = { plugins: ["a"], hooks: { Stop: [] as unknown[] } };
    const source = { plugins: ["b"], hooks: { Stop: [{ command: "x" }] } };
    const merged = deepMerge(target, source, { arrayAppendPaths: ["hooks.Stop"] });
    expect(merged.plugins).toEqual(["b"]); // REPLACE, not append
    expect((merged.hooks.Stop as unknown[]).length).toBe(1);
  });

  it("multiple arrayAppendPaths can be configured simultaneously", () => {
    const target = {
      hooks: { Stop: [{ command: "a" }] },
      events: { Stop: [{ command: "x" }] },
    };
    const source = {
      hooks: { Stop: [{ command: "b" }] },
      events: { Stop: [{ command: "y" }] },
    };
    const merged = deepMerge(target, source, {
      arrayAppendPaths: ["hooks.Stop", "events.Stop"],
    });
    expect(merged.hooks.Stop).toEqual([{ command: "a" }, { command: "b" }]);
    expect(merged.events.Stop).toEqual([{ command: "x" }, { command: "y" }]);
  });

  it("dedupe falls back to deep equality when no .command field exists", () => {
    const target = { tags: { Stop: [{ id: 1, label: "alpha" }] } };
    const source = { tags: { Stop: [{ id: 1, label: "alpha" }, { id: 2, label: "beta" }] } };
    const merged = deepMerge(target, source, { arrayAppendPaths: ["tags.Stop"] });
    expect(merged.tags.Stop).toEqual([{ id: 1, label: "alpha" }, { id: 2, label: "beta" }]);
  });

  it("nested arrayAppendPaths does not collide with same-named keys at root", () => {
    const target = { Stop: [{ command: "root-x" }], hooks: { Stop: [{ command: "nested-x" }] } };
    const source = { Stop: [{ command: "root-y" }], hooks: { Stop: [{ command: "nested-y" }] } };
    const merged = deepMerge(target, source, { arrayAppendPaths: ["hooks.Stop"] });
    // root Stop: REPLACE (path 'Stop' not in arrayAppendPaths)
    expect(merged.Stop).toEqual([{ command: "root-y" }]);
    // hooks.Stop: APPEND
    expect(merged.hooks.Stop).toEqual([{ command: "nested-x" }, { command: "nested-y" }]);
  });
});

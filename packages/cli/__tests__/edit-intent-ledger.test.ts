/**
 * rc.35 TASK-07 (P0-2) — cite-infrastructure wire-up tests.
 *
 * The PreToolUse narrow hook now appends one `edit_intent_checked` event
 * per touched path to `.fabric/events.jsonl` (ledger_source: 'hook'). This
 * test exercises the writer directly via the exported `appendEditIntentToLedger`
 * helper and also drives the hook's `main()` end-to-end to assert that the
 * production code path emits events on a PreToolUse Edit fire.
 *
 * Best-effort contract: any failure (missing .fabric/, fs error, etc.)
 * must NOT throw out of the hook — these tests assert that explicitly.
 */

import { afterEach, describe, expect, it } from "vitest";
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

import { editIntentCheckedEventSchema } from "@fenglimg/fabric-shared";

const require_ = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/knowledge-hint-narrow.cjs", import.meta.url),
);
const hook = require_(hookPath) as {
  main: (env: Record<string, unknown>, stdio: { stderr: { write(s: string): void }; stdout: { write(s: string): void } }) => void;
  appendEditIntentToLedger: (
    projectRoot: string,
    now: Date,
    paths: string[],
    toolName: string,
  ) => void;
};

const tempRoots: string[] = [];

function makeRoot(seedFabric = true): string {
  const root = mkdtempSync(join(tmpdir(), "fab-cite-infra-"));
  tempRoots.push(root);
  if (seedFabric) {
    mkdirSync(join(root, ".fabric"), { recursive: true });
  }
  return root;
}

function readEvents(root: string): unknown[] {
  const file = join(root, ".fabric", "events.jsonl");
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("appendEditIntentToLedger (direct writer)", () => {
  it("writes one edit_intent_checked event per path", () => {
    const root = makeRoot();
    hook.appendEditIntentToLedger(root, new Date("2026-05-26T12:00:00Z"), ["src/foo.ts", "src/bar.ts"], "Edit");

    const events = readEvents(root);
    expect(events).toHaveLength(2);
    for (const ev of events) {
      const parsed = editIntentCheckedEventSchema.parse(ev);
      expect(parsed.event_type).toBe("edit_intent_checked");
      expect(parsed.ledger_source).toBe("hook");
      expect(parsed.intent).toBe("Edit");
      expect(parsed.compliant).toBe(true);
      expect(typeof parsed.ledger_entry_id).toBe("string");
      expect(parsed.ledger_entry_id.startsWith("hook:")).toBe(true);
    }
    const paths = events.map((e) => (e as { path: string }).path).sort();
    expect(paths).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("groups all paths from a single hook fire under the same ledger_entry_id", () => {
    const root = makeRoot();
    hook.appendEditIntentToLedger(root, new Date(), ["a.ts", "b.ts", "c.ts"], "MultiEdit");
    const events = readEvents(root);
    const ids = new Set(events.map((e) => (e as { ledger_entry_id: string }).ledger_entry_id));
    expect(ids.size).toBe(1);
  });

  it("normalises absolute paths under projectRoot to relative POSIX form", () => {
    const root = makeRoot();
    hook.appendEditIntentToLedger(root, new Date(), [join(root, "src/foo.ts")], "Write");
    const events = readEvents(root);
    expect(events).toHaveLength(1);
    expect((events[0] as { path: string }).path).toBe("src/foo.ts");
  });

  it("silently skips paths escaping projectRoot", () => {
    const root = makeRoot();
    hook.appendEditIntentToLedger(root, new Date(), ["../escape.ts", "src/keep.ts"], "Edit");
    const events = readEvents(root);
    expect(events).toHaveLength(1);
    expect((events[0] as { path: string }).path).toBe("src/keep.ts");
  });

  it("silently skips when paths is empty (counter signal preserved elsewhere)", () => {
    const root = makeRoot();
    hook.appendEditIntentToLedger(root, new Date(), [], "Edit");
    expect(readEvents(root)).toHaveLength(0);
  });

  it("silently skips when .fabric/ does not exist (project not init'd)", () => {
    const root = makeRoot(false); // no .fabric/ seeded
    expect(() => {
      hook.appendEditIntentToLedger(root, new Date(), ["src/foo.ts"], "Edit");
    }).not.toThrow();
    expect(existsSync(join(root, ".fabric", "events.jsonl"))).toBe(false);
  });

  it("concurrent appends preserve every line (small-write atomicity)", () => {
    const root = makeRoot();
    // 10 successive append calls — each well under PIPE_BUF, append is atomic
    // at the OS level.
    for (let i = 0; i < 10; i++) {
      hook.appendEditIntentToLedger(root, new Date(), [`src/path-${i}.ts`], "Edit");
    }
    const events = readEvents(root);
    expect(events).toHaveLength(10);
    // Every line must be parseable JSON (no partial writes).
    for (const ev of events) {
      expect(() => editIntentCheckedEventSchema.parse(ev)).not.toThrow();
    }
  });
});

describe("hook main() end-to-end emits edit_intent_checked", () => {
  it("PreToolUse Edit fire appends one event per touched path", () => {
    const root = makeRoot();
    writeFileSync(join(root, "src.ts"), "// touched\n", "utf8");

    const stderr: string[] = [];
    const stdout: string[] = [];
    hook.main(
      {
        cwd: root,
        now: new Date(),
        payload: {
          tool_name: "Edit",
          tool_input: { file_path: join(root, "src.ts") },
        },
        // Short-circuit the CLI spawn so the hook does not need a built
        // fabric binary. Empty entries → silence path, but the counter and
        // ledger writes happen BEFORE the silence early-return.
        cliResult: { version: 2, revision_hash: "rev-1", target_paths: ["src.ts"], entries: [], broad_count: 0, narrow_count: 0 },
      },
      { stderr: { write: (s: string) => stderr.push(s) }, stdout: { write: (s: string) => stdout.push(s) } },
    );

    const events = readEvents(root);
    expect(events).toHaveLength(1);
    const parsed = editIntentCheckedEventSchema.parse(events[0]);
    expect(parsed.ledger_source).toBe("hook");
    expect(parsed.intent).toBe("Edit");
    expect(parsed.path).toBe("src.ts");
  });
});

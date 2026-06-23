/**
 * ux-w2-9: contract tests for templates/hooks/lib/event-writer.cjs — the single
 * guarded events.jsonl write path for .cjs hooks. Loaded via createRequire (no
 * child_process), matching the other hook contract tests.
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const writerPath = fileURLToPath(
  new URL("../templates/hooks/lib/event-writer.cjs", import.meta.url),
);
const { appendEvent, appendEvents, stampEvent } = require(writerPath) as {
  appendEvent: (fabricDir: string, event: unknown) => boolean;
  appendEvents: (fabricDir: string, events: unknown[]) => number;
  stampEvent: (event: unknown) => Record<string, unknown> | null;
};

let fabricDir: string;

beforeEach(() => {
  fabricDir = mkdtempSync(join(tmpdir(), "fabric-event-writer-"));
});
afterEach(() => {
  rmSync(fabricDir, { recursive: true, force: true });
});

function readLedger(): Record<string, unknown>[] {
  const path = join(fabricDir, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("event-writer.cjs — guarded events.jsonl write (ux-w2-9)", () => {
  it("stamps the canonical envelope (kind/schema_version/id/ts) on a valid event", () => {
    expect(appendEvent(fabricDir, { event_type: "file_mutated", path: "src/x.ts" })).toBe(true);
    const [row] = readLedger();
    expect(row.kind).toBe("fabric-event");
    expect(row.schema_version).toBe(1);
    expect(row.event_type).toBe("file_mutated");
    expect(typeof row.id).toBe("string");
    expect(String(row.id)).toMatch(/^event:/);
    expect(typeof row.ts).toBe("number");
    expect(row.path).toBe("src/x.ts");
  });

  it("rejects an event with no event_type — nothing is written", () => {
    expect(appendEvent(fabricDir, { path: "src/x.ts" })).toBe(false);
    expect(appendEvent(fabricDir, { event_type: "" })).toBe(false);
    expect(appendEvent(fabricDir, null)).toBe(false);
    expect(appendEvent(fabricDir, "nope")).toBe(false);
    expect(readLedger()).toEqual([]);
  });

  it("preserves a caller-supplied id/ts but FORCES kind/schema_version", () => {
    appendEvent(fabricDir, {
      event_type: "hook_surface_emitted",
      id: "event:custom-123",
      ts: 1234567890,
      kind: "tampered",
      schema_version: 99,
    });
    const [row] = readLedger();
    expect(row.id).toBe("event:custom-123");
    expect(row.ts).toBe(1234567890);
    expect(row.kind).toBe("fabric-event");
    expect(row.schema_version).toBe(1);
  });

  it("appendEvents writes a batch in one go and drops invalid members", () => {
    const written = appendEvents(fabricDir, [
      { event_type: "file_mutated", path: "a.ts" },
      { path: "missing-type.ts" }, // dropped
      { event_type: "file_mutated", path: "b.ts" },
    ]);
    expect(written).toBe(2);
    const rows = readLedger();
    expect(rows.map((r) => r.path)).toEqual(["a.ts", "b.ts"]);
    expect(rows.every((r) => r.kind === "fabric-event" && r.schema_version === 1)).toBe(true);
  });

  it("appendEvents with an all-invalid batch performs no write", () => {
    expect(appendEvents(fabricDir, [{ no: "type" }, null])).toBe(0);
    expect(readLedger()).toEqual([]);
  });

  it("stampEvent is pure — returns null on guard failure, stamped object otherwise", () => {
    expect(stampEvent({ nope: true })).toBeNull();
    const stamped = stampEvent({ event_type: "x" });
    expect(stamped?.kind).toBe("fabric-event");
  });
});

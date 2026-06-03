/**
 * Contract tests for templates/hooks/session-end-marker.cjs
 * (lifecycle-refactor W2-T2 — SessionEnd marker hook).
 *
 * In-process invocation only (no child_process.spawn): the .cjs is loaded via
 * createRequire and driven through the `env.payload` test seam so stdin is
 * never touched. Each test runs against an isolated temp `.fabric/` directory.
 * The emitted line is validated against the canonical `eventLedgerEventSchema`
 * (safeParse) so the on-disk shape can never drift from the shared schema.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { eventLedgerEventSchema } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/session-end-marker.cjs", import.meta.url),
);

type HookEnv = {
  cwd?: string;
  now?: Date;
  payload?: unknown;
  stdin?: string;
};

type HookModule = {
  main: (env: HookEnv) => void;
  readPayload: (raw: string) => Record<string, unknown> | null;
  extractSessionId: (payload: unknown) => string | null;
  appendSessionEnded: (projectRoot: string, now: Date, sessionId: string | null) => void;
  CONSTANTS: { FABRIC_DIR_REL: string; EVENTS_LEDGER_FILE: string };
};

const hook = require(hookPath) as HookModule;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function mkRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

function mkFabric(root: string): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
}

function readLedgerLines(root: string): string[] {
  const file = join(root, hook.CONSTANTS.FABRIC_DIR_REL, hook.CONSTANTS.EVENTS_LEDGER_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

describe("session-end-marker.cjs — readPayload", () => {
  it("parses a valid JSON object", () => {
    expect(hook.readPayload(JSON.stringify({ session_id: "s1" }))).toEqual({ session_id: "s1" });
  });
  it("returns null for empty / malformed / non-object", () => {
    expect(hook.readPayload("")).toBeNull();
    expect(hook.readPayload("{ not json")).toBeNull();
    expect(hook.readPayload("[1,2]")).toBeNull();
    expect(hook.readPayload("42")).toBeNull();
  });
});

describe("session-end-marker.cjs — extractSessionId", () => {
  it("returns the real payload session_id", () => {
    expect(hook.extractSessionId({ session_id: "sess-abc" })).toBe("sess-abc");
  });
  it("returns null when absent / empty / wrong type", () => {
    expect(hook.extractSessionId({})).toBeNull();
    expect(hook.extractSessionId({ session_id: "" })).toBeNull();
    expect(hook.extractSessionId({ session_id: 7 })).toBeNull();
    expect(hook.extractSessionId(null)).toBeNull();
  });
});

describe("session-end-marker.cjs — main marker append", () => {
  it("appends one session_ended event carrying the session_id", () => {
    const root = mkRoot("session-end-happy");
    mkFabric(root);
    const now = new Date("2026-06-03T00:00:00.000Z");
    hook.main({ cwd: root, now, payload: { session_id: "sess-123" } });

    const lines = readLedgerLines(root);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event.event_type).toBe("session_ended");
    expect(event.session_id).toBe("sess-123");
    expect(event.ts).toBe(now.getTime());
    expect(event.kind).toBe("fabric-event");
    expect(event.schema_version).toBe(1);
  });

  it("emitted line satisfies the shared eventLedgerEventSchema (safeParse)", () => {
    const root = mkRoot("session-end-schema");
    mkFabric(root);
    hook.main({ cwd: root, now: new Date(), payload: { session_id: "sess-schema" } });

    const lines = readLedgerLines(root);
    expect(lines).toHaveLength(1);
    const parsed = eventLedgerEventSchema.safeParse(JSON.parse(lines[0]));
    expect(parsed.success).toBe(true);
  });

  it("degrades to a no-op append when session_id is missing", () => {
    const root = mkRoot("session-end-nosession");
    mkFabric(root);
    hook.main({ cwd: root, now: new Date(), payload: { foo: "bar" } });
    expect(readLedgerLines(root)).toHaveLength(0);
  });

  it("is a silent no-op when .fabric/ does not exist", () => {
    const root = mkRoot("session-end-nofabric");
    // no mkFabric
    expect(() => hook.main({ cwd: root, now: new Date(), payload: { session_id: "x" } })).not.toThrow();
    expect(readLedgerLines(root)).toHaveLength(0);
  });

  it("never throws on a null payload (best-effort contract)", () => {
    const root = mkRoot("session-end-null");
    mkFabric(root);
    expect(() => hook.main({ cwd: root, now: new Date(), payload: null })).not.toThrow();
    expect(readLedgerLines(root)).toHaveLength(0);
  });
});

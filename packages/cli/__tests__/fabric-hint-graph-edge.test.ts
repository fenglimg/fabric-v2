/**
 * lifecycle-refactor W3-A2 (§7 graph generation signal): hook-side tests for
 * the Stop-hook graph_edge_candidate_requested emitter in
 * `packages/cli/templates/hooks/fabric-hint.cjs`.
 *
 * Contract (honest stable_id gating, KT-DEC-0007 best-effort):
 *   - Emits ONE graph_edge_candidate_requested{stable_id, store?} when the
 *     most-recent knowledge_proposed event carries a REAL K[TP]-XXX-NNNN
 *     stable_id (the approve/promote path that allocates a canonical node).
 *   - Honestly SKIPS when the latest knowledge_proposed is id-less or carries
 *     the `pending:<key>` sentinel — pending drafts have no canonical node to
 *     attach edges to (id late-bound at approve), so requesting an edge would
 *     be meaningless.
 *   - De-dupes within a session via the graph-edge-requested sidecar.
 *   - Never throws; reads/writes are best-effort.
 *
 * In-process createRequire load of the .cjs (no child_process), mirroring the
 * fabric-hint.test.ts / fabric-hint-reminder.test.ts policy.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(new URL("../templates/hooks/fabric-hint.cjs", import.meta.url));

type LedgerEvent = Record<string, unknown>;

type HookModule = {
  emitGraphEdgeCandidateBestEffort: (
    cwd: string,
    events: LedgerEvent[],
    sessionId: string | null,
  ) => void;
  readLedger: (cwd: string) => LedgerEvent[];
  CONSTANTS: {
    FABRIC_DIR: string;
    EVENT_LEDGER_FILE: string;
    EVENT_TYPE_PROPOSED: string;
    GRAPH_EDGE_REQUESTED_SIDECAR: string;
  };
};

const hook = require(hookPath) as HookModule;
const { FABRIC_DIR, EVENT_LEDGER_FILE, EVENT_TYPE_PROPOSED } = hook.CONSTANTS;

function makeEvent(event_type: string, ts: number, extra: Record<string, unknown> = {}): LedgerEvent {
  return {
    kind: "fabric-event",
    schema_version: 1,
    id: `event:${event_type}:${ts}`,
    event_type,
    ts,
    ...extra,
  };
}

function readEmittedGraphEvents(cwd: string): LedgerEvent[] {
  const ledgerPath = join(cwd, FABRIC_DIR, EVENT_LEDGER_FILE);
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as LedgerEvent)
    .filter((e) => e.event_type === "graph_edge_candidate_requested");
}

describe("fabric-hint.cjs — graph_edge_candidate_requested (W3-A2 §7)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-graph-edge-"));
    mkdirSync(join(tempRoot, FABRIC_DIR), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("emits graph_edge_candidate_requested with the real stable_id of the latest archived entry", () => {
    const events = [
      makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-DEC-0007", store: "team" }),
    ];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    const emitted = readEmittedGraphEvents(tempRoot);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].stable_id).toBe("KT-DEC-0007");
    expect(emitted[0].store).toBe("team");
    expect(emitted[0].event_type).toBe("graph_edge_candidate_requested");
    expect(emitted[0].kind).toBe("fabric-event");
    expect(emitted[0].schema_version).toBe(1);
  });

  it("omits store when the knowledge_proposed event carries no store", () => {
    const events = [makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-PIT-0003" })];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    const emitted = readEmittedGraphEvents(tempRoot);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].stable_id).toBe("KT-PIT-0003");
    expect("store" in emitted[0]).toBe(false);
  });

  it("honestly SKIPS when the latest knowledge_proposed has no stable_id (pending late-bind path)", () => {
    // extractKnowledge emits knowledge_proposed WITHOUT a stable_id — the
    // canonical id is allocated later at approve. No edge request should fire.
    const events = [makeEvent(EVENT_TYPE_PROPOSED, 100, { reason: "extract_knowledge:my-slug" })];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    expect(readEmittedGraphEvents(tempRoot)).toHaveLength(0);
  });

  it("honestly SKIPS the `pending:<key>` sentinel stable_id", () => {
    const events = [makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "pending:abc123def" })];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    expect(readEmittedGraphEvents(tempRoot)).toHaveLength(0);
  });

  it("uses the NEWEST knowledge_proposed; an id-less latest archive skips even if an older one had an id", () => {
    const events = [
      makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-DEC-0001" }),
      makeEvent(EVENT_TYPE_PROPOSED, 200, { reason: "extract_knowledge:newer-pending" }),
    ];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    // The newest proposed is id-less → skip (the older approved entry already
    // had its edges requested when IT landed).
    expect(readEmittedGraphEvents(tempRoot)).toHaveLength(0);
  });

  it("de-dupes within a session — a second call for the same stable_id does not re-emit", () => {
    const events = [makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-DEC-0007" })];
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");
    hook.emitGraphEdgeCandidateBestEffort(tempRoot, events, "sess-1");

    expect(readEmittedGraphEvents(tempRoot)).toHaveLength(1);
  });

  it("re-emits when a newer entry with a different stable_id is archived", () => {
    hook.emitGraphEdgeCandidateBestEffort(
      tempRoot,
      [makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-DEC-0007" })],
      "sess-1",
    );
    hook.emitGraphEdgeCandidateBestEffort(
      tempRoot,
      [
        makeEvent(EVENT_TYPE_PROPOSED, 100, { stable_id: "KT-DEC-0007" }),
        makeEvent(EVENT_TYPE_PROPOSED, 200, { stable_id: "KT-PIT-0009" }),
      ],
      "sess-1",
    );

    const emitted = readEmittedGraphEvents(tempRoot);
    expect(emitted.map((e) => e.stable_id)).toEqual(["KT-DEC-0007", "KT-PIT-0009"]);
  });

  it("never throws on an empty / non-array events input", () => {
    expect(() => hook.emitGraphEdgeCandidateBestEffort(tempRoot, [], "sess-1")).not.toThrow();
    expect(() =>
      hook.emitGraphEdgeCandidateBestEffort(tempRoot, undefined as unknown as LedgerEvent[], "sess-1"),
    ).not.toThrow();
    expect(readEmittedGraphEvents(tempRoot)).toHaveLength(0);
  });
});

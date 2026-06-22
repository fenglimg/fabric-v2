import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { hasUnresolvedDismissal } from "./promotion-gate.js";

// v2.2 C1 — verified→proven "0 dismiss" gate. Each case is a producer-consumer
// round-trip (KT-PIT-0014): append real assistant_turn_observed cite events
// (producer, the same path the Stop hook writes) → hasUnresolvedDismissal reads
// them back (consumer). last-write-wins per id: a later `applied` cite clears an
// earlier `dismissed` one.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-gate-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  return projectRoot;
}

async function citeTurn(
  projectRoot: string,
  ts: number,
  cite_ids: string[],
  cite_tags: ("applied" | "dismissed" | "none")[],
): Promise<void> {
  await appendEventLedgerEvent(projectRoot, {
    event_type: "assistant_turn_observed",
    ts,
    kb_line_raw: cite_ids.length > 0 ? `KB: ${cite_ids.join(", ")}` : null,
    cite_ids,
    cite_tags,
    cite_commitments: [],
    turn_id: `turn-${ts}`,
    timestamp: new Date(ts).toISOString(),
  });
}

describe("hasUnresolvedDismissal (C1 verified→proven 0-dismiss gate)", () => {
  it("returns FALSE with no ledger (gate fails open — human reviewer in charge)", async () => {
    const projectRoot = await createProject();
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(false);
  });

  it("returns TRUE when the latest cite verdict for the id is dismissed", async () => {
    const projectRoot = await createProject();
    await citeTurn(projectRoot, 1000, ["KT-DEC-0001"], ["dismissed"]);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(true);
  });

  it("returns FALSE when a later applied cite RE-AFFIRMS an earlier dismissal", async () => {
    const projectRoot = await createProject();
    await citeTurn(projectRoot, 1000, ["KT-DEC-0001"], ["dismissed"]);
    await citeTurn(projectRoot, 2000, ["KT-DEC-0001"], ["applied"]);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(false);
  });

  it("returns TRUE when a later dismissal supersedes an earlier applied cite", async () => {
    const projectRoot = await createProject();
    await citeTurn(projectRoot, 1000, ["KT-DEC-0001"], ["applied"]);
    await citeTurn(projectRoot, 2000, ["KT-DEC-0001"], ["dismissed"]);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(true);
  });

  it("matches on LOCAL id regardless of store-alias qualifier on either side", async () => {
    const projectRoot = await createProject();
    // cited with a store qualifier; queried bare — must still match.
    await citeTurn(projectRoot, 1000, ["team:KT-DEC-0001"], ["dismissed"]);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(true);
    expect(await hasUnresolvedDismissal(projectRoot, "team:KT-DEC-0001")).toBe(true);
  });

  it("ignores dismissals of OTHER ids", async () => {
    const projectRoot = await createProject();
    await citeTurn(projectRoot, 1000, ["KT-DEC-0002"], ["dismissed"]);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(false);
  });

  it("resolves the per-id verdict within a multi-cite turn (index-aligned tags)", async () => {
    const projectRoot = await createProject();
    await citeTurn(
      projectRoot,
      1000,
      ["KT-DEC-0001", "KT-DEC-0002"],
      ["dismissed", "applied"],
    );
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0001")).toBe(true);
    expect(await hasUnresolvedDismissal(projectRoot, "KT-DEC-0002")).toBe(false);
  });
});

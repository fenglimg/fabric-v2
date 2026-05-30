// v2.0.0-rc.37 NEW-24: redirect resolver unit tests.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendFile } from "node:fs/promises";

import {
  appendEventLedgerEvent,
  __eventLedgerParseStats,
  __resetEventLedgerParseStats,
} from "./event-ledger.js";
import {
  loadIdRedirectMap,
  resolveRedirectedId,
  trimRedirectsToActiveIds,
} from "./id-redirect.js";

const tempDirs: string[] = [];

beforeEach(() => {
  // empty
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-redirect-test-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  // Touch an empty ledger so readEventLedger's ENOENT short-circuit doesn't fire.
  await writeFile(join(root, ".fabric", "events.jsonl"), "");
  return root;
}

async function appendRedirectEvent(
  projectRoot: string,
  previous: string,
  current: string,
  timestamp = new Date().toISOString(),
): Promise<void> {
  await appendEventLedgerEvent(projectRoot, {
    event_type: "knowledge_id_redirect",
    timestamp,
    previous_stable_id: previous,
    new_stable_id: current,
    reason: `test:${previous}->${current}`,
  });
}

describe("id-redirect resolver", () => {
  it("returns an empty map when no redirect events exist", async () => {
    const projectRoot = await createTempProject();
    const map = await loadIdRedirectMap(projectRoot);
    expect(map.size).toBe(0);
  });

  // W1-06 (ISS-005): loadIdRedirectMap asks readEventLedger for one rare
  // event_type. The event_type pushdown filter must Zod-parse only candidate
  // lines, not the whole ledger, AND yield the same result as a full scan.
  it("event_type pushdown: only redirect lines are parsed, result matches a full scan", async () => {
    const projectRoot = await createTempProject();
    // 200 unrelated, high-volume events written raw — none contain the token.
    const noise = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({
        kind: "fabric-event",
        id: `event:noise-${i}`,
        ts: 1,
        schema_version: 1,
        event_type: "assistant_turn_observed",
        turn_id: `t-${i}`,
        envelope_index: i,
        timestamp: new Date().toISOString(),
      }),
    ).join("\n") + "\n";
    await appendFile(join(projectRoot, ".fabric", "events.jsonl"), noise, "utf8");
    // 2 genuine redirect events interleaved at the tail.
    await appendRedirectEvent(projectRoot, "KT-DEC-1111", "KP-DEC-2222");
    await appendRedirectEvent(projectRoot, "KT-PIT-3333", "KP-PIT-4444");

    __resetEventLedgerParseStats();
    const map = await loadIdRedirectMap(projectRoot);

    // Correctness: both redirects resolved.
    expect(map.get("KT-DEC-1111")).toBe("KP-DEC-2222");
    expect(map.get("KT-PIT-3333")).toBe("KP-PIT-4444");
    // Bounded parse: only the 2 redirect lines were Zod-parsed, not all 202.
    expect(__eventLedgerParseStats.lineParses).toBe(2);
  });

  it("loads a single old → new mapping from a redirect event", async () => {
    const projectRoot = await createTempProject();
    await appendRedirectEvent(projectRoot, "KT-DEC-1234", "KP-DEC-5678");

    const map = await loadIdRedirectMap(projectRoot);
    expect(map.get("KT-DEC-1234")).toBe("KP-DEC-5678");
    expect(resolveRedirectedId(map, "KT-DEC-1234")).toBe("KP-DEC-5678");
    expect(resolveRedirectedId(map, "KT-OTHER")).toBe("KT-OTHER");
  });

  it("compresses chains: A→B and B→C both surface as A→C and B→C", async () => {
    const projectRoot = await createTempProject();
    await appendRedirectEvent(projectRoot, "A", "B");
    await appendRedirectEvent(projectRoot, "B", "C");

    const map = await loadIdRedirectMap(projectRoot);
    expect(map.get("A")).toBe("C");
    expect(map.get("B")).toBe("C");
  });

  it("drops redirects older than the configured window", async () => {
    const projectRoot = await createTempProject();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    await appendRedirectEvent(projectRoot, "OLD-A", "OLD-B", old);
    await appendRedirectEvent(projectRoot, "NEW-A", "NEW-B", fresh);

    const map = await loadIdRedirectMap(projectRoot);
    expect(map.has("OLD-A")).toBe(false);
    expect(map.get("NEW-A")).toBe("NEW-B");
  });

  it("trimRedirectsToActiveIds only surfaces mappings whose new id is currently active", async () => {
    const map = new Map([
      ["X", "Y"],
      ["P", "Q"],
    ]);

    const trimmed = trimRedirectsToActiveIds(map, ["Y", "Z"]);
    expect(trimmed).toEqual({ X: "Y" });
    expect(trimmed).not.toHaveProperty("P");
  });

  it("returns the latest mapping when the same old id was redirected twice", async () => {
    const projectRoot = await createTempProject();
    await appendRedirectEvent(projectRoot, "DUP", "FIRST");
    await appendRedirectEvent(projectRoot, "DUP", "SECOND");

    const map = await loadIdRedirectMap(projectRoot);
    expect(map.get("DUP")).toBe("SECOND");
  });
});

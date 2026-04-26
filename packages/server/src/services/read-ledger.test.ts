import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendLedgerEntry, migrateLegacyLedger, readLedger, resolveLedgerPaths } from "./read-ledger.js";
import { appendEventLedgerEvent } from "./event-ledger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("readLedger", () => {
  it("prefers the canonical ledger path when both files exist", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", ".intent-ledger.jsonl"),
      `${JSON.stringify(createEntry("canonical", "README.md"))}\n`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, ".intent-ledger.jsonl"),
      `${JSON.stringify(createEntry("legacy", "docs/legacy.md"))}\n`,
      "utf8",
    );

    const paths = await resolveLedgerPaths(projectRoot);
    const entries = await readLedger(projectRoot);

    expect(paths.usingLegacy).toBe(false);
    expect(paths.readPath).toBe(join(projectRoot, ".fabric", ".intent-ledger.jsonl"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.intent).toBe("canonical");
  });

  it("falls back to the legacy root ledger when the canonical file is absent", async () => {
    const projectRoot = await createTempProject();
    await writeFile(
      join(projectRoot, ".intent-ledger.jsonl"),
      `${JSON.stringify(createEntry("legacy", "README.md"))}\n`,
      "utf8",
    );

    const paths = await resolveLedgerPaths(projectRoot);
    const entries = await readLedger(projectRoot);

    expect(paths.usingLegacy).toBe(true);
    expect(paths.readPath).toBe(join(projectRoot, ".intent-ledger.jsonl"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.intent).toBe("legacy");
  });

  it("appends new entries to the Event Ledger without touching legacy ledger files", async () => {
    const projectRoot = await createTempProject();
    await writeFile(
      join(projectRoot, ".intent-ledger.jsonl"),
      `${JSON.stringify(createEntry("legacy", "README.md"))}\n`,
      "utf8",
    );

    await appendLedgerEntry(projectRoot, createEntry("new", "src/app.ts"));

    const eventRaw = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    const legacyRaw = await readFile(join(projectRoot, ".intent-ledger.jsonl"), "utf8");

    expect(eventRaw).toContain("\"event_type\":\"edit_intent_checked\"");
    expect(eventRaw).toContain("\"intent\":\"new\"");
    expect(legacyRaw).toContain("\"intent\":\"legacy\"");
    await expect(readFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("migrates the legacy ledger into the canonical path without a read-side move", async () => {
    const projectRoot = await createTempProject();
    await writeFile(
      join(projectRoot, ".intent-ledger.jsonl"),
      `${JSON.stringify(createEntry("legacy", "README.md"))}\n`,
      "utf8",
    );

    const before = await readLedger(projectRoot);
    const migration = await migrateLegacyLedger(projectRoot);
    const after = await readLedger(projectRoot);

    expect(before[0]?.intent).toBe("legacy");
    expect(migration.migrated).toBe(true);
    expect(migration.from).toBe(join(projectRoot, ".intent-ledger.jsonl"));
    expect(migration.to).toBe(join(projectRoot, ".fabric", ".intent-ledger.jsonl"));
    await expect(readFile(join(projectRoot, ".intent-ledger.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(after[0]?.intent).toBe("legacy");
  });

  it("projects compatible AI ledger entries from Event Ledger edit_intent_checked records", async () => {
    const projectRoot = await createTempProject();

    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      id: "event:edit-a",
      ts: 2_000,
      path: "src/a.ts",
      compliant: true,
      intent: "edit projected files",
      ledger_entry_id: "ledger:projected",
      matched_rule_context_ts: 1_500,
      window_ms: 5_000,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      id: "event:edit-b",
      ts: 2_500,
      path: "src/b.ts",
      compliant: true,
      intent: "edit projected files",
      ledger_entry_id: "ledger:projected",
      matched_rule_context_ts: 1_500,
      window_ms: 5_000,
    });

    await expect(readFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readLedger(projectRoot)).toEqual([
      {
        id: "ledger:projected",
        ts: 2_000,
        source: "ai",
        intent: "edit projected files",
        affected_paths: ["src/a.ts", "src/b.ts"],
      },
    ]);
  });

  it("keeps richer legacy ledger entries when Event Ledger contains duplicate projected rows", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", ".intent-ledger.jsonl"),
      `${JSON.stringify({
        id: "ledger:shared",
        ts: 1_000,
        source: "ai",
        commit_sha: "abc1234",
        intent: "legacy wins",
        affected_paths: ["src/legacy.ts"],
      })}\n`,
      "utf8",
    );
    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      id: "event:duplicate",
      ts: 1_000,
      path: "src/projected.ts",
      compliant: true,
      intent: "projected duplicate",
      ledger_entry_id: "ledger:shared",
      matched_rule_context_ts: null,
      window_ms: 5_000,
    });

    expect(await readLedger(projectRoot)).toEqual([
      {
        id: "ledger:shared",
        ts: 1_000,
        source: "ai",
        commit_sha: "abc1234",
        intent: "legacy wins",
        affected_paths: ["src/legacy.ts"],
      },
    ]);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-read-ledger-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function createEntry(intent: string, affectedPath: string) {
  return {
    ts: Date.now(),
    source: "human" as const,
    parent_sha: "root",
    intent,
    affected_paths: [affectedPath],
    diff_stat: "1 file changed",
  };
}

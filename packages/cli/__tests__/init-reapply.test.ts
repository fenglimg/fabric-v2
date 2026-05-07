import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../src/commands/init.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

function sha256hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readBytes(path: string): Buffer {
  return readFileSync(path);
}

describe("initFabric --reapply preservation", () => {
  it("preserves events.jsonl byte-identically after --reapply", async () => {
    const target = createWerewolfFixtureRoot("fab-reapply-ledger-preserved");
    tempRoots.push(target);

    // First init to create the fabric structure.
    await initFabric(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");

    // Write some fake ledger events to simulate a populated ledger.
    const originalContent = [
      JSON.stringify({ kind: "fabric-event", id: "event:aaa", ts: 1000, schema_version: 1, event_type: "mcp_event", mcp_event_id: "m1", stream_id: "s1", message: null }),
      JSON.stringify({ kind: "fabric-event", id: "event:bbb", ts: 2000, schema_version: 1, event_type: "mcp_event", mcp_event_id: "m2", stream_id: "s2", message: null }),
    ].join("\n") + "\n";

    writeFileSync(eventsPath, originalContent, "utf8");
    const originalHash = sha256hex(readBytes(eventsPath));
    const originalByteLength = readBytes(eventsPath).length;

    // Run --reapply (force: true mirrors what the CLI sets when reapply is active).
    await initFabric(target, { reapply: true, force: true });

    // The original events must still be byte-identically present at the start of the file.
    const afterBytes = readBytes(eventsPath);
    const afterContent = afterBytes.toString("utf8");

    // The file starts with the original content unchanged.
    expect(afterContent.startsWith(originalContent)).toBe(true);

    // The file is at least as large as the original (reapply appended a new event).
    expect(afterBytes.length).toBeGreaterThanOrEqual(originalByteLength);

    // The first originalByteLength bytes are identical.
    const prefixHash = sha256hex(afterBytes.subarray(0, originalByteLength));
    expect(prefixHash).toBe(originalHash);
  });

  it("preserves agents.meta.json when rules/*.md files exist", async () => {
    const target = createWerewolfFixtureRoot("fab-reapply-meta-preserved");
    tempRoots.push(target);

    // First init.
    await initFabric(target);

    const metaPath = join(target, ".fabric", "agents.meta.json");

    // Write a populated meta (simulating AI-built rule tree).
    const customMeta = JSON.stringify(
      {
        revision: "sha256:custom-revision",
        nodes: {
          L0: { file: ".fabric/bootstrap/README.md", scope_glob: "**", deps: [], priority: "high", layer: "L0", topology_type: "mirror", hash: "sha256:aaa" },
          "rules/my-rule": { file: ".fabric/rules/my-rule.md", scope_glob: "src/**", deps: ["L0"], priority: "medium", layer: "L1", topology_type: "cluster", hash: "sha256:bbb" },
        },
      },
      null,
      2,
    ) + "\n";
    writeFileSync(metaPath, customMeta, "utf8");
    const originalMetaHash = sha256hex(readBytes(metaPath));

    // Create a rule file to signal that rules exist.
    mkdirSync(join(target, ".fabric", "rules"), { recursive: true });
    writeFixtureFile(target, ".fabric/rules/my-rule.md", "# My Rule\n\nSome rule content.\n");

    // Run --reapply (force: true mirrors what the CLI sets when reapply is active).
    await initFabric(target, { reapply: true, force: true });

    const afterMetaHash = sha256hex(readBytes(metaPath));
    expect(afterMetaHash).toBe(originalMetaHash);
  });

  it("regenerates agents.meta.json when rules/ is empty", async () => {
    const target = createWerewolfFixtureRoot("fab-reapply-meta-regen");
    tempRoots.push(target);

    // First init.
    await initFabric(target);

    const metaPath = join(target, ".fabric", "agents.meta.json");

    // Write a custom meta.
    const customMeta = JSON.stringify(
      {
        revision: "sha256:custom-revision",
        nodes: {
          L0: { file: ".fabric/bootstrap/README.md", scope_glob: "**", deps: [], priority: "high", layer: "L0", topology_type: "mirror", hash: "sha256:aaa" },
          "rules/extra": { file: ".fabric/rules/extra.md", scope_glob: "src/**", deps: [], priority: "medium", layer: "L1", topology_type: "cluster", hash: "sha256:ccc" },
        },
      },
      null,
      2,
    ) + "\n";
    writeFileSync(metaPath, customMeta, "utf8");
    const originalMetaHash = sha256hex(readBytes(metaPath));

    // Rules directory exists but has no .md files — ensure it's empty.
    mkdirSync(join(target, ".fabric", "rules"), { recursive: true });

    // Run --reapply (force: true mirrors what the CLI sets when reapply is active).
    await initFabric(target, { reapply: true, force: true });

    const afterMetaHash = sha256hex(readBytes(metaPath));

    // Meta should have been rewritten (different from our custom content).
    expect(afterMetaHash).not.toBe(originalMetaHash);

    // The rewritten meta should be the L0-only stub shape.
    const afterMeta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      revision?: string;
      nodes?: Record<string, unknown>;
    };
    expect(afterMeta.nodes).toBeDefined();
    expect(Object.keys(afterMeta.nodes ?? {})).toEqual(["L0"]);
  });

  it("appends a reapply_completed ledger event with correct preservation flags", async () => {
    const target = createWerewolfFixtureRoot("fab-reapply-event");
    tempRoots.push(target);

    // First init.
    await initFabric(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");
    const rulesDir = join(target, ".fabric", "rules");

    // Create a rule file so that preserved_meta will be true.
    mkdirSync(rulesDir, { recursive: true });
    writeFixtureFile(target, ".fabric/rules/some-rule.md", "# Rule\n");

    // Also put a sentinel event in the ledger.
    const sentinelEvent = JSON.stringify({
      kind: "fabric-event",
      id: "event:sentinel",
      ts: 999,
      schema_version: 1,
      event_type: "mcp_event",
      mcp_event_id: "sentinel",
      stream_id: "s0",
      message: null,
    });
    writeFileSync(eventsPath, sentinelEvent + "\n", "utf8");

    // Run --reapply (force: true mirrors what the CLI sets when reapply is active).
    await initFabric(target, { reapply: true, force: true });

    const content = readFileSync(eventsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    // First line must still be the sentinel.
    expect(lines[0]).toBe(sentinelEvent);

    // Last line must be the reapply_completed event.
    const lastEvent = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    expect(lastEvent["event_type"]).toBe("reapply_completed");
    expect(lastEvent["kind"]).toBe("fabric-event");
    expect(lastEvent["schema_version"]).toBe(1);
    expect(lastEvent["preserved_ledger"]).toBe(true);
    expect(lastEvent["preserved_meta"]).toBe(true);
    expect(lastEvent["rules_count"]).toBe(1);
    expect(typeof lastEvent["id"]).toBe("string");
    expect(typeof lastEvent["ts"]).toBe("number");
  });
});

/**
 * Integration tests: init command guard behavior
 * Covers: I2 (no-overwrite + action_hint), I3 (reapply idempotency), T4 (preexisting root markdown)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../../src/commands/init.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

// I2 — init refuses to overwrite without --force, error message contains actionable hint
describe("I2: init guard — no-overwrite behavior", () => {
  it("rejects an already-initialized project when --force is not set", async () => {
    const target = createWerewolfFixtureRoot("itg-init-guard-nof");
    tempRoots.push(target);

    await initFabric(target);

    await expect(initFabric(target)).rejects.toThrow();
  });

  it("error thrown on existing v2.0 fabric meta file mentions the conflicting file path", async () => {
    const target = createWerewolfFixtureRoot("itg-init-guard-hint");
    tempRoots.push(target);

    // v2.0: agents.meta.json is the canonical guard target (replaces v1.x bootstrap/README.md).
    writeFixtureFile(target, ".fabric/agents.meta.json", "{}\n");

    let thrownError: Error | null = null;
    try {
      await initFabric(target);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    // The thrown error message must mention the conflicting path (action_hint contract, I2).
    expect(thrownError!.message).toMatch(/agents\.meta\.json|--force/i);
  });

  it("existing legacy v1.x bootstrap files are untouched by v2.0 init (no guard, no overwrite)", async () => {
    const target = createWerewolfFixtureRoot("itg-init-guard-unchanged");
    tempRoots.push(target);

    const original = "# do not overwrite\n";
    writeFixtureFile(target, ".fabric/bootstrap/README.md", original);

    // v2.0 init writes its own layout but does not touch the legacy file.
    await initFabric(target);

    expect(readFileSync(join(target, ".fabric/bootstrap/README.md"), "utf8")).toBe(original);
  });
});

// I3 — reapply idempotency: consecutive reapply produces byte-identical agents.meta.json and events.jsonl prefix
describe("I3: init --reapply idempotency", () => {
  it("produces byte-identical agents.meta.json on second --reapply (rules/ non-empty)", async () => {
    const target = createWerewolfFixtureRoot("itg-reapply-meta-idem");
    tempRoots.push(target);

    await initFabric(target);

    // Put a rule file so meta is preserved
    mkdirSync(join(target, ".fabric", "rules"), { recursive: true });
    writeFixtureFile(target, ".fabric/rules/my-rule.md", "# My Rule\n");

    await initFabric(target, { reapply: true, force: true });
    const hash1 = sha256(readFileSync(join(target, ".fabric", "agents.meta.json")));

    await initFabric(target, { reapply: true, force: true });
    const hash2 = sha256(readFileSync(join(target, ".fabric", "agents.meta.json")));

    expect(hash1).toBe(hash2);
  });

  it("preserves events.jsonl prefix byte-identically across reapply runs", async () => {
    const target = createWerewolfFixtureRoot("itg-reapply-events-idem");
    tempRoots.push(target);

    await initFabric(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");
    const sentinel = JSON.stringify({ kind: "fabric-event", id: "event:s1", ts: 100, schema_version: 1, event_type: "mcp_event", mcp_event_id: "m1", stream_id: "s1", message: null });
    writeFileSync(eventsPath, sentinel + "\n", "utf8");

    await initFabric(target, { reapply: true, force: true });
    const content1 = readFileSync(eventsPath, "utf8");

    await initFabric(target, { reapply: true, force: true });
    const content2 = readFileSync(eventsPath, "utf8");

    // Both files should start with the sentinel line
    expect(content1.startsWith(sentinel + "\n")).toBe(true);
    expect(content2.startsWith(sentinel + "\n")).toBe(true);
  });
});

// T4 — existing root markdown files are not modified by init
describe("T4: preexisting root markdown preservation", () => {
  it("does not overwrite existing CLAUDE.md when init is run with --force", async () => {
    const target = createWerewolfFixtureRoot("itg-init-root-md-claude");
    tempRoots.push(target);

    const original = "# My Project\n\nUser instructions here.\n";
    writeFixtureFile(target, "CLAUDE.md", original);

    // Force init should not touch CLAUDE.md
    await initFabric(target, { force: true });

    expect(readFileSync(join(target, "CLAUDE.md"), "utf8")).toBe(original);
  });

  it("does not overwrite existing AGENTS.md when init is run with --force", async () => {
    const target = createWerewolfFixtureRoot("itg-init-root-md-agents");
    tempRoots.push(target);

    const original = "# Agents\n\nCustom agent instructions.\n";
    writeFixtureFile(target, "AGENTS.md", original);

    await initFabric(target, { force: true });

    expect(readFileSync(join(target, "AGENTS.md"), "utf8")).toBe(original);
  });
});

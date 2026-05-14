/**
 * Integration tests: init command guard behavior
 *
 * Covers (post rc.14 TASK-002 diff-mode refactor):
 *   I2 — default `fab install` on already-init canonical workspace is a no-op
 *        success (no throw); drift on a managed file aborts with a helpful
 *        message pointing to `fab doctor` and `fab uninstall && fab install`
 *   I3 — default-install idempotency: byte-identical agents.meta.json across
 *        re-runs without --reapply/--force. A separate legacy --reapply test
 *        preserves the deprecation-warning contract for rc.14.
 *   T4 — preexisting root markdown files are not modified by init
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../../src/commands/install.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
  seedDriftedFile,
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

// I2 — default `fab install` on already-init canonical workspace is a no-op
// success (diff-mode contract). Drift on a managed file aborts.
describe("I2: init guard — diff-mode behavior", () => {
  it("does NOT throw on an already-initialized canonical workspace when no flags are set", async () => {
    const target = createWerewolfFixtureRoot("itg-init-guard-nof");
    tempRoots.push(target);

    await runInit(target);

    // rc.14 TASK-002: re-run without any flags is a no-op success (was a
    // throw under rc.13 planFreshPath semantics). Diff-mode classifies all
    // scaffold paths as present-canonical and prints a one-line
    // "Workspace already canonical" confirmation.
    await expect(runInit(target)).resolves.toBeDefined();
  });

  it("aborts with a drift message when a managed hook script has been byte-modified", async () => {
    const target = createWerewolfFixtureRoot("itg-init-guard-drift");
    tempRoots.push(target);

    await runInit(target);

    // Byte-modify a managed scaffold file (.fabric/agents.meta.json) so the
    // classifier detects drift. We strip a required schema field so the
    // structural detector classifies it as drifted/user-modified.
    seedDriftedFile(target, ".fabric/agents.meta.json", () => "{}\n");

    let thrownError: Error | null = null;
    try {
      await runInit(target);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    // The thrown error must mention the conflicting path, fab doctor, and
    // the fab uninstall + fab install reset suggestion.
    expect(thrownError!.message).toMatch(/agents\.meta\.json/);
    expect(thrownError!.message).toMatch(/fab doctor/);
    expect(thrownError!.message).toMatch(/fab uninstall/);
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

// I3 — default-install idempotency. agents.meta.json and events.jsonl are
// byte-stable across re-runs under default `fab install` (no --reapply,
// no --force). A separate legacy --reapply test preserves the deprecation-
// warning contract for rc.14.
describe("I3: init default-install idempotency", () => {
  it("produces byte-identical agents.meta.json on second `fab install` (no flags)", async () => {
    const target = createWerewolfFixtureRoot("itg-init-idem-meta");
    tempRoots.push(target);

    await runInit(target);

    // Put a knowledge file so meta is preserved by runInitScan.
    mkdirSync(join(target, ".fabric", "knowledge", "decisions"), { recursive: true });
    writeFixtureFile(target, ".fabric/knowledge/decisions/my-rule.md", "# My Rule\n");

    await runInit(target);
    const hash1 = sha256(readFileSync(join(target, ".fabric", "agents.meta.json")));

    await runInit(target);
    const hash2 = sha256(readFileSync(join(target, ".fabric", "agents.meta.json")));

    expect(hash1).toBe(hash2);
  });

  it("preserves events.jsonl prefix byte-identically across default re-runs", async () => {
    const target = createWerewolfFixtureRoot("itg-init-idem-events");
    tempRoots.push(target);

    await runInit(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");
    const sentinel = JSON.stringify({
      kind: "fabric-event",
      id: "event:s1",
      ts: 100,
      schema_version: 1,
      event_type: "mcp_event",
      mcp_event_id: "m1",
      stream_id: "s1",
      message: null,
    });
    // Prepend sentinel WITHOUT clobbering whatever the install pipeline
    // already wrote during the first runInit (notably install_diff_applied).
    const existing = readFileSync(eventsPath, "utf8");
    writeFileSync(eventsPath, sentinel + "\n" + existing, "utf8");

    await runInit(target);
    const content1 = readFileSync(eventsPath, "utf8");

    await runInit(target);
    const content2 = readFileSync(eventsPath, "utf8");

    // Both files start with the sentinel line — default install preserves
    // events.jsonl byte-identically (events.jsonl is presence-canonical).
    expect(content1.startsWith(sentinel + "\n")).toBe(true);
    expect(content2.startsWith(sentinel + "\n")).toBe(true);
  });

  it("legacy --reapply path still succeeds and emits the rc.14 deprecation warning", async () => {
    const target = createWerewolfFixtureRoot("itg-init-reapply-legacy");
    tempRoots.push(target);

    await runInit(target);

    // Capture stderr so we can assert the deprecation banner.
    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runInit(target, { reapply: true, force: true });
    } finally {
      process.stderr.write = originalWrite;
    }

    const stderrJoined = stderrLines.join("");
    // Matches en ("--reapply is a legacy escape hatch") or zh-CN
    // ("--reapply 是兼容性的逃生口") banner.
    expect(stderrJoined).toMatch(/--reapply.*(legacy escape hatch|逃生口)/);
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

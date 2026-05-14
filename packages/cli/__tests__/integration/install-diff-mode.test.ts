/**
 * Integration tests: rc.14 TASK-002 — `fab install` diff-mode idempotency.
 *
 * Five scenarios derived from the rc.14 「Stop the bleeding」 plan:
 *   1. canonical no-op: re-running init on an unmodified post-install
 *      workspace prints the canonical confirmation and exits 0 with no
 *      writes (byte-identical snapshot before/after).
 *   2. missing file auto-applies: deleting a managed hook script then
 *      re-running install restores it without --force.
 *   3. drift aborts with a helpful message: byte-modifying a managed
 *      scaffold file (agents.meta.json) then re-running install (no flags)
 *      throws an error mentioning `fab doctor` AND `fab uninstall && fab install`.
 *   4. --dry-run on existing workspace works: runInit with planOnly=true on
 *      a post-install fixture does NOT throw and emits no writes (Bug Z
 *      root cause). Output includes a per-file DiffFileState row.
 *   5. --force on drifted workspace (legacy bypass): seed drift, run with
 *      --force=true, assert success AND the deprecation warning is emitted
 *      to stderr.
 *
 * Source path: packages/cli/src/commands/install.ts — classifyFreshPath,
 * buildInitFabricPlan, executeInitExecutionPlan (drift-abort gate).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
  seedDriftedFile,
  seedMissingFile,
  snapshotTree,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

function captureStdio(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  console.log = (...args: unknown[]) => {
    stdout.push(args.map((a) => String(a)).join(" "));
  };
  return {
    stdout,
    stderr,
    restore: () => {
      process.stderr.write = originalErr;
      console.log = originalLog;
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — canonical no-op
// ---------------------------------------------------------------------------

describe("rc.14 TASK-002 install-diff-mode: canonical no-op", () => {
  it("re-running install on a canonical workspace prints the canonical confirmation and writes nothing", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-canonical-noop");
    tempRoots.push(target);

    await runInit(target);
    const snapshot1Fabric = snapshotTree(target, ".fabric");
    const snapshot1Claude = snapshotTree(target, ".claude");
    const snapshot1Codex = snapshotTree(target, ".codex");
    const snapshot1Cursor = snapshotTree(target, ".cursor");

    const captured = captureStdio();
    try {
      await runInit(target);
    } finally {
      captured.restore();
    }

    // Confirmation banner is printed on the canonical happy path.
    const allOutput = [...captured.stdout, ...captured.stderr].join("\n");
    expect(allOutput).toMatch(/Workspace already canonical|工作区已是规范状态/);

    // Re-run is byte-stable for managed trees (events.jsonl is excepted
    // because diff-mode appends install_diff_applied per non-reapply run —
    // ledger growth is the documented contract).
    const snapshot2Claude = snapshotTree(target, ".claude");
    const snapshot2Codex = snapshotTree(target, ".codex");
    const snapshot2Cursor = snapshotTree(target, ".cursor");
    expect(snapshot2Claude).toEqual(snapshot1Claude);
    expect(snapshot2Codex).toEqual(snapshot1Codex);
    expect(snapshot2Cursor).toEqual(snapshot1Cursor);

    // .fabric/agents.meta.json must be byte-stable (present-canonical → no
    // write under diff-mode; runInitScan is also skipped on a canonical
    // re-run so post-scan mutation does not happen either).
    const metaBefore = snapshot1Fabric[".fabric/agents.meta.json"];
    expect(metaBefore).toBeDefined();
    const metaAfter = readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8");
    expect(metaAfter).toBe(metaBefore);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — missing file auto-applies
// ---------------------------------------------------------------------------

describe("rc.14 TASK-002 install-diff-mode: missing file auto-applies", () => {
  it("restores a deleted managed hook script on re-run without --force", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-missing-restore");
    tempRoots.push(target);

    await runInit(target);
    const hookPath = ".cursor/hooks/fabric-hint.cjs";
    expect(existsSync(join(target, hookPath))).toBe(true);

    seedMissingFile(target, hookPath);
    expect(existsSync(join(target, hookPath))).toBe(false);

    // No flags — diff-mode auto-applies missing pieces via existing
    // copyTextIdempotent path.
    await runInit(target);

    expect(existsSync(join(target, hookPath))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — drift aborts with a helpful message
// ---------------------------------------------------------------------------

describe("rc.14 TASK-002 install-diff-mode: drift aborts with helpful message", () => {
  it("aborts with a stderr message naming the path, `fab doctor`, and `fab uninstall && fab install`", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-drift-abort");
    tempRoots.push(target);

    await runInit(target);

    // Strip schema fields so the structural classifier flags drift.
    seedDriftedFile(target, ".fabric/agents.meta.json", () => "{}\n");

    let thrown: Error | null = null;
    try {
      await runInit(target);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/agents\.meta\.json/);
    expect(thrown!.message).toMatch(/fab doctor/);
    expect(thrown!.message).toMatch(/fab uninstall/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — --dry-run on existing workspace works (Bug Z fix)
// ---------------------------------------------------------------------------

describe("rc.14 TASK-002 install-diff-mode: --dry-run on existing workspace", () => {
  it("planOnly=true on a post-install workspace does NOT throw and writes nothing", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-dryrun-existing");
    tempRoots.push(target);

    await runInit(target);
    const beforeSnapshot = snapshotTree(target, ".fabric");

    const captured = captureStdio();
    try {
      // rc.14 Bug Z fix: planOnly on a workspace with existing .fabric/
      // agents.meta.json used to throw inside buildInitFabricPlan before
      // executeInitExecutionPlan could short-circuit. Diff-mode classifies
      // the path without throwing, so this is a clean dry-run.
      await expect(runInit(target, { planOnly: true })).resolves.toBeDefined();
    } finally {
      captured.restore();
    }

    // No writes — files must be byte-identical before/after the dry-run.
    const afterSnapshot = snapshotTree(target, ".fabric");
    expect(afterSnapshot).toEqual(beforeSnapshot);

    // Output includes the diff-state classification table (canonical row).
    const allOutput = [...captured.stdout, ...captured.stderr].join("\n");
    expect(allOutput).toMatch(/canonical|规范/);
  });

  it("planOnly=true on a workspace missing one hook shows the missing classification, no writes", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-dryrun-missing");
    tempRoots.push(target);

    await runInit(target);

    // Delete a managed scaffold file so classification surfaces "missing".
    seedMissingFile(target, ".fabric/agents.meta.json");

    const captured = captureStdio();
    try {
      await expect(runInit(target, { planOnly: true })).resolves.toBeDefined();
    } finally {
      captured.restore();
    }

    // The file is still missing — dry-run wrote nothing.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    const allOutput = [...captured.stdout, ...captured.stderr].join("\n");
    expect(allOutput).toMatch(/missing|缺失/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — --force on drifted workspace (legacy escape hatch)
// ---------------------------------------------------------------------------

describe("rc.14 TASK-002 install-diff-mode: --force legacy bypass", () => {
  it("--force overwrites the drifted file and emits the rc.15 deprecation warning to stderr", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-force-legacy");
    tempRoots.push(target);

    await runInit(target);
    seedDriftedFile(target, ".fabric/agents.meta.json", () => "{}\n");

    const captured = captureStdio();
    try {
      await expect(runInit(target, { force: true })).resolves.toBeDefined();
    } finally {
      captured.restore();
    }

    // agents.meta.json was overwritten with the canonical initial structure
    // (drift-abort was bypassed by --force).
    const meta = JSON.parse(
      readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(meta).toHaveProperty("revision");
    expect(meta).toHaveProperty("counters");

    // Deprecation warning was emitted (en or zh-CN match-either).
    const stderrJoined = captured.stderr.join("");
    expect(stderrJoined).toMatch(/--force.*legacy escape hatch|逃生口/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — rc.14 TASK-004 Finding 1: `.fabric` as a regular file aborts
// with the friendly drift-abort message instead of crashing with native
// ENOTDIR / EEXIST from mkdirSync.
// ---------------------------------------------------------------------------

describe("rc.14 TASK-004 install-diff-mode: .fabric as regular file aborts with friendly message", () => {
  it("aborts with the drift-abort message naming `.fabric` instead of raising native ENOTDIR/EEXIST", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-fabric-is-file");
    tempRoots.push(target);

    // Place a regular file where the `.fabric` directory belongs. Pathological
    // user setup — but the friendly-error-message contract must hold.
    const fabricPath = join(target, ".fabric");
    writeFileSync(fabricPath, "garbage — not a directory\n", "utf8");
    expect(statSync(fabricPath).isFile()).toBe(true);

    let thrown: Error | null = null;
    try {
      await runInit(target);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    // Friendly drift-abort message names the offending path and points at the
    // recovery commands. Must NOT be a native ENOTDIR/EEXIST stack trace.
    expect(thrown!.message).toMatch(/\.fabric/);
    expect(thrown!.message).toMatch(/fab doctor/);
    expect(thrown!.message).toMatch(/fab uninstall/);
    expect(thrown!.message).not.toMatch(/ENOTDIR|EEXIST/);

    // The regular file at `.fabric` is preserved verbatim — abort fires before
    // any write/mutation.
    expect(statSync(fabricPath).isFile()).toBe(true);
    expect(readFileSync(fabricPath, "utf8")).toBe("garbage — not a directory\n");
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — rc.14 TASK-004 Finding 2: events.jsonl as a directory + --force
// cleans up and writes a fresh ledger file instead of crashing with EISDIR.
// ---------------------------------------------------------------------------

describe("rc.14 TASK-004 install-diff-mode: events.jsonl as directory + --force recovers cleanly", () => {
  it("--force overwrites a directory-where-file-belongs at events.jsonl without raising native EISDIR", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-events-is-dir");
    tempRoots.push(target);

    // First install gets the workspace into a canonical state, then we
    // pathologically replace events.jsonl with a directory.
    await runInit(target);
    const eventsPath = join(target, ".fabric", "events.jsonl");
    expect(statSync(eventsPath).isFile()).toBe(true);

    rmSync(eventsPath, { force: true });
    mkdirSync(eventsPath, { recursive: true });
    // Drop a file inside the directory so we can prove the recursive rm
    // actually fired during recovery (not just a no-op).
    writeFileSync(join(eventsPath, "stray.txt"), "should not survive --force\n", "utf8");
    expect(statSync(eventsPath).isDirectory()).toBe(true);

    // --force must take the symmetric cleanup branch (mirrors agents.meta
    // .json's preparePlannedPath rmSync recursive). No EISDIR.
    await expect(runInit(target, { force: true })).resolves.toBeDefined();

    // events.jsonl is now a regular file again, the stray subfile is gone.
    expect(statSync(eventsPath).isFile()).toBe(true);
    expect(existsSync(join(eventsPath, "stray.txt"))).toBe(false);
  });
});


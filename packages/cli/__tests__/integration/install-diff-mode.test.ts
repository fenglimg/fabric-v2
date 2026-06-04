/**
 * Integration tests: rc.15 (formerly rc.14 TASK-002) — `fabric install`
 * diff-mode idempotency.
 *
 * Scenarios:
 *   1. canonical no-op: re-running init on an unmodified post-install
 *      workspace prints the canonical confirmation and exits 0 with no
 *      writes (byte-identical snapshot before/after).
 *   2. missing file auto-applies: deleting a managed hook script then
 *      re-running install restores it.
 *   3. drift aborts with a helpful message: occupying a managed scaffold file
 *      location (events.jsonl) with a directory then re-running install throws
 *      an error mentioning `fabric doctor` AND `fabric uninstall && fabric install`.
 *   4. --dry-run on existing workspace works: runInit with planOnly=true on
 *      a post-install fixture does NOT throw and emits no writes. Output
 *      includes a per-file DiffFileState row.
 *   6. .fabric as regular file aborts with the friendly drift-abort message
 *      instead of raising native ENOTDIR/EEXIST (rc.14 TASK-004 Finding 1).
 *
 * Source path: packages/cli/src/commands/install.ts — classifyFreshPath,
 * buildInitFabricPlan, executeInitExecutionPlan (drift-abort gate).
 *
 * W5 I1 retired the co-location knowledge cabinet (.fabric/knowledge/*) and
 * agents.meta.json scaffold — install now only scaffolds the event ledgers
 * (events.jsonl + forensic.json) plus AGENTS.md / client bootstrap. The drift
 * scenarios that previously drove structural drift via agents.meta.json now use
 * the events.jsonl scaffold path (presence/file-type detection).
 *
 * Scenarios 5 (--force legacy bypass) and 7 (events.jsonl as directory +
 * --force) were retired in rc.15 alongside the --force/--reapply flags.
 * The recovery path for both pathological cases is now `fabric uninstall &&
 * fabric install`, surfaced by the drift-abort message.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
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
    // W5 I1: install no longer scaffolds the co-location knowledge cabinet
    // nor agents.meta.json — assert they are absent after a real install.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "knowledge"))).toBe(false);
    // The event ledgers ARE scaffolded.
    expect(existsSync(join(target, ".fabric", "events.jsonl"))).toBe(true);
    expect(existsSync(join(target, ".fabric", "forensic.json"))).toBe(true);

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

    // .fabric/forensic.json is a snapshot regenerated every run; events.jsonl
    // grows by one install_diff_applied line per non-canonical run. The
    // remaining managed config (fabric-config.json, .gitignore) must be
    // byte-stable on a canonical re-run.
    const configBefore = snapshot1Fabric[".fabric/fabric-config.json"];
    expect(configBefore).toBeDefined();
    const configAfter = readFileSync(join(target, ".fabric", "fabric-config.json"), "utf8");
    expect(configAfter).toBe(configBefore);
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
  it("aborts with a stderr message naming the path, `fabric doctor`, and `fabric uninstall && fabric install`", async () => {
    const target = createWerewolfFixtureRoot("itg-diff-drift-abort");
    tempRoots.push(target);

    await runInit(target);

    // Occupy a managed scaffold FILE location (events.jsonl) with a directory
    // so the per-file classifier flags it as user-modified (not a file).
    const eventsPath = join(target, ".fabric", "events.jsonl");
    rmSync(eventsPath, { force: true });
    mkdirSync(eventsPath, { recursive: true });

    let thrown: Error | null = null;
    try {
      await runInit(target);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/events\.jsonl/);
    expect(thrown!.message).toMatch(/fabric doctor/);
    expect(thrown!.message).toMatch(/fabric uninstall/);
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
    seedMissingFile(target, ".fabric/events.jsonl");

    const captured = captureStdio();
    try {
      await expect(runInit(target, { planOnly: true })).resolves.toBeDefined();
    } finally {
      captured.restore();
    }

    // The file is still missing — dry-run wrote nothing.
    expect(existsSync(join(target, ".fabric", "events.jsonl"))).toBe(false);
    const allOutput = [...captured.stdout, ...captured.stderr].join("\n");
    expect(allOutput).toMatch(/missing|缺失/);
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
    expect(thrown!.message).toMatch(/fabric doctor/);
    expect(thrown!.message).toMatch(/fabric uninstall/);
    expect(thrown!.message).not.toMatch(/ENOTDIR|EEXIST/);

    // The regular file at `.fabric` is preserved verbatim — abort fires before
    // any write/mutation.
    expect(statSync(fabricPath).isFile()).toBe(true);
    expect(readFileSync(fabricPath, "utf8")).toBe("garbage — not a directory\n");
  });
});


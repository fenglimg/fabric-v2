import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, readBindingsSnapshot, storeRelativePath } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";
import {
  runAbortSync,
  runContinueSync,
  runStartSync,
  type GitRebaseOutcome,
} from "../src/sync/run-sync.js";

// v2.1.0-rc.1 P3 — `fabric sync` orchestration (S9/S17/S37). The git edge is
// injected so the orchestration (session persistence, conflict pause/resume,
// deferred-push, settle → bindings snapshot) is exercised deterministically;
// one real-git case proves the default `git pull --rebase` wiring.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-05-30T00:00:00.000Z";

const dirs: string[] = [];
let globalRoot: string;
let projectRoot: string;

function syncSessionExists(): boolean {
  return existsSync(join(globalRoot, "state", "sync-session.json"));
}

// Outcome script keyed by alias; falls back to "clean".
function scriptedPull(plan: Record<string, GitRebaseOutcome>) {
  return (storeDir: string): GitRebaseOutcome => {
    const alias = storeDir.includes(TEAM) ? "team" : storeDir.includes(PLATFORM) ? "platform" : "?";
    return plan[alias] ?? "clean";
  };
}

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-sync-home-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  saveGlobalConfig(
    globalConfigSchema.parse({
      uid: "u-test",
      stores: [
        { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
        { store_uuid: TEAM, alias: "team", remote: "git@h:team.git", writable: true },
        { store_uuid: PLATFORM, alias: "platform", remote: "git@h:platform.git", writable: true },
      ],
    }),
    globalRoot,
  );
  projectRoot = mkdtempSync(join(tmpdir(), "fabric-sync-proj-"));
  dirs.push(projectRoot);
  saveProjectConfig(
    { project_id: PROJECT_ID, required_stores: [{ id: "team" }], active_write_store: "team" },
    projectRoot,
  );
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runStartSync", () => {
  it("syncs only remote-backed stores; settles + regenerates the snapshot when all clean", () => {
    const result = runStartSync({
      projectRoot,
      globalRoot,
      now: NOW,
      pull: scriptedPull({}),
    });
    // Local-only personal store is skipped (nothing to pull/push).
    expect(result.session.stores.map((s) => s.alias).sort()).toEqual(["platform", "team"]);
    expect(result.session.stores.every((s) => s.state === "synced")).toBe(true);
    expect(result.settled).toBe(true);
    expect(result.snapshotWritten).toBe(true);
    expect(syncSessionExists()).toBe(false); // settled → session cleared
    expect(readBindingsSnapshot(globalRoot, PROJECT_ID)).not.toBeNull();
  });

  it("offline store defers its push but the session still settles (S17)", () => {
    const result = runStartSync({
      projectRoot,
      globalRoot,
      now: NOW,
      pull: scriptedPull({ platform: "offline" }),
    });
    expect(result.settled).toBe(true);
    expect(result.deferred.map((s) => s.alias)).toEqual(["platform"]);
    expect(result.snapshotWritten).toBe(true);
  });

  it("pauses + persists the session on a conflict (no snapshot yet)", () => {
    const result = runStartSync({
      projectRoot,
      globalRoot,
      now: NOW,
      pull: scriptedPull({ team: "conflict" }),
    });
    expect(result.settled).toBe(false);
    expect(result.snapshotWritten).toBe(false);
    expect(result.session.stores.find((s) => s.alias === "team")?.state).toBe("conflict");
    expect(syncSessionExists()).toBe(true); // persisted for --continue/--abort
  });
});

describe("runContinueSync / runAbortSync (resume a paused conflict)", () => {
  function pauseOnTeamConflict(): void {
    runStartSync({ projectRoot, globalRoot, now: NOW, pull: scriptedPull({ team: "conflict" }) });
  }

  it("--continue advances the resolved store, walks the rest, settles + snapshots", () => {
    pauseOnTeamConflict();
    let rebaseContinued = "";
    const result = runContinueSync({
      projectRoot,
      globalRoot,
      now: NOW,
      pull: scriptedPull({}),
      rebaseContinue: (dir) => {
        rebaseContinued = dir;
      },
    });
    expect(rebaseContinued).toContain(TEAM);
    expect(result.session.stores.find((s) => s.alias === "team")?.state).toBe("synced");
    expect(result.settled).toBe(true);
    expect(result.snapshotWritten).toBe(true);
    expect(syncSessionExists()).toBe(false);
  });

  it("--abort abandons the conflicted store but resumes the remaining walk", () => {
    pauseOnTeamConflict();
    let rebaseAborted = "";
    const result = runAbortSync({
      projectRoot,
      globalRoot,
      now: NOW,
      pull: scriptedPull({}),
      rebaseAbort: (dir) => {
        rebaseAborted = dir;
      },
    });
    expect(rebaseAborted).toContain(TEAM);
    expect(result.session.stores.find((s) => s.alias === "team")?.state).toBe("aborted");
    // platform still pending at pause time → now walked to synced.
    expect(result.session.stores.find((s) => s.alias === "platform")?.state).toBe("synced");
    expect(result.settled).toBe(true);
  });

  it("--continue with no session in progress throws", () => {
    expect(() => runContinueSync({ projectRoot, globalRoot, now: NOW })).toThrow(/no sync in progress/);
  });
});

describe("F57/F58 sync-session robustness", () => {
  function sessionPath(): string {
    return join(globalRoot, "state", "sync-session.json");
  }

  // F58 (ISS-20260531-097): a corrupt sync-session.json must surface an
  // actionable error, not a bare unhandled SyntaxError that crashes every later
  // sync command. It also quarantines the bytes to a forensic sidecar.
  it("loadSession on a corrupt session file throws an actionable error + quarantines bytes", () => {
    mkdirSync(join(globalRoot, "state"), { recursive: true });
    writeFileSync(sessionPath(), "{ this is not valid json", "utf8");
    expect(() => runContinueSync({ projectRoot, globalRoot, now: NOW })).toThrow(/corrupt/i);
    const stateDir = join(globalRoot, "state");
    const quarantined = readdirSync(stateDir).filter((f) => f.includes("sync-session.json.corrupted."));
    expect(quarantined.length).toBe(1);
  });

  // F58: saveSession uses write-tmp + rename, so a persisted conflict session
  // leaves no `.tmp` residue (and an interrupted write can never corrupt the
  // live file).
  it("saveSession persists atomically — no .tmp residue after a conflict pause", () => {
    runStartSync({ projectRoot, globalRoot, now: NOW, pull: scriptedPull({ team: "conflict" }) });
    expect(syncSessionExists()).toBe(true);
    const residue = readdirSync(join(globalRoot, "state")).filter((f) => f.endsWith(".tmp"));
    expect(residue).toEqual([]);
  });

  // F57 (ISS-20260531-096): a failing `git rebase --continue` (default wiring,
  // no rebase in progress / non-repo store) surfaces an actionable FabricError
  // instead of crashing the CLI with execFileSync's bare "Command failed".
  it("default rebase --continue failure surfaces an actionable error", () => {
    runStartSync({ projectRoot, globalRoot, now: NOW, pull: scriptedPull({ team: "conflict" }) });
    // No rebaseContinue injected → the real `git rebase --continue` runs and
    // fails (the store dir is not mid-rebase / not a git repo).
    expect(() => runContinueSync({ projectRoot, globalRoot, now: NOW })).toThrow(
      /git rebase --continue failed/,
    );
  });
});

describe("no global config", () => {
  it("guides to `install --global`", () => {
    const empty = join(mkdtempSync(join(tmpdir(), "fabric-sync-empty-")), ".fabric");
    dirs.push(empty);
    expect(() => runStartSync({ projectRoot, globalRoot: empty, now: NOW })).toThrow(
      /install --global/,
    );
  });
});

describe("real git: default `git pull --rebase` clean path", () => {
  function git(cwd: string, args: string[]): void {
    execFileSync("git", args, {
      cwd,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
      },
    });
  }

  it("a remote with no new commits rebases clean and settles", () => {
    // Bare remote + an upstream working clone that seeds one commit.
    const remote = mkdtempSync(join(tmpdir(), "fabric-sync-remote-"));
    dirs.push(remote);
    git(remote, ["init", "--bare", "-b", "main"]);
    const seed = mkdtempSync(join(tmpdir(), "fabric-sync-seed-"));
    dirs.push(seed);
    git(seed, ["init", "-b", "main"]);
    execFileSync("git", ["commit", "--allow-empty", "-m", "seed"], {
      cwd: seed,
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
    });
    git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-u", "origin", "main"]);

    // The mounted store is a clone of that remote under ~/.fabric/stores/<uuid>/.
    const storeDir = join(globalRoot, storeRelativePath(TEAM));
    mkdirSync(join(globalRoot, "stores"), { recursive: true });
    execFileSync("git", ["clone", remote, storeDir], { stdio: "ignore" });

    // Only the team store has a reachable remote in this test; point platform's
    // remote at the same bare repo so its pull is also clean.
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        stores: [{ store_uuid: TEAM, alias: "team", remote, writable: true }],
      }),
      globalRoot,
    );

    const result = runStartSync({ projectRoot, globalRoot, now: NOW });
    expect(result.session.stores.find((s) => s.alias === "team")?.state).toBe("synced");
    expect(result.settled).toBe(true);
  });
});

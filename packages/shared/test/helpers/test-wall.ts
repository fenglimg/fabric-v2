import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.5 — Validation test wall (S39).
//
// Reusable, real-fs (no mocks) harness so every later phase TDDs against an
// ISOLATED global home + a local fake bare git remote, never the developer's
// real `~/.fabric`. Mirrors the existing FABRIC_HOME tempdir convention used by
// server/src/services/knowledge-sync.test.ts.
//
//   - createIsolatedHome() : temp dir acting as $HOME; FABRIC_HOME points at it,
//                            globalRoot = <home>/.fabric is the v2.1 store root.
//   - createFakeBareRemote(): a local `git init --bare` repo for sync/clone.
//   - cloneRepo()/seedAndPush(): round-trip helpers over the fake remote.
//   - twoClientConfigFixtures(): one fabric-config fixture per supported client.
//
// All created temp dirs are tracked; call cleanupTestWall() in afterEach.
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];
const savedEnv: Array<[string, string | undefined]> = [];

function track(dir: string): string {
  createdDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Deterministic committer identity for isolated repos (no global git config
// dependency, no interactive prompts).
function configureIdentity(repoDir: string): void {
  git(repoDir, ["config", "user.email", "testwall@fabric.local"]);
  git(repoDir, ["config", "user.name", "Fabric Test Wall"]);
  git(repoDir, ["config", "commit.gpgsign", "false"]);
}

export interface IsolatedHome {
  /** Temp dir acting as $HOME. */
  home: string;
  /** v2.1 global fabric root: <home>/.fabric */
  globalRoot: string;
  /** Stores root: <home>/.fabric/stores */
  storesRoot: string;
  /** Global volatile state: <home>/.fabric/state */
  stateRoot: string;
}

/** mkdtemp a fake $HOME, set FABRIC_HOME, and scaffold the v2.1 global layout. */
export function createIsolatedHome(prefix = "fabric-testwall-home-"): IsolatedHome {
  const home = track(mkdtempSync(join(tmpdir(), prefix)));
  const globalRoot = join(home, ".fabric");
  const storesRoot = join(globalRoot, "stores");
  const stateRoot = join(globalRoot, "state");
  mkdirSync(storesRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  setEnv("FABRIC_HOME", home);
  return { home, globalRoot, storesRoot, stateRoot };
}

/** Inject the FABRIC_PROJECT_ROOT env signal (S15). */
export function setProjectRoot(dir: string): void {
  setEnv("FABRIC_PROJECT_ROOT", dir);
}

/** Set an env var, remembering the prior value for cleanupTestWall() to restore. */
export function setEnv(key: string, value: string): void {
  savedEnv.push([key, process.env[key]]);
  process.env[key] = value;
}

/** Create a local `git init --bare` repo usable as a sync/clone remote. */
export function createFakeBareRemote(prefix = "fabric-testwall-remote-"): string {
  const dir = track(mkdtempSync(join(tmpdir(), prefix)));
  git(dir, ["init", "--bare", "-b", "main", dir]);
  return dir;
}

/** Clone a remote into a fresh temp working dir; returns the working dir path. */
export function cloneRepo(remote: string, prefix = "fabric-testwall-clone-"): string {
  const parent = track(mkdtempSync(join(tmpdir(), prefix)));
  const dest = join(parent, "work");
  git(parent, ["clone", remote, dest]);
  configureIdentity(dest);
  return dest;
}

/** Write a file in a working clone, commit, and push to its origin/main. */
export function seedAndPush(workDir: string, relPath: string, content: string): void {
  const abs = join(workDir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
  git(workDir, ["add", "-A"]);
  git(workDir, ["commit", "-m", "seed"]);
  git(workDir, ["push", "origin", "main"]);
}

export interface TwoClientConfigFixtures {
  claudeCode: Record<string, unknown>;
  codexCLI: Record<string, unknown>;
}

/**
 * One project fabric-config fixture per supported client (CC / Codex).
 * Each is a valid `fabric-config.json` shape (parses against fabricConfigSchema)
 * carrying the v2.1 project_id + required_stores fields. Used to prove the two
 * ends round-trip identically through the config schema.
 */
export function twoClientConfigFixtures(): TwoClientConfigFixtures {
  const base = {
    project_id: "11111111-1111-4111-8111-111111111111",
    required_stores: [{ id: "team", suggested_remote: "git@github.com:acme/team-kb.git" }],
    fabric_language: "match-existing",
  };
  return {
    claudeCode: { ...base, clientPaths: { claudeCodeCLI: ".claude" } },
    codexCLI: { ...base, clientPaths: { codexCLI: ".codex" } },
  };
}

/**
 * Build a v2.0-style legacy in-repo `.fabric/knowledge/<type>/` directory (NO
 * store.json) under a fresh temp dir. The clean-slate negative test asserts the
 * v2.1 store reader does NOT recognize it (S22/S66).
 */
export function createLegacyInRepoLayout(prefix = "fabric-testwall-legacy-"): string {
  const repo = track(mkdtempSync(join(tmpdir(), prefix)));
  const legacyKnowledge = join(repo, ".fabric", "knowledge", "decisions");
  mkdirSync(legacyKnowledge, { recursive: true });
  writeFileSync(
    join(legacyKnowledge, "KT-DEC-0001.md"),
    "# legacy entry\n\nold v2.0 in-repo layout, no store.json\n",
    "utf8",
  );
  return join(repo, ".fabric");
}

/**
 * Build a recognizable v2.1 store directory (valid store.json) under a fresh
 * temp dir; returns its absolute path. The positive counterpart to
 * createLegacyInRepoLayout() for store-disk-reader recognition tests.
 */
export function createValidStoreDir(prefix = "fabric-testwall-store-"): string {
  const dir = track(mkdtempSync(join(tmpdir(), prefix)));
  mkdirSync(join(dir, "knowledge", "decisions"), { recursive: true });
  writeFileSync(
    join(dir, "store.json"),
    JSON.stringify(
      {
        store_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        created_at: "2026-05-30T00:00:00.000Z",
        canonical_alias: "team",
      },
      null,
      2,
    ),
    "utf8",
  );
  return dir;
}

/** Remove all tracked temp dirs and restore env. Call in afterEach. */
export function cleanupTestWall(): void {
  for (const [key, value] of savedEnv.splice(0).reverse()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

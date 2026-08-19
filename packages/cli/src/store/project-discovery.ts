// ---------------------------------------------------------------------------
// Finding Fabric projects that the registry never heard of.
//
// WHY THIS EXISTS. `~/.fabric/state/projects.json` is written by `fabric
// install` and is the only thing on this machine that knows where a project
// lives. It was added long after people started installing Fabric, so on a real
// machine it holds the ONE project that was installed since — while
// `state/bindings/` holds a file per project that ever bound a store. The
// console then truthfully reported one project on a machine with eight, which
// reads as "this tool cannot see my work" rather than "this table is young".
//
// The standing comment in project-list.ts said a project_id cannot be mapped
// back to a directory (KT-PIT-0050). That is true of the DATA — no file stores
// that mapping — but it was being treated as true of the MACHINE, which it is
// not: every installed project carries its own id in `.fabric/fabric-config.json`.
// The reverse map is not absent, it is uncomputed. Measured on the machine this
// was written for: a depth-6 walk of $HOME recovers 5 of the 7 missing projects.
// The remaining 2 are directories that no longer exist, which no amount of
// searching can fix and which the page must therefore say out loud.
//
// HOW LONG IT TAKES IS NOT A PROPERTY OF THE WALK. The same walk over the same
// $HOME measured 0.35s from a terminal-spawned process and did not finish at all
// from the desktop app's — one directory in it never returned from `readdir`.
// Both ceilings below (whole-walk, single-read) exist because of that, and the
// result reports which one it hit: a scan that quietly returns less than
// everything is worse than the missing table it was built to replace.
//
// WHAT COUNTS AS A PROJECT: `<dir>/.fabric/fabric-config.json` parses as JSON.
// Not "has a `.fabric/` directory" — that matched 15 paths here, including
// `~/.fabric` (the global root itself), a backup copy of it, and five repos left
// holding nothing but an empty `.fabric/.cache`. The config file is what
// `fabric install` writes, so it is the marker with no false positives.
//
// SCANNING IS EXPLICIT, NEVER AMBIENT. Nothing calls this on a timer or during
// a page load. It walks the user's home directory, which is a thing to do when
// asked and not otherwise.
// ---------------------------------------------------------------------------

import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { INSTALL_MANIFEST_REL } from "@fenglimg/fabric-shared";

import { resolveGlobalRoot } from "./global-config-io.js";
import { listRegisteredProjects, registerProject } from "./project-registry-io.js";

/**
 * Directory names never descended into.
 *
 * Deliberately an explicit list rather than "skip anything starting with a
 * dot": worktrees live under `.claude/worktrees/` and `.trae/worktrees/` on this
 * machine, and those are real checkouts with real installs. A dot-prefix rule
 * would have silently made every worktree undiscoverable — the same class of
 * miss this module exists to fix.
 */
const PRUNED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "Library",
  "Applications",
  ".Trash",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".cache",
  ".venv",
  "venv",
  ".rustup",
  ".cargo",
  ".gradle",
  ".m2",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  // The marker directory itself. Descending into it would walk every store
  // checkout under the global root for no possible gain.
  ".fabric",
]);

const DEFAULT_MAX_DEPTH = 6;
/**
 * Hard ceiling on directories visited.
 *
 * A prune list is a guess about someone else's disk; this is the thing that
 * holds when the guess is wrong. Hitting it is reported (`stoppedBy`) rather
 * than swallowed, because "scanned everything and found 5" and "gave up after
 * 20000 directories and found 5" are different answers to the user's question.
 */
const DEFAULT_MAX_DIRS = 20_000;
/**
 * Wall-clock ceiling on the whole walk.
 *
 * A directory count is not a time bound, and the gap between them is not
 * academic: measured on one machine, the same walk over the same `$HOME` ran at
 * ~50µs per directory from a terminal-spawned process and ~30ms per directory
 * from the desktop app's — a 600x spread, from per-call security checks that
 * depend on which process is asking. At the slow rate the 20000-directory
 * ceiling is roughly ten minutes, so the console's scan request simply never
 * returned. Network mounts and endpoint-security agents produce the same shape.
 *
 * So the budget the user actually cares about is time, and it is enforced here
 * rather than by an HTTP timeout: a request the server abandons still leaves the
 * walk running, while this stops the work and returns what was found.
 */
const DEFAULT_MAX_MS = 8_000;
/**
 * Ceiling on a SINGLE `readdir`, which is a different failure from the walk
 * being slow overall.
 *
 * The overall budget above is checked between directories, so it cannot fire
 * while the walk is stuck inside one call — and that is exactly what happens.
 * Measured: a scan of `$HOME` read 19 directories in milliseconds and then
 * stopped dead on the 20th, with the process asleep at ~0% CPU and no further
 * progress for as long as it was left running. One unresponsive directory
 * (stale network mount, cloud-storage placeholder, a path the process is not
 * permitted to read and whose denial never returns) is enough to hang the whole
 * scan, and the console request behind it never answers.
 *
 * A stuck directory is therefore skipped rather than waited on. The abandoned
 * `readdir` keeps its libuv threadpool slot — there is no way to cancel it — so
 * enough stuck directories will starve the pool and every later read will time
 * out too. That degrades to "found less than everything", which is reportable;
 * the alternative degrades to "never answered", which is not.
 */
const DEFAULT_MAX_DIR_MS = 1_500;

/** Marker for "this read did not come back in time" — distinct from any value `readdir` can return. */
const TIMED_OUT = Symbol("timed-out");

/**
 * `readdir`, bounded. Resolves to {@link TIMED_OUT} rather than rejecting so the
 * caller can tell "unreadable" (a real error, already handled) apart from
 * "never came back" (this), which need different bookkeeping.
 */
async function readdirWithin(
  dir: string,
  ms: number,
): Promise<Dirent[] | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      readdir(dir, { withFileTypes: true }),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
        // Do not hold the process open for a timer that only bounds a read.
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface DiscoveredProject {
  path: string;
  /** null when the install never bound a store, so it was never given an id. */
  projectId: string | null;
  /** From `.fabric/install-manifest.json`; null for a pre-manifest install. */
  fabricVersion: string | null;
}

export interface DiscoveryResult {
  projects: DiscoveredProject[];
  /** Roots actually walked, so the page can say where it looked. */
  roots: string[];
  visitedDirs: number;
  /**
   * Which ceiling ended the walk, or null when it finished on its own.
   *
   * One field rather than a `truncated` boolean beside a reason: two fields
   * that describe one outcome can disagree, and the reason is the part the user
   * can act on. "Hit the directory ceiling" means narrow the roots; "ran out of
   * time" means this machine is slow at filesystem calls and a re-run gets
   * further. Collapsing both into "partial" throws away the advice.
   */
  stoppedBy: "dirs" | "time" | null;
  /**
   * Directories whose read never came back within {@link DEFAULT_MAX_DIR_MS}.
   *
   * Counted separately from "unreadable" because the remedy differs and because
   * a non-zero value here is the signal that results are incomplete for a reason
   * the user cannot see: the directory is not missing and not forbidden, it just
   * does not answer.
   */
  stuckDirs: number;
}

export interface DiscoveryOptions {
  /** Defaults to the user's home directory. */
  roots?: readonly string[];
  maxDepth?: number;
  maxDirs?: number;
  /** Wall-clock budget for the walk — see {@link DEFAULT_MAX_MS}. */
  maxMs?: number;
  /** Wall-clock budget for one directory read — see {@link DEFAULT_MAX_DIR_MS}. */
  maxDirMs?: number;
  globalRoot?: string;
}

async function readProjectId(configPath: string): Promise<string | null | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return undefined; // not a project
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const id = (parsed as { project_id?: unknown }).project_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    // A project whose config is corrupt is still a project sitting in a
    // directory, and saying so is more useful than pretending it is not there.
    return null;
  }
}

async function readManifestVersion(projectRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(join(projectRoot, ...INSTALL_MANIFEST_REL.split("/")), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const version = (parsed as { fabric_version?: unknown }).fabric_version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * Walk `roots` breadth-first and return every Fabric project found.
 *
 * Breadth-first rather than depth-first so that truncation, when it happens,
 * costs the DEEPEST directories rather than an arbitrary subtree — projects
 * live a few levels under home, and losing level 6 is survivable in a way that
 * losing `~/Desktop/projects/**` is not.
 */
export async function discoverFabricProjects(
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxDirs = options.maxDirs ?? DEFAULT_MAX_DIRS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const maxDirMs = options.maxDirMs ?? DEFAULT_MAX_DIR_MS;
  const globalRoot = resolve(options.globalRoot ?? resolveGlobalRoot());
  const roots = (options.roots ?? [homedir()]).map((r) => resolve(r));
  const deadline = Date.now() + maxMs;

  const projects: DiscoveredProject[] = [];
  const seenDirs = new Set<string>();
  let queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }));
  let visitedDirs = 0;
  let stoppedBy: DiscoveryResult["stoppedBy"] = null;
  let stuckDirs = 0;

  while (queue.length > 0 && stoppedBy === null) {
    const next: typeof queue = [];
    for (const { dir, depth } of queue) {
      // Checked per directory, not per level: a level of a wide home directory
      // is thousands of entries, and at the slow-filesystem rates this budget
      // exists for, one level is already far past the deadline.
      if (Date.now() >= deadline) {
        stoppedBy = "time";
        break;
      }
      if (visitedDirs >= maxDirs) {
        stoppedBy = "dirs";
        break;
      }
      // Two roots can overlap (`["~", "~/code"]`), which puts the same tree in
      // the queue twice and lists every project under it twice. Visiting each
      // resolved path once ends that without having to reason about which root
      // contains which.
      //
      // This is NOT what stops symlink cycles: the descent below tests
      // `entry.isDirectory()`, which is false for a symlink-to-directory, so
      // the walk never follows one. That is the deliberate trade — a symlinked
      // project is missed, and in exchange the walk can never escape the roots
      // or spin on a loop. A project you reach only through a symlink is still
      // reachable by adding its real location as a root.
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);
      visitedDirs += 1;

      let entries: Dirent[];
      try {
        // Never longer than the budget that is left: a 1500ms per-directory
        // ceiling would otherwise be able to overshoot the overall one.
        const result = await readdirWithin(dir, Math.min(maxDirMs, deadline - Date.now()));
        if (result === TIMED_OUT) {
          stuckDirs += 1;
          continue;
        }
        entries = result;
      } catch {
        continue; // unreadable (permissions, vanished mid-walk) — not fatal
      }

      const hasFabric = entries.some((e) => e.isDirectory() && e.name === ".fabric");
      // The global root is `<something>/.fabric`, so its PARENT looks exactly
      // like a project to the check above. Exclude it by identity rather than
      // by name: FABRIC_HOME can move it anywhere.
      if (hasFabric && join(dir, ".fabric") !== globalRoot) {
        const projectId = await readProjectId(join(dir, ".fabric", "fabric-config.json"));
        if (projectId !== undefined) {
          projects.push({ path: dir, projectId, fabricVersion: await readManifestVersion(dir) });
        }
      }

      if (depth >= maxDepth) continue;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (PRUNED_DIRS.has(entry.name)) continue;
        next.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    }
    queue = next;
  }

  projects.sort((a, b) => a.path.localeCompare(b.path));
  return { projects, roots, visitedDirs, stoppedBy, stuckDirs };
}

export interface BackfillResult extends DiscoveryResult {
  /** Projects that were not in the registry and now are. */
  added: DiscoveredProject[];
  /** Found, but the registry already had that exact path. */
  alreadyKnown: number;
}

/**
 * Discover, then write what was found into the registry.
 *
 * Only paths the registry does not already hold are written. An existing entry
 * carries a real `fabric_version` and `registered_at` from the install that
 * created it; overwriting those with "found by a scan just now" would trade
 * facts for observations, and the whole point of the registry is that it is the
 * one place that knows when a project was actually installed.
 */
export async function backfillProjectRegistry(
  options: DiscoveryOptions = {},
): Promise<BackfillResult> {
  const discovery = await discoverFabricProjects(options);
  const known = new Set((await listRegisteredProjects(options.globalRoot)).map((p) => p.path));

  const added: DiscoveredProject[] = [];
  for (const project of discovery.projects) {
    if (known.has(project.path)) continue;
    const ok = await registerProject(
      {
        path: project.path,
        ...(project.projectId === null ? {} : { projectId: project.projectId }),
        // Left absent rather than guessed. Every pre-manifest install has no
        // version to read, and writing the RUNNING version here would label
        // five ancient installs as up to date.
        ...(project.fabricVersion === null ? {} : { fabricVersion: project.fabricVersion }),
      },
      options.globalRoot,
    );
    if (ok) added.push(project);
  }

  return { ...discovery, added, alreadyKnown: discovery.projects.length - added.length };
}

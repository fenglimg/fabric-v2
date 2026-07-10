import { readdirSync, rename as renameCb } from "node:fs";
import { promisify } from "node:util";
import { join, sep } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

const rename = promisify(renameCb);

// ---------------------------------------------------------------------------
// stray_fabric_dir_detected — walks the project tree from projectRoot and
// reports every `.fabric/` directory that is NOT the authoritative root
// anchor at `<projectRoot>/.fabric`. These are historical artifacts from
// before the git-anchor resolver landed (rc.10 hook side, rc.11 server side)
// — a subprocess whose cwd landed in a subdirectory of the repo would create
// a fresh `<subdir>/.fabric/` alongside the real one, scattering
// `events.jsonl` / `metrics.jsonl` / `.cache` across the source tree.
//
// The lint is a WARNING (not a fixable_error): the source-of-truth root is
// still healthy; the strays are corpses to sweep, not data-loss risks. The
// `--fix` arm renames each stray to `<path>.stale-<timestamp>` — rescue-
// before-delete (KT-PIT-0016), never a hard rm. Ops can review the renamed
// dirs and either merge unique events by hand or delete once satisfied.
//
// Scan strategy: bounded-depth (MAX_DEPTH) recursive readdir from projectRoot.
// Skips the standard IGNORED_DIRS heavy trees (node_modules / .git / dist /
// build / coverage / .next / .turbo / Library / Temp) so the walker stays
// fast in monorepos. When a `.fabric` dir is encountered mid-tree it is
// recorded and NOT descended into (avoid stat-storming its cache).
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "Library",
  "Temp",
  ".claude",
  ".codex",
  ".workflow",
]);

const MAX_DEPTH = 8;

export function detectStrayFabricDirs(projectRoot: string): string[] {
  const strays: string[] = [];
  walk(projectRoot, projectRoot, 0, strays);
  return strays;
}

function walk(root: string, current: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".fabric") {
      // `<root>/.fabric` is the legitimate anchor; anything else is stray.
      if (current !== root) {
        out.push(join(current, entry.name));
      }
      // Never descend into any `.fabric/` — legit or stray — the cache is
      // large and unrelated to this scan.
      continue;
    }
    if (IGNORED_DIRS.has(entry.name)) continue;
    walk(root, join(current, entry.name), depth + 1, out);
  }
}

function relative(root: string, abs: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

export function createStrayFabricDirCheck(
  t: Translator,
  strays: string[],
  projectRoot: string,
): DoctorCheck {
  if (strays.length === 0) {
    return {
      name: t("doctor.check.stray_fabric_dir_detected.name"),
      status: "ok",
      message: t("doctor.check.stray_fabric_dir_detected.ok"),
    };
  }
  const summary = strays
    .slice(0, 5)
    .map((abs) => relative(projectRoot, abs))
    .join(", ");
  return {
    name: t("doctor.check.stray_fabric_dir_detected.name"),
    status: "warn",
    kind: "warning",
    code: "stray_fabric_dir_detected",
    fixable: true,
    message: t("doctor.check.stray_fabric_dir_detected.message", {
      count: String(strays.length),
      dirs: summary,
    }),
    actionHint: t("doctor.check.stray_fabric_dir_detected.remediation"),
  };
}

export type StrayFabricRenameResult = {
  from: string;
  to: string;
  ok: boolean;
  error?: string;
};

// --fix arm: rescue-before-delete. Rename each stray to a timestamped
// sibling so ops can inspect + optionally merge events before removal.
// `nowIso` is injectable so tests get a deterministic suffix.
export async function fixStrayFabricDirs(
  strays: string[],
  nowIso: string = new Date().toISOString(),
): Promise<StrayFabricRenameResult[]> {
  const stamp = nowIso.replace(/[:.]/g, "-");
  const results: StrayFabricRenameResult[] = [];
  for (const from of strays) {
    const to = `${from}.stale-${stamp}`;
    try {
      await rename(from, to);
      results.push({ from, to, ok: true });
    } catch (err) {
      results.push({
        from,
        to,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

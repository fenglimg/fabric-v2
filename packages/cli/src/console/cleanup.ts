// ---------------------------------------------------------------------------
// `POST /api/cleanup` — the console's only DELETE-shaped capability.
//
// Everything else this server writes is reversible: a config value can be set
// back, an install can be re-run. Removing a file cannot, so this endpoint is
// built to the same two rules the config write channel follows, tightened:
//
//   1. THE REQUEST NEVER CARRIES A PATH. The body names an ACTION, and the
//      server computes the set of files that action covers. A body that could
//      say "delete /etc/..." would make a page the browser happens to load into
//      an arbitrary-file remover on the user's machine.
//   2. THE SET IS COMPUTED BY THE SAME CODE THAT DISPLAYS IT. The orphan list
//      comes from `collectIntegrations` — the collector the page rendered from —
//      and the cache list from doctor's own sweep families. A second
//      implementation of "which files are stale" would eventually disagree with
//      the one the user was looking at when they pressed the button, and the
//      disagreement would only ever be visible after the delete (KT-PIT-0106).
//
// The report is read back off disk rather than assumed from the plan
// (KT-PIT-0107): `remainingCount` is a fresh inspection, so a delete that
// silently failed shows up as a number that did not move.
// ---------------------------------------------------------------------------

import { unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { applySessionHintsStaleCleanup } from "@fenglimg/fabric-server";

import { collectIntegrations } from "./integrations-view.js";
import { resolveScope, type ResolvedScope } from "./scope.js";

/** The closed set of things this endpoint knows how to remove. */
export type CleanupAction =
  /**
   * Files under a client's Fabric directories that no template in this release
   * ships — companions left behind because install never prunes (KT-PIT-0079).
   */
  | "orphan-artifacts"
  /** Per-session sidecars under `.fabric/.cache/`, excluding live-session state. */
  | "hint-cache";

const CLEANUP_ACTIONS = new Set<string>(["orphan-artifacts", "hint-cache"]);

export interface CleanupRequest {
  action?: unknown;
  /** A scope ID (`machine` or a project uuid) — never a directory. */
  scope?: unknown;
}

/** One file the plan named but did not remove, and why the user still sees it. */
export interface CleanupSkip {
  path: string;
  reason: "outside-project" | "delete-failed";
}

export type CleanupResult =
  | {
      ok: true;
      action: CleanupAction;
      removed: string[];
      skipped: CleanupSkip[];
      /**
       * How many files the SAME inspection still finds afterwards, re-read from
       * disk. Zero is the only honest way to say "there is nothing left"; a
       * count derived from `plan.length - removed.length` would report success
       * for a delete that never happened.
       */
      remainingCount: number;
    }
  | { ok: false; status: number; error: string };

function bad(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

/**
 * Belt-and-braces containment check.
 *
 * Nothing in either plan comes from the request, so no relative path should
 * ever escape the project — which is exactly why a violation must be refused
 * loudly rather than trusted quietly: if one ever appears, the assumption this
 * whole endpoint rests on has already broken.
 */
function insideProject(projectRoot: string, relPath: string): boolean {
  const abs = resolve(projectRoot, relPath);
  return abs === projectRoot || abs.startsWith(projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep);
}

/**
 * Delete every path in `plan`, reporting each outcome off the syscall.
 *
 * `remove` is passed in rather than always being `unlink` because the cache arm
 * goes through doctor's own apply-lint helper — the same function `fabric doctor
 * --fix` calls, so "cleared from the console" and "cleared by doctor" cannot
 * drift into two different operations.
 */
async function removeAll(
  projectRoot: string,
  plan: readonly string[],
  remove: (relPath: string) => Promise<boolean>,
): Promise<{ removed: string[]; skipped: CleanupSkip[] }> {
  const removed: string[] = [];
  const skipped: CleanupSkip[] = [];
  for (const relPath of plan) {
    if (!insideProject(projectRoot, relPath)) {
      skipped.push({ path: relPath, reason: "outside-project" });
      continue;
    }
    if (await remove(relPath)) removed.push(relPath);
    else skipped.push({ path: relPath, reason: "delete-failed" });
  }
  return { removed, skipped };
}

/**
 * @param launchDir the directory the console was started in — the fallback root
 * and the registry lookup base, exactly as every read endpoint uses it. It does
 * NOT select the target: the body's scope id does, and it is resolved through
 * the same `resolveScope` the pages read through, so a scope this endpoint will
 * delete in is always one the page could display.
 */
export async function applyCleanup(
  body: CleanupRequest | null,
  launchDir: string,
): Promise<CleanupResult> {
  const action = body?.action;
  if (typeof action !== "string" || !CLEANUP_ACTIONS.has(action)) {
    return bad(400, `unknown cleanup action: ${String(action)}`);
  }
  const rawScope = body?.scope;
  if (rawScope !== undefined && rawScope !== null && typeof rawScope !== "string") {
    return bad(400, "scope must be a string");
  }
  const resolved = await resolveScope(rawScope ?? null, launchDir);
  if (!resolved.ok) return bad(resolved.status, resolved.error);
  const scope = resolved.scope;
  if (scope.kind === "machine") {
    // Both plans are properties of a project directory. Machine scope has no
    // directory, and inventing one (the launch dir) would delete files in a
    // project the user was not looking at.
    return bad(409, "cleanup needs a project scope: neither list exists machine-wide");
  }
  const projectRoot = scope.projectRoot;

  // The plan comes off the SAME collector the page rendered from — read set and
  // write set are literally one call, not two implementations that agree today
  // (KT-PIT-0106). It is recomputed here rather than taken from the request,
  // because the page may be minutes stale and the request may not be the page.
  const before = await collectIntegrations(scope);
  const { removed, skipped } =
    action === "orphan-artifacts"
      ? await removeAll(projectRoot, before.cleanup.orphans, async (relPath) => {
          try {
            await unlink(join(projectRoot, ...relPath.split("/")));
            return true;
          } catch {
            return false;
          }
        })
      : await removeAll(
          projectRoot,
          before.cleanup.cache.map((c) => c.path),
          async (relPath) => {
            const candidate = before.cleanup.cache.find((c) => c.path === relPath);
            if (candidate === undefined) return false;
            return (await applySessionHintsStaleCleanup(projectRoot, candidate)).applied;
          },
        );

  // A fresh collection, so the count is disk state and not arithmetic on the
  // plan (KT-PIT-0107): a delete that silently failed leaves a number that did
  // not move, which is the only way the page can tell.
  const after = await collectIntegrations(scope);
  return {
    ok: true,
    action: action as CleanupAction,
    removed,
    skipped,
    remainingCount:
      action === "orphan-artifacts" ? after.cleanup.orphans.length : after.cleanup.cache.length,
  };
}

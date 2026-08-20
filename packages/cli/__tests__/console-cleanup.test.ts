/**
 * `POST /api/cleanup` — the only endpoint in this console that deletes.
 *
 * The guard (POST-only, loopback Origin, no path in the body) is pinned in
 * console-write-guard.test.ts. What is pinned HERE is the part a guard cannot
 * protect: whether the set it deletes is the right set. Three questions, and the
 * last one is why this file exists at all:
 *
 *   1. Does it remove what it says it removes?
 *   2. Does it leave everything else alone — including files it can SEE and
 *      report as a problem, but must not act on?
 *   3. When this CLI cannot read its own templates, does it delete nothing?
 *      That is the failure with no undo: every skill and hook on the machine
 *      reads as "no template ships this path" the instant the template tree
 *      stops resolving, and a delete keyed off the LABEL would take them all.
 *
 * The assertions read disk state after the call, not the returned plan. A report
 * built from what the code intended would agree with itself while the files
 * survived (KT-PIT-0107).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCleanup } from "../src/console/cleanup.ts";
import { collectIntegrations } from "../src/console/integrations-view.ts";
import { HOOK_LIB_DESTINATIONS, SKILL_LIB_DESTINATIONS } from "../src/install/distribution-targets.ts";

const dirs: string[] = [];
const savedEnv = new Map<string, string | undefined>();
// Same isolation console-integrations.test.ts needs and for the same reason: the
// MCP probe reads `$HOME/.claude.json`, so a test that only redirects
// FABRIC_HOME is reading the developer's real machine.
const HOME_VARS = ["FABRIC_HOME", "HOME", "USERPROFILE"] as const;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fab-clean-home-"));
  dirs.push(home);
  for (const name of HOME_VARS) {
    savedEnv.set(name, process.env[name]);
    process.env[name] = home;
  }
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [] }),
    "utf8",
  );
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-clean-proj-"));
  dirs.push(root);
  return root;
}

function put(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function has(root: string, rel: string): boolean {
  return existsSync(join(root, ...rel.split("/")));
}

describe("cleanup: orphan artifacts", () => {
  // Derived from the shipped destination tables rather than typed out, so a
  // renamed hook directory fails here instead of quietly testing a path the
  // product no longer uses (KT-PIT-0095).
  const hookLib = HOOK_LIB_DESTINATIONS[0];
  const skillLib = SKILL_LIB_DESTINATIONS[0];

  it("removes a leftover companion and leaves a hand-edited file alone", async () => {
    const root = project();
    // A file no template ships — the leftover the button exists for.
    put(root, `${hookLib}/dropped-helper.cjs`, "// from an older release\n");
    put(root, `${skillLib}/dropped-note.md`, "# stale\n");
    // A file a template DOES ship, edited by hand. The page reports it as a
    // problem in the same list, which is exactly why the delete set cannot be
    // "everything the page flagged": the user's edits are the one thing here a
    // reinstall could not give back.
    put(root, `${hookLib}/state-store.cjs`, "// hand-edited\n");

    const before = await collectIntegrations({
      kind: "project",
      projectId: null,
      projectRoot: root,
    });
    const flagged = before.clients
      .flatMap((c) => [...c.hooks, ...c.skills, ...c.libs])
      .flatMap((g) => g.problems);
    // The premise: all three files are visible as problems, and only two of them
    // are removable. Without this the next assertion could pass by finding
    // nothing at all.
    expect(flagged.filter((f) => f.path.endsWith("dropped-helper.cjs"))[0]?.removable).toBe(true);
    expect(flagged.filter((f) => f.path.endsWith("state-store.cjs"))[0]?.removable).toBe(false);

    const result = await applyCleanup({ action: "orphan-artifacts" }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed).toEqual([`${hookLib}/dropped-helper.cjs`, `${skillLib}/dropped-note.md`]);
    expect(result.skipped).toEqual([]);
    // Read back off disk, not off the report.
    expect(has(root, `${hookLib}/dropped-helper.cjs`)).toBe(false);
    expect(has(root, `${skillLib}/dropped-note.md`)).toBe(false);
    expect(has(root, `${hookLib}/state-store.cjs`)).toBe(true);
    // A fresh inspection, so a delete that silently failed shows up as a number
    // that did not move.
    expect(result.remainingCount).toBe(0);
  });

  it("deletes NOTHING when this CLI cannot read its own templates", async () => {
    const root = project();
    put(root, `${hookLib}/state-store.cjs`, "// the last good copy\n");
    put(root, `${hookLib}/dropped-helper.cjs`, "// genuinely a leftover\n");

    // Simulate the packaging fault: the templates tree stops resolving. Every
    // installed file now reads as "nothing ships this path", which is the exact
    // shape of an orphan — and the reason `removable` is not the same question
    // as `state === "orphan"`.
    const io = await import("../src/install/template-io.ts");
    vi.spyOn(io, "findTemplatePath").mockImplementation((rel: string) => {
      throw new Error(`Template not found: templates/${rel}`);
    });

    const view = await collectIntegrations({ kind: "project", projectId: null, projectRoot: root });
    const flagged = view.clients
      .flatMap((c) => [...c.hooks, ...c.skills, ...c.libs])
      .flatMap((g) => g.problems);
    // The premise again: the files ARE flagged, and every single one of them is
    // withheld from the delete set. An empty `flagged` would make this vacuous.
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.filter((f) => f.removable)).toEqual([]);

    const result = await applyCleanup({ action: "orphan-artifacts" }, root);
    expect(result.ok && result.removed).toEqual([]);
    expect(has(root, `${hookLib}/state-store.cjs`)).toBe(true);
    expect(has(root, `${hookLib}/dropped-helper.cjs`)).toBe(true);
  });
});

describe("cleanup: hint cache", () => {
  const CACHE = ".fabric/.cache";

  function seedCache(root: string): void {
    put(root, `${CACHE}/session-hints-alpha.json`, "{}");
    put(root, `${CACHE}/hint-dismiss-alpha.json`, "{}");
    // No extension — the family that a single shared `.json` suffix gate used
    // to skip.
    put(root, `${CACHE}/maintenance-hint-last-emit-alpha`, "2026-08-20T00:00:00Z");
    // Live state for a session that may be running right now. People keep
    // several client windows open on one repo, so "clear the cache" pressed in
    // one of them must not reach into the others.
    put(root, `${CACHE}/active-session-beta.json`, "{}");
    // A pre-split shared slot. Self-limiting at one file, and not session-scoped
    // — the sweep must not widen onto it (KT-PIT-0051).
    put(root, `${CACHE}/archive-hint-shown.json`, "{}");
    // Nothing to do with any sweep family.
    put(root, `${CACHE}/read-set-revision.json`, "{}");
  }

  it("clears session sidecars of any age but never a live session's own file", async () => {
    const root = project();
    seedCache(root);
    // Every file written seconds ago. Doctor would take none of them — its
    // seven-day floor is what makes it safe. This button has no floor, which is
    // the whole reason the live family is excluded by NAME.
    const result = await applyCleanup({ action: "hint-cache" }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed.sort()).toEqual([
      `${CACHE}/hint-dismiss-alpha.json`,
      `${CACHE}/maintenance-hint-last-emit-alpha`,
      `${CACHE}/session-hints-alpha.json`,
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.remainingCount).toBe(0);

    expect(has(root, `${CACHE}/active-session-beta.json`)).toBe(true);
    expect(has(root, `${CACHE}/archive-hint-shown.json`)).toBe(true);
    expect(has(root, `${CACHE}/read-set-revision.json`)).toBe(true);
  });

  it("survives a project with no cache directory at all", async () => {
    const result = await applyCleanup({ action: "hint-cache" }, project());
    expect(result.ok && result.removed).toEqual([]);
    expect(result.ok && result.remainingCount).toBe(0);
  });

  it("takes a file whose mtime is in the FUTURE", async () => {
    // Not a hypothetical. `mtimeMs` carries sub-millisecond precision while
    // `Date.now()` is whole milliseconds, so a file written moments ago is
    // routinely stamped a hair after "now" — and an unclamped
    // `floor((now - mtime) / day)` makes that -1, which is below a zero floor.
    // The test above flaked four runs in five before the clamp landed, because
    // its fixture was reproducing this by accident. Forcing the clock forward
    // turns an intermittent failure into a deterministic one.
    const root = project();
    put(root, `${CACHE}/session-hints-future.json`, "{}");
    const ahead = new Date(Date.now() + 60_000);
    utimesSync(join(root, ...`${CACHE}/session-hints-future.json`.split("/")), ahead, ahead);

    const result = await applyCleanup({ action: "hint-cache" }, root);
    expect(result.ok && result.removed).toEqual([`${CACHE}/session-hints-future.json`]);
  });

  it("takes an old file too — the button is not an age filter in disguise", async () => {
    // The cheap way to get this wrong is to inherit doctor's floor and then
    // report "nothing to clear" on a machine full of week-old sidecars. Pinning
    // both ends (fresh above, ancient here) is what makes the floor's absence a
    // tested property rather than an accident of the fixture's mtimes.
    const root = project();
    put(root, `${CACHE}/session-hints-ancient.json`, "{}");
    const old = new Date("2026-01-01T00:00:00Z");
    utimesSync(join(root, ...`${CACHE}/session-hints-ancient.json`.split("/")), old, old);

    const result = await applyCleanup({ action: "hint-cache" }, root);
    expect(result.ok && result.removed).toEqual([`${CACHE}/session-hints-ancient.json`]);
  });
});

describe("cleanup: refusals", () => {
  it("refuses an action outside the closed set", async () => {
    for (const action of ["orphan_artifacts", "", null, undefined, 7]) {
      const result = await applyCleanup({ action }, project());
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(400);
    }
  });

  it("refuses a scope that is not a string, rather than coercing it", async () => {
    // A body is whatever the socket sent. `{scope: {projectRoot: "/"}}` must not
    // become a path by way of String() — the endpoint's central rule is that a
    // request never names a directory.
    const result = await applyCleanup(
      { action: "hint-cache", scope: { projectRoot: "/" } },
      project(),
    );
    expect(result.ok === false && result.status).toBe(400);
  });

  it("refuses machine scope instead of falling back to the launch directory", async () => {
    const root = project();
    put(root, ".fabric/.cache/session-hints-alpha.json", "{}");
    const result = await applyCleanup({ action: "hint-cache", scope: "machine" }, root);
    expect(result.ok === false && result.status).toBe(409);
    // The fallback that would have made this "work" is exactly the bug: it would
    // clear a project the page was not showing.
    expect(has(root, ".fabric/.cache/session-hints-alpha.json")).toBe(true);
  });

  it("refuses an unknown scope id", async () => {
    const result = await applyCleanup(
      { action: "hint-cache", scope: "p-does-not-exist" },
      project(),
    );
    expect(result.ok === false && result.status).toBe(404);
  });
});

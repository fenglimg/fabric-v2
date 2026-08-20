/**
 * `POST /api/projects/deregister` — the console's only capability that removes
 * the machine's memory of a project.
 *
 * A project lives in up to three places and is usually in only some of them, so
 * the assertions below are mostly about the arms that must NOT fire: a project
 * with no registry entry must not have one invented, and a project the user did
 * not name must come out of the operation byte-identical. That last one is the
 * acceptance criterion the feature actually rests on, and it is asserted by
 * comparing every neighbouring record before and after rather than by counting.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyProjectDeregister } from "../src/console/project-deregister.js";
import { collectKnownProjects } from "../src/console/project-list.js";

const KEEP = "11111111-1111-4111-8111-111111111111";
const DROP = "22222222-2222-4222-8222-222222222222";
const ID_ONLY = "33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
let home: string;
let globalRoot: string;
let launchDir: string;
let dropPath: string;
let keepPath: string;
/** A registered directory with no `project_id` at all — see KT-PIT-0102. */
let namelessPath: string;
let savedHome: string | undefined;

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function readGlobal(): { projects?: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(globalRoot, "fabric-global.json"), "utf8")) as {
    projects?: Record<string, unknown>;
  };
}

function bindingPath(name: string): string {
  return join(globalRoot, "state", "bindings", `${name}_resolved.json`);
}

beforeEach(() => {
  home = makeDir("fab-dereg-home-");
  globalRoot = join(home, ".fabric");
  savedHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = home;

  // The launch directory is deliberately NOT one of the projects under test:
  // "the current project is refused" needs its own case, and every other case
  // must not accidentally be exercising it.
  launchDir = makeDir("fab-dereg-launch-");
  keepPath = makeDir("fab-dereg-keep-");
  dropPath = makeDir("fab-dereg-drop-");
  namelessPath = makeDir("fab-dereg-nameless-");

  mkdirSync(join(globalRoot, "state", "bindings"), { recursive: true });
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify({
      uid: "u-test",
      stores: [],
      projects: {
        [KEEP]: { nudge_mode: "verbose" },
        [DROP]: { nudge_mode: "silent" },
        [ID_ONLY]: { archive_hint_hours: 99 },
      },
    }),
    "utf8",
  );
  writeFileSync(
    join(globalRoot, "state", "projects.json"),
    JSON.stringify({
      projects: {
        [keepPath]: { project_id: KEEP, registered_at: "2020-01-01T00:00:00.000Z" },
        [dropPath]: { project_id: DROP, registered_at: "2020-01-01T00:00:00.000Z" },
        [namelessPath]: { registered_at: "2020-01-01T00:00:00.000Z" },
      },
    }),
    "utf8",
  );
  // Snapshot filenames are workspace-binding ids, only incidentally equal to
  // the project id — so one here deliberately is NOT named after its project.
  writeFileSync(bindingPath("wb-keep"), JSON.stringify({ project_id: KEEP }), "utf8");
  writeFileSync(bindingPath("wb-drop"), JSON.stringify({ project_id: DROP }), "utf8");
  writeFileSync(bindingPath("wb-idonly"), JSON.stringify({ project_id: ID_ONLY }), "utf8");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Everything belonging to the project that must survive, as one comparable value. */
function keepState(): string {
  return JSON.stringify({
    registry: JSON.parse(readFileSync(join(globalRoot, "state", "projects.json"), "utf8")).projects[
      keepPath
    ],
    config: readGlobal().projects?.[KEEP],
    binding: readFileSync(bindingPath("wb-keep"), "utf8"),
  });
}

async function keyOf(match: (path: string | null, id: string | null) => boolean): Promise<string> {
  const rows = await collectKnownProjects(launchDir);
  const row = rows.find((r) => match(r.path, r.projectId));
  if (row === undefined) throw new Error("fixture does not contain the expected row");
  return row.key;
}

describe("what it removes", () => {
  it("clears all three places for a project that is in all three", async () => {
    const before = keepState();
    const result = await applyProjectDeregister(
      { key: DROP, confirm: true },
      launchDir,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.confirmed) throw new Error("expected a confirmed result");
    expect(result.removed.map((i) => i.where).sort()).toEqual(["bindings", "config", "registry"]);

    const registry = JSON.parse(
      readFileSync(join(globalRoot, "state", "projects.json"), "utf8"),
    ) as { projects: Record<string, unknown> };
    expect(dropPath in registry.projects).toBe(false);
    expect(readGlobal().projects?.[DROP]).toBeUndefined();
    expect(() => readFileSync(bindingPath("wb-drop"), "utf8")).toThrow();

    // AC3, stated as identity rather than as a count: the neighbouring project
    // comes out byte-identical in all three places.
    expect(keepState()).toBe(before);
  });

  it("skips the registry for a project that only exists as an id", async () => {
    // Two of the three sources cannot supply a path, so most projects on a real
    // machine are this. Inventing a registry row to delete would mean guessing a
    // directory, and nothing maps an id back to one.
    const result = await applyProjectDeregister({ key: ID_ONLY, confirm: true }, launchDir);
    if (!result.ok || !result.confirmed) throw new Error("expected a confirmed result");

    expect(result.plan.items.map((i) => i.where).sort()).toEqual(["bindings", "config"]);
    const registry = JSON.parse(
      readFileSync(join(globalRoot, "state", "projects.json"), "utf8"),
    ) as { projects: Record<string, unknown> };
    // All three registered directories are still there.
    expect(Object.keys(registry.projects).sort()).toEqual(
      [keepPath, dropPath, namelessPath].sort(),
    );
  });

  it("removes a registered project that never got a project_id", async () => {
    // `project_id` is only written when a store is bound (KT-PIT-0102), so this
    // row has nothing but its directory. Keying the request on project_id would
    // make exactly this project permanently unremovable — and one exists on the
    // machine this was written for.
    const key = await keyOf((path, id) => path === namelessPath && id === null);
    expect(key).not.toBe(namelessPath); // a key, not a bare path

    const result = await applyProjectDeregister({ key, confirm: true }, launchDir);
    if (!result.ok || !result.confirmed) throw new Error("expected a confirmed result");
    expect(result.removed.map((i) => i.where)).toEqual(["registry"]);

    const registry = JSON.parse(
      readFileSync(join(globalRoot, "state", "projects.json"), "utf8"),
    ) as { projects: Record<string, unknown> };
    expect(namelessPath in registry.projects).toBe(false);
    // With no id there is nothing to look up in the other two sources, and
    // nothing there was touched.
    expect(Object.keys(readGlobal().projects ?? {}).sort()).toEqual([KEEP, DROP, ID_ONLY].sort());
  });

  it("reports what is left by re-reading, not by subtracting one", async () => {
    const before = (await collectKnownProjects(launchDir)).length;
    const result = await applyProjectDeregister({ key: DROP, confirm: true }, launchDir);
    if (!result.ok || !result.confirmed) throw new Error("expected a confirmed result");
    expect(result.remainingCount).toBe(before - 1);
    expect(result.remainingCount).toBe((await collectKnownProjects(launchDir)).length);
  });
});

describe("what it refuses", () => {
  it("returns the plan and writes nothing when confirm is absent", async () => {
    const registryBefore = readFileSync(join(globalRoot, "state", "projects.json"), "utf8");
    const globalBefore = readFileSync(join(globalRoot, "fabric-global.json"), "utf8");

    const result = await applyProjectDeregister({ key: DROP }, launchDir);
    if (!result.ok || result.confirmed) throw new Error("expected an unconfirmed result");

    // AC2: the preview names the concrete locations, not a count.
    expect(result.plan.items.map((i) => i.detail)).toContain(dropPath);
    expect(result.plan.items.map((i) => i.detail)).toContain(`projects.${DROP}`);
    expect(result.plan.items.map((i) => i.detail)).toContain(bindingPath("wb-drop"));

    // ...and the disk is untouched, which is what makes "cancel" free.
    expect(readFileSync(join(globalRoot, "state", "projects.json"), "utf8")).toBe(registryBefore);
    expect(readFileSync(join(globalRoot, "fabric-global.json"), "utf8")).toBe(globalBefore);
    expect(readFileSync(bindingPath("wb-drop"), "utf8")).toBeTruthy();
  });

  it("refuses a missing or non-string key (400)", async () => {
    for (const key of [undefined, "", 42, null]) {
      const result = await applyProjectDeregister({ key } as { key?: unknown }, launchDir);
      expect(result.ok === false && result.status).toBe(400);
    }
  });

  it("refuses a key no row has (404), including a real directory", async () => {
    // The endpoint accepts a ROW KEY, so a directory that exists on disk but was
    // never rendered is not a valid target — the set it can act on is the set
    // the page displayed.
    for (const key of [
      "44444444-4444-4444-8444-444444444444",
      `path:${launchDir}`,
      "path:/etc",
    ]) {
      const result = await applyProjectDeregister({ key, confirm: true }, launchDir);
      expect(result.ok === false && result.status).toBe(404);
    }
  });

  it("refuses the project the console is running in (409)", async () => {
    // Give the launch directory an identity, so it appears in the list as the
    // current row rather than not appearing at all.
    mkdirSync(join(launchDir, ".fabric"), { recursive: true });
    writeFileSync(
      join(launchDir, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: KEEP }),
      "utf8",
    );

    const result = await applyProjectDeregister({ key: KEEP, confirm: true }, launchDir);
    expect(result.ok === false && result.status).toBe(409);
    // And nothing was removed on the way to refusing.
    expect(readGlobal().projects?.[KEEP]).toBeDefined();
  });
});

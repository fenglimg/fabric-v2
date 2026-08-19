/**
 * Merging the machine's two half-complete project sources.
 *
 * The interesting cases are all about ABSENCE — a registry entry with no id, a
 * config segment with no path, a current project neither source knows about.
 * Each of those is a real state on a real machine today, and each of them is a
 * different answer to "can the user configure this project".
 */

import { describe, expect, it } from "vitest";

import { mergeProjectList } from "../src/console/project-list.ts";
import type { RegisteredProjectView } from "../src/store/project-registry-io.ts";

function reg(
  path: string,
  projectId?: string,
  stale = false,
): RegisteredProjectView {
  return {
    path,
    projectId,
    stale,
    fabricVersion: "2.1.0",
    registeredAt: "2026-08-18T00:00:00.000Z",
  };
}

describe("mergeProjectList", () => {
  it("matches a registry entry to its config segment on project_id", () => {
    const [only] = mergeProjectList({
      registry: [reg("/repos/alpha", "p-alpha")],
      configuredIds: ["p-alpha"],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });

    // One row, not two — the whole point of merging on id.
    expect(only).toMatchObject({
      projectId: "p-alpha",
      path: "/repos/alpha",
      name: "alpha",
      origin: "both",
      editable: true,
    });
  });

  it("registry entry with no project_id is listed but NOT editable", () => {
    // An install that never bound a store. Per-project settings live under
    // `projects[<id>]`, so with no id there is nowhere to write — listing it as
    // editable would offer a control whose save can only fail.
    const [only] = mergeProjectList({
      registry: [reg("/repos/unbound")],
      configuredIds: [],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });

    expect(only).toMatchObject({
      projectId: null,
      path: "/repos/unbound",
      origin: "registry-only",
      editable: false,
    });
  });

  it("config segment with no registry entry is editable but has no path", () => {
    // Every project on the real machine is this today: the registry postdates
    // their installs, and nothing maps an id back to a directory.
    const [only] = mergeProjectList({
      registry: [],
      configuredIds: ["p-ghost"],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });

    expect(only).toMatchObject({
      projectId: "p-ghost",
      path: null,
      name: "p-ghost",
      origin: "config-only",
      editable: true,
    });
    // Not `stale: true`. Staleness is a claim about a path we do not have, and
    // reporting it here would tell the user their project is gone when all we
    // know is that we never learned where it is.
    expect(only?.stale).toBe(false);
  });

  it("carries the registry's stale flag through", () => {
    const [only] = mergeProjectList({
      registry: [reg("/repos/moved", "p-moved", true)],
      configuredIds: [],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(only?.stale).toBe(true);
  });

  it("surfaces the current project even when neither source knows it", () => {
    // Installed before the registry existed AND never configured. Without this
    // branch the one project the user is standing in would be missing from its
    // own machine's list.
    const rows = mergeProjectList({
      registry: [reg("/repos/other", "p-other")],
      configuredIds: ["p-other"],
      boundIds: [],
      currentProjectId: "p-here",
      currentProjectPath: null,
    });

    // Sorted by display name ("other" < "p-here"), not current-first — the
    // synthesized row is present, and where it lands is not the point.
    expect(rows.map((r) => r.projectId).sort()).toEqual(["p-here", "p-other"]);
    expect(rows.find((r) => r.projectId === "p-here")).toMatchObject({
      isCurrent: true,
      editable: true,
      // No path was supplied, so the row honestly has none and falls back to the
      // id for a label.
      path: null,
      name: "p-here",
      origin: "config-only",
    });
  });

  it("labels the synthesized row by directory when the launch path is known", () => {
    // The path is known first-hand — the console is running in it. Falling back
    // to the bare uuid there would put an unreadable label on the ONE project
    // the user is standing in, which on a machine installed before the registry
    // is the only project row that exists at all.
    const rows = mergeProjectList({
      registry: [],
      configuredIds: [],
      boundIds: [],
      currentProjectId: "p-here",
      currentProjectPath: "/repos/my-app",
    });
    expect(rows).toEqual([
      {
        projectId: "p-here",
        path: "/repos/my-app",
        name: "my-app",
        // Its own origin, not `config-only`: origin drives what the page may
        // claim, and claiming the directory is unknown while displaying it is a
        // lie. Not `both` either — it is in neither source, and the page still
        // owes the user the "re-run fabric install here" remedy.
        origin: "current-only",
        stale: false,
        isCurrent: true,
        editable: true,
      },
    ]);
  });

  it("fills in the launch directory's path even when its id is already configured", () => {
    // The real machine's state, and the defect the browser caught: every project
    // has a config segment and none is registered. The config segment claims the
    // id first, so the row that would have carried the observed path was never
    // reached — leaving the ONE project whose directory we know first-hand
    // rendered as a bare uuid and unopenable as a scope.
    //
    // The fixture must have the SEGMENT and no registry entry; a fixture where
    // the id is only current passes on the old code too.
    const rows = mergeProjectList({
      registry: [],
      configuredIds: ["p-here"],
      boundIds: [],
      currentProjectId: "p-here",
      currentProjectPath: "/repos/my-app",
    });
    expect(rows).toEqual([
      {
        projectId: "p-here",
        path: "/repos/my-app",
        name: "my-app",
        origin: "current-only",
        stale: false,
        isCurrent: true,
        editable: true,
      },
    ]);
  });

  it("does NOT hand the launch path to any other project's row", () => {
    // The path is observed, not looked up — it describes exactly one row. Nothing
    // maps an id back to a directory (KT-PIT-0050), so a second configured id
    // must stay pathless rather than inherit the directory we happen to be in.
    const rows = mergeProjectList({
      registry: [],
      configuredIds: ["p-here", "p-elsewhere"],
      boundIds: [],
      currentProjectId: "p-here",
      currentProjectPath: "/repos/my-app",
    });
    expect(rows.find((r) => r.projectId === "p-elsewhere")).toMatchObject({
      path: null,
      name: "p-elsewhere",
      origin: "config-only",
    });
  });

  it("marks exactly one row current, and none when launched from nowhere", () => {
    const withCurrent = mergeProjectList({
      registry: [reg("/repos/a", "p-a"), reg("/repos/b", "p-b")],
      configuredIds: ["p-a", "p-b"],
      boundIds: [],
      currentProjectId: "p-b",
      currentProjectPath: null,
    });
    expect(withCurrent.filter((r) => r.isCurrent).map((r) => r.projectId)).toEqual(["p-b"]);

    const noCurrent = mergeProjectList({
      registry: [reg("/repos/a", "p-a"), reg("/repos/b", "p-b")],
      configuredIds: ["p-a", "p-b"],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(noCurrent.some((r) => r.isCurrent)).toBe(false);
    expect(noCurrent.map((r) => r.projectId)).toEqual(["p-a", "p-b"]);
  });

  it("sorts by name only — the current project does NOT float to the top", () => {
    // Current-first would make the list order depend on the launch directory,
    // which is the property this page exists to remove: two consoles open on
    // one machine would disagree about the order of the same list. The current
    // row is marked instead, which serves findability without reordering.
    const rows = mergeProjectList({
      registry: [reg("/repos/zeta", "p-z"), reg("/repos/alpha", "p-a"), reg("/repos/mid", "p-m")],
      configuredIds: [],
      boundIds: [],
      currentProjectId: "p-z",
      currentProjectPath: null,
    });
    expect(rows.map((r) => r.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(rows.find((r) => r.name === "zeta")?.isCurrent).toBe(true);

    // Same machine, launched from elsewhere: identical order.
    const elsewhere = mergeProjectList({
      registry: [reg("/repos/zeta", "p-z"), reg("/repos/alpha", "p-a"), reg("/repos/mid", "p-m")],
      configuredIds: [],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(elsewhere.map((r) => r.name)).toEqual(rows.map((r) => r.name));
  });

  it("empty machine yields an empty list, not a fabricated row", () => {
    // The real state of the machine today. The page renders an empty state from
    // this; inventing a placeholder row here would make that impossible to
    // distinguish from a machine with one real project.
    expect(
      mergeProjectList({
        registry: [],
        configuredIds: [],
        boundIds: [],
        currentProjectId: null,
        currentProjectPath: null,
      }),
    ).toEqual([]);
  });

  it("keeps two unbound registry entries as separate rows", () => {
    // They share `projectId: null`, which is an absence and not an identity —
    // collapsing them on that would merge two unrelated repos into one row.
    const rows = mergeProjectList({
      registry: [reg("/repos/one"), reg("/repos/two")],
      configuredIds: [],
      boundIds: [],
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(rows.map((r) => r.path)).toEqual(["/repos/one", "/repos/two"]);
  });
});

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
      currentProjectId: null,
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
      currentProjectId: null,
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
      currentProjectId: null,
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
      currentProjectId: null,
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
      currentProjectId: "p-here",
    });

    // Sorted by display name ("other" < "p-here"), not current-first — the
    // synthesized row is present, and where it lands is not the point.
    expect(rows.map((r) => r.projectId).sort()).toEqual(["p-here", "p-other"]);
    expect(rows.find((r) => r.projectId === "p-here")).toMatchObject({
      isCurrent: true,
      editable: true,
      origin: "config-only",
    });
  });

  it("marks exactly one row current, and none when launched from nowhere", () => {
    const withCurrent = mergeProjectList({
      registry: [reg("/repos/a", "p-a"), reg("/repos/b", "p-b")],
      configuredIds: ["p-a", "p-b"],
      currentProjectId: "p-b",
    });
    expect(withCurrent.filter((r) => r.isCurrent).map((r) => r.projectId)).toEqual(["p-b"]);

    const noCurrent = mergeProjectList({
      registry: [reg("/repos/a", "p-a"), reg("/repos/b", "p-b")],
      configuredIds: ["p-a", "p-b"],
      currentProjectId: null,
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
      currentProjectId: "p-z",
    });
    expect(rows.map((r) => r.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(rows.find((r) => r.name === "zeta")?.isCurrent).toBe(true);

    // Same machine, launched from elsewhere: identical order.
    const elsewhere = mergeProjectList({
      registry: [reg("/repos/zeta", "p-z"), reg("/repos/alpha", "p-a"), reg("/repos/mid", "p-m")],
      configuredIds: [],
      currentProjectId: null,
    });
    expect(elsewhere.map((r) => r.name)).toEqual(rows.map((r) => r.name));
  });

  it("empty machine yields an empty list, not a fabricated row", () => {
    // The real state of the machine today. The page renders an empty state from
    // this; inventing a placeholder row here would make that impossible to
    // distinguish from a machine with one real project.
    expect(
      mergeProjectList({ registry: [], configuredIds: [], currentProjectId: null }),
    ).toEqual([]);
  });

  it("keeps two unbound registry entries as separate rows", () => {
    // They share `projectId: null`, which is an absence and not an identity —
    // collapsing them on that would merge two unrelated repos into one row.
    const rows = mergeProjectList({
      registry: [reg("/repos/one"), reg("/repos/two")],
      configuredIds: [],
      currentProjectId: null,
    });
    expect(rows.map((r) => r.path)).toEqual(["/repos/one", "/repos/two"]);
  });
});

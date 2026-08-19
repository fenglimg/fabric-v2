/**
 * `?scope=` — which project a request is about.
 *
 * The property under test is an INVARIANCE: the answer comes from the parameter,
 * not from the directory the console was launched in. Asserting that requires a
 * fixture where a launch-directory-driven implementation would give a DIFFERENT
 * answer — otherwise the two paths coincide and the case passes without ever
 * exercising the invariant. Here the discriminator is `projectRoot` in the
 * payload, and the two launch directories are two different real projects.
 *
 * The failure modes on the other side are refusals: a scope that cannot be
 * opened must say so, and must not quietly serve the launch directory's data
 * under the requested project's name.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";
import { resolveGlobalRoot } from "../src/store/global-config-io.js";

const dirs: string[] = [];
const handles: PreviewServerHandle[] = [];
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-scope-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory that is a Fabric project with the given id. */
function project(projectId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-scope-proj-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId }, null, 2),
    "utf8",
  );
  return dir;
}

/** Write the machine project registry (`~/.fabric/state/projects.json`). */
function registerAll(entries: ReadonlyArray<{ path: string; projectId?: string }>): void {
  const projects: Record<string, unknown> = {};
  for (const e of entries) {
    projects[e.path] = {
      ...(e.projectId === undefined ? {} : { project_id: e.projectId }),
      fabric_version: "2.6.0",
      registered_at: "2026-08-19T00:00:00.000Z",
    };
  }
  mkdirSync(join(resolveGlobalRoot(), "state"), { recursive: true });
  writeFileSync(
    join(resolveGlobalRoot(), "state", "projects.json"),
    JSON.stringify({ schema_version: 1, projects }, null, 2),
    "utf8",
  );
}

async function serve(target: string): Promise<string> {
  const handle = await startPreviewServer({ port: 0, target });
  handles.push(handle);
  return handle.url.replace(/\/$/u, "");
}

describe("the scope comes from the parameter, not the launch directory (AC1)", () => {
  it("returns the same status payload from two different launch directories", async () => {
    const a = project("proj-a");
    const b = project("proj-b");
    registerAll([
      { path: a, projectId: "proj-a" },
      { path: b, projectId: "proj-b" },
    ]);

    // Both consoles are asked about proj-B. One of them is launched in A — so an
    // implementation that reads the launch directory answers with A's root and
    // this comparison fails. That is the whole point of using two DIFFERENT
    // projects rather than launching twice in the same one.
    const fromA = await (await fetch(`${await serve(a)}/api/status?scope=proj-b`)).json();
    const fromB = await (await fetch(`${await serve(b)}/api/status?scope=proj-b`)).json();

    expect(fromA).toEqual(fromB);
    expect((fromA as { projectRoot: string }).projectRoot).toBe(b);
    expect((fromA as { projectId: string }).projectId).toBe("proj-b");
  });

  it("still answers for the launch directory when no scope is named", async () => {
    // Backward compatibility: every request meant this before scopes existed,
    // and a repo that was never registered has no other way to be looked at.
    const a = project("proj-a");
    const payload = (await (await fetch(`${await serve(a)}/api/status`)).json()) as {
      projectRoot: string;
      scope: string;
    };
    expect(payload.projectRoot).toBe(a);
    expect(payload.scope).toBe("project");
  });

  it("opens the launch directory's own project even when it is unregistered", async () => {
    // No projects.json at all — the state of every machine installed before the
    // registry existed. The one project the user is provably standing in must
    // still be selectable, or the switcher is empty on exactly those machines.
    const a = project("proj-a");
    const payload = (await (await fetch(`${await serve(a)}/api/status?scope=proj-a`)).json()) as {
      projectRoot: string;
    };
    expect(payload.projectRoot).toBe(a);
  });
});

describe("a scope that cannot be opened is refused, never substituted (AC3)", () => {
  it("refuses a project whose registered directory is gone (409)", async () => {
    const a = project("proj-a");
    const gone = project("proj-gone");
    registerAll([
      { path: a, projectId: "proj-a" },
      { path: gone, projectId: "proj-gone" },
    ]);
    rmSync(gone, { recursive: true, force: true });

    const res = await fetch(`${await serve(a)}/api/status?scope=proj-gone`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("stale");
    // The negative that matters: no fallback payload rode along. A response
    // carrying `projectRoot` would mean the console showed project A's data on a
    // page labelled proj-gone.
    expect(body).not.toHaveProperty("projectRoot");
    expect(body.error).toContain(gone);
  });

  it("refuses a project known only by config segment (409)", async () => {
    // KT-PIT-0050: nothing maps a project_id back to a directory, so this is
    // permanent until `fabric install` re-registers it — not a transient miss.
    const a = project("proj-a");
    mkdirSync(resolveGlobalRoot(), { recursive: true });
    writeFileSync(
      join(resolveGlobalRoot(), "fabric-global.json"),
      JSON.stringify({ uid: "u-test", stores: [], projects: { "proj-ghost": { nudge_mode: "silent" } } }),
      "utf8",
    );

    const res = await fetch(`${await serve(a)}/api/status?scope=proj-ghost`);
    expect(res.status).toBe(409);
    expect((await res.json()) as { reason: string }).toMatchObject({ reason: "no-path" });
  });

  it("refuses an id this machine never heard of (404)", async () => {
    const a = project("proj-a");
    const res = await fetch(`${await serve(a)}/api/status?scope=proj-invented`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { reason: string }).toMatchObject({ reason: "unknown" });
  });

  it("serves the page itself even for an unopenable scope", async () => {
    // The document must load: it is what renders the reason and the next step.
    // Refusing it would leave a blank tab with the answer only in devtools.
    const a = project("proj-a");
    const res = await fetch(`${await serve(a)}/status?scope=proj-invented`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("machine scope", () => {
  it("lists every known project rather than one project's state", async () => {
    const a = project("proj-a");
    const b = project("proj-b");
    registerAll([
      { path: a, projectId: "proj-a" },
      { path: b, projectId: "proj-b" },
    ]);

    const payload = (await (await fetch(`${await serve(a)}/api/status?scope=machine`)).json()) as {
      scope: string;
      projects: { projectId: string | null; path: string | null; isCurrent: boolean }[];
      outdatedCount: number;
    };
    expect(payload.scope).toBe("machine");
    expect(payload.projects.map((p) => p.projectId).sort()).toEqual(["proj-a", "proj-b"]);
    // The launch directory is marked, not privileged: it is one row of two.
    expect(payload.projects.filter((p) => p.isCurrent).map((p) => p.path)).toEqual([a]);
  });

  it("is identical from either launch directory", async () => {
    const a = project("proj-a");
    const b = project("proj-b");
    registerAll([
      { path: a, projectId: "proj-a" },
      { path: b, projectId: "proj-b" },
    ]);
    const fromA = (await (await fetch(`${await serve(a)}/api/status?scope=machine`)).json()) as {
      projects: { isCurrent: boolean }[];
    };
    const fromB = (await (await fetch(`${await serve(b)}/api/status?scope=machine`)).json()) as {
      projects: { isCurrent: boolean }[];
    };
    // `isCurrent` is honestly launch-dependent — it says where THIS console is
    // running. Everything else must match, so compare with that field dropped.
    const strip = (d: { projects: { isCurrent: boolean }[] }) => ({
      ...d,
      projects: d.projects.map(({ isCurrent: _drop, ...rest }) => rest),
    });
    expect(strip(fromA)).toEqual(strip(fromB));
    // Control: the field we dropped really does differ, so the comparison above
    // is not passing because both sides were identical to begin with.
    expect(fromA.projects.map((p) => p.isCurrent)).not.toEqual(
      fromB.projects.map((p) => p.isCurrent),
    );
  });
});

describe("GET /api/scopes", () => {
  it("offers machine plus the openable projects, and counts the rest", async () => {
    const a = project("proj-a");
    const gone = project("proj-gone");
    registerAll([
      { path: a, projectId: "proj-a" },
      { path: gone, projectId: "proj-gone" },
    ]);
    rmSync(gone, { recursive: true, force: true });
    mkdirSync(resolveGlobalRoot(), { recursive: true });
    writeFileSync(
      join(resolveGlobalRoot(), "fabric-global.json"),
      JSON.stringify({ uid: "u-test", stores: [], projects: { "proj-ghost": {} } }),
      "utf8",
    );

    const payload = (await (await fetch(`${await serve(a)}/api/scopes`)).json()) as {
      defaultScope: string;
      blockedCount: number;
      options: { id: string; openable: boolean; blockedReason: string | null }[];
    };

    expect(payload.defaultScope).toBe("proj-a");
    const openable = payload.options.filter((o) => o.openable).map((o) => o.id);
    expect(openable.sort()).toEqual(["machine", "proj-a"]);
    // The two that cannot be opened are still REPORTED — a switcher that simply
    // omitted them would read as "you only have one project".
    expect(payload.blockedCount).toBe(2);
    expect(
      payload.options.filter((o) => !o.openable).map((o) => o.blockedReason).sort(),
    ).toEqual(["no-path", "stale"]);
  });
});

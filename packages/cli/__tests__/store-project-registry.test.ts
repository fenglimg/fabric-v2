import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { saveGlobalConfig } from "../src/store/global-config-io.js";
import {
  storeBind,
  storeCreate,
  storeProjectCreate,
  storeProjectList,
} from "../src/store/store-ops.js";

// W1/A2 — store-internal project registry. `store project {list,create}` plus
// `store bind --project <id>` validation, against an isolated global root.

const STORE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-06-04T00:00:00.000Z";

const dirs: string[] = [];
let globalRoot: string;
let projectRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-a2-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }), globalRoot);
  projectRoot = mkdtempSync(join(tmpdir(), "fabric-a2-proj-"));
  dirs.push(projectRoot);
  saveProjectConfig({ project_id: "p-test" }, projectRoot);
  // A mounted on-disk store to register projects in.
  storeCreate("team", NOW, { uuid: STORE, git: false, globalRoot });
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("store project create/list", () => {
  it("a fresh store has no registered projects", () => {
    expect(storeProjectList("team", globalRoot)).toHaveLength(0);
  });

  it("creates a project and lists it (persisted to projects.json)", () => {
    const created = storeProjectCreate("team", "fabric-v2", NOW, { name: "Fabric v2", globalRoot });
    expect(created.id).toBe("fabric-v2");
    const listed = storeProjectList("team", globalRoot);
    expect(listed.map((p) => p.id)).toEqual(["fabric-v2"]);
    // committed parallel to store.json
    const file = JSON.parse(
      readFileSync(join(globalRoot, "stores", STORE, "projects.json"), "utf8"),
    );
    expect(file.projects[0].id).toBe("fabric-v2");
  });

  it("refuses a duplicate project id", () => {
    storeProjectCreate("team", "fabric-v2", NOW, { globalRoot });
    expect(() => storeProjectCreate("team", "fabric-v2", NOW, { globalRoot })).toThrow(
      /already exists/,
    );
  });

  it("rejects an invalid project id (not a single scope segment)", () => {
    expect(() => storeProjectCreate("team", "Bad:Id", NOW, { globalRoot })).toThrow();
  });

  it("throws when the store is not mounted", () => {
    expect(() => storeProjectList("nope", globalRoot)).toThrow(/no mounted store/);
  });
});

describe("store bind --project <id> validation", () => {
  it("binds to an existing project and records active_project", () => {
    storeProjectCreate("team", "fabric-v2", NOW, { globalRoot });
    const next = storeBind(projectRoot, { id: "team" }, { project: "fabric-v2", globalRoot });
    expect(next.active_project).toBe("fabric-v2");
    // persisted
    expect(loadProjectConfig(projectRoot)?.active_project).toBe("fabric-v2");
    // the required store binding is still recorded
    expect(next.required_stores?.map((r) => r.id)).toContain("team");
  });

  it("rejects binding to a non-existent project", () => {
    expect(() =>
      storeBind(projectRoot, { id: "team" }, { project: "ghost", globalRoot }),
    ).toThrow(/not registered in store/);
    // config untouched — no active_project leaked
    expect(loadProjectConfig(projectRoot)?.active_project).toBeUndefined();
  });

  it("rejects binding a project to an unmounted store", () => {
    expect(() =>
      storeBind(projectRoot, { id: "ghost-store" }, { project: "fabric-v2", globalRoot }),
    ).toThrow(/is not mounted/);
  });

  it("plain bind (no --project) leaves active_project unset", () => {
    const next = storeBind(projectRoot, { id: "team" }, { globalRoot });
    expect(next.active_project).toBeUndefined();
  });
});

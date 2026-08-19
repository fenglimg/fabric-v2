/**
 * `POST /api/config/set` — writing at an explicitly named target.
 *
 * Two properties carry this file:
 *
 *  1. ISOLATION — a value written for one project reaches that project and
 *     nothing else. Asserted with one positive and two negatives, because "it
 *     landed in A" is equally true of an implementation that writes it
 *     everywhere.
 *  2. REFUSAL WITHOUT SIDE EFFECTS — a rejected target must leave the disk
 *     untouched. A 4xx alone does not prove that: a handler can write first and
 *     fail after. Every refusal case here hashes the global config before and
 *     after.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storeRelativePathForMount } from "@fenglimg/fabric-shared";

import { applyGlobalConfigEdit } from "../src/console/global-config-write.ts";
import { resolveGlobalRoot } from "../src/store/global-config-io.ts";

const STORE_X = "11111111-1111-4111-8111-111111111111";
const STORE_Y = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-gcfgw-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function globalPath(): string {
  return join(resolveGlobalRoot(), "fabric-global.json");
}

/**
 * A launch directory that is not a Fabric project — no `project_id`, so it
 * contributes no current project. Cases that are not about the current-project
 * row use this so the launch directory cannot be what makes them pass.
 */
function elsewhereDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-gcfgw-cwd-"));
  dirs.push(dir);
  return dir;
}

/** A launch directory whose repo config claims `projectId`. */
function projectDir(projectId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-gcfgw-proj-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId }, null, 2),
    "utf8",
  );
  return dir;
}

function writeGlobal(config: Record<string, unknown>): void {
  mkdirSync(resolveGlobalRoot(), { recursive: true });
  writeFileSync(
    globalPath(),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

function readGlobal(): Record<string, unknown> {
  return JSON.parse(readFileSync(globalPath(), "utf8")) as Record<string, unknown>;
}

/** Fingerprint of everything a write could plausibly touch. */
function diskFingerprint(): string {
  const h = createHash("sha256");
  h.update(readFileSync(globalPath(), "utf8"));
  for (const uuid of [STORE_X, STORE_Y]) {
    const path = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: uuid }), "store-config.json");
    try {
      h.update(readFileSync(path, "utf8"));
    } catch {
      h.update(`absent:${uuid}`);
    }
  }
  return h.digest("hex");
}

describe("writing to a project (AC3)", () => {
  beforeEach(() => {
    writeGlobal({
      defaults: { nudge_mode: "normal" },
      projects: { "proj-a": {}, "proj-b": { nudge_mode: "verbose" } },
    });
  });

  it("lands in that project only, leaving siblings and defaults alone", async () => {
    const result = await applyGlobalConfigEdit({
      key: "nudge_mode",
      value: "silent",
      target: { scope: "project", projectId: "proj-a" },
    }, elsewhereDir());
    expect(result.ok).toBe(true);

    const after = readGlobal();
    const projects = after.projects as Record<string, Record<string, unknown>>;
    expect(projects["proj-a"]?.nudge_mode).toBe("silent");
    // The two negatives. Without them an implementation that writes the value
    // into every segment, or into defaults, passes the positive above.
    expect(projects["proj-b"]?.nudge_mode).toBe("verbose");
    expect((after.defaults as Record<string, unknown>).nudge_mode).toBe("normal");
  });

  it("writing machine-wide leaves every project segment untouched", async () => {
    const result = await applyGlobalConfigEdit({
      key: "nudge_mode",
      value: "silent",
      target: { scope: "machine" },
    }, elsewhereDir());
    expect(result.ok).toBe(true);

    const after = readGlobal();
    expect((after.defaults as Record<string, unknown>).nudge_mode).toBe("silent");
    // proj-b keeps its exception — that is the entire point of having one.
    expect((after.projects as Record<string, Record<string, unknown>>)["proj-b"]?.nudge_mode).toBe(
      "verbose",
    );
  });

  it("persists validate's return value, not the request's string", async () => {
    await applyGlobalConfigEdit({
      key: "archive_hint_hours",
      value: "48",
      target: { scope: "project", projectId: "proj-a" },
    }, elsewhereDir());
    const stored = (readGlobal().projects as Record<string, Record<string, unknown>>)["proj-a"]
      ?.archive_hint_hours;
    // A number, not "48": readers of this key expect a number, so writing the
    // string back would produce a value the page shows and nothing honours.
    expect(stored).toBe(48);
    expect(typeof stored).toBe("number");
  });
});

describe("writing to a store (AC6 write half)", () => {
  beforeEach(() => {
    writeGlobal({
      stores: [
        { store_uuid: STORE_X, alias: "x" },
        { store_uuid: STORE_Y, alias: "y" },
      ],
    });
    // A mounted store exists on disk. Skipping this would make the case test
    // the not-synced refusal path instead of the write it claims to cover.
    for (const uuid of [STORE_X, STORE_Y]) {
      mkdirSync(join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: uuid })), {
        recursive: true,
      });
    }
  });

  it("refuses a store that is mounted but not on disk (409)", async () => {
    // Mounted-but-unsynced is a real state. Writing anyway would leave a lone
    // store-config.json in an empty tree — a directory that is not a store.
    rmSync(join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE_Y })), {
      recursive: true,
      force: true,
    });
    const result = await applyGlobalConfigEdit({
      key: "underseed_node_threshold",
      value: "25",
      target: { scope: "store", storeUuid: STORE_Y },
    }, elsewhereDir());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    // And it says what to do about it, rather than surfacing a raw ENOENT
    // naming a temp file.
    expect(result.ok === false && result.error).toMatch(/fabric sync/u);
  });

  it("reaches the named store and not its neighbour", async () => {
    const result = await applyGlobalConfigEdit({
      key: "underseed_node_threshold",
      value: "25",
      target: { scope: "store", storeUuid: STORE_X },
    }, elsewhereDir());
    expect(result).toEqual({ ok: true, target: expect.any(String) });

    const configOf = (uuid: string) => {
      const path = join(
        resolveGlobalRoot(),
        storeRelativePathForMount({ store_uuid: uuid }),
        "store-config.json",
      );
      try {
        return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    expect(configOf(STORE_X)?.underseed_node_threshold).toBe(25);
    // Y's config was never created — a store the request did not name must not
    // acquire a file as a side effect.
    expect(configOf(STORE_Y)).toBeNull();
  });
});

describe("refusals leave the disk untouched (AC4)", () => {
  beforeEach(() => {
    writeGlobal({
      defaults: { nudge_mode: "normal" },
      projects: { "proj-a": {} },
      stores: [{ store_uuid: STORE_X, alias: "x" }],
    });
    mkdirSync(join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE_X })), {
      recursive: true,
    });
  });

  const REFUSALS: ReadonlyArray<{
    name: string;
    body: Record<string, unknown>;
    status: number;
  }> = [
    {
      name: "a project id the server never listed",
      body: { key: "nudge_mode", value: "silent", target: { scope: "project", projectId: "p-forged" } },
      status: 404,
    },
    {
      name: "a store that is not mounted",
      body: {
        key: "underseed_node_threshold",
        value: "25",
        target: { scope: "store", storeUuid: "99999999-9999-4999-8999-999999999999" },
      },
      status: 404,
    },
    {
      name: "a path smuggled in as a store uuid",
      body: {
        key: "underseed_node_threshold",
        value: "25",
        target: { scope: "store", storeUuid: "../../../../tmp/evil" },
      },
      status: 404,
    },
    {
      name: "a path field the schema does not have",
      body: {
        key: "nudge_mode",
        value: "silent",
        target: { scope: "store", storeRoot: "/tmp/evil", storeUuid: STORE_X },
      },
      // Refused on home/scope mismatch before the extra field could matter —
      // and `storeRoot` is never read from a request regardless.
      status: 400,
    },
    {
      name: "an unknown scope",
      body: { key: "nudge_mode", value: "silent", target: { scope: "everywhere" } },
      status: 400,
    },
    {
      name: "no target at all",
      body: { key: "nudge_mode", value: "silent" },
      status: 400,
    },
    {
      name: "a key outside the panel set",
      body: { key: "uid", value: "hijacked", target: { scope: "machine" } },
      status: 400,
    },
    {
      name: "a corpus key aimed machine-wide",
      body: { key: "underseed_node_threshold", value: "25", target: { scope: "machine" } },
      status: 400,
    },
    {
      name: "a preference key aimed at a store",
      body: { key: "nudge_mode", value: "silent", target: { scope: "store", storeUuid: STORE_X } },
      status: 400,
    },
    {
      name: "a value the field rejects",
      body: { key: "nudge_mode", value: "screaming", target: { scope: "machine" } },
      status: 400,
    },
  ];

  for (const { name, body, status } of REFUSALS) {
    it(`refuses ${name} (${String(status)}) and writes nothing`, async () => {
      const before = diskFingerprint();
      const result = await applyGlobalConfigEdit(body, elsewhereDir());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(status);
      // The half a status code cannot prove: a handler that wrote first and
      // failed afterwards would satisfy the assertion above.
      expect(diskFingerprint()).toBe(before);
    });
  }

  it("control: the same fingerprint DOES move on an accepted write", async () => {
    // Without this the refusal cases could all be passing because the
    // fingerprint is insensitive to the writes in question.
    const before = diskFingerprint();
    const result = await applyGlobalConfigEdit({
      key: "nudge_mode",
      value: "silent",
      target: { scope: "machine" },
    }, elsewhereDir());
    expect(result.ok).toBe(true);
    expect(diskFingerprint()).not.toBe(before);
  });
});

describe("the current project, known to neither the registry nor the config", () => {
  // The read side synthesizes a row for it (project-list.ts:129) so the one
  // project the user is standing in is not invisible on their own machine. That
  // row is `editable`, so the page renders controls for it — and every machine
  // installed before the project registry existed has NO other project row at
  // all. If the write side builds its membership set from different inputs, the
  // only row on the page is also the only row that can never be saved.
  it("accepts a write and creates its config segment", async () => {
    writeGlobal({ defaults: { nudge_mode: "normal" }, projects: {} });

    const result = await applyGlobalConfigEdit(
      { key: "nudge_mode", value: "silent", target: { scope: "project", projectId: "proj-here" } },
      projectDir("proj-here"),
    );

    expect(result).toEqual({ ok: true, target: expect.any(String) });
    const after = readGlobal();
    expect((after.projects as Record<string, Record<string, unknown>>)["proj-here"]?.nudge_mode).toBe(
      "silent",
    );
    // "silent" is not the machine default, so the assertion above cannot be
    // satisfied by a write that missed the segment and left a default showing.
    expect((after.defaults as Record<string, unknown>).nudge_mode).toBe("normal");
  });

  it("is still refused when the console was launched somewhere else", async () => {
    // The negative half. Without it the case above also passes an implementation
    // that accepts ANY id — which is the membership check this endpoint exists
    // for. `proj-here` is a real project id; what makes it writable is standing
    // in it, and this launch directory is not it.
    writeGlobal({ defaults: { nudge_mode: "normal" }, projects: {} });
    const before = diskFingerprint();

    const result = await applyGlobalConfigEdit(
      { key: "nudge_mode", value: "silent", target: { scope: "project", projectId: "proj-here" } },
      elsewhereDir(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
    expect(diskFingerprint()).toBe(before);
  });
});

describe("a registry project with no id", () => {
  it("is refused with 409 rather than silently writing under an empty key", async () => {
    // `registry-only` rows are listed but not editable: per-project values live
    // under `projects[<id>]`, and there is no id. The page hides the control,
    // but the endpoint must refuse independently — a UI is not an access check.
    writeGlobal({ projects: {} });
    const result = await applyGlobalConfigEdit({
      key: "nudge_mode",
      value: "silent",
      target: { scope: "project", projectId: "" },
    }, elsewhereDir());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
  });
});

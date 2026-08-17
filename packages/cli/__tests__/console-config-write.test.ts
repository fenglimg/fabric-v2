/**
 * `POST /api/config` — the console's config write path.
 *
 * The endpoint's safety comes from a closed set (only panel keys) and from
 * refusing writes that would not take effect (env-decided keys). Both are
 * asserted here, along with the round-trip that is the whole point of the
 * feature: a value changed in the browser is the value `fabric config --get`
 * reports, because both go through one resolver rather than two.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PANEL_ENV_OVERRIDES } from "@fenglimg/fabric-shared";

import { collectConfigView } from "../src/console/config-view.ts";
import { applyConfigEdit } from "../src/console/config-write.ts";
import { configCmd } from "../src/commands/config.ts";

const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();
const TEAM_UUID = "22222222-2222-4222-8222-222222222222";
const PERSONAL_UUID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-cfgwrite-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  for (const name of Object.values(PANEL_ENV_OVERRIDES)) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(identity: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-cfgwrite-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify(identity, null, 2),
    "utf8",
  );
  return dir;
}

function writeGlobal(config: Record<string, unknown>): void {
  const home = process.env.FABRIC_HOME as string;
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

function readGlobal(): Record<string, unknown> {
  const home = process.env.FABRIC_HOME as string;
  return JSON.parse(
    readFileSync(join(home, ".fabric", "fabric-global.json"), "utf8"),
  ) as Record<string, unknown>;
}

/** A repo bound to a writable team store, so corpus-home keys have a target. */
function makeBoundRepo(): string {
  writeGlobal({
    stores: [
      { store_uuid: PERSONAL_UUID, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM_UUID, alias: "team", remote: "git@example:t.git", writable: true },
    ],
  });
  return makeRepo({
    project_id: "p-write",
    required_stores: [{ id: "team" }],
    active_write_store: "team",
  });
}

describe("applyConfigEdit — refusals", () => {
  it("rejects a missing key", async () => {
    const result = await applyConfigEdit(makeRepo({ project_id: "p1" }), {});
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a key that is not panel-scoped", async () => {
    writeGlobal({});
    // A real config key, but not one this endpoint may write. If the closed set
    // were only advisory, this would land in the global config.
    const repo = makeRepo({ project_id: "p1" });
    const result = await applyConfigEdit(repo, { key: "plan_context_top_k", value: "9" });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(readGlobal().defaults).toBeUndefined();
  });

  it("rejects an identity key outright (not a knob at all)", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p1" });
    expect(await applyConfigEdit(repo, { key: "uid", value: "hijacked" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(readGlobal().uid).toBe("u-test");
  });

  it("rejects a value the field's own validator refuses", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p1" });
    const result = await applyConfigEdit(repo, { key: "nudge_mode", value: "louder" });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(readGlobal().defaults).toBeUndefined();
  });

  it("refuses with 409 when an env var is deciding the value", async () => {
    writeGlobal({ defaults: { fusion: "additive" } });
    const repo = makeRepo({ project_id: "p1" });
    process.env.FABRIC_FUSION = "rrf";

    const result = await applyConfigEdit(repo, { key: "fusion", value: "auto" });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toContain("FABRIC_FUSION");
    // The refusal must be total: a "saved but ignored" write is the exact state
    // this endpoint exists to prevent.
    expect((readGlobal().defaults as Record<string, unknown>).fusion).toBe("additive");
  });
});

describe("applyConfigEdit — writes land in the field's one home", () => {
  it("scope=defaults writes the machine-wide segment", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p-write" });

    const result = await applyConfigEdit(repo, {
      key: "nudge_mode",
      value: "silent",
      scope: "defaults",
    });

    expect(result.ok).toBe(true);
    expect((readGlobal().defaults as Record<string, unknown>).nudge_mode).toBe("silent");
    expect(readGlobal().projects).toBeUndefined();
  });

  it("scope=project writes only this project's segment", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p-write" });

    await applyConfigEdit(repo, { key: "nudge_mode", value: "silent", scope: "project" });

    const projects = readGlobal().projects as Record<string, Record<string, unknown>>;
    expect(projects["p-write"]?.nudge_mode).toBe("silent");
    expect(readGlobal().defaults).toBeUndefined();
  });

  it("stores a numeric field as a number, not the input string", async () => {
    // An HTML text input yields "48"; a numeric reader rejects a string, so the
    // value would be written, displayed, and then ignored at read time.
    writeGlobal({});
    const repo = makeRepo({ project_id: "p-write" });

    await applyConfigEdit(repo, {
      key: "archive_hint_hours",
      value: "48",
      scope: "defaults",
    });

    expect((readGlobal().defaults as Record<string, unknown>).archive_hint_hours).toBe(48);
  });

  it("a corpus key lands in the store, not the global config", async () => {
    const repo = makeBoundRepo();
    const storeRoot = collectConfigView(repo).storeRoot;
    expect(storeRoot).not.toBeNull();
    mkdirSync(storeRoot as string, { recursive: true });

    const result = await applyConfigEdit(repo, {
      key: "underseed_node_threshold",
      value: "25",
      scope: "project",
    });

    expect(result.ok).toBe(true);
    const storeConfig = JSON.parse(
      readFileSync(join(storeRoot as string, "store-config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(storeConfig.underseed_node_threshold).toBe(25);
    // scope is meaningless for a corpus key and must not leak into the global
    // config as a second copy (the dual-write KT-MOD-0004 forbids).
    expect(readGlobal().projects).toBeUndefined();
    expect(readGlobal().defaults).toBeUndefined();
  });

  it("a corpus key with no bound store fails with actionable text", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p-write" });
    const result = await applyConfigEdit(repo, {
      key: "underseed_node_threshold",
      value: "25",
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toMatch(/store/i);
  });

  it("scope=project without a project_id fails instead of silently going machine-wide", async () => {
    writeGlobal({});
    const repo = makeRepo({}); // no project_id
    const result = await applyConfigEdit(repo, {
      key: "nudge_mode",
      value: "silent",
      scope: "project",
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(readGlobal().defaults).toBeUndefined();
  });
});

describe("round-trip: the console and the CLI agree", () => {
  it("a value written from the console is what `fabric config --get` reports", async () => {
    writeGlobal({});
    const repo = makeRepo({ project_id: "p-write" });

    // 48 is neither the code default (24) nor a value already on disk, so a
    // green result cannot come from the assertion coinciding with a default.
    await applyConfigEdit(repo, {
      key: "archive_hint_hours",
      value: "48",
      scope: "defaults",
    });

    const view = collectConfigView(repo).fields.find((f) => f.key === "archive_hint_hours");
    expect(view?.effective).toBe("48");
    expect(view?.source).toBe("defaults");

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ""));
    });
    try {
      await configCmd.run!({
        args: { target: repo, get: "archive_hint_hours" },
        rawArgs: [],
        cmd: configCmd,
        data: undefined,
      } as never);
    } finally {
      spy.mockRestore();
    }
    expect(lines.join("\n")).toContain("48");
  });
});

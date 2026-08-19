/**
 * `GET /api/config` — the console's configuration view, MACHINE-scoped.
 *
 * The property this file exists for is AC1: what the page shows must not depend
 * on which directory the console was started from. Configuration lives in
 * `~/.fabric/fabric-global.json`; the working directory is an unrelated fact
 * about how you launched a server, and letting it decide what you can see or
 * edit was the design flaw this task removes.
 *
 * The AC1 test below is written FIRST and is expected to be RED against the
 * project-scoped implementation. Red-then-green is what makes it evidence about
 * this change; a test authored after the fact would pass on day one and never
 * tell us whether it was measuring anything.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getPanelFields,
  storeRelativePathForMount,
  PANEL_ENV_OVERRIDES,
} from "@fenglimg/fabric-shared";

import { collectGlobalConfigView } from "../src/console/global-config-view.ts";
import { resolveGlobalRoot } from "../src/store/global-config-io.ts";

const CANARY = "sk-CANARY-DO-NOT-LEAK-0001";
const STORE_X = "11111111-1111-4111-8111-111111111111";
const STORE_Y = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-gcfg-home-"));
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
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeGlobal(config: Record<string, unknown>): void {
  const home = process.env.FABRIC_HOME as string;
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

/** A repo with Fabric installed — carries an identity-only panel config. */
function installedRepo(projectId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-gcfg-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId }, null, 2),
    "utf8",
  );
  return dir;
}

/** A directory with no Fabric install at all — the "I started it from ~" case. */
function bareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-gcfg-bare-"));
  dirs.push(dir);
  return dir;
}

describe("collectGlobalConfigView is machine-scoped (AC1)", () => {
  it("returns the same content regardless of the launch directory", async () => {
    // The current project is deliberately the one that sorts LAST. An earlier
    // version of this case used a project that happened to sort first either
    // way, so an ordering that depended on the launch directory passed it — the
    // real two-directory comparison caught what the fixture could not.
    writeGlobal({
      language: "zh-CN",
      defaults: { nudge_mode: "normal", archive_hint_hours: 8 },
      projects: { "aaa-first": { audit_mode: "strict" }, "zzz-last": { nudge_mode: "silent" } },
    });

    const fromInstalled = await collectGlobalConfigView(installedRepo("zzz-last"));
    const fromBare = await collectGlobalConfigView(bareDir());

    // The launch directory legitimately decides two things. `currentProjectId`
    // and the `isCurrent` derived from it move a highlight, not availability.
    // The second is narrower and is an honest limit rather than a design choice:
    // for the current row ALONE, its `path` is OBSERVED — the console is running
    // in it — and nothing maps an id back to a directory anywhere else
    // (KT-PIT-0050), so from a bare directory that path does not exist to be
    // reported. `fabric install` is what removes the asymmetry for good, by
    // putting the path in the registry where every console can see it.
    //
    // Normalising the current row back to its pathless form is what keeps the
    // rest of the comparison sharp: it applies only to a row that is both
    // current AND `current-only`, so a path leaking onto any OTHER row still
    // fails, as does a project appearing or disappearing.
    const strip = (view: Awaited<ReturnType<typeof collectGlobalConfigView>>) => ({
      ...view,
      currentProjectId: null,
      projects: view.projects.map(({ isCurrent, ...rest }) =>
        isCurrent && rest.origin === "current-only" && rest.projectId !== null
          ? { ...rest, path: null, name: rest.projectId, origin: "config-only" as const }
          : rest,
      ),
    });

    // The normalisation must actually be doing something, or the comparison
    // above passes for the wrong reason.
    const current = fromInstalled.projects.find((p) => p.isCurrent);
    expect(current).toMatchObject({ projectId: "zzz-last", origin: "current-only" });
    expect(current?.path).not.toBeNull();

    expect(strip(fromBare)).toEqual(strip(fromInstalled));
  });

  it("offers the same project as editable from both directories", async () => {
    // The sharper half of AC1: equal payloads would be uninteresting if both
    // were empty. This pins that the machine's project is actually THERE when
    // the console was launched from somewhere unrelated to it.
    writeGlobal({ projects: { "proj-a": { nudge_mode: "silent" } } });

    for (const cwd of [installedRepo("proj-a"), bareDir()]) {
      const view = await collectGlobalConfigView(cwd);
      const projectA = view.projects.find((p) => p.projectId === "proj-a");
      expect(projectA).toBeDefined();
      expect(projectA?.editable).toBe(true);
      expect(projectA?.overrides.map((o) => o.key)).toEqual(["nudge_mode"]);
    }
  });

  it("marks the launch directory's project as current, and only that one", async () => {
    writeGlobal({
      projects: { "proj-a": { nudge_mode: "silent" }, "proj-b": { audit_mode: "strict" } },
    });

    const view = await collectGlobalConfigView(installedRepo("proj-a"));
    expect(view.projects.filter((p) => p.isCurrent).map((p) => p.projectId)).toEqual(["proj-a"]);

    // Launched from nowhere in particular: nothing is current, everything is
    // still listed. A console started from ~ is a legitimate way to run it.
    const bare = await collectGlobalConfigView(bareDir());
    expect(bare.projects.some((p) => p.isCurrent)).toBe(false);
    expect(bare.projects.map((p) => p.projectId).sort()).toEqual(["proj-a", "proj-b"]);
  });

  it("adds a whole row for a project no source knows — the far end of the same exception", async () => {
    // The one documented exception to AC1, and it is the real machine's own
    // state today: an install that predates the registry and has never been
    // configured is in neither source, so standing in it is the only way the
    // page can learn it exists. The row is additive and carries no overrides, so
    // it cannot change what any other project shows. Without this branch the
    // project the user is standing in would be missing from its own machine's
    // list.
    writeGlobal({ projects: { "proj-known": { nudge_mode: "silent" } } });

    const launchDir = installedRepo("proj-unlisted");
    const fromUnknown = await collectGlobalConfigView(launchDir);
    const fromBare = await collectGlobalConfigView(bareDir());

    expect(fromBare.projects.map((p) => p.projectId)).toEqual(["proj-known"]);
    const added = fromUnknown.projects.filter((p) => p.projectId === "proj-unlisted");
    expect(added).toHaveLength(1);
    // The path IS carried: the console is running in it, so it is known
    // first-hand rather than guessed. That is what lets the row be labelled by
    // directory instead of by a bare uuid, and what makes it openable as a scope.
    // `current-only`, not `both`: it really is in neither source, and the page
    // owes the user that fact plus its remedy (re-run `fabric install` here).
    expect(added[0]).toMatchObject({ path: launchDir, overrides: [], origin: "current-only" });

    // Drop that one row and the two payloads are identical again — the
    // exception is exactly this row and nothing else rides along with it.
    const strip = (view: Awaited<ReturnType<typeof collectGlobalConfigView>>) => ({
      ...view,
      currentProjectId: null,
      projects: view.projects
        .filter((p) => p.projectId !== "proj-unlisted")
        .map(({ isCurrent: _isCurrent, ...rest }) => rest),
    });
    expect(strip(fromUnknown)).toEqual(strip(fromBare));
  });
});

describe("field list stays derived from the schema", () => {
  it("the machine section is exactly the non-corpus panel fields, in order", () => {
    // Corpus keys are excluded on purpose: `underseed_node_threshold` is a
    // property of a knowledge base, not of this machine, so offering it here
    // would imply a machine-wide setting that no reader consults.
    expect(getPanelFields().filter((f) => f.home === "corpus").map((f) => String(f.key))).toEqual([
      "underseed_node_threshold",
    ]);
  });

  it("the view module names no panel key of its own", async () => {
    // A hand-written list would match `getPanelFields()` on the day it was
    // transcribed, so comparing the two proves nothing about drift. This reads
    // the module's source: if it mentions no key, it cannot be maintaining a
    // list, and a key added tomorrow appears with no edit here.
    const source = await readFile(
      fileURLToPath(new URL("../src/console/global-config-view.ts", import.meta.url)),
      "utf8",
    );
    const mentioned = getPanelFields()
      .map((f) => String(f.key))
      .filter((key) => source.includes(key));
    // `underseed_node_threshold` is absent too — the corpus split is expressed
    // as `home === "corpus"`, not as a named key.
    expect(mentioned).toEqual([]);
  });

  it("every field carries rendered strings, not raw i18n keys", async () => {
    writeGlobal({});
    const view = await collectGlobalConfigView(bareDir());
    for (const field of view.machine) {
      expect(field.label).not.toMatch(/^cli\./u);
      expect(field.description).not.toMatch(/^cli\./u);
      expect(field.sourceLabel.length).toBeGreaterThan(0);
    }
    for (const value of Object.values(view.strings)) {
      expect(value).not.toMatch(/^cli\./u);
    }
  });
});

describe("env is only authoritative where the console can observe it (AC5)", () => {
  it("decides the current project's row but only hints on the others", async () => {
    writeGlobal({
      defaults: { fusion: "additive" },
      projects: { "proj-a": { fusion: "additive" }, "proj-b": { fusion: "additive" } },
    });
    process.env.FABRIC_FUSION = "rrf";

    const view = await collectGlobalConfigView(installedRepo("proj-a"));
    const fusionOf = (id: string) =>
      view.projects.find((p) => p.projectId === id)?.overrides.find((f) => f.key === "fusion");

    // The launch directory: the console runs in the same shell the user does,
    // so the strong claim is defensible and editing is refused (a write here
    // would persist a value the variable keeps overriding).
    expect(fusionOf("proj-a")?.source).toBe("env");
    expect(fusionOf("proj-a")?.editable).toBe(false);

    // Any other project: `FABRIC_FUSION` is read by THAT project's own MCP
    // process, whose environment this console cannot see. Reporting "env is
    // deciding" would describe one process using another's state. proj-b
    // therefore resolves from its own config segment — the same segment proj-a
    // has, which is what makes the two rows differ only by the env question.
    expect(fusionOf("proj-b")?.source).toBe("project");
    expect(fusionOf("proj-b")?.effective).toBe("additive");
    expect(fusionOf("proj-b")?.editable).toBe(true);
    // The variable is still NAMED, so "why didn't my change take" stays
    // answerable — it is downgraded from a verdict to a possibility.
    expect(fusionOf("proj-b")?.envVar).toBe("FABRIC_FUSION");
  });

  it("the machine section describes a clean environment", async () => {
    // These are the defaults a process with no FABRIC_* inherits. Folding this
    // shell's variables in would report the console's state as the machine's.
    writeGlobal({ defaults: { fusion: "additive" } });
    process.env.FABRIC_FUSION = "rrf";

    const machineFusion = (await collectGlobalConfigView(bareDir())).machine.find(
      (f) => f.key === "fusion",
    );
    expect(machineFusion?.source).toBe("defaults");
    expect(machineFusion?.effective).toBe("additive");
    expect(machineFusion?.editable).toBe(true);
  });
});

describe("empty machine (AC2)", () => {
  it("renders an empty project list rather than failing", async () => {
    // The real state of every machine today: the registry postdates the
    // installs, and nothing has a per-project override yet. This is the DEFAULT
    // first screen, so it has to be a supported render and not an error path.
    writeGlobal({ defaults: { nudge_mode: "silent" } });
    const view = await collectGlobalConfigView(bareDir());

    expect(view.projects).toEqual([]);
    // The machine section is still fully populated — "no projects" must not
    // read as "nothing is configured".
    expect(view.machine.length).toBeGreaterThan(10);
    expect(view.machine.find((f) => f.key === "nudge_mode")?.effective).toBe("silent");
    expect(view.strings["projects.empty"]?.length).toBeGreaterThan(0);
  });

  it("a project with no overrides is listed with an empty override set", async () => {
    // Distinct from "not listed": the project exists and can receive its first
    // override, which is exactly what the row's add-control is for.
    writeGlobal({ projects: { "proj-a": {} } });
    const view = await collectGlobalConfigView(bareDir());

    expect(view.projects.map((p) => p.projectId)).toEqual(["proj-a"]);
    expect(view.projects[0]?.overrides).toEqual([]);
    expect(view.projects[0]?.editable).toBe(true);
  });
});

describe("stores section (AC6 read half)", () => {
  it("reports the corpus key per mounted store, independently", async () => {
    writeGlobal({
      stores: [
        { store_uuid: STORE_X, alias: "team-x" },
        { store_uuid: STORE_Y, alias: "personal-y", personal: true },
      ],
    });
    // resolveGlobalRoot(), not FABRIC_HOME: the global root is the `.fabric`
    // directory INSIDE it. Building the fixture path from the env var put the
    // store one tree over from where the code reads it.
    const globalRoot = resolveGlobalRoot();
    // Only store X carries a value; Y must fall through to the code default
    // rather than inheriting X's — the assertion that makes this about
    // per-store isolation instead of "we read a file".
    //
    // The path comes from `storeRelativePathForMount`, not from a hand-built
    // `stores/<uuid>`: the real layout is stores/<group>/<mount_name ?? uuid>,
    // and a path guessed here would point at nothing, leaving the case to
    // "prove" isolation by reading two empty files.
    const rootX = join(globalRoot, storeRelativePathForMount({ store_uuid: STORE_X }));
    mkdirSync(rootX, { recursive: true });
    writeFileSync(
      join(rootX, "store-config.json"),
      JSON.stringify({ underseed_node_threshold: 7 }),
      "utf8",
    );

    const stores = (await collectGlobalConfigView(bareDir())).stores;
    const fieldOf = (uuid: string) =>
      stores.find((s) => s.storeUuid === uuid)?.fields.find((f) => f.key === "underseed_node_threshold");

    expect(stores.map((s) => s.alias)).toEqual(["team-x", "personal-y"]);
    expect(fieldOf(STORE_X)?.effective).toBe("7");
    expect(fieldOf(STORE_X)?.source).toBe("store");
    expect(fieldOf(STORE_Y)?.source).toBe("default");
    expect(stores.find((s) => s.storeUuid === STORE_Y)?.personal).toBe(true);
  });

  it("no mounted stores yields an empty section, not a fabricated one", async () => {
    writeGlobal({ stores: [] });
    expect((await collectGlobalConfigView(bareDir())).stores).toEqual([]);
  });
});

describe("secrets never reach the wire (AC7)", () => {
  it("reports remote embedding as shape only, from nested or flat keys", async () => {
    writeGlobal({
      embed_remote: {
        endpoint: "https://api.example.com/v1/embeddings?token=leak-me",
        api_key: CANARY,
        model: "BAAI/bge-m3",
      },
    });
    const view = await collectGlobalConfigView(bareDir());

    expect(view.remoteEmbedding).toEqual({
      configured: true,
      // Host only: the query string of a real endpoint is a plausible place for
      // a credential, so the full URL never comes back.
      endpointHost: "api.example.com",
      hasApiKey: true,
      model: "BAAI/bge-m3",
    });
    expect(JSON.stringify(view)).not.toContain("leak-me");
  });

  it("detects the pre-W2 FLAT keys, which the real machine carries", async () => {
    // Reading only `embed_remote` reported "off" on the dogfood machine while
    // recall was going over the network — a display that lies, on the one page
    // whose job is to not do that.
    writeGlobal({
      embed_endpoint: "https://flat.example.com/v1",
      embed_api_key: CANARY,
      embed_model: "BAAI/bge-m3",
    });
    const remote = (await collectGlobalConfigView(bareDir())).remoteEmbedding;

    expect(remote.configured).toBe(true);
    expect(remote.endpointHost).toBe("flat.example.com");
    expect(remote.hasApiKey).toBe(true);
  });

  it("CANARY: no secret appears anywhere in the payload", async () => {
    // Asserted over the WHOLE payload rather than per field: the panel field
    // set contains no credential, so a per-field masking check would examine an
    // empty set and stay green forever (the shape KT-PIT-0062 describes). This
    // also catches the likeliest real leak — spreading the global config object
    // into the response.
    writeGlobal({
      embed_remote: { endpoint: "https://api.example.com/v1", api_key: CANARY },
      embed_api_key: CANARY,
      defaults: { nudge_mode: "silent" },
      projects: { "proj-a": { audit_mode: "strict" } },
    });
    const serialized = JSON.stringify(await collectGlobalConfigView(bareDir()));

    expect(serialized).not.toContain(CANARY);
    // Control: the payload is populated, so the assertion above examined
    // something. Without this, an empty view would pass it.
    expect(serialized).toContain("nudge_mode");
    expect(serialized).toContain("proj-a");
    expect(serialized.length).toBeGreaterThan(500);
  });
});

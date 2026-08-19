/**
 * The settings page's presentation layer: tiers, the change bar, and the
 * reminder-frequency preset.
 *
 * Every property here is about the layer NOT becoming a second source of truth.
 * The registry may promote a key to the front page and it may bundle eight
 * numbers into one choice — but it must not decide what exists, and it must not
 * record a claim (which preset is active, whether a value is customised) that
 * can drift from the configuration itself.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getPanelFields,
  storeRelativePathForMount,
  PANEL_ENV_OVERRIDES,
} from "@fenglimg/fabric-shared";

import {
  ARCHIVE_PRESETS,
  ARCHIVE_PRESET_KEYS,
  getArchivePreset,
  matchArchivePreset,
  tierOf,
} from "../src/console/config-presentation.ts";
import { collectGlobalConfigView } from "../src/console/global-config-view.ts";
import {
  applyGlobalConfigEdit,
  applyGlobalConfigPreset,
} from "../src/console/global-config-write.ts";
import { resolveGlobalRoot } from "../src/store/global-config-io.ts";

const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-pres-home-"));
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

function globalPath(): string {
  return join(process.env.FABRIC_HOME as string, ".fabric", "fabric-global.json");
}

function writeGlobal(config: Record<string, unknown>): void {
  mkdirSync(join(process.env.FABRIC_HOME as string, ".fabric"), { recursive: true });
  writeFileSync(
    globalPath(),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

function readGlobal(): Record<string, unknown> {
  return JSON.parse(readFileSync(globalPath(), "utf8")) as Record<string, unknown>;
}

function installedRepo(projectId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-pres-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId }, null, 2),
    "utf8",
  );
  return dir;
}

function bareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-pres-bare-"));
  dirs.push(dir);
  return dir;
}

/** The value each preset key resolves to with nothing configured. */
function schemaDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of getPanelFields()) {
    const key = String(field.key);
    if (ARCHIVE_PRESET_KEYS.includes(key)) out[key] = field.default;
  }
  return out;
}

describe("tierOf — promotion only, never omission", () => {
  it("puts a key it has never heard of in advanced", () => {
    // The invariant the whole module exists for. A hand-written list would make
    // a new schema field vanish from the page until someone remembered to update
    // the list — with every test green, because the tests read the same list.
    expect(tierOf("a_key_added_to_the_schema_next_week")).toBe("advanced");
    expect(tierOf("")).toBe("advanced");
  });

  it("assigns every actual panel field to a tier, dropping none", () => {
    const fields = getPanelFields().map((f) => String(f.key));
    expect(fields.length).toBeGreaterThan(0);
    for (const key of fields) {
      expect(["common", "advanced"]).toContain(tierOf(key));
    }
  });

  it("every promoted key is a real panel key", () => {
    // A typo in the promotion list is silent in the other direction: the key
    // never matches, so nothing is promoted and the page just looks like it was
    // never restructured. Derived from the panel fields rather than repeated as
    // a literal so this cannot drift into asserting the list against itself.
    const known = new Set(getPanelFields().map((f) => String(f.key)));
    const promoted = [...known].filter((k) => tierOf(k) === "common");
    expect(promoted.length).toBeGreaterThan(0);
    // ...and the front page stays a front page. Nineteen equal rows was the
    // original complaint; a "common" section that grows past a screenful
    // reproduces it one level down.
    expect(promoted.length).toBeLessThanOrEqual(8);
  });
});

describe("matchArchivePreset — derived, never stored", () => {
  it("a machine with nothing configured reads as standard", () => {
    // Not decoration: if `standard` disagreed with the schema defaults, every
    // fresh install would be told it is running a customised configuration it
    // never chose.
    expect(matchArchivePreset(schemaDefaults())).toBe("standard");
  });

  it("changing any single key makes it custom", () => {
    // Looped over all eight rather than spot-checked: a typo in ONE row of the
    // preset table is exactly the failure a single-key check misses, and it
    // would show a preset name the configuration does not match.
    for (const key of ARCHIVE_PRESET_KEYS) {
      const drifted = { ...schemaDefaults(), [key]: 999 };
      expect(matchArchivePreset(drifted), `${key} should break the match`).toBeNull();
    }
  });

  it("recognises each preset from its own values", () => {
    for (const preset of ARCHIVE_PRESETS) {
      expect(matchArchivePreset(preset.values)).toBe(preset.id);
    }
  });

  it("the three presets differ on every key", () => {
    // First-match wins, so two presets sharing a full value set would make one of
    // them unreachable in the display — the user picks it and the page keeps
    // showing the other one's name.
    for (const key of ARCHIVE_PRESET_KEYS) {
      const values = ARCHIVE_PRESETS.map((p) => p.values[key]);
      expect(new Set(values).size, `${key} is not distinct across presets`).toBe(values.length);
    }
  });

  it("a number typed into JSON as a string still matches", () => {
    // `24` and `"24"` resolve to the same behaviour everywhere else in the
    // system; reporting "custom" for the second would be the display inventing a
    // difference that does not exist.
    const stringy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schemaDefaults())) stringy[key] = String(value);
    expect(matchArchivePreset(stringy)).toBe("standard");
  });

  it("an unknown preset id has no definition to apply", () => {
    expect(getArchivePreset("aggressive")).toBeUndefined();
  });
});

describe("the change bar reports the SOURCE, not a value comparison", () => {
  it("is off on a fresh machine and on once a value is written", async () => {
    writeGlobal({});
    const dir = bareDir();

    const before = await collectGlobalConfigView(dir);
    expect(before.machine.find((f) => f.key === "nudge_mode")?.modified).toBe(false);

    await applyGlobalConfigEdit(
      { key: "nudge_mode", value: "silent", target: { scope: "machine" } },
      dir,
    );
    const after = await collectGlobalConfigView(dir);
    expect(after.machine.find((f) => f.key === "nudge_mode")?.modified).toBe(true);
  });

  it("stays on when the written value happens to equal the default", async () => {
    // The discriminator between this implementation and the obvious wrong one.
    // `normal` IS nudge_mode's code default, but writing it materialises a value
    // that outranks every layer below — a machine-wide setting made later will
    // not reach a project pinned this way. A page that hid that would make "why
    // does my default not apply here" unanswerable.
    writeGlobal({});
    const dir = bareDir();
    await applyGlobalConfigEdit(
      { key: "nudge_mode", value: "normal", target: { scope: "machine" } },
      dir,
    );

    const view = await collectGlobalConfigView(dir);
    const field = view.machine.find((f) => f.key === "nudge_mode");
    expect(field?.effective).toBe("normal");
    expect(field?.modified).toBe(true);
  });

  it("goes off again after a reset", async () => {
    writeGlobal({ defaults: { nudge_mode: "silent" } });
    const dir = bareDir();
    expect((await collectGlobalConfigView(dir)).machine.find((f) => f.key === "nudge_mode")
      ?.modified).toBe(true);

    await applyGlobalConfigEdit(
      { key: "nudge_mode", action: "reset", target: { scope: "machine" } },
      dir,
    );
    const after = await collectGlobalConfigView(dir);
    const field = after.machine.find((f) => f.key === "nudge_mode");
    expect(field?.modified).toBe(false);
    // And the value came back from the layer below rather than being rewritten
    // in place — `defaults` is gone from the file entirely.
    expect(readGlobal().defaults).toBeUndefined();
    expect(field?.effective).toBe("normal");
  });
});

describe("POST /api/config/preset", () => {
  it("writes all eight keys into the machine defaults", async () => {
    writeGlobal({});
    const dir = bareDir();

    const result = await applyGlobalConfigPreset(
      { preset: "relaxed", target: { scope: "machine" } },
      dir,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.applied).toEqual(ARCHIVE_PRESET_KEYS);

    const defaults = readGlobal().defaults as Record<string, unknown>;
    // Compared against the preset table, not against literals repeated here —
    // a copy of the numbers in the test only proves the test agrees with itself.
    expect(defaults).toEqual(getArchivePreset("relaxed")?.values);

    const view = await collectGlobalConfigView(dir);
    expect(view.archivePreset.active).toBe("relaxed");
  });

  it("editing one key afterwards turns the display to custom", async () => {
    writeGlobal({});
    const dir = bareDir();
    await applyGlobalConfigPreset({ preset: "attentive", target: { scope: "machine" } }, dir);
    expect((await collectGlobalConfigView(dir)).archivePreset.active).toBe("attentive");

    // 13 is in no preset's table, so the resulting state cannot accidentally
    // match a different one and read as "still a preset".
    await applyGlobalConfigEdit(
      { key: "archive_hint_hours", value: "13", target: { scope: "machine" } },
      dir,
    );
    expect((await collectGlobalConfigView(dir)).archivePreset.active).toBeNull();
  });

  it("writes into a project's own segment when the target names one", async () => {
    writeGlobal({ projects: { "p-one": { nudge_mode: "silent" } } });
    const dir = installedRepo("p-one");

    const result = await applyGlobalConfigPreset(
      { preset: "relaxed", target: { scope: "project", projectId: "p-one" } },
      dir,
    );
    expect(result.ok).toBe(true);

    const global = readGlobal();
    const scoped = (global.projects as Record<string, Record<string, unknown>>)["p-one"];
    expect(scoped?.archive_hint_hours).toBe(72);
    // The pre-existing override survives — a preset sets its eight keys, not the
    // whole segment.
    expect(scoped?.nudge_mode).toBe("silent");
    // And the machine-wide defaults were NOT touched. `archivePreset.active`
    // reports the MACHINE layer, so a project write leaking upward would show as
    // the whole machine changing frequency.
    expect(global.defaults).toBeUndefined();
    expect((await collectGlobalConfigView(dir)).archivePreset.active).toBe("standard");
  });

  it("refuses an unknown preset without writing anything", async () => {
    writeGlobal({});
    const dir = bareDir();
    const result = await applyGlobalConfigPreset(
      { preset: "silent-mode", target: { scope: "machine" } },
      dir,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(readGlobal().defaults).toBeUndefined();
  });

  it("refuses a store target — none of these keys is read from a store", async () => {
    const storeUuid = "33333333-3333-4333-8333-333333333333";
    const mount = { store_uuid: storeUuid, alias: "team" };
    writeGlobal({ stores: [mount] });
    // The store must exist on disk, or the refusal under test is masked by the
    // earlier "mounted but not synced" 409 and this asserts nothing about
    // presets at all.
    mkdirSync(join(resolveGlobalRoot(), storeRelativePathForMount(mount)), { recursive: true });

    const result = await applyGlobalConfigPreset(
      { preset: "relaxed", target: { scope: "store", storeUuid } },
      bareDir(),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(result.ok === false && result.error).toContain("store");
  });

  it("refuses a preset with no id rather than picking one", async () => {
    writeGlobal({});
    const result = await applyGlobalConfigPreset({ target: { scope: "machine" } }, bareDir());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
  });
});

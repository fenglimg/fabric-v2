/**
 * The env layer of `resolveEffective`.
 *
 * Four panel keys have a reader that consults `process.env`; the other fifteen
 * do not. Before this, the resolver skipped env entirely, so for those four it
 * reported the config file's value while the environment was the thing actually
 * deciding — a surface showing a value that is not in effect, which is the
 * failure KT-MOD-0004 names as the hardest to debug.
 *
 * Every case here sets THREE distinct values (env / defaults / code default) and
 * asserts the env one wins. Asserting against a value that happens to equal the
 * default is how a case goes green without ever exercising the layer it claims
 * to cover (KT-PIT-0062).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPanelFields, PANEL_ENV_OVERRIDES } from "@fenglimg/fabric-shared";

import { loadPanelContext, resolveEffective } from "../src/console/config-resolve.ts";

const dirs: string[] = [];
let savedHome: string | undefined;
const TEAM_UUID = "22222222-2222-4222-8222-222222222222";
const PERSONAL_UUID = "33333333-3333-4333-8333-333333333333";
// Every FABRIC_* the suite may set, restored wholesale in afterEach. A case that
// only clears the vars it happens to remember leaks state into its neighbours,
// and an env-driven suite is exactly where that goes unnoticed.
const MANAGED_ENV = Object.values(PANEL_ENV_OVERRIDES);
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-env-layer-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  for (const name of MANAGED_ENV) {
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

function makeRepo(identity: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-env-layer-repo-"));
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

function fieldFor(key: string) {
  const field = getPanelFields().find((f) => String(f.key) === key);
  if (field === undefined) throw new Error(`no panel field named ${key}`);
  return field;
}

/**
 * env value / lower-layer value / code default — deliberately three DIFFERENT
 * values per key, so "env won" and "the default happened to match" cannot be
 * confused for one another.
 *
 * Only PREFERENCE keys are here. `underseed_node_threshold` is the fourth
 * registered override but a CORPUS key, so its lower layer is the store's
 * store-config.json, not the global `defaults` segment — it gets its own case
 * below. Writing it into `defaults` produced a value that resolved to
 * `undefined`, which is the correct behaviour and a good reminder that "the
 * layer below env" is not one place.
 */
const PREFERENCE_CASES: ReadonlyArray<{ key: string; env: string; defaults: unknown }> = [
  { key: "fusion", env: "rrf", defaults: "additive" }, // code default: "auto"
  { key: "nudge_mode", env: "silent", defaults: "verbose" }, // code default: "normal"
  { key: "default_layer_filter", env: "team", defaults: "personal" }, // code default: "both"
];

describe("resolveEffective — env layer", () => {
  for (const { key, env, defaults } of PREFERENCE_CASES) {
    it(`${key}: env beats the config layers, and all three values differ`, () => {
      const field = fieldFor(key);
      const envVar = PANEL_ENV_OVERRIDES[key] as string;

      // The premise of the case, asserted rather than assumed.
      expect(String(field.default)).not.toBe(env);
      expect(String(defaults)).not.toBe(env);
      expect(String(defaults)).not.toBe(String(field.default));

      writeGlobal({ defaults: { [key]: defaults } });
      const repo = makeRepo({ project_id: "p-env-layer" });

      const before = resolveEffective(field, loadPanelContext(repo));
      // Without env set, the config layer must be what wins — otherwise the
      // "after" assertion below proves nothing about env specifically.
      expect(String(before.value)).toBe(String(defaults));

      process.env[envVar] = env;
      const after = resolveEffective(field, loadPanelContext(repo));
      expect(after.source).toBe("env");
      expect(String(after.value)).toBe(env);
    });
  }

  it("underseed_node_threshold (corpus): env beats the STORE layer", () => {
    const field = fieldFor("underseed_node_threshold");
    expect(field.home).toBe("corpus");
    // 42 (env) / 7 (store) / 10 (code default) — pairwise distinct.
    expect(String(field.default)).toBe("10");

    writeGlobal({
      stores: [
        { store_uuid: PERSONAL_UUID, alias: "personal", personal: true, writable: true },
        { store_uuid: TEAM_UUID, alias: "team", remote: "git@example:t.git", writable: true },
      ],
    });
    const repo = makeRepo({
      project_id: "p-env-layer",
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    });

    // Ask the resolver where the store root is rather than recomputing the path
    // here — a hand-built path that drifts from the resolver would make the case
    // silently test an empty store config.
    const storeRoot = loadPanelContext(repo).storeRoot;
    expect(storeRoot).not.toBeNull();
    mkdirSync(storeRoot as string, { recursive: true });
    writeFileSync(
      join(storeRoot as string, "store-config.json"),
      JSON.stringify({ underseed_node_threshold: 7 }, null, 2),
      "utf8",
    );

    const before = resolveEffective(field, loadPanelContext(repo));
    expect(before.source).toBe("store");
    expect(before.value).toBe(7);

    process.env.FABRIC_UNDERSEED_NODE_THRESHOLD = "42";
    const after = resolveEffective(field, loadPanelContext(repo));
    expect(after.source).toBe("env");
    expect(after.value).toBe(42);
  });

  it("a malformed env value falls through instead of poisoning the field", () => {
    const field = fieldFor("fusion");
    writeGlobal({ defaults: { fusion: "additive" } });
    const repo = makeRepo({ project_id: "p-env-layer" });

    process.env.FABRIC_FUSION = "not-a-strategy";
    const resolved = resolveEffective(field, loadPanelContext(repo));

    expect(resolved.source).toBe("defaults");
    expect(resolved.value).toBe("additive");
  });

  it("an empty env value is treated as unset", () => {
    const field = fieldFor("fusion");
    writeGlobal({ defaults: { fusion: "additive" } });
    const repo = makeRepo({ project_id: "p-env-layer" });

    process.env.FABRIC_FUSION = "";
    expect(resolveEffective(field, loadPanelContext(repo)).source).toBe("defaults");
  });

  it("keys with no registered env reader ignore a same-named variable", () => {
    // The negative half of the contract: env must not become a universal
    // override just because a variable with a plausible name exists.
    const field = fieldFor("audit_mode");
    expect(PANEL_ENV_OVERRIDES.audit_mode).toBeUndefined();

    writeGlobal({ defaults: { audit_mode: "strict" } });
    const repo = makeRepo({ project_id: "p-env-layer" });
    process.env.FABRIC_AUDIT_MODE = "off";

    try {
      const resolved = resolveEffective(field, loadPanelContext(repo));
      expect(resolved.source).toBe("defaults");
      expect(resolved.value).toBe("strict");
    } finally {
      delete process.env.FABRIC_AUDIT_MODE;
    }
  });
});

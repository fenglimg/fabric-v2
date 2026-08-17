/**
 * Anti-drift gate for `PANEL_ENV_OVERRIDES`
 * (packages/shared/src/schemas/config-env-registry.ts).
 *
 * The registry tells the config surfaces which panel keys an environment
 * variable can actually override. It is a hand-written list, and a hand-written
 * list that nothing checks is how `STORE_OVERRIDABLE_KNOBS` ended up declaring
 * 15 overridable knobs while only 12 were read — the declaration and the
 * implementation were two tables with no gate between them, so the gap widened
 * unnoticed for months (KT-PIT-0081).
 *
 * So this census greps the ACTUAL readers and asserts set equality in BOTH
 * directions:
 *   - a reader that is not registered → the console would show "machine-wide"
 *     for a key the environment is really deciding.
 *   - a registration nothing reads → the console would offer an env explanation
 *     that can never be true.
 *
 * Matching is POSITIVE (only shapes that read a variable), not exclusion-based.
 * An exclusion list would have to know about i18n help text that names
 * `FABRIC_NUDGE_MODE` in prose, doc comments that spell out a cascade, and this
 * registry's own string literals — and every such rule is a chance to exclude a
 * real reader by accident.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getPanelFields, PANEL_ENV_OVERRIDES } from "@fenglimg/fabric-shared";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Where a config reader can live. `.claude/hooks` is in the list because two of
// the four overrides are read ONLY there — a census over packages/ alone would
// report them as unread and delete them from the registry.
const SCAN_ROOTS = [
  join(REPO_ROOT, "packages", "cli", "src"),
  join(REPO_ROOT, "packages", "server", "src"),
  join(REPO_ROOT, "packages", "shared", "src"),
  join(REPO_ROOT, ".claude", "hooks"),
];

const SOURCE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;
// Tests are not readers: they SET variables to drive the code under test, and a
// fixture assignment reads exactly like `process.env.X` to a regex.
const TEST_FILE = /\.test\.|\.spec\.|__tests__|[/\\]tests?[/\\]/;

/**
 * Every `FABRIC_*` name this text actually READS.
 *
 * Three shapes cover the codebase: direct property access, computed access, and
 * the `envNum` / `envRaw` / `readEnvInt` helper family (matched by the `env`
 * substring in the callee name rather than by enumerating helper names, so a new
 * helper is covered on the day it is written).
 */
function readEnvNames(source: string): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /process\.env\.(FABRIC_[A-Z0-9_]+)/g,
    /process\.env\[\s*["'`](FABRIC_[A-Z0-9_]+)["'`]\s*\]/g,
    /\b\w*[eE]nv\w*\(\s*["'`](FABRIC_[A-Z0-9_]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[1] as string);
    }
  }
  return found;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a root that does not exist in this checkout
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(full)) {
      out.push(full);
    }
  }
}

function censusReadEnvNames(): Set<string> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const names = new Set<string>();
  for (const file of files) {
    for (const name of readEnvNames(readFileSync(file, "utf8"))) names.add(name);
  }
  return names;
}

describe("PANEL_ENV_OVERRIDES census", () => {
  // Control group. Without it, a matcher that silently matches nothing would
  // report "no readers anywhere" and the set-equality assertion would then only
  // pass for an EMPTY registry — a green test proving the opposite of its intent
  // (KT-PIT-0062).
  it("the matcher actually extracts names from each read shape", () => {
    expect(readEnvNames(`const a = process.env.FABRIC_NUDGE_MODE;`)).toContain(
      "FABRIC_NUDGE_MODE",
    );
    expect(readEnvNames(`const b = process.env["FABRIC_FUSION"];`)).toContain("FABRIC_FUSION");
    expect(readEnvNames(`envRaw("FABRIC_DEFAULT_LAYER_FILTER")`)).toContain(
      "FABRIC_DEFAULT_LAYER_FILTER",
    );
    expect(
      readEnvNames(`storeConfigReader.readEnvInt("FABRIC_UNDERSEED_NODE_THRESHOLD", { min: 1 })`),
    ).toContain("FABRIC_UNDERSEED_NODE_THRESHOLD");
    // Prose and bare literals must NOT count — those are the false positives an
    // exclusion list would otherwise have to chase.
    expect(readEnvNames("set it with FABRIC_NUDGE_MODE=silent").size).toBe(0);
    expect(readEnvNames(`nudge_mode: "FABRIC_NUDGE_MODE",`).size).toBe(0);
  });

  it("the census finds readers at all", () => {
    // Guards the walker (wrong roots, over-eager skip rules) independently of
    // the intersection below, which can be empty for boring reasons.
    expect(censusReadEnvNames().size).toBeGreaterThan(5);
  });

  it("registry === the env vars actually read for panel keys", () => {
    const panelKeys = new Set(getPanelFields().map((f) => String(f.key)));
    const read = censusReadEnvNames();

    // Registered but unread → the surface would explain a value with a layer
    // that cannot win.
    const registeredButUnread = Object.entries(PANEL_ENV_OVERRIDES)
      .filter(([, envVar]) => !read.has(envVar))
      .map(([key, envVar]) => `${key} → ${envVar}`);
    expect(registeredButUnread).toEqual([]);

    // Read but unregistered. Derived by name convention because that is the only
    // way to go from an env var back to a panel key; a reader whose variable
    // does NOT follow the convention cannot be caught here, which is exactly why
    // the registry stores the mapping explicitly instead of computing it.
    const registeredVars = new Set(Object.values(PANEL_ENV_OVERRIDES));
    const unregistered = [...read]
      .filter((envVar) => !registeredVars.has(envVar))
      .filter((envVar) => panelKeys.has(envVar.replace(/^FABRIC_/, "").toLowerCase()));
    expect(unregistered).toEqual([]);
  });
});

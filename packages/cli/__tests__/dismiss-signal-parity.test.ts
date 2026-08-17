/**
 * Regression oracle for the `hint_dismiss_signals` dismiss lever.
 *
 * Two defects motivated this file, both of which type-check and test-pass in
 * every other suite because a nudge that keeps firing looks exactly like a nudge
 * that was never dismissed:
 *
 *   1. The user-visible affordance (session-signal-state.cjs#renderDismissOption)
 *      told people to edit `.fabric/fabric-config.json`, but every reader of the
 *      key resolves it through config-cache.cjs#readPolicy — the GLOBAL policy
 *      layer. Following the instruction was a silent no-op (KT-PIT-0071: a remedy
 *      pointer whose scope differs from the reader's is a nudge that can never be
 *      satisfied).
 *   2. `archive_backlog` was in the hook's DISMISSABLE_SIGNALS but not in the
 *      `hint_dismiss_signals` zod enum. The hook path reads raw JSON, so it
 *      worked at runtime while the documented contract rejected it.
 *
 * The oracles below are deliberately round-trip rather than assertion-by-hand:
 * `followsTheRenderedInstruction` PARSES the affordance string the user actually
 * sees and writes to whatever file/layer/key that string names. If the wording
 * ever drifts away from the reader again, this test goes red instead of the
 * silence going unnoticed.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fabricConfigSchema } from "@fenglimg/fabric-shared";

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const hook = require("../templates/hooks/fabric-hint.cjs") as {
  readDismissedSignals: (cwd: string, sessionId: string | null) => Set<string>;
  renderDismissOption: (signal: string, variant: string) => string;
  DISMISSABLE_SIGNALS: string[];
  main: (
    env: { cwd: string; now: Date; stdin_payload?: unknown },
    stdio: { stdout: { write: (s: string) => void } },
  ) => void;
};
const configCache = require("../templates/hooks/lib/config-cache.cjs") as {
  clearConfigCache: () => void;
};
const hintNarrowConfig = require("../templates/hooks/lib/hint-narrow-config.cjs") as {
  readNarrowDismissed: (projectRoot: string) => boolean;
};
const citePolicyEvict = require("../templates/hooks/cite-policy-evict.cjs") as {
  readCiteEvictDismissed: (cwd: string) => boolean;
};
const knowledgeHintBroad = require("../templates/hooks/knowledge-hint-broad.cjs") as {
  readDismissedSummarySignals: (cwd: string) => Set<string>;
};
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const HOOKS_DIR = join(__dirname, "..", "templates", "hooks");

const PROJECT_ID = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const NOW_MS = 1_750_000_000_000;
const NOW = new Date(NOW_MS);
const HOUR_MS = 60 * 60 * 1000;

let home: string;
const roots: string[] = [];
let prevHome: string | undefined;
let prevClient: string | undefined;
let prevProjectDir: string | undefined;

beforeEach(() => {
  prevHome = process.env.FABRIC_HOME;
  prevClient = process.env.FABRIC_HINT_CLIENT;
  prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
  home = mkdtempSync(join(tmpdir(), "dismiss-parity-home-"));
  process.env.FABRIC_HOME = home;
  process.env.FABRIC_HINT_CLIENT = "cc";
  // The hook resolves the project root from CLAUDE_PROJECT_DIR when set, which
  // would drag the real repo in and make every temp root inert.
  delete process.env.CLAUDE_PROJECT_DIR;
  configCache.clearConfigCache();
});

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = prevHome;
  if (prevClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
  else process.env.FABRIC_HINT_CLIENT = prevClient;
  if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
  configCache.clearConfigCache();
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * A fresh project root. Each `main()` invocation needs its OWN root: the hook
 * writes a per-signal shown-cache on emit, and a second run against the same
 * root would be silenced by the cooldown — a false green indistinguishable from
 * a working dismiss.
 */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dismiss-parity-root-"));
  roots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: PROJECT_ID, fabric_language: "en" }),
    "utf8",
  );
  return root;
}

/**
 * Seed two DEAD sessions (idle past archive_backlog_idle_hours, default 24h)
 * that each hold unarchived high-value work. That is exactly the crack-2
 * archive_backlog trigger, and the default session-count threshold is 2.
 * The current session ("live") carries no events, so the in-session `archive`
 * signal — which takes precedence — stays quiet.
 */
function seedBacklogTrigger(root: string): void {
  const dead = NOW_MS - 48 * HOUR_MS;
  const lines = ["s1", "s2"].map((sid, i) => ({
    kind: "fabric-event",
    schema_version: 1,
    id: `event:eic:${sid}`,
    event_type: "edit_intent_checked",
    ts: dead + i * 1000,
    session_id: sid,
    path: `src/${sid}.ts`,
  }));
  writeFileSync(
    join(root, ".fabric", "events.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    "utf8",
  );
}

function writeGlobalConfig(body: Record<string, unknown>): void {
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(join(home, ".fabric", "fabric-global.json"), JSON.stringify(body), "utf8");
  configCache.clearConfigCache();
}

function runHook(root: string): string[] {
  const writes: string[] = [];
  hook.main(
    { cwd: root, now: NOW, stdin_payload: { session_id: "live" } },
    { stdout: { write: (s: string) => writes.push(s) } },
  );
  return writes;
}

// ---------------------------------------------------------------------------
// the affordance parser — the heart of the round-trip oracle
// ---------------------------------------------------------------------------

interface ParsedAffordance {
  /** The config file the rendered line tells the user to edit, verbatim. */
  displayPath: string;
  /** The nesting key the line names (e.g. "defaults"). */
  layer: string;
  configKey: string;
  signal: string;
}

/**
 * Parse the user-visible dismiss line WITHOUT presupposing its contents: every
 * double-quoted token is collected, the `"<key>": ["<signal>"]` pair identifies
 * two of them, and whatever single token is left over is the layer. A `*.json`
 * token is the file. If the wording changes shape, this throws rather than
 * silently testing nothing.
 */
function parseAffordance(line: string): ParsedAffordance {
  const pair = /"([A-Za-z0-9_]+)":\s*\["([^"]+)"\]/.exec(line);
  if (pair === null) {
    throw new Error(`dismiss affordance no longer names a "key": ["value"] pair: ${line}`);
  }
  const [, configKey, signal] = pair;

  const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const leftovers = quoted.filter((t) => t !== configKey && t !== signal);
  if (leftovers.length !== 1) {
    throw new Error(
      `expected exactly one quoted layer token besides the key/value, got ${JSON.stringify(leftovers)}`,
    );
  }

  const pathMatch = /([~A-Za-z0-9_./-]+\.json)/.exec(line);
  if (pathMatch === null) {
    throw new Error(`dismiss affordance no longer names a .json config file: ${line}`);
  }

  return { displayPath: pathMatch[1], layer: leftovers[0], configKey, signal };
}

/**
 * Resolve the `~`-prefixed path the affordance displays into the real file, using
 * the SAME FABRIC_HOME convention config-cache.cjs#readGlobalConfig uses
 * (FABRIC_HOME is a $HOME stand-in, so `.fabric` is always appended). Anything
 * without `~` is treated as repo-relative, which is what the old — broken —
 * wording rendered.
 */
function resolveDisplayPath(root: string, displayPath: string): string {
  if (displayPath.startsWith("~/")) {
    return join(process.env.FABRIC_HOME ?? homedir(), displayPath.slice(2));
  }
  return join(root, displayPath);
}

/** Do literally what the rendered line says, on a config that may already exist. */
function followsTheRenderedInstruction(root: string, parsed: ParsedAffordance): string {
  const target = resolveDisplayPath(root, parsed.displayPath);
  let body: Record<string, unknown> = {};
  if (existsSync(target)) {
    body = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
  }
  const layer = (body[parsed.layer] as Record<string, unknown> | undefined) ?? {};
  layer[parsed.configKey] = [parsed.signal];
  body[parsed.layer] = layer;
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, JSON.stringify(body), "utf8");
  configCache.clearConfigCache();
  return target;
}

// ---------------------------------------------------------------------------
// 1. the headline round-trip: following the printed instruction actually works
// ---------------------------------------------------------------------------

describe("hint_dismiss_signals — following the rendered instruction silences the nudge", () => {
  it("archive_backlog: the affordance names the file its own reader consults", () => {
    // Positive control FIRST (KT-PIT-0062: a layered-config case that never
    // fired in the first place is a false green). nudge_mode verbose opts into
    // the human sink so the affordance line is actually rendered.
    writeGlobalConfig({ uid: "test-uid", stores: [], defaults: { nudge_mode: "verbose" } });
    const firing = makeRoot();
    seedBacklogTrigger(firing);
    const before = runHook(firing);
    expect(before).toHaveLength(1);
    const envelope = JSON.parse(before[0]) as { decision?: string; systemMessage?: string };
    expect(envelope.decision).toBeUndefined(); // soft, never block (KT-DEC-0007)

    // The affordance the user is shown, verbatim — asserted to be IN the emitted
    // nudge, so parsing it below is parsing what the user really reads.
    const affordance = hook.renderDismissOption("archive_backlog", "en");
    expect(envelope.systemMessage).toContain(affordance.trim());

    const parsed = parseAffordance(affordance);
    expect(parsed.configKey).toBe("hint_dismiss_signals");
    expect(parsed.signal).toBe("archive_backlog");

    // Now do exactly what it says — and land in a fresh root so the cooldown
    // sidecar written by the positive control cannot fake the silence.
    const written = followsTheRenderedInstruction(firing, parsed);
    expect(readFileSync(written, "utf8")).toContain("archive_backlog");

    const silenced = makeRoot();
    seedBacklogTrigger(silenced);
    expect(hook.readDismissedSignals(silenced, "live").has("archive_backlog")).toBe(true);
    expect(runHook(silenced)).toEqual([]);
  });

  it("the same round-trip holds for the zh-CN wording", () => {
    writeGlobalConfig({ uid: "test-uid", stores: [], defaults: {} });
    const parsed = parseAffordance(hook.renderDismissOption("archive_backlog", "zh-CN"));
    const root = makeRoot();
    seedBacklogTrigger(root);
    followsTheRenderedInstruction(root, parsed);
    expect(runHook(root)).toEqual([]);
  });

  it("every DISMISSABLE_SIGNALS value round-trips through the wording it renders", () => {
    for (const signal of hook.DISMISSABLE_SIGNALS) {
      writeGlobalConfig({ uid: "test-uid", stores: [], defaults: {} });
      const root = makeRoot();
      const parsed = parseAffordance(hook.renderDismissOption(signal, "en"));
      expect(parsed.signal).toBe(signal);
      followsTheRenderedInstruction(root, parsed);
      expect(hook.readDismissedSignals(root, null).has(signal)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. one key, one home — the repo file must stay inert (config-single-home W3)
// ---------------------------------------------------------------------------

describe("hint_dismiss_signals — single home (config-single-home W3 / KT-MOD-0004)", () => {
  it("the repo fabric-config.json is inert for this key, so the wording must not name it", () => {
    writeGlobalConfig({ uid: "test-uid", stores: [], defaults: { nudge_mode: "verbose" } });
    const root = makeRoot();
    seedBacklogTrigger(root);
    // The pre-fix instruction, executed faithfully.
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        project_id: PROJECT_ID,
        fabric_language: "en",
        hint_dismiss_signals: ["archive_backlog"],
      }),
      "utf8",
    );
    configCache.clearConfigCache();

    expect(hook.readDismissedSignals(root, null).has("archive_backlog")).toBe(false);
    expect(runHook(root)).toHaveLength(1); // still fires — the repo copy does nothing
    // …which is precisely why the affordance may not point there.
    expect(hook.renderDismissOption("archive_backlog", "en")).not.toContain("fabric-config.json");
    expect(hook.renderDismissOption("archive_backlog", "zh-CN")).not.toContain("fabric-config.json");
  });

  it("all four dismiss readers resolve the key from the one global policy layer", () => {
    writeGlobalConfig({
      uid: "test-uid",
      stores: [],
      defaults: {
        hint_dismiss_signals: ["archive_backlog", "review", "narrow", "cite-evict"],
      },
    });
    const root = makeRoot();

    // Stop (fabric-hint), SessionStart summary (knowledge-hint-broad),
    // PreToolUse narrow (hint-narrow-config), PreToolUse cite (cite-policy-evict).
    expect(hook.readDismissedSignals(root, null).has("archive_backlog")).toBe(true);
    expect(knowledgeHintBroad.readDismissedSummarySignals(root).has("review")).toBe(true);
    expect(hintNarrowConfig.readNarrowDismissed(root)).toBe(true);
    expect(citePolicyEvict.readCiteEvictDismissed(root)).toBe(true);
  });

  it("no reader is fooled by the same list sitting in the repo config", () => {
    writeGlobalConfig({ uid: "test-uid", stores: [], defaults: {} });
    const root = makeRoot();
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        project_id: PROJECT_ID,
        hint_dismiss_signals: ["archive_backlog", "review", "narrow", "cite-evict"],
      }),
      "utf8",
    );
    configCache.clearConfigCache();

    expect(hook.readDismissedSignals(root, null).size).toBe(0);
    // Was the outlier before this fix: it read the repo file directly, so the
    // SessionStart summary and the Stop nudge disagreed about what "dismissed"
    // meant.
    expect(knowledgeHintBroad.readDismissedSummarySignals(root).size).toBe(0);
    expect(hintNarrowConfig.readNarrowDismissed(root)).toBe(false);
    expect(citePolicyEvict.readCiteEvictDismissed(root)).toBe(false);
  });

  it("projects[<project_id>] overrides defaults, and an empty array means 'dismiss nothing'", () => {
    writeGlobalConfig({
      uid: "test-uid",
      stores: [],
      defaults: { hint_dismiss_signals: ["archive_backlog"] },
      projects: { [PROJECT_ID]: { hint_dismiss_signals: [] } },
    });
    const root = makeRoot();
    seedBacklogTrigger(root);
    expect(hook.readDismissedSignals(root, null).size).toBe(0);
    expect(runHook(root)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. schema ↔ hook parity census — catches the NEXT archive_backlog
// ---------------------------------------------------------------------------

/** Behavioural membership probe: never reaches into zod internals. */
function schemaAccepts(signal: string): boolean {
  return fabricConfigSchema.safeParse({ hint_dismiss_signals: [signal] }).success;
}

/**
 * Every string literal in the hook tree that is tested for membership in
 * `hint_dismiss_signals`, collected from source rather than hand-listed — a
 * hand-listed census is the same drift this test exists to catch.
 */
function censusHookDismissLiterals(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith(".cjs")) continue;
      // Skip the generated zod bundle — it CONTAINS the enum rather than
      // consuming it, so its literals would trivially self-satisfy the parity.
      if (name === "project-context-runtime.cjs") continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/hint_dismiss_signals\.includes\("([^"]+)"\)/g)) {
        found.add(m[1]);
      }
      for (const m of src.matchAll(/const DISMISSABLE_SIGNALS = \[([^\]]*)\]/g)) {
        for (const lit of m[1].matchAll(/"([^"]+)"/g)) found.add(lit[1]);
      }
    }
  };
  walk(HOOKS_DIR);
  return found;
}

describe("hint_dismiss_signals — hook literals ⊆ zod enum", () => {
  it("the schema still rejects unknown signals (guards against a widen-to-string 'fix')", () => {
    expect(schemaAccepts("definitely-not-a-signal")).toBe(false);
  });

  it("accepts every DISMISSABLE_SIGNALS value, including archive_backlog", () => {
    expect(hook.DISMISSABLE_SIGNALS).toContain("archive_backlog");
    for (const signal of hook.DISMISSABLE_SIGNALS) {
      expect({ signal, accepted: schemaAccepts(signal) }).toEqual({ signal, accepted: true });
    }
  });

  it("accepts every dismiss literal found anywhere in the hook tree", () => {
    const census = censusHookDismissLiterals();
    // Sanity-check the scanner itself: if the regexes stop matching, an empty
    // census would make this assertion vacuously true.
    expect(census.size).toBeGreaterThanOrEqual(hook.DISMISSABLE_SIGNALS.length);
    expect(census).toContain("narrow"); // hint-narrow-config.cjs
    expect(census).toContain("cite-evict"); // cite-policy-evict.cjs
    for (const signal of census) {
      expect({ signal, accepted: schemaAccepts(signal) }).toEqual({ signal, accepted: true });
    }
  });

  it("the per-edit surfaces stay enum-only — DISMISSABLE_SIGNALS must not claim them", () => {
    // DISMISSABLE_SIGNALS doubles as the writeSessionDismiss allow-list. "narrow"
    // and "cite-evict" have no session-scoped reader, so listing them there would
    // let a user dismiss-for-this-session into a file nothing consults.
    expect(hook.DISMISSABLE_SIGNALS).not.toContain("narrow");
    expect(hook.DISMISSABLE_SIGNALS).not.toContain("cite-evict");
  });
});

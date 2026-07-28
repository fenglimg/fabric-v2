/**
 * config-single-home W7 — the presentation numbers are DERIVED from nudge_mode.
 *
 * Six keys used to expose them individually (hint_narrow_top_k,
 * hint_narrow_dedup_window_turns, hint_narrow_cooldown_hours,
 * hint_broad_cooldown_hours, hint_summary_max_len, hint_reminder_to_context).
 * They asked the user to spell "be quieter" as six numbers; the volume dial now
 * decides all of them.
 *
 * The load-bearing assertion is the PARITY one: the `normal` preset row must be
 * value-for-value identical to the retired per-key defaults, or a workspace that
 * never touched those keys would silently change behavior on upgrade.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const hookLib = (name: string): string =>
  fileURLToPath(new URL(`../templates/hooks/lib/${name}`, import.meta.url));

const nudgePolicy = require_(hookLib("nudge-policy.cjs")) as {
  NUDGE_PRESETS: Record<
    string,
    {
      narrowTopK: number;
      summaryMaxLen: number;
      broadCooldownHours: number;
      narrowCooldownHours: number;
    }
  >;
  resolveNudgePreset(projectRoot: string): {
    narrowTopK: number;
    summaryMaxLen: number;
    broadCooldownHours: number;
    narrowCooldownHours: number;
  };
};
const narrowConfig = require_(hookLib("hint-narrow-config.cjs")) as {
  readNarrowTopK(root: string): number;
  readNarrowCooldownHours(root: string): number;
  readNarrowDedupWindowTurns(root: string): number;
  readSummaryMaxLen(root: string): number;
  readReminderToContext(root: string): boolean;
};
const configCache = require_(hookLib("config-cache.cjs")) as { clearConfigCache(): void };
const broadHook = require_(
  fileURLToPath(new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url)),
) as {
  readBroadCooldownHours(root: string): number;
  readSummaryMaxLen(root: string): number;
  readReminderToContext(root: string): boolean;
};

/** The per-key defaults that shipped BEFORE the six keys were retired. */
const LEGACY_DEFAULTS = {
  narrowTopK: 5, // hint_narrow_top_k
  summaryMaxLen: 80, // hint_summary_max_len
  broadCooldownHours: 24, // hint_broad_cooldown_hours (ISS-20260713-033)
  narrowCooldownHours: 0, // hint_narrow_cooldown_hours
} as const;

const dirs: string[] = [];
let savedHome: string | undefined;
let savedMode: string | undefined;
let home: string;

function repoWithMode(mode: string | null): string {
  const repo = mkdtempSync(join(tmpdir(), "fab-preset-repo-"));
  dirs.push(repo);
  mkdirSync(join(repo, ".fabric"), { recursive: true });
  writeFileSync(
    join(repo, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: "pr-1" }),
    "utf8",
  );
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({
      uid: "u",
      stores: [],
      ...(mode === null ? {} : { defaults: { nudge_mode: mode } }),
    }),
    "utf8",
  );
  configCache.clearConfigCache();
  return repo;
}

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  savedMode = process.env.FABRIC_NUDGE_MODE;
  delete process.env.FABRIC_NUDGE_MODE;
  home = mkdtempSync(join(tmpdir(), "fab-preset-home-"));
  dirs.push(home);
  mkdirSync(join(home, ".fabric"), { recursive: true });
  process.env.FABRIC_HOME = home;
  configCache.clearConfigCache();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  if (savedMode === undefined) delete process.env.FABRIC_NUDGE_MODE;
  else process.env.FABRIC_NUDGE_MODE = savedMode;
  configCache.clearConfigCache();
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("W7: the `normal` preset preserves the retired per-key defaults", () => {
  it("matches the legacy defaults value-for-value", () => {
    expect(nudgePolicy.NUDGE_PRESETS.normal).toEqual(LEGACY_DEFAULTS);
  });

  it("a workspace with no nudge_mode set resolves the legacy numbers", () => {
    const repo = repoWithMode(null);
    expect(narrowConfig.readNarrowTopK(repo)).toBe(LEGACY_DEFAULTS.narrowTopK);
    expect(narrowConfig.readSummaryMaxLen(repo)).toBe(LEGACY_DEFAULTS.summaryMaxLen);
    expect(narrowConfig.readNarrowCooldownHours(repo)).toBe(LEGACY_DEFAULTS.narrowCooldownHours);
    expect(broadHook.readBroadCooldownHours(repo)).toBe(LEGACY_DEFAULTS.broadCooldownHours);
  });
});

describe("W7: nudge_mode drives every presentation number", () => {
  it("verbose widens the hint and drops the cooldowns", () => {
    const repo = repoWithMode("verbose");
    expect(narrowConfig.readNarrowTopK(repo)).toBe(8);
    expect(narrowConfig.readSummaryMaxLen(repo)).toBe(120);
    expect(broadHook.readBroadCooldownHours(repo)).toBe(0);
    expect(narrowConfig.readNarrowCooldownHours(repo)).toBe(0);
  });

  it("minimal narrows the hint and throttles repeats", () => {
    const repo = repoWithMode("minimal");
    expect(narrowConfig.readNarrowTopK(repo)).toBe(3);
    expect(narrowConfig.readNarrowCooldownHours(repo)).toBe(1);
    expect(broadHook.readBroadCooldownHours(repo)).toBe(24);
  });

  it("silent shares minimal's numbers — it mutes the HUMAN sink, not the AI one", () => {
    // D5 flow ⊥ observation: these numbers also shape the AI payload, so the
    // human-channel mute must not shrink what the model receives.
    expect(nudgePolicy.NUDGE_PRESETS.silent).toEqual(nudgePolicy.NUDGE_PRESETS.minimal);
  });

  it("an unrecognised mode falls back to normal rather than a degenerate row", () => {
    const repo = repoWithMode("shouty");
    expect(nudgePolicy.resolveNudgePreset(repo)).toEqual(LEGACY_DEFAULTS);
  });

  it("both hooks agree on the summary length for a given mode", () => {
    const repo = repoWithMode("verbose");
    expect(broadHook.readSummaryMaxLen(repo)).toBe(narrowConfig.readSummaryMaxLen(repo));
  });
});

describe("W7: the two non-derived knobs are fixed, not configurable", () => {
  it("the AI sink is on in every mode (D5: nudge_mode never touches it)", () => {
    for (const mode of ["silent", "minimal", "normal", "verbose"]) {
      const repo = repoWithMode(mode);
      expect(narrowConfig.readReminderToContext(repo), mode).toBe(true);
      expect(broadHook.readReminderToContext(repo), mode).toBe(true);
    }
  });

  it("the per-file dedup window is a fixed correctness guard", () => {
    for (const mode of ["silent", "verbose"]) {
      expect(narrowConfig.readNarrowDedupWindowTurns(repoWithMode(mode))).toBe(5);
    }
  });

  it("a stale on-disk value for a retired key has no effect", () => {
    const repo = repoWithMode("normal");
    // Someone's old config still carries the key — it must be inert, not honored.
    writeFileSync(
      join(home, ".fabric", "fabric-global.json"),
      JSON.stringify({
        uid: "u",
        stores: [],
        defaults: { nudge_mode: "normal", hint_narrow_top_k: 19, hint_summary_max_len: 240 },
      }),
      "utf8",
    );
    configCache.clearConfigCache();
    expect(narrowConfig.readNarrowTopK(repo)).toBe(LEGACY_DEFAULTS.narrowTopK);
    expect(narrowConfig.readSummaryMaxLen(repo)).toBe(LEGACY_DEFAULTS.summaryMaxLen);
  });
});

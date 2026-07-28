/**
 * config-single-home W3: hook-side PREFERENCE knobs resolve from the global
 * policy layer only.
 *
 *   global.projects[<project_id>] > global.defaults > built-in default
 *
 * The repo's fabric-config.json is identity-only — a policy key left in it is
 * inert, exactly as on the server side, so a knob can never "work in the hook but
 * not in recall" (or vice versa).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const configCache = require("../templates/hooks/lib/config-cache.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hintConfig = require("../templates/hooks/lib/hint-config.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hintNarrowConfig = require("../templates/hooks/lib/hint-narrow-config.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const citePolicy = require("../templates/hooks/cite-policy-evict.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const nudgePolicy = require("../templates/hooks/lib/nudge-policy.cjs");

const PROJECT_ID = "machine-global-fixture-project";

let tempDirs: string[] = [];
let projectRoot: string;
let homeRoot: string;
let originalFabricHome: string | undefined;
let originalNudgeMode: string | undefined;

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** The repo file — IDENTITY ONLY. `extra` exercises the "inert leftovers" contract. */
function writeProjectConfig(extra: Record<string, unknown> = {}): void {
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: PROJECT_ID, ...extra }),
  );
  configCache.clearConfigCache();
}

/** `<FABRIC_HOME>/.fabric/fabric-global.json` — the policy home. */
function writeGlobalPolicy(policy: {
  defaults?: Record<string, unknown>;
  projects?: Record<string, Record<string, unknown>>;
}): void {
  const dir = join(homeRoot, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "fabric-global.json"),
    JSON.stringify({ uid: "test-uid", stores: [], ...policy }),
  );
  configCache.clearConfigCache();
}

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  originalNudgeMode = process.env.FABRIC_NUDGE_MODE;
  projectRoot = makeTemp("fabric-machine-project-");
  homeRoot = makeTemp("fabric-machine-home-");
  process.env.FABRIC_HOME = homeRoot;
  delete process.env.FABRIC_NUDGE_MODE;
  configCache.clearConfigCache();
  writeProjectConfig();
});

afterEach(() => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  if (originalNudgeMode === undefined) delete process.env.FABRIC_NUDGE_MODE;
  else process.env.FABRIC_NUDGE_MODE = originalNudgeMode;
  configCache.clearConfigCache();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("hook policy layer — projects[id] > defaults > default", () => {
  it("typed getters read the global defaults with validation", () => {
    writeGlobalPolicy({ defaults: { count: 7, enabled: false, label: "global" } });

    expect(configCache.readConfigNumber(projectRoot, "count", 1, { min: 1 })).toBe(7);
    expect(configCache.readConfigBoolean(projectRoot, "enabled", true)).toBe(false);
    expect(configCache.readConfigString(projectRoot, "label", "default")).toBe("global");
  });

  it("an invalid value in the project segment falls through to defaults", () => {
    writeGlobalPolicy({
      defaults: { count: 7, enabled: false, label: "global" },
      projects: { [PROJECT_ID]: { count: -1, enabled: "no", label: "" } },
    });

    expect(configCache.readConfigNumber(projectRoot, "count", 1, { min: 1 })).toBe(7);
    expect(configCache.readConfigBoolean(projectRoot, "enabled", true)).toBe(false);
    expect(configCache.readConfigString(projectRoot, "label", "default")).toBe("global");
  });

  it("a valid project segment beats the defaults", () => {
    writeGlobalPolicy({
      defaults: { count: 7, enabled: false, label: "global" },
      projects: { [PROJECT_ID]: { count: 9, enabled: true, label: "project" } },
    });

    expect(configCache.readConfigNumber(projectRoot, "count", 1, { min: 1 })).toBe(9);
    expect(configCache.readConfigBoolean(projectRoot, "enabled", false)).toBe(true);
    expect(configCache.readConfigString(projectRoot, "label", "default")).toBe("project");
  });

  it("a policy key left in the repo config is inert", () => {
    writeGlobalPolicy({ defaults: {} });
    writeProjectConfig({ count: 42 });
    expect(configCache.readConfigNumber(projectRoot, "count", 1, { min: 1 })).toBe(1);
  });

  it("hint readers inherit the global defaults", () => {
    writeGlobalPolicy({
      defaults: {
        archive_hint_hours: 48,
        archive_hint_cooldown_hours: 6,
        archive_edit_threshold: 30,
      },
    });

    expect(hintConfig.readArchiveHintHours(projectRoot)).toBe(48);
    expect(hintConfig.readCooldownHours(projectRoot)).toBe(6);
    expect(hintConfig.readArchiveEditThreshold(projectRoot)).toBe(30);
  });

  it("hint readers honour a per-project exception", () => {
    writeGlobalPolicy({
      defaults: { archive_hint_cooldown_hours: 6 },
      projects: { [PROJECT_ID]: { archive_hint_cooldown_hours: 2 } },
    });
    expect(hintConfig.readCooldownHours(projectRoot)).toBe(2);
  });

  // config-single-home W7: the narrow hint's presentation numbers are derived
  // from nudge_mode, so what the policy layer carries for them is `nudge_mode`
  // itself — the individual keys are retired and inert.
  it("narrow hint numbers follow the nudge_mode carried by the policy layer", () => {
    writeGlobalPolicy({
      defaults: {
        nudge_mode: "verbose",
        hint_dismiss_signals: ["narrow"],
        // Stale keys from a pre-W7 config — must be ignored, not honored.
        hint_narrow_top_k: 19,
        hint_summary_max_len: 240,
        hint_reminder_to_context: false,
      },
    });

    expect(hintNarrowConfig.readNarrowTopK(projectRoot)).toBe(8);
    expect(hintNarrowConfig.readSummaryMaxLen(projectRoot)).toBe(120);
    expect(hintNarrowConfig.readNarrowCooldownHours(projectRoot)).toBe(0);
    expect(hintNarrowConfig.readNarrowDedupWindowTurns(projectRoot)).toBe(5);
    expect(hintNarrowConfig.readReminderToContext(projectRoot)).toBe(true);
    // hint_dismiss_signals is still a real preference knob and still inherits.
    expect(hintNarrowConfig.readNarrowDismissed(projectRoot)).toBe(true);
  });

  it("a per-project nudge_mode exception outranks the machine-wide one", () => {
    writeGlobalPolicy({
      defaults: { nudge_mode: "verbose", hint_dismiss_signals: ["narrow"] },
      projects: { [PROJECT_ID]: { nudge_mode: "minimal", hint_dismiss_signals: [] } },
    });
    expect(hintNarrowConfig.readNarrowTopK(projectRoot)).toBe(3);
    expect(hintNarrowConfig.readNarrowDismissed(projectRoot)).toBe(false);
  });

  it("cite readers inherit nudge, window, and dismiss settings", () => {
    writeGlobalPolicy({
      defaults: {
        cite_recall_nudge: false,
        cite_recall_window_minutes: 90,
        hint_dismiss_signals: ["cite-evict"],
      },
    });

    expect(citePolicy.readNudgeEnabled(projectRoot)).toBe(false);
    expect(citePolicy.readWindowMinutes(projectRoot)).toBe(90);
    expect(citePolicy.readCiteEvictDismissed(projectRoot)).toBe(true);
  });

  it("cite readers honour per-project exceptions", () => {
    writeGlobalPolicy({
      defaults: {
        cite_recall_nudge: false,
        cite_recall_window_minutes: 90,
        hint_dismiss_signals: ["cite-evict"],
      },
      projects: {
        [PROJECT_ID]: {
          cite_recall_nudge: true,
          cite_recall_window_minutes: 10,
          hint_dismiss_signals: [],
        },
      },
    });
    expect(citePolicy.readNudgeEnabled(projectRoot)).toBe(true);
    expect(citePolicy.readWindowMinutes(projectRoot)).toBe(10);
    expect(citePolicy.readCiteEvictDismissed(projectRoot)).toBe(false);
  });

  it("nudge mode keeps env > projects[id] > defaults > default precedence", () => {
    writeGlobalPolicy({ defaults: { nudge_mode: "minimal" } });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("minimal");

    writeGlobalPolicy({
      defaults: { nudge_mode: "minimal" },
      projects: { [PROJECT_ID]: { nudge_mode: "verbose" } },
    });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("verbose");

    process.env.FABRIC_NUDGE_MODE = "silent";
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("silent");

    delete process.env.FABRIC_NUDGE_MODE;
    writeGlobalPolicy({
      defaults: { nudge_mode: "minimal" },
      projects: { [PROJECT_ID]: { nudge_mode: "invalid" } },
    });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("minimal");
  });
});

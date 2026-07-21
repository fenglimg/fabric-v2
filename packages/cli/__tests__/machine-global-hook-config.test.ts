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

let tempDirs: string[] = [];
let projectRoot: string;
let globalRoot: string;
let originalFabricHome: string | undefined;
let originalNudgeMode: string | undefined;

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeProjectConfig(body: Record<string, unknown>): void {
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(join(projectRoot, ".fabric", "fabric-config.json"), JSON.stringify(body));
  configCache.clearConfigCache();
}

function writeGlobalConfig(body: Record<string, unknown>): void {
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(join(globalRoot, "fabric-global.json"), JSON.stringify(body));
  configCache.clearConfigCache();
}

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  originalNudgeMode = process.env.FABRIC_NUDGE_MODE;
  projectRoot = makeTemp("fabric-machine-project-");
  globalRoot = makeTemp("fabric-machine-global-");
  process.env.FABRIC_HOME = globalRoot;
  delete process.env.FABRIC_NUDGE_MODE;
  configCache.clearConfigCache();
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

describe("machine-global hook config", () => {
  it("shared typed getters use project > global > default with validation", () => {
    writeGlobalConfig({ count: 7, enabled: false, label: "global" });

    expect(
      configCache.readConfigNumber(projectRoot, "count", 1, {
        min: 1,
        globalFallback: true,
      }),
    ).toBe(7);
    expect(
      configCache.readConfigBoolean(projectRoot, "enabled", true, { globalFallback: true }),
    ).toBe(false);
    expect(
      configCache.readConfigString(projectRoot, "label", "default", { globalFallback: true }),
    ).toBe("global");

    writeProjectConfig({ count: -1, enabled: "no", label: "" });
    expect(
      configCache.readConfigNumber(projectRoot, "count", 1, {
        min: 1,
        globalFallback: true,
      }),
    ).toBe(7);
    expect(
      configCache.readConfigBoolean(projectRoot, "enabled", true, { globalFallback: true }),
    ).toBe(false);
    expect(
      configCache.readConfigString(projectRoot, "label", "default", { globalFallback: true }),
    ).toBe("global");

    writeProjectConfig({ count: 9, enabled: true, label: "project" });
    expect(
      configCache.readConfigNumber(projectRoot, "count", 1, {
        min: 1,
        globalFallback: true,
      }),
    ).toBe(9);
    expect(
      configCache.readConfigBoolean(projectRoot, "enabled", false, { globalFallback: true }),
    ).toBe(true);
    expect(
      configCache.readConfigString(projectRoot, "label", "default", { globalFallback: true }),
    ).toBe("project");
  });

  it("hint readers inherit machine-global thresholds", () => {
    writeGlobalConfig({
      archive_hint_hours: 48,
      archive_hint_cooldown_hours: 6,
      archive_edit_threshold: 30,
      underseed_node_threshold: 15,
    });

    expect(hintConfig.readArchiveHintHours(projectRoot)).toBe(48);
    expect(hintConfig.readCooldownHours(projectRoot)).toBe(6);
    expect(hintConfig.readArchiveEditThreshold(projectRoot)).toBe(30);
    expect(hintConfig.readUnderseedThreshold(projectRoot)).toBe(15);

    writeProjectConfig({ archive_hint_cooldown_hours: 2 });
    expect(hintConfig.readCooldownHours(projectRoot)).toBe(2);
  });

  it("narrow hint readers inherit every machine-global behavior knob", () => {
    writeGlobalConfig({
      hint_narrow_top_k: 8,
      hint_narrow_dedup_window_turns: 12,
      hint_narrow_cooldown_hours: 4,
      hint_dismiss_signals: ["narrow"],
      hint_reminder_to_context: false,
      hint_summary_max_len: 120,
    });

    expect(hintNarrowConfig.readNarrowTopK(projectRoot)).toBe(8);
    expect(hintNarrowConfig.readNarrowDedupWindowTurns(projectRoot)).toBe(12);
    expect(hintNarrowConfig.readNarrowCooldownHours(projectRoot)).toBe(4);
    expect(hintNarrowConfig.readNarrowDismissed(projectRoot)).toBe(true);
    expect(hintNarrowConfig.readReminderToContext(projectRoot)).toBe(false);
    expect(hintNarrowConfig.readSummaryMaxLen(projectRoot)).toBe(120);

    writeProjectConfig({ hint_narrow_top_k: 3, hint_dismiss_signals: [] });
    expect(hintNarrowConfig.readNarrowTopK(projectRoot)).toBe(3);
    expect(hintNarrowConfig.readNarrowDismissed(projectRoot)).toBe(false);
  });

  it("cite readers inherit machine-global nudge, window, and dismiss settings", () => {
    writeGlobalConfig({
      cite_recall_nudge: false,
      cite_recall_window_minutes: 90,
      hint_dismiss_signals: ["cite-evict"],
    });

    expect(citePolicy.readNudgeEnabled(projectRoot)).toBe(false);
    expect(citePolicy.readWindowMinutes(projectRoot)).toBe(90);
    expect(citePolicy.readCiteEvictDismissed(projectRoot)).toBe(true);

    writeProjectConfig({
      cite_recall_nudge: true,
      cite_recall_window_minutes: 10,
      hint_dismiss_signals: [],
    });
    expect(citePolicy.readNudgeEnabled(projectRoot)).toBe(true);
    expect(citePolicy.readWindowMinutes(projectRoot)).toBe(10);
    expect(citePolicy.readCiteEvictDismissed(projectRoot)).toBe(false);
  });

  it("nudge mode keeps env > project > global > default precedence", () => {
    writeGlobalConfig({ nudge_mode: "minimal" });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("minimal");

    writeProjectConfig({ nudge_mode: "verbose" });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("verbose");

    process.env.FABRIC_NUDGE_MODE = "silent";
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("silent");

    delete process.env.FABRIC_NUDGE_MODE;
    writeProjectConfig({ nudge_mode: "invalid" });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("minimal");
  });
});

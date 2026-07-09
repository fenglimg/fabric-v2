/**
 * G2 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * 4-layer priority for nudge_mode resolution.
 *
 * Priority (highest → lowest):
 *   1. env `FABRIC_NUDGE_MODE`                   (opt-in ergonomic override)
 *   2. project `.fabric/fabric-config.json`     (per-repo setting)
 *   3. global `~/.fabric/fabric-global.json`    (machine-wide preference)
 *   4. default `"silent"`                        (G1/G2 alignment — human-mute)
 *
 * Rationale: G1 flipped the new-install default to "silent" (AI-only channel).
 * G2 adds env + global layers so a user who wants nudges back can restore them
 * WITHOUT editing every repo's config — either FABRIC_NUDGE_MODE env or a
 * one-shot ~/.fabric/fabric-global.json#nudge_mode: "normal" flips it globally.
 *
 * Never-throw: any layer's read/parse failure degrades silently to the next.
 * Home-dir side-effect: the global-layer test overrides process.env.HOME so
 * os.homedir() returns the tmpdir (hermetic — no user's real ~/.fabric read).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const configCache = require("../templates/hooks/lib/config-cache.cjs") as {
  clearConfigCache: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const nudgePolicy = require("../templates/hooks/lib/nudge-policy.cjs") as {
  readNudgeMode: (root: string) => string;
  DEFAULT_NUDGE_MODE: string;
};

const tempDirs: string[] = [];
let originalHome: string | undefined;
let originalFabricNudgeMode: string | undefined;

beforeEach(() => {
  configCache.clearConfigCache();
  originalHome = process.env.HOME;
  originalFabricNudgeMode = process.env.FABRIC_NUDGE_MODE;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalFabricNudgeMode === undefined) delete process.env.FABRIC_NUDGE_MODE;
  else process.env.FABRIC_NUDGE_MODE = originalFabricNudgeMode;
  configCache.clearConfigCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeProjectRoot(config?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-nudge-4layer-proj-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  if (config !== undefined) {
    writeFileSync(join(dir, ".fabric", "fabric-config.json"), JSON.stringify(config), "utf8");
  }
  return dir;
}

function makeFakeHomeWithGlobal(globalConfig?: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "fab-nudge-4layer-home-"));
  tempDirs.push(home);
  mkdirSync(join(home, ".fabric"), { recursive: true });
  if (globalConfig !== undefined) {
    writeFileSync(
      join(home, ".fabric", "fabric-global.json"),
      JSON.stringify(globalConfig),
      "utf8",
    );
  }
  process.env.HOME = home;
  return home;
}

describe("G2 nudge_mode 4-layer priority", () => {
  // Layer 4 boundary decision (G2 caveat): DEFAULT stays "normal", NOT "silent".
  // The 4-layer resolution DOES flow through; only the hard fallback is kept at
  // "normal" so old installs whose fabric-config.json lacks nudge_mode retain
  // visible SessionStart / PreToolUse hooks. New installs get silent via G1
  // scaffold writing the field. See DEFAULT_NUDGE_MODE JSDoc in nudge-policy.cjs.
  it("Layer 4 (default): no env / no global / no project → 'normal' (boundary preserved)", () => {
    makeFakeHomeWithGlobal(); // fake $HOME with no global config
    const projectRoot = makeProjectRoot(); // no project config
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("normal");
    expect(nudgePolicy.DEFAULT_NUDGE_MODE).toBe("normal");
  });

  it("Layer 3 (global): no env / no project / global='normal' → 'normal'", () => {
    makeFakeHomeWithGlobal({ nudge_mode: "normal" });
    const projectRoot = makeProjectRoot();
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("normal");
  });

  it("Layer 2 (project): no env / project='verbose' > global='normal' → 'verbose'", () => {
    makeFakeHomeWithGlobal({ nudge_mode: "normal" });
    const projectRoot = makeProjectRoot({ nudge_mode: "verbose" });
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("verbose");
  });

  it("Layer 1 (env): env='minimal' > project='verbose' > global='normal' → 'minimal'", () => {
    makeFakeHomeWithGlobal({ nudge_mode: "normal" });
    const projectRoot = makeProjectRoot({ nudge_mode: "verbose" });
    process.env.FABRIC_NUDGE_MODE = "minimal";
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("minimal");
  });

  it("invalid env value falls through to project layer", () => {
    makeFakeHomeWithGlobal();
    const projectRoot = makeProjectRoot({ nudge_mode: "verbose" });
    process.env.FABRIC_NUDGE_MODE = "loud"; // not in NUDGE_MODES
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("verbose");
  });

  it("invalid global value falls through to default (normal — boundary preserved)", () => {
    makeFakeHomeWithGlobal({ nudge_mode: 7 }); // not a string
    const projectRoot = makeProjectRoot();
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("normal");
  });

  it("malformed global JSON does not throw; falls through to default (normal)", () => {
    const home = mkdtempSync(join(tmpdir(), "fab-nudge-4layer-badjson-"));
    tempDirs.push(home);
    mkdirSync(join(home, ".fabric"), { recursive: true });
    writeFileSync(join(home, ".fabric", "fabric-global.json"), "{ not-valid-json", "utf8");
    process.env.HOME = home;
    const projectRoot = makeProjectRoot();
    expect(() => nudgePolicy.readNudgeMode(projectRoot)).not.toThrow();
    expect(nudgePolicy.readNudgeMode(projectRoot)).toBe("normal");
  });
});

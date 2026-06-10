import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectNodeLocale } from "./detect-node-locale.js";
import { resolveFabricLocale } from "./resolve-fabric-locale.js";
import { resolveGlobalLocale } from "./resolve-global-locale.js";

// ---------------------------------------------------------------------------
// resolve-fabric-locale / resolve-global-locale — grill-6fixes (D1).
//
// Language is now a SINGLE machine-wide tone in
// `~/.fabric/fabric-global.json` → `language`. `resolveFabricLocale` ignores
// its `projectRoot` argument and delegates to `resolveGlobalLocale`. Tests
// isolate the global root via FABRIC_HOME and assert RELATIVELY against
// `detectNodeLocale()` for the env-fallback branches so the suite stays
// deterministic regardless of CI's LANG / FAB_LANG.
// ---------------------------------------------------------------------------

function writeGlobalConfig(globalHome: string, body: string): void {
  const dir = path.join(globalHome, ".fabric");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fabric-global.json"), body);
}

describe("resolveGlobalLocale / resolveFabricLocale", () => {
  let tmpHomes: string[] = [];
  let savedFabricHome: string | undefined;

  beforeEach(() => {
    tmpHomes = [];
    savedFabricHome = process.env.FABRIC_HOME;
  });

  afterEach(() => {
    for (const home of tmpHomes) {
      fs.rmSync(home, { recursive: true, force: true });
    }
    if (savedFabricHome === undefined) {
      delete process.env.FABRIC_HOME;
    } else {
      process.env.FABRIC_HOME = savedFabricHome;
    }
    vi.restoreAllMocks();
  });

  function freshGlobalHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-globalloc-"));
    tmpHomes.push(home);
    process.env.FABRIC_HOME = home;
    return home;
  }

  it("returns the global language 'zh-CN' verbatim", () => {
    const home = freshGlobalHome();
    writeGlobalConfig(home, JSON.stringify({ uid: "u-test", language: "zh-CN", stores: [] }));

    expect(resolveGlobalLocale()).toBe("zh-CN");
    // resolveFabricLocale ignores its projectRoot and delegates to the global.
    expect(resolveFabricLocale("/any/project/root")).toBe("zh-CN");
  });

  it("returns the global language 'en' verbatim", () => {
    const home = freshGlobalHome();
    writeGlobalConfig(home, JSON.stringify({ uid: "u-test", language: "en", stores: [] }));

    expect(resolveGlobalLocale()).toBe("en");
    expect(resolveFabricLocale()).toBe("en");
  });

  it("falls back to detectNodeLocale when global config has no language", () => {
    const home = freshGlobalHome();
    writeGlobalConfig(home, JSON.stringify({ uid: "u-test", stores: [] }));

    expect(resolveGlobalLocale()).toBe(detectNodeLocale());
    expect(resolveFabricLocale()).toBe(detectNodeLocale());
  });

  it("falls back to detectNodeLocale when fabric-global.json is missing", () => {
    freshGlobalHome();
    // No fabric-global.json written.

    expect(resolveGlobalLocale()).toBe(detectNodeLocale());
  });

  it("falls back to detectNodeLocale when fabric-global.json is malformed (and does not throw)", () => {
    const home = freshGlobalHome();
    writeGlobalConfig(home, "{ not valid json");

    expect(() => resolveGlobalLocale()).not.toThrow();
    expect(resolveGlobalLocale()).toBe(detectNodeLocale());
  });
});

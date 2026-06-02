import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectNodeLocale } from "./detect-node-locale.js";
import { resolveFabricLocale } from "./resolve-fabric-locale.js";

// ---------------------------------------------------------------------------
// resolve-fabric-locale — runtime locale resolver for projectRoot-aware
// consumers (rc.26 doctor i18n closure, TASK-01).
//
// Tests use a tmpdir fixture (no global state mutation) and assert
// RELATIVELY against `detectNodeLocale()` for the fall-through branches so the
// suite stays deterministic regardless of CI's LANG / FAB_LANG env.
// ---------------------------------------------------------------------------

function makeTmpProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fabric-locale-"));
}

function writeFabricConfig(projectRoot: string, body: string): void {
  const dir = path.join(projectRoot, ".fabric");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fabric-config.json"), body);
}

describe("resolveFabricLocale", () => {
  let tmpRoots: string[] = [];

  beforeEach(() => {
    tmpRoots = [];
  });

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function freshRoot(): string {
    const root = makeTmpProjectRoot();
    tmpRoots.push(root);
    return root;
  }

  it("returns 'zh-CN' when fabric_language is 'zh-CN'", () => {
    const root = freshRoot();
    writeFabricConfig(root, JSON.stringify({ fabric_language: "zh-CN" }));

    expect(resolveFabricLocale(root)).toBe("zh-CN");
  });

  it("returns 'en' when fabric_language is 'en'", () => {
    const root = freshRoot();
    writeFabricConfig(root, JSON.stringify({ fabric_language: "en" }));

    expect(resolveFabricLocale(root)).toBe("en");
  });

  it("returns 'zh-CN' (silently) when fabric_language is 'zh-CN-hybrid' — a valid persistent value, NOT a placeholder", () => {
    const root = freshRoot();
    writeFabricConfig(root, JSON.stringify({ fabric_language: "zh-CN-hybrid" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveFabricLocale(root);

    expect(result).toBe("zh-CN");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns and falls back to detectNodeLocale when fabric_language is 'match-existing'", () => {
    const root = freshRoot();
    writeFabricConfig(
      root,
      JSON.stringify({ fabric_language: "match-existing" }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveFabricLocale(root);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/match-existing/);
    // RELATIVE assertion — env-dependent, but must equal detectNodeLocale's
    // own return for the current process env. Re-invoke to compare.
    expect(result).toBe(detectNodeLocale());
  });

  it("falls back to detectNodeLocale when fabric-config.json is missing", () => {
    const root = freshRoot();
    // No .fabric/ directory at all.

    const result = resolveFabricLocale(root);

    expect(result).toBe(detectNodeLocale());
  });

  it("falls back to detectNodeLocale when fabric-config.json is malformed JSON (and does not throw)", () => {
    const root = freshRoot();
    writeFabricConfig(root, "{ this is not valid json");

    expect(() => resolveFabricLocale(root)).not.toThrow();
    expect(resolveFabricLocale(root)).toBe(detectNodeLocale());
  });
});

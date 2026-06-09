/**
 * v2.0.0-rc.37 NEW-19: unit tests for the shared hook libs
 * (templates/hooks/lib/config-cache.cjs + state-store.cjs).
 *
 * These libs centralise the fabric-config read + .fabric/.cache sidecar I/O
 * that cite-policy-evict + knowledge-hint-broad previously duplicated. Tests
 * pin the never-throw contract (KT-DEC-0007), the typed-getter validation
 * matrix (integer-reject vs floor-truncate), mtime-keyed cache invalidation,
 * and sidecar round-trip + corruption tolerance.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const configCache = require("../templates/hooks/lib/config-cache.cjs") as {
  readConfig: (root: string) => Record<string, unknown>;
  clearConfigCache: () => void;
  readConfigNumber: (
    root: string,
    key: string,
    fallback: number,
    opts?: { min?: number; max?: number; integer?: boolean; floor?: boolean },
  ) => number;
  readConfigBoolean: (root: string, key: string, fallback: boolean) => boolean;
  readConfigString: (root: string, key: string, fallback: string) => string;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const stateStore = require("../templates/hooks/lib/state-store.cjs") as {
  cachePath: (root: string, file: string) => string;
  readJsonState: <T>(root: string, file: string, validate?: (v: unknown) => boolean) => T | null;
  writeJsonState: (root: string, file: string, value: unknown) => boolean;
  readJsonStateAsync: <T>(root: string, file: string, validate?: (v: unknown) => boolean) => Promise<T | null>;
  writeJsonStateAsync: (root: string, file: string, value: unknown) => Promise<boolean>;
  readTextState: (root: string, file: string) => string | null;
  writeTextState: (root: string, file: string, text: string) => boolean;
  readTextStateAsync: (root: string, file: string) => Promise<string | null>;
  writeTextStateAsync: (root: string, file: string, text: string) => Promise<boolean>;
};

let tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  configCache.clearConfigCache();
});

function mkTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rc37-new19-hooklib-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(cwd: string, body: object): void {
  const dir = join(cwd, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fabric-config.json"), JSON.stringify(body));
}

describe("config-cache.cjs", () => {
  it("readConfig returns {} when file absent or corrupt (never throws)", () => {
    const cwd = mkTemp();
    expect(configCache.readConfig(cwd)).toEqual({});
    mkdirSync(join(cwd, ".fabric"), { recursive: true });
    writeFileSync(join(cwd, ".fabric", "fabric-config.json"), "{not json");
    configCache.clearConfigCache();
    expect(configCache.readConfig(cwd)).toEqual({});
  });

  it("readConfigNumber honours min/max range, else fallback", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { n: 5 });
    expect(configCache.readConfigNumber(cwd, "n", 99, { min: 1, max: 10 })).toBe(5);
    configCache.clearConfigCache();
    writeConfig(cwd, { n: 50 });
    expect(configCache.readConfigNumber(cwd, "n", 99, { min: 1, max: 10 })).toBe(99);
  });

  it("integer:true rejects fractional values to fallback (strict)", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { n: 3.14 });
    expect(configCache.readConfigNumber(cwd, "n", 10, { min: 0, integer: true })).toBe(10);
  });

  it("floor:true truncates fractional values (lenient)", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { n: 3.99 });
    expect(configCache.readConfigNumber(cwd, "n", 0, { min: 1, max: 50, floor: true })).toBe(3);
  });

  it("readConfigBoolean / readConfigString validate type", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { b: true, s: "hello", bad: 1 });
    expect(configCache.readConfigBoolean(cwd, "b", false)).toBe(true);
    expect(configCache.readConfigBoolean(cwd, "bad", false)).toBe(false);
    expect(configCache.readConfigString(cwd, "s", "x")).toBe("hello");
    expect(configCache.readConfigString(cwd, "missing", "x")).toBe("x");
  });

  it("mtime-keyed cache invalidates when the config file changes", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { n: 1 });
    expect(configCache.readConfigNumber(cwd, "n", 0, {})).toBe(1);
    // Rewrite with a forced later mtime so the cache key differs.
    const path = join(cwd, ".fabric", "fabric-config.json");
    writeFileSync(path, JSON.stringify({ n: 2 }));
    const later = new Date(Date.now() + 5000);
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    require("node:fs").utimesSync(path, later, later);
    expect(configCache.readConfigNumber(cwd, "n", 0, {})).toBe(2);
  });
});

describe("state-store.cjs", () => {
  it("writeJsonState + readJsonState round-trip under .fabric/.cache/", () => {
    const cwd = mkTemp();
    expect(stateStore.writeJsonState(cwd, "x.json", { a: 1 })).toBe(true);
    expect(stateStore.cachePath(cwd, "x.json")).toBe(join(cwd, ".fabric", ".cache", "x.json"));
    expect(stateStore.readJsonState(cwd, "x.json")).toEqual({ a: 1 });
  });

  it("readJsonState returns null on missing / corrupt / failed-validate", () => {
    const cwd = mkTemp();
    expect(stateStore.readJsonState(cwd, "none.json")).toBeNull();
    mkdirSync(join(cwd, ".fabric", ".cache"), { recursive: true });
    writeFileSync(join(cwd, ".fabric", ".cache", "bad.json"), "{nope");
    expect(stateStore.readJsonState(cwd, "bad.json")).toBeNull();
    stateStore.writeJsonState(cwd, "v.json", { turn: 1 });
    expect(
      stateStore.readJsonState(cwd, "v.json", (v) => (v as { turn: number }).turn > 5),
    ).toBeNull();
  });

  it("writeTextState + readTextState trim round-trip", () => {
    const cwd = mkTemp();
    expect(stateStore.writeTextState(cwd, "ts", "  1700000000000  ")).toBe(true);
    expect(stateStore.readTextState(cwd, "ts")).toBe("1700000000000");
    expect(stateStore.readTextState(cwd, "absent")).toBeNull();
  });

  it("async state helpers preserve never-throw cache semantics", async () => {
    const cwd = mkTemp();
    await expect(stateStore.writeJsonStateAsync(cwd, "async.json", { ok: true })).resolves.toBe(true);
    await expect(stateStore.readJsonStateAsync(cwd, "async.json")).resolves.toEqual({ ok: true });
    await expect(stateStore.writeTextStateAsync(cwd, "async.txt", "  value  ")).resolves.toBe(true);
    await expect(stateStore.readTextStateAsync(cwd, "async.txt")).resolves.toBe("value");
    await expect(stateStore.readJsonStateAsync(cwd, "missing.json")).resolves.toBeNull();
  });
});

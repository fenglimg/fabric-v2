import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

// W4-01 (ISS-016) — sidecar state writes must be atomic (tmp file + rename) so
// a crash or concurrent write can never leave a truncated/garbled cache file.

const require = createRequire(import.meta.url);
// CJS-required fs is the SAME mutable module object state-store.cjs requires,
// so spies installed here intercept its calls (ESM `import * as fs` is frozen).
const fs = require("node:fs") as typeof import("node:fs");
const stateStore = require("../templates/hooks/lib/state-store.cjs") as {
  writeJsonState: (root: string, file: string, value: unknown) => boolean;
  writeJsonStateAsync: (root: string, file: string, value: unknown) => Promise<boolean>;
  readJsonState: (root: string, file: string) => unknown;
  readJsonStateAsync: (root: string, file: string) => Promise<unknown>;
  writeTextState: (root: string, file: string, text: string) => boolean;
  writeTextStateAsync: (root: string, file: string, text: string) => Promise<boolean>;
  readTextState: (root: string, file: string) => string | null;
  readTextStateAsync: (root: string, file: string) => Promise<string | null>;
  cachePath: (root: string, file: string) => string;
};

const dirs: string[] = [];
function root(): string {
  const d = mkdtempSync(join(tmpdir(), "fab-state-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("state-store atomic sidecar writes", () => {
  it("round-trips JSON and text values", () => {
    const r = root();
    expect(stateStore.writeJsonState(r, "c.json", { n: 7 })).toBe(true);
    expect(stateStore.readJsonState(r, "c.json")).toEqual({ n: 7 });
    expect(stateStore.writeTextState(r, "t.txt", "hello")).toBe(true);
    expect(stateStore.readTextState(r, "t.txt")).toBe("hello");
  });

  it("writes via a temp file + rename (no .tmp residue on success)", () => {
    const r = root();
    const renameSpy = vi.spyOn(fs, "renameSync");
    stateStore.writeJsonState(r, "c.json", { a: 1 });
    // rename target must be the final cache path (proves tmp+rename, not direct write)
    expect(renameSpy).toHaveBeenCalled();
    const lastCall = renameSpy.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe(stateStore.cachePath(r, "c.json"));
    const cacheDir = join(r, ".fabric", ".cache");
    expect(readdirSync(cacheDir).some((f) => f.includes(".tmp-"))).toBe(false);
  });

  it("async APIs round-trip through the same cache layout", async () => {
    const r = root();
    await expect(stateStore.writeJsonStateAsync(r, "c.json", { n: 9 })).resolves.toBe(true);
    await expect(stateStore.readJsonStateAsync(r, "c.json")).resolves.toEqual({ n: 9 });
    await expect(stateStore.writeTextStateAsync(r, "t.txt", "hello async")).resolves.toBe(true);
    await expect(stateStore.readTextStateAsync(r, "t.txt")).resolves.toBe("hello async");
  });

  it("async writes clean the temp file when rename fails", async () => {
    const r = root();
    await stateStore.writeJsonStateAsync(r, "c.json", { keep: "old" });
    vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("simulated async rename failure"));
    await expect(stateStore.writeJsonStateAsync(r, "c.json", { keep: "new" })).resolves.toBe(false);
    await expect(stateStore.readJsonStateAsync(r, "c.json")).resolves.toEqual({ keep: "old" });
    const cacheDir = join(r, ".fabric", ".cache");
    expect(readdirSync(cacheDir).some((f) => f.includes(".tmp-"))).toBe(false);
  });

  it("preserves the prior file and cleans the temp file when rename fails", () => {
    const r = root();
    stateStore.writeJsonState(r, "c.json", { keep: "old" });
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated rename failure");
    });
    expect(stateStore.writeJsonState(r, "c.json", { keep: "new" })).toBe(false);
    // original content intact (atomic: target untouched until successful rename)
    expect(stateStore.readJsonState(r, "c.json")).toEqual({ keep: "old" });
    const cacheDir = join(r, ".fabric", ".cache");
    expect(readdirSync(cacheDir).some((f) => f.includes(".tmp-"))).toBe(false);
  });
});

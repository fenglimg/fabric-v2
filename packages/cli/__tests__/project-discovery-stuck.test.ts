/**
 * One directory that never answers must not hang the whole scan.
 *
 * This is its own file because it mocks `readdir`, and a module mock applies to
 * every test beside it. It is worth the extra file: the defect it pins is the
 * one that actually reached a user-facing surface. The console's 扫描本机 button
 * issued a request that NEVER returned — the walk read 19 directories under
 * `$HOME` in milliseconds, entered the 20th, and stopped there at ~0% CPU for as
 * long as it was left running.
 *
 * The whole-walk time budget cannot save this on its own: it is checked between
 * directories, so it never gets to run while the walk is blocked inside one
 * call. Only bounding the individual read does.
 *
 * A mock rather than a real unresponsive path, having tried the latter: a FIFO
 * is the obvious "blocks until a writer appears" fixture, and it is useless here
 * because a FIFO is not a directory, so `isDirectory()` is false and the walk
 * skips it without ever reading it. That version of this test passed while
 * exercising nothing (`stuckDirs` was 0).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HANG_MARKER = "never-answers";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: (path: Parameters<typeof actual.readdir>[0], ...rest: unknown[]) => {
      // A promise that is never settled — the shape of the real failure. Not a
      // rejection and not a slow resolve: the call simply does not come back.
      if (String(path).includes(HANG_MARKER)) return new Promise(() => undefined);
      return (actual.readdir as (...a: unknown[]) => unknown)(path, ...rest);
    },
  };
});

const { discoverFabricProjects } = await import("../src/store/project-discovery.js");

let home: string;
let globalRoot: string;
let originalFabricHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fabric-stuck-"));
  globalRoot = join(home, ".fabric");
  mkdirSync(globalRoot, { recursive: true });
  originalFabricHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = home;
});

afterEach(() => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  rmSync(home, { recursive: true, force: true });
});

function project(rel: string, id: string): string {
  const root = join(home, ...rel.split("/"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify({ project_id: id }));
  return root;
}

describe("a directory that never answers", () => {
  it("is skipped, counted, and does not stop the walk", async () => {
    mkdirSync(join(home, HANG_MARKER), { recursive: true });
    const sibling = project("code/reachable", "p-reachable");

    const result = await discoverFabricProjects({
      roots: [home],
      globalRoot,
      maxDirMs: 100,
    });

    // The three things that matter, in order of how badly their absence hurt:
    // it returned at all; the rest of the disk was still searched; and the user
    // is told the result is incomplete rather than being handed a short list
    // presented as the whole truth.
    expect(result.projects.map((p) => p.path)).toEqual([sibling]);
    expect(result.stuckDirs).toBe(1);
    expect(result.stoppedBy).toBeNull();
  });

  it("keeps the per-read budget under the whole-walk budget", async () => {
    // Two stuck directories with a 100ms read budget is 200ms of waiting, which
    // must not be allowed to overrun a 50ms walk budget. Without the min() the
    // per-read ceiling silently becomes the real deadline, and the bound the
    // caller asked for is not the bound it gets.
    mkdirSync(join(home, `${HANG_MARKER}-a`), { recursive: true });
    mkdirSync(join(home, `${HANG_MARKER}-b`), { recursive: true });

    const started = Date.now();
    const result = await discoverFabricProjects({
      roots: [home],
      globalRoot,
      maxMs: 50,
      maxDirMs: 5_000,
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.stoppedBy).toBe("time");
  });
});

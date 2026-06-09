import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

// v2.1.0-rc.1 P4 — hook-side bindings-snapshot reader (F4/S63). Hooks read ONLY
// the CLI-pre-generated snapshot, never re-resolving / walking .fabric. Missing
// or malformed → harmless degrade (KT-DEC-0007, never block).

const require = createRequire(import.meta.url);
const lib = require(
  fileURLToPath(new URL("../templates/hooks/lib/bindings-snapshot-reader.cjs", import.meta.url)),
) as {
  readBindingsSnapshot: (bindingId: string, globalRoot?: string) => unknown;
  formatStoreLabels: (snapshot: unknown) => string;
  bindingsSnapshotPath: (bindingId: string, globalRoot?: string) => string;
};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];

function writeSnapshot(globalRoot: string, snapshot: unknown): void {
  const path = lib.bindingsSnapshotPath(PROJECT_ID, globalRoot);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot), "utf8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmpGlobalRoot(): string {
  const home = mkdtempSync(join(tmpdir(), "fabric-snap-reader-"));
  dirs.push(home);
  return join(home, ".fabric");
}

describe("bindings-snapshot-reader.cjs (hook reads CLI snapshot, not .fabric)", () => {
  const SNAPSHOT = {
    version: 1,
    project_id: PROJECT_ID,
    generated_at: "2026-05-30T00:00:00.000Z",
    read_set: {
      stores: [
        { store_uuid: "p", alias: "personal", writable: true },
        { store_uuid: "t", alias: "team", writable: true },
        { store_uuid: "r", alias: "readonly-ext", writable: false },
      ],
      warnings: [],
    },
    write_target: { store_uuid: "t", alias: "team" },
  };

  it("reads a written snapshot back", () => {
    const globalRoot = tmpGlobalRoot();
    writeSnapshot(globalRoot, SNAPSHOT);
    const snap = lib.readBindingsSnapshot(PROJECT_ID, globalRoot) as { project_id: string };
    expect(snap?.project_id).toBe(PROJECT_ID);
  });

  it("formats per-store labels with the write target and read-only flagged (F4)", () => {
    const label = lib.formatStoreLabels(SNAPSHOT);
    expect(label).toContain("personal");
    expect(label).toContain("team (write)");
    expect(label).toContain("readonly-ext (ro)");
  });

  it("degrades to null on a missing snapshot (never blocks)", () => {
    expect(lib.readBindingsSnapshot(PROJECT_ID, tmpGlobalRoot())).toBeNull();
  });

  it("degrades to null on a malformed snapshot file", () => {
    const globalRoot = tmpGlobalRoot();
    const path = lib.bindingsSnapshotPath(PROJECT_ID, globalRoot);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");
    expect(lib.readBindingsSnapshot(PROJECT_ID, globalRoot)).toBeNull();
  });

  it("empty label string when snapshot is null/shapeless (silent degrade)", () => {
    expect(lib.formatStoreLabels(null)).toBe("");
    expect(lib.formatStoreLabels({})).toBe("");
  });
});

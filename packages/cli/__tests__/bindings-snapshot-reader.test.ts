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
  liveKnowledgeStats: (
    snapshot: unknown,
  ) => { pendingCount: number; canonicalCount: number; oldestPendingMtimeMs: number | null } | null;
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

// Seed a store ROOT dir with `canonical` canonical *.md files (spread across the
// 5 type dirs) and `pending` pending *.md files; return the store root path.
function seedStoreDir(globalRoot: string, name: string, canonical: number, pending: number): string {
  const root = join(globalRoot, "stores", name);
  const types = ["decisions", "pitfalls", "guidelines", "models", "processes"];
  for (let i = 0; i < canonical; i++) {
    const typeDir = join(root, "knowledge", types[i % types.length]);
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, `K-${i}.md`), "# node\n", "utf8");
  }
  const pendingDir = join(root, "knowledge", "pending", "decisions");
  if (pending > 0) mkdirSync(pendingDir, { recursive: true });
  for (let i = 0; i < pending; i++) {
    writeFileSync(join(pendingDir, `p-${i}.md`), "# pending\n", "utf8");
  }
  return root;
}

describe("liveKnowledgeStats (recount live, never trust the stale cached projection)", () => {
  it("recounts live off knowledge_store_dirs, ignoring the stale cached counts (KT-PIT-0017 root cure)", () => {
    // The defect scenario: store grew 1 → 57 nodes out-of-band; the cached
    // knowledge_stats is frozen at the install-time count of 1, which mis-fires
    // the underseed "knowledge sparse" nudge. Live walk must return the truth.
    const globalRoot = tmpGlobalRoot();
    const storeRoot = seedStoreDir(globalRoot, "team-kb", 57, 0);
    const live = lib.liveKnowledgeStats({
      knowledge_stats: { pending_count: 19, canonical_count: 1, oldest_pending_mtime_ms: 123 },
      knowledge_store_dirs: [storeRoot],
    });
    expect(live?.canonicalCount).toBe(57);
    // pending审完 → no pending files on disk → live pending is 0, NOT the cached 19.
    expect(live?.pendingCount).toBe(0);
    expect(live?.oldestPendingMtimeMs).toBeNull();
  });

  it("sums canonical + pending across multiple store dirs", () => {
    const globalRoot = tmpGlobalRoot();
    const a = seedStoreDir(globalRoot, "store-a", 4, 2);
    const b = seedStoreDir(globalRoot, "store-b", 3, 1);
    const live = lib.liveKnowledgeStats({ knowledge_store_dirs: [a, b] });
    expect(live?.canonicalCount).toBe(7);
    expect(live?.pendingCount).toBe(3);
    expect(typeof live?.oldestPendingMtimeMs).toBe("number");
  });

  it("returns null (undeterminable) when knowledge_store_dirs is absent, NEVER trusting the stale cached stats (#3)", () => {
    // GH #3: the cached knowledge_stats projection freezes at snapshot-write
    // time and goes stale out-of-band (store grew via git pull / cross-workspace
    // sync). Trusting it re-introduced the false "knowledge sparse" underseed
    // nudge (observed canonical frozen at 1 vs 61 live). With no store dirs there
    // is no way to recount live (read_set carries alias/uuid only, not a root),
    // so the lean fix is to return null → callers SKIP the nudge rather than act
    // on stale data; the snapshot self-heals on the next install/sync.
    const live = lib.liveKnowledgeStats({
      knowledge_stats: { pending_count: 5, canonical_count: 12, oldest_pending_mtime_ms: 999 },
    });
    expect(live).toBeNull();
  });

  it("returns zero counts when dirs are present but empty (missing dirs degrade silently)", () => {
    const globalRoot = tmpGlobalRoot();
    const live = lib.liveKnowledgeStats({ knowledge_store_dirs: [join(globalRoot, "stores", "nope")] });
    expect(live).toEqual({ pendingCount: 0, canonicalCount: 0, oldestPendingMtimeMs: null });
  });

  it("returns null when neither dirs nor cached stats are available", () => {
    expect(lib.liveKnowledgeStats({})).toBeNull();
    expect(lib.liveKnowledgeStats(null)).toBeNull();
  });
});

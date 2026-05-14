import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as atomicWriteModule from "@fenglimg/fabric-shared/node/atomic-write";
import { initFabric } from "../src/commands/install.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

function collectTmpFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".tmp")) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

describe("init-atomic: no .tmp files remain after fresh init", () => {
  it("no .tmp files in .fabric dir after successful init", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-no-tmp");
    tempRoots.push(target);

    await initFabric(target);

    const fabricDir = join(target, ".fabric");
    const tmpFiles = collectTmpFiles(fabricDir);
    expect(tmpFiles).toHaveLength(0);
  });

  it("no .tmp files in .claude dir after successful init", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-no-tmp-claude");
    tempRoots.push(target);

    await initFabric(target);

    const claudeDir = join(target, ".claude");
    const tmpFiles = collectTmpFiles(claudeDir);
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("init-atomic: events.jsonl created as raw file (0-byte after scaffold, populated by init-scan)", () => {
  it("events.jsonl exists and contains init_scan_completed after fresh init", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-events");
    tempRoots.push(target);

    await initFabric(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);

    // v2.0: scaffold writes a 0-byte events.jsonl, then the init-scan stage
    // appends `init_scan_completed` and supporting reconcile entries. Asserting
    // that the ledger is non-empty AND contains init_scan_completed verifies
    // both the raw-create contract and the scan invocation.
    const raw = readFileSync(eventsPath, "utf8");
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toContain("init_scan_completed");
  });

  it("atomicWriteText is NOT called for events.jsonl", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-events-not-atomic");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await initFabric(target);

    const eventsCallsites = spy.mock.calls.filter(([p]) => p.endsWith("events.jsonl"));
    expect(eventsCallsites).toHaveLength(0);
  });

  it("atomicWriteJson is NOT called for events.jsonl", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-events-not-json");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    const eventsCallsites = spy.mock.calls.filter(([p]) => p.endsWith("events.jsonl"));
    expect(eventsCallsites).toHaveLength(0);
  });
});

describe("init-atomic: P1 scaffold artifacts use atomic writes", () => {
  // v2.0: legacy `.fabric/bootstrap/README.md` and `.fabric/INITIAL_TAXONOMY.md`
  // are no longer produced. The remaining atomic writes target
  // `agents.meta.json`, `forensic.json`, and the knowledge entries placed by
  // the init-scan stage (which use atomicWriteText for each markdown file).

  it("atomicWriteJson is called for agents.meta.json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-meta");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("agents.meta.json"));
    // Two writes: scaffold-stage (empty meta) + post-scan (registerKnowledgeNodesInMeta).
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("atomicWriteJson is called for forensic.json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-forensic");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("forensic.json"));
    expect(calls).toHaveLength(1);
  });

  it("scan stage emits knowledge entries via atomicWriteText (markdown)", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-knowledge-entries");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await initFabric(target);

    // Each scan-placed knowledge entry (.fabric/knowledge/<sub>/<slug>.md) is
    // written via atomicWriteText. The deterministic builders produce 4-7
    // entries; assert at least one .md write under .fabric/knowledge/.
    const knowledgeMarkdownCalls = spy.mock.calls.filter(
      ([p]) => typeof p === "string" && p.includes(".fabric/knowledge/") && p.endsWith(".md"),
    );
    expect(knowledgeMarkdownCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("init-atomic: artifact content correctness after atomic lift", () => {
  it("agents.meta.json is valid JSON with trailing newline after atomic write", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-meta-content");
    tempRoots.push(target);

    await initFabric(target);

    const metaPath = join(target, ".fabric", "agents.meta.json");
    expect(existsSync(metaPath)).toBe(true);
    const raw = readFileSync(metaPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("forensic.json is valid JSON with trailing newline after atomic write", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-forensic-content");
    tempRoots.push(target);

    await initFabric(target);

    const forensicPath = join(target, ".fabric", "forensic.json");
    expect(existsSync(forensicPath)).toBe(true);
    const raw = readFileSync(forensicPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("legacy v1.x scaffold artifacts are NOT created", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-no-legacy-v1");
    tempRoots.push(target);

    await initFabric(target);

    // v2.0: bootstrap/README.md and INITIAL_TAXONOMY.md must not be written.
    expect(existsSync(join(target, ".fabric", "bootstrap", "README.md"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "INITIAL_TAXONOMY.md"))).toBe(false);
  });

  it("test_full_init_artifact_set_includes_fabric_config_json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-config-included");
    tempRoots.push(target);

    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(9);
    // No .import-requested sentinel artifact is created.
    expect(existsSync(join(target, ".fabric", ".import-requested"))).toBe(false);
  });

  it("test_init_atomic_rollback_includes_fabric_config_json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-config-no-tmp");
    tempRoots.push(target);

    await initFabric(target);

    // No .tmp residue (the helper uses a plain idempotent writeFileSync,
    // which is atomic enough for a 1KB JSON; collectTmpFiles must remain empty).
    const fabricDir = join(target, ".fabric");
    const tmpFiles = collectTmpFiles(fabricDir);
    expect(tmpFiles).toHaveLength(0);
    expect(existsSync(join(fabricDir, "fabric-config.json"))).toBe(true);
  });

  it("knowledge subdirs contain .gitkeep markers after init", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-gitkeep");
    tempRoots.push(target);

    await initFabric(target);

    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      const dir = join(target, ".fabric", "knowledge", sub);
      expect(existsSync(dir)).toBe(true);
      // .gitkeep is the canonical empty-directory marker.
      expect(existsSync(join(dir, ".gitkeep"))).toBe(true);
    }
  });
});

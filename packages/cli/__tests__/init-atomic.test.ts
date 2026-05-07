import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as atomicWriteModule from "@fenglimg/fabric-shared/node/atomic-write";
import { initFabric } from "../src/commands/init.ts";
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

describe("init-atomic: events.jsonl created as raw 0-byte file", () => {
  it("events.jsonl exists and is empty (0 bytes) after fresh init", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-events");
    tempRoots.push(target);

    await initFabric(target);

    const eventsPath = join(target, ".fabric", "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const size = statSync(eventsPath).size;
    expect(size).toBe(0);
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
  it("atomicWriteText is called for bootstrap README", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-readme");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("README.md"));
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("atomicWriteText is called for INITIAL_TAXONOMY.md", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-taxonomy");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("INITIAL_TAXONOMY.md"));
    expect(calls).toHaveLength(1);
  });

  it("atomicWriteJson is called for agents.meta.json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-meta");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("agents.meta.json"));
    expect(calls).toHaveLength(1);
  });

  it("atomicWriteJson is called for forensic.json", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-forensic");
    tempRoots.push(target);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    const calls = spy.mock.calls.filter(([p]) => p.endsWith("forensic.json"));
    expect(calls).toHaveLength(1);
  });

  it("all 4 P1 callsites use atomic: 2 atomicWriteText + 2 atomicWriteJson (from scaffold)", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-all-p1");
    tempRoots.push(target);

    const textSpy = vi.spyOn(atomicWriteModule, "atomicWriteText");
    const jsonSpy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await initFabric(target);

    // atomicWriteText: bootstrap README + INITIAL_TAXONOMY.md
    const textScaffold = textSpy.mock.calls.filter(
      ([p]) => p.endsWith("README.md") || p.endsWith("INITIAL_TAXONOMY.md"),
    );
    expect(textScaffold).toHaveLength(2);

    // atomicWriteJson: agents.meta.json + forensic.json (at minimum)
    const jsonScaffold = jsonSpy.mock.calls.filter(
      ([p]) => p.endsWith("agents.meta.json") || p.endsWith("forensic.json"),
    );
    expect(jsonScaffold).toHaveLength(2);
  });
});

describe("init-atomic: artifact content correctness after atomic lift", () => {
  it("bootstrap README has expected content after atomic write", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-readme-content");
    tempRoots.push(target);

    await initFabric(target);

    const readmePath = join(target, ".fabric", "bootstrap", "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content.endsWith("\n")).toBe(true);
  });

  it("INITIAL_TAXONOMY.md has expected content after atomic write", async () => {
    const target = createWerewolfFixtureRoot("fab-atomic-taxonomy-content");
    tempRoots.push(target);

    await initFabric(target);

    const taxonomyPath = join(target, ".fabric", "INITIAL_TAXONOMY.md");
    expect(existsSync(taxonomyPath)).toBe(true);
    const content = readFileSync(taxonomyPath, "utf8");
    expect(content).toContain("Fabric Initial Taxonomy");
    expect(content.endsWith("\n")).toBe(true);
  });

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
});

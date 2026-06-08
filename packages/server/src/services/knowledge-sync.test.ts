/**
 * knowledge-sync.test.ts — regression coverage for `ensureKnowledgeFresh`.
 *
 * Store-backed cutover: `ensureKnowledgeFresh` is now a compatibility no-op.
 * It must not scan non-store knowledge roots, compare them against the retired
 * co-location agents.meta index, emit drift events, or rewrite metadata.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";
import { ensureKnowledgeFresh, resolveContentRefPath } from "./knowledge-sync.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "knowledge-sync-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ensureKnowledgeFresh — store-only no-op", () => {
  it("does not scan legacy local knowledge or emit drift events", async () => {
    const projectRoot = await createProject("ks-store-noop");
    await seedLegacyLocalKnowledge(projectRoot, "Mutated body that old drift detection would have flagged.");
    await seedRetiredAgentsMeta(projectRoot);
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");

    const report = await ensureKnowledgeFresh(projectRoot);

    expect(report).toEqual({ status: "fresh", events: [], warnings: [] });
    const { events } = await readEventLedger(projectRoot);
    expect(events.filter((e) => e.event_type === "knowledge_drift_detected")).toHaveLength(0);
    expect(events.filter((e) => e.event_type === "meta_reconciled")).toHaveLength(0);
  });

  it("ignores autoHealOnDrift because local reconcile is retired", async () => {
    const projectRoot = await createProject("ks-store-noop-heal");
    await seedLegacyLocalKnowledge(projectRoot, "Another mutated body.");
    await seedRetiredAgentsMeta(projectRoot);
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");

    const report = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });

    expect(report).toEqual({ status: "fresh", events: [], warnings: [] });
    const { events } = await readEventLedger(projectRoot);
    expect(events).toHaveLength(0);
  });

  it("rejects retired non-store content_ref resolution", async () => {
    const projectRoot = await createProject("ks-resolve-retired");

    expect(() => resolveContentRefPath(projectRoot, ".fabric/knowledge/decisions/d1.md")).toThrow(
      /legacy non-store knowledge content_ref resolution is retired/u,
    );
    expect(() => resolveContentRefPath(projectRoot, "~/.fabric/knowledge/decisions/d1.md")).toThrow(
      /legacy non-store knowledge content_ref resolution is retired/u,
    );
  });
});

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  return projectRoot;
}

async function seedLegacyLocalKnowledge(projectRoot: string, body: string): Promise<void> {
  await writeFile(
    join(projectRoot, ".fabric", "knowledge", "decisions", "KT-DEC-0001--legacy.md"),
    `---\nid: KT-DEC-0001\ntype: decisions\nmaturity: verified\nlayer: team\nsummary: Legacy local entry\n---\n# Legacy local entry\n\n${body}\n`,
    "utf8",
  );
}

async function seedRetiredAgentsMeta(projectRoot: string): Promise<void> {
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    JSON.stringify({ revision: "retired-fixture", nodes: {} }, null, 2),
    "utf8",
  );
}

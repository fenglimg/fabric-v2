/**
 * knowledge-sync.test.ts — regression coverage for `ensureKnowledgeFresh`.
 *
 * v2.2 W5 R2 (agents.meta decolo): the `reconcileKnowledge` entry point — and
 * its full `writeKnowledgeMeta`-based co-location rebuild + `autoHealOnDrift`
 * chaining — has been retired (knowledge lives in mounted stores; read paths
 * cut over to the cross-store model). The tests that exercised that path are
 * gone with it.
 *
 * What survives, and is covered here, is `ensureKnowledgeFresh`: the hot-path
 * drift *detector* still wired into the MCP read tools. It compares the
 * on-disk knowledge files against the co-location `agents.meta.json` index and
 * emits a `knowledge_drift_detected` ledger event when they diverge. It does
 * NOT rewrite agents.meta.json (drift repair is retired). `autoHealOnDrift`
 * remains on the input type as a documented no-op for backward compatibility.
 *
 * Real-fs tests; no mocks. Each test isolates FABRIC_HOME to a tempdir so the
 * developer's actual `~/.fabric` cannot pollute results.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";
import { ensureKnowledgeFresh } from "./knowledge-sync.js";
import { sha256 } from "./_shared.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "knowledge-sync-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  // contextCache is module-scoped — invalidate all slots between tests so a
  // stale meta entry from a previous tempdir cannot mask a real read of the
  // new one. file_watch with no projectRoot clears every slot.
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("ensureKnowledgeFresh — drift detection", () => {
  it("detects content drift and emits a knowledge_drift_detected event (does NOT rewrite meta)", async () => {
    const projectRoot = await createProject("ks-drift-detect");

    const relPath = "decisions/d1.md";
    await seedTeamEntry(
      projectRoot,
      relPath,
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Original body.",
    );

    // Seed agents.meta.json directly with a baseline node carrying the hash of
    // the original content. `ensureKnowledgeFresh` reads this index for its
    // drift baseline (its own lightweight JSON reader, not the retired
    // co-location meta builder).
    const original = await readFile(join(projectRoot, ".fabric", "knowledge", relPath), "utf8");
    await seedAgentsMeta(projectRoot, {
      "KT-DEC-0001": {
        stable_id: "KT-DEC-0001",
        content_ref: `.fabric/knowledge/${relPath}`,
        hash: sha256(original),
      },
    });
    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    // Mutate the file body to inject content drift.
    await seedTeamEntry(
      projectRoot,
      relPath,
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Mutated body — drift simulated.",
    );

    const report = await ensureKnowledgeFresh(projectRoot);
    expect(report.status).toBe("reconciled");
    expect(report.events.some((e) => e.type === "rule_content_changed")).toBe(true);

    const { events } = await readEventLedger(projectRoot);
    const driftEvents = events.filter((e) => e.event_type === "knowledge_drift_detected");
    expect(driftEvents.length).toBeGreaterThanOrEqual(1);

    // R2 contract: ensureKnowledgeFresh never rewrites the co-location index —
    // there is no meta_reconciled summary event.
    const reconciledEvents = events.filter((e) => e.event_type === "meta_reconciled");
    expect(reconciledEvents).toHaveLength(0);
  });

  it("returns fresh when on-disk content matches the meta hash", async () => {
    const projectRoot = await createProject("ks-fresh");

    const relPath = "decisions/d1.md";
    await seedTeamEntry(
      projectRoot,
      relPath,
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Stable body.",
    );
    const content = await readFile(join(projectRoot, ".fabric", "knowledge", relPath), "utf8");
    await seedAgentsMeta(projectRoot, {
      "KT-DEC-0001": {
        stable_id: "KT-DEC-0001",
        content_ref: `.fabric/knowledge/${relPath}`,
        hash: sha256(content),
      },
    });

    const report = await ensureKnowledgeFresh(projectRoot);
    expect(report.status).toBe("fresh");
    expect(report.events).toHaveLength(0);
  });

  it("autoHealOnDrift=true is a no-op — still detects drift but never emits a heal summary", async () => {
    // v2.2 W5 R2: the rc.29 BUG-G1 auto-heal chain into reconcileKnowledge is
    // retired. The flag is accepted for backward compat but ignored — no
    // meta_reconciled event is ever emitted.
    const projectRoot = await createProject("ks-drift-noop-heal");

    const relPath = "decisions/d1.md";
    await seedTeamEntry(
      projectRoot,
      relPath,
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Original body.",
    );
    const original = await readFile(join(projectRoot, ".fabric", "knowledge", relPath), "utf8");
    await seedAgentsMeta(projectRoot, {
      "KT-DEC-0001": {
        stable_id: "KT-DEC-0001",
        content_ref: `.fabric/knowledge/${relPath}`,
        hash: sha256(original),
      },
    });
    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    await seedTeamEntry(
      projectRoot,
      relPath,
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Mutated body — heal opt-in ignored.",
    );

    const report = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });
    expect(report.status).toBe("reconciled");

    const { events } = await readEventLedger(projectRoot);
    const driftEvents = events.filter((e) => e.event_type === "knowledge_drift_detected");
    expect(driftEvents.length).toBeGreaterThanOrEqual(1);
    const healSummaryEvents = events.filter((e) => e.event_type === "meta_reconciled");
    expect(healSummaryEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(projectRoot);

  // Minimal v2.0 knowledge layout — the dual-root scan walks these subdirs.
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    await mkdir(join(projectRoot, ".fabric", "knowledge", sub), { recursive: true });
  }
  return projectRoot;
}

type MetaNodeFixture = { stable_id: string; content_ref: string; hash: string };

/**
 * Write a minimal `agents.meta.json` whose `nodes` map carries just the fields
 * `ensureKnowledgeFresh` reads for its drift baseline (stable_id / content_ref
 * / hash). Replaces the retired `writeKnowledgeMeta` seed helper.
 */
async function seedAgentsMeta(
  projectRoot: string,
  nodes: Record<string, MetaNodeFixture>,
): Promise<void> {
  const meta = { revision: "test-fixture-revision", nodes };
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

async function seedTeamEntry(
  projectRoot: string,
  relPath: string,
  id: string,
  type: string,
  maturity: string,
  layer: string,
  body: string,
): Promise<void> {
  const target = join(projectRoot, ".fabric", "knowledge", relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, renderEntry(id, type, maturity, layer, body), "utf8");
}

function renderEntry(
  id: string,
  type: string,
  maturity: string,
  layer: string,
  body: string,
): string {
  return [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    `maturity: ${maturity}`,
    `layer: ${layer}`,
    `summary: Test fixture entry ${id}`,
    "created_at: 2026-05-18T00:00:00Z",
    "---",
    `# ${id}`,
    "",
    body,
    "",
  ].join("\n");
}

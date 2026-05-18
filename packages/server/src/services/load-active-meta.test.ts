/**
 * v2.0.0-rc.22 Scope D T-D1: loadActiveMeta unit tests.
 *
 * Six convergence cases (see TASK-008 convergence.criteria):
 *   1. fresh meta → no auto-heal, auto_healed:false, no event emitted.
 *   2. stale meta → writeKnowledgeMeta runs once + knowledge_meta_auto_healed
 *      event emitted with previous + new hash.
 *   3. strict mode + rebuild failure → throws.
 *   4. graceful mode + rebuild failure → returns degraded:true + error string.
 *   5. caller field forwarded into the emitted event payload.
 *   6. idempotent: second call after first auto-heal is a no-op (meta now
 *      matches derived).
 *
 * Uses the same real-fs / mkdtemp pattern as knowledge-meta-builder.test.ts
 * (no fs mocks). FABRIC_HOME redirects the personal-root scan into an
 * isolated tempdir so dual-root walks stay deterministic.
 *
 * For the rebuild-failure branches (tests 3 + 4) we spy on the
 * knowledge-meta-builder module namespace to inject a thrown error from
 * buildKnowledgeMeta — readAgentsMeta still succeeds against the real
 * on-disk file so the failure is scoped to the rebuild step only.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as knowledgeMetaBuilder from "./knowledge-meta-builder.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { loadActiveMeta, loadActiveMetaOrStale } from "./load-active-meta.js";
import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-lam-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  // Clear the meta-slot cache so the previous test's projectRoot entry
  // does not satisfy a readAgentsMeta call in this test.
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("load-active-meta", () => {
  // -------------------------------------------------------------------------
  // (1) loadActiveMeta_fresh_no_heal
  // -------------------------------------------------------------------------
  it("returns auto_healed:false with no event when on-disk meta matches derived", async () => {
    const projectRoot = await createProject("lam-fresh");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary",
    );
    // Persist a fresh meta — its revision now matches the derived revision.
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const result = await loadActiveMeta(projectRoot);

    expect(result.auto_healed).toBe(false);
    expect(result.meta.revision).toBe(result.previous_revision_hash);
    expect(result.revision_hash).toBe(result.previous_revision_hash);

    const { events } = await readEventLedger(projectRoot);
    expect(events.filter((e) => e.event_type === "knowledge_meta_auto_healed")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (2) loadActiveMeta_stale_heals_and_emits
  // -------------------------------------------------------------------------
  it("heals stale meta in-place and emits knowledge_meta_auto_healed", async () => {
    const projectRoot = await createProject("lam-stale");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary one",
    );
    // Persist baseline meta — capture its revision.
    const baseline = await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    const previousRevision = baseline.meta.revision;

    // Make the on-disk knowledge tree diverge from the persisted meta —
    // add a new file. The persisted meta.revision is now stale.
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/bar.md",
      "summary two",
    );
    contextCache.invalidate("file_watch", projectRoot);

    const writeSpy = vi.spyOn(knowledgeMetaBuilder, "writeKnowledgeMeta");

    const result = await loadActiveMeta(projectRoot, { caller: "getKnowledge" });

    expect(result.auto_healed).toBe(true);
    expect(result.previous_revision_hash).toBe(previousRevision);
    expect(result.revision_hash).not.toBe(previousRevision);
    expect(result.meta.revision).toBe(result.revision_hash);
    expect(writeSpy).toHaveBeenCalledTimes(1);

    const { events } = await readEventLedger(projectRoot);
    const healEvents = events.filter((e) => e.event_type === "knowledge_meta_auto_healed");
    expect(healEvents).toHaveLength(1);
    expect(healEvents[0]).toMatchObject({
      event_type: "knowledge_meta_auto_healed",
      previous_revision_hash: previousRevision,
      revision_hash: result.revision_hash,
      trigger: "read",
      caller: "getKnowledge",
    });
  });

  // -------------------------------------------------------------------------
  // (3) loadActiveMeta_build_failure_strict_throws
  // -------------------------------------------------------------------------
  it("STRICT: propagates buildKnowledgeMeta failure", async () => {
    const projectRoot = await createProject("lam-strict-fail");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary",
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const buildErr = new Error("synthetic rebuild failure");
    vi.spyOn(knowledgeMetaBuilder, "buildKnowledgeMeta").mockRejectedValueOnce(buildErr);

    await expect(loadActiveMeta(projectRoot)).rejects.toThrow("synthetic rebuild failure");

    // No auto-heal event should have been emitted.
    const { events } = await readEventLedger(projectRoot);
    expect(events.filter((e) => e.event_type === "knowledge_meta_auto_healed")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (4) loadActiveMetaOrStale_build_failure_returns_degraded
  // -------------------------------------------------------------------------
  it("GRACEFUL: returns on-disk meta with degraded:true + error on rebuild failure", async () => {
    const projectRoot = await createProject("lam-graceful-fail");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary",
    );
    const baseline = await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    const baselineRevision = baseline.meta.revision;

    const buildErr = new Error("synthetic rebuild failure");
    vi.spyOn(knowledgeMetaBuilder, "buildKnowledgeMeta").mockRejectedValueOnce(buildErr);

    const result = await loadActiveMetaOrStale(projectRoot, { caller: "planContext" });

    expect(result.degraded).toBe(true);
    expect(result.error).toBe("synthetic rebuild failure");
    expect(result.auto_healed).toBe(false);
    expect(result.previous_revision_hash).toBe(baselineRevision);
    expect(result.revision_hash).toBe(baselineRevision);
    expect(result.meta.revision).toBe(baselineRevision);

    // No auto-heal event — heal never happened.
    const { events } = await readEventLedger(projectRoot);
    expect(events.filter((e) => e.event_type === "knowledge_meta_auto_healed")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (5) loadActiveMeta_caller_field_in_event
  // -------------------------------------------------------------------------
  it("forwards opts.caller into the emitted event payload", async () => {
    const projectRoot = await createProject("lam-caller");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary",
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Drift the tree.
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/bar.md",
      "summary two",
    );
    contextCache.invalidate("file_watch", projectRoot);

    await loadActiveMeta(projectRoot, { caller: "extractKnowledge" });

    const { events } = await readEventLedger(projectRoot);
    const healEvents = events.filter((e) => e.event_type === "knowledge_meta_auto_healed");
    expect(healEvents).toHaveLength(1);
    expect(healEvents[0]).toMatchObject({
      event_type: "knowledge_meta_auto_healed",
      trigger: "read",
      caller: "extractKnowledge",
    });

    // Sanity: when no caller is supplied, the field is absent in the parsed
    // event (caller is optional).
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/baz.md",
      "summary three",
    );
    contextCache.invalidate("file_watch", projectRoot);
    await loadActiveMeta(projectRoot);

    const after = await readEventLedger(projectRoot);
    const allHeals = after.events.filter((e) => e.event_type === "knowledge_meta_auto_healed");
    expect(allHeals).toHaveLength(2);
    // The second heal had no caller — the field should be undefined.
    const second = allHeals[1];
    if (second.event_type !== "knowledge_meta_auto_healed") {
      throw new Error("type narrowing");
    }
    expect(second.caller).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // (6) loadActiveMeta_idempotent_after_heal
  // -------------------------------------------------------------------------
  it("is idempotent: second call after auto-heal does not re-heal", async () => {
    const projectRoot = await createProject("lam-idempotent");
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/foo.md",
      "summary",
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Drift.
    await seedKnowledgeFile(
      projectRoot,
      ".fabric/knowledge/decisions/bar.md",
      "summary two",
    );
    contextCache.invalidate("file_watch", projectRoot);

    const first = await loadActiveMeta(projectRoot);
    expect(first.auto_healed).toBe(true);

    // Second call — on-disk meta now matches the derived state.
    const writeSpy = vi.spyOn(knowledgeMetaBuilder, "writeKnowledgeMeta");
    const second = await loadActiveMeta(projectRoot);

    expect(second.auto_healed).toBe(false);
    expect(second.previous_revision_hash).toBe(first.revision_hash);
    expect(second.revision_hash).toBe(first.revision_hash);
    expect(writeSpy).not.toHaveBeenCalled();

    // Exactly one auto-heal event total.
    const { events } = await readEventLedger(projectRoot);
    expect(events.filter((e) => e.event_type === "knowledge_meta_auto_healed")).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(projectRoot);
  return projectRoot;
}

async function seedKnowledgeFile(
  projectRoot: string,
  relativePath: string,
  summary: string,
): Promise<void> {
  const target = join(projectRoot, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  const body = [
    "---",
    `summary: ${summary}`,
    "intent_clues: [test]",
    "tech_stack: [TypeScript]",
    "impact: [Test]",
    "must_read_if: Always",
    "---",
    `# ${summary}`,
    "",
  ].join("\n");
  await writeFile(target, body, "utf8");
}

// Avoid an unused-import warning when tests are scoped down.
void readFile;

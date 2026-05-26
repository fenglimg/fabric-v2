/**
 * knowledge-sync.test.ts — regression coverage for reconcileKnowledge
 * after v2.0.0-rc.22 TASK-014 (Scope E).
 *
 * Two bugs are covered:
 *
 *   1. findRuleFiles team-only scan — pre-fix, personal-layer entries on
 *      disk never reached agents.meta.json via reconcileKnowledge because
 *      the scan only walked `.fabric/knowledge/`.
 *
 *   2. reconcileKnowledge per-file gate suppressing top-level revision
 *      drift writes — pre-fix, `if (events.length > 0)` meant that an
 *      on-disk meta with a stale schema/revision but per-file-hash-matching
 *      content was never repaired by `fabric doctor --fix`.
 *
 * Real-fs tests; no mocks. Each test isolates FABRIC_HOME to a tempdir so
 * the developer's actual `~/.fabric` cannot pollute results.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { contextCache } from "../cache.js";
import { ensureKnowledgeFresh, reconcileKnowledge } from "./knowledge-sync.js";

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

describe("reconcileKnowledge — Scope E (TASK-014)", () => {
  it("reconcile_per_file_drift_still_triggers_write — existing per-file drift path stays green", async () => {
    // Regression guard: the new revision-drift gate must NOT break the
    // pre-existing path where some knowledge file's bytes diverge from
    // its meta entry.
    const projectRoot = await createProject("ks-per-file-drift");
    await seedTeamEntry(
      projectRoot,
      "decisions/team-auth.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Initial team content.",
    );

    // Build the canonical meta from this initial state.
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Now mutate the file's body so its content_hash diverges from the
    // hash persisted in agents.meta.json.
    await seedTeamEntry(
      projectRoot,
      "decisions/team-auth.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Mutated team content — body bytes diverge from meta hash.",
    );

    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    const report = await reconcileKnowledge(projectRoot, { trigger: "doctor" });

    expect(report.status).toBe("reconciled");
    expect(report.events.length).toBeGreaterThan(0);
    expect(report.events.some((e) => e.type === "rule_content_changed")).toBe(true);

    const { events } = await readEventLedger(projectRoot);
    const reconciledEvt = events.find((e) => e.event_type === "meta_reconciled");
    expect(reconciledEvt).toBeDefined();
    // Per-file drift path must NOT set force_write_reason — that is
    // reserved for revision-only writes.
    expect(reconciledEvt).not.toHaveProperty("force_write_reason");
  });

  it("reconcile_force_write_on_revision_drift_only — stale meta + zero per-file drift still writes", async () => {
    // The lock-in case for TASK-014's second defect: a corrupted meta
    // revision must be repaired even when no per-file content drift exists.
    const projectRoot = await createProject("ks-revision-drift");
    await seedTeamEntry(
      projectRoot,
      "decisions/team-auth.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Stable content.",
    );

    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Corrupt only the top-level revision — leave per-file nodes and their
    // hashes untouched so processSingleFile sees zero drift.
    const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw);
    meta.revision = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    contextCache.invalidate("meta_write", projectRoot);

    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    const report = await reconcileKnowledge(projectRoot, { trigger: "doctor" });

    // No per-file events expected — the bytes match — but the report
    // must still report "reconciled" because the revision was repaired.
    expect(report.events).toEqual([]);
    expect(report.status).toBe("reconciled");

    // The on-disk revision must now match what buildKnowledgeMeta produces.
    const repaired = JSON.parse(await readFile(metaPath, "utf8"));
    expect(repaired.revision).not.toBe(
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );

    // Summary event must be emitted with force_write_reason=revision_drift.
    const { events } = await readEventLedger(projectRoot);
    const reconciledEvt = events.find((e) => e.event_type === "meta_reconciled");
    expect(reconciledEvt).toBeDefined();
    expect(reconciledEvt).toMatchObject({
      event_type: "meta_reconciled",
      trigger: "doctor",
      force_write_reason: "revision_drift",
    });
  });

  it("reconcile_indexes_personal_layer_files — KP-* entries on disk reach agents.meta.json", async () => {
    // The lock-in case for TASK-014's first defect: dual-root scan must
    // surface personal-layer entries.
    const projectRoot = await createProject("ks-personal-layer");
    const fakeHome = process.env.FABRIC_HOME!;

    // No team entries at all — make sure the personal-only repo still works.
    await mkdir(join(projectRoot, ".fabric/knowledge/decisions"), { recursive: true });

    // Seed a personal-layer decision entry.
    await seedPersonalEntry(
      fakeHome,
      "decisions/KP-DEC-9999.md",
      "KP-DEC-9999",
      "decisions",
      "draft",
      "personal",
      "Personal-layer decision body.",
    );

    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    // First reconcile — no on-disk meta yet → per-file events get raised
    // for the personal entry (rule_added), forcing the write.
    const report = await reconcileKnowledge(projectRoot, { trigger: "doctor" });

    expect(report.status).toBe("reconciled");

    // Verify the personal entry shows up in agents.meta.json with its
    // personal content_ref prefix.
    const meta = JSON.parse(
      await readFile(join(projectRoot, ".fabric/agents.meta.json"), "utf8"),
    );
    const personalNode = Object.values(meta.nodes as Record<string, { content_ref?: string; stable_id?: string }>).find(
      (n) => n.content_ref === "~/.fabric/knowledge/decisions/KP-DEC-9999.md",
    );
    expect(personalNode).toBeDefined();
    expect(personalNode?.stable_id).toBe("KP-DEC-9999");
  });

  it("reconcile_indexes_team_and_personal_together — mixed-layer repo indexes both layers", async () => {
    const projectRoot = await createProject("ks-team-and-personal");
    const fakeHome = process.env.FABRIC_HOME!;

    await seedTeamEntry(
      projectRoot,
      "decisions/team-jwt.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Team JWT decision.",
    );

    await seedPersonalEntry(
      fakeHome,
      "guidelines/personal-style.md",
      "KP-GLD-0001",
      "guidelines",
      "draft",
      "personal",
      "Personal style guideline.",
    );

    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    await reconcileKnowledge(projectRoot, { trigger: "doctor" });

    const meta = JSON.parse(
      await readFile(join(projectRoot, ".fabric/agents.meta.json"), "utf8"),
    );
    const refs = Object.values(meta.nodes as Record<string, { content_ref?: string }>)
      .map((n) => n.content_ref)
      .filter((r): r is string => typeof r === "string");

    expect(refs).toContain(".fabric/knowledge/decisions/team-jwt.md");
    expect(refs).toContain("~/.fabric/knowledge/guidelines/personal-style.md");
  });

  it("reconcile_idempotent_after_first_run — second invocation is a no-op", async () => {
    // After reconcile converges, a second call must be fresh (no events,
    // no extra writes, no ledger spam). This pins down that revisionDrift
    // detection is symmetric with the write path so we never thrash.
    const projectRoot = await createProject("ks-idempotent");
    const fakeHome = process.env.FABRIC_HOME!;

    await seedTeamEntry(
      projectRoot,
      "decisions/team-jwt.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Team JWT decision.",
    );
    await seedPersonalEntry(
      fakeHome,
      "guidelines/personal-style.md",
      "KP-GLD-0001",
      "guidelines",
      "draft",
      "personal",
      "Personal style guideline.",
    );

    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    // First reconcile — should write.
    await reconcileKnowledge(projectRoot, { trigger: "doctor" });
    const ledgerAfterFirst = (await readEventLedger(projectRoot)).events.length;

    // Second reconcile — same disk state, must be a no-op.
    const second = await reconcileKnowledge(projectRoot, { trigger: "doctor" });
    expect(second.status).toBe("fresh");
    expect(second.events).toEqual([]);

    const ledgerAfterSecond = (await readEventLedger(projectRoot)).events.length;
    expect(ledgerAfterSecond).toBe(ledgerAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.29 TASK-005 (BUG-G1): ensureKnowledgeFresh autoHealOnDrift opt-in
//
// Audit found 5/72 drifts auto-healed on this repo (~7%). Root cause: the
// hot-path detector (`ensureKnowledgeFresh`) emitted `knowledge_drift_detected`
// but never chained a heal — heal only fired when a separate caller invoked
// `reconcileKnowledge` (doctor, startup, plan-context auto-heal-description).
// The new `autoHealOnDrift` flag lets callers opt in to a same-call reconcile
// so every detected drift gets a paired heal event in the same ledger tail
// window. Default off preserves the rc.28 hot-path latency contract.
// ---------------------------------------------------------------------------

describe("ensureKnowledgeFresh autoHealOnDrift (rc.29 BUG-G1)", () => {
  it("default (autoHealOnDrift omitted) detects drift but does NOT emit meta_reconciled — preserves rc.28 hot-path semantics", async () => {
    const projectRoot = await createProject("ks-drift-no-heal");
    const fakeHome = process.env.FABRIC_HOME!;
    void fakeHome; // suppress unused-var

    await seedTeamEntry(
      projectRoot,
      "decisions/d1.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Original body.",
    );
    // Materialize the baseline meta + ledger.
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    // Mutate the file body to inject content drift.
    await writeFile(
      join(projectRoot, ".fabric/knowledge/decisions/d1.md"),
      [
        "---",
        "id: KT-DEC-0001",
        "type: decisions",
        "maturity: verified",
        "layer: team",
        "---",
        "",
        "Mutated body — drift simulated.",
      ].join("\n"),
      "utf8",
    );

    const report = await ensureKnowledgeFresh(projectRoot);
    expect(report.status).toBe("reconciled");

    const { events } = await readEventLedger(projectRoot);
    const driftEvents = events.filter((e) => e.event_type === "knowledge_drift_detected");
    const healSummaryEvents = events.filter(
      (e) =>
        e.event_type === "meta_reconciled" &&
        "trigger" in e &&
        e.trigger === "auto-heal-after-drift",
    );
    expect(driftEvents.length).toBeGreaterThanOrEqual(1);
    expect(healSummaryEvents).toHaveLength(0);
  });

  it("with autoHealOnDrift=true, drift emits a paired meta_reconciled (trigger=auto-heal-after-drift)", async () => {
    const projectRoot = await createProject("ks-drift-with-heal");
    const fakeHome = process.env.FABRIC_HOME!;
    void fakeHome;

    await seedTeamEntry(
      projectRoot,
      "decisions/d1.md",
      "KT-DEC-0001",
      "decisions",
      "verified",
      "team",
      "Original body.",
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    await writeFile(join(projectRoot, ".fabric/events.jsonl"), "", "utf8");

    await writeFile(
      join(projectRoot, ".fabric/knowledge/decisions/d1.md"),
      [
        "---",
        "id: KT-DEC-0001",
        "type: decisions",
        "maturity: verified",
        "layer: team",
        "---",
        "",
        "Mutated body — drift simulated, heal opt-in.",
      ].join("\n"),
      "utf8",
    );

    const report = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });
    expect(report.status).toBe("reconciled");

    const { events } = await readEventLedger(projectRoot);
    const driftEvents = events.filter((e) => e.event_type === "knowledge_drift_detected");
    const healSummaryEvents = events.filter(
      (e) =>
        e.event_type === "meta_reconciled" &&
        "trigger" in e &&
        e.trigger === "auto-heal-after-drift",
    );
    expect(driftEvents.length).toBeGreaterThanOrEqual(1);
    // The structural fix: at least one paired meta_reconciled fires when the
    // caller opts in to heal-after-drift. The earlier 5/72 (~7%) coverage was
    // the audit's symptom of this paired emission being absent.
    expect(healSummaryEvents.length).toBeGreaterThanOrEqual(1);
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

async function seedPersonalEntry(
  fakeHome: string,
  relPath: string,
  id: string,
  type: string,
  maturity: string,
  layer: string,
  body: string,
): Promise<void> {
  const target = join(fakeHome, ".fabric", "knowledge", relPath);
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

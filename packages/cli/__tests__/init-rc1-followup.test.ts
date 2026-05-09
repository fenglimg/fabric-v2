/**
 * v2.0 rc.1 follow-up tests: covers the three post-init `fab doctor` issues
 * fixed in this patch.
 *
 *   Issue 1 (bootstrap_anchor_missing): `fabric init` writes AGENTS.md at the
 *           repo root with idempotent semantics.
 *   Issue 2 (agents_meta_stale): runInitScan produces a revision hash that
 *           matches doctor's recomputation (same algorithm, single owner).
 *   Issue 3 (init_context_missing): doctor check is removed; init-context.json
 *           ownership belongs to the AI-side fabric-init skill, not the CLI.
 *
 * Acceptance: post-init `fab doctor` reports zero errors AND zero warnings.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorReport } from "@fenglimg/fabric-server";
import { initFabric } from "../src/commands/init.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

// -----------------------------------------------------------------------------
// Issue 1 — bootstrap_anchor_missing: AGENTS.md at the repo root
// -----------------------------------------------------------------------------

describe("rc.1 follow-up #1: writes AGENTS.md at the repo root", () => {
  it("writes_agents_md_at_repo_root: a fresh init creates AGENTS.md with default content", async () => {
    const target = createWerewolfFixtureRoot("rc1-agents-md-fresh");
    tempRoots.push(target);

    const result = await initFabric(target);

    const agentsMdPath = join(target, "AGENTS.md");
    expect(existsSync(agentsMdPath)).toBe(true);
    expect(result.agentsMdPath).toBe(agentsMdPath);
    expect(result.agentsMdAction).toBe("created");

    const content = readFileSync(agentsMdPath, "utf8");
    // Sanity-check the minimal default template: heading + Fabric reference +
    // knowledge dir mention. Exact wording is intentionally not pinned so we
    // can iterate on copy without breaking the test.
    expect(content).toMatch(/^# /);
    expect(content).toContain("Fabric");
    expect(content).toContain(".fabric/knowledge/");
    // Must end with a trailing newline (atomic-write convention).
    expect(content.endsWith("\n")).toBe(true);
  });

  it("agents_md_idempotent_on_existing: pre-existing AGENTS.md is preserved verbatim", async () => {
    const target = createWerewolfFixtureRoot("rc1-agents-md-preserve");
    tempRoots.push(target);

    const agentsMdPath = join(target, "AGENTS.md");
    const userContent = "# My Hand-Crafted Project\n\nDo not clobber me.\n";
    writeFileSync(agentsMdPath, userContent, "utf8");
    const userMtimeMs = statSync(agentsMdPath).mtimeMs;

    const result = await initFabric(target);

    expect(result.agentsMdAction).toBe("preserved");
    expect(readFileSync(agentsMdPath, "utf8")).toBe(userContent);
    // mtime should NOT advance because we never touched the file.
    expect(statSync(agentsMdPath).mtimeMs).toBe(userMtimeMs);
  });

  it("agents_md_idempotent_on_existing: even with --force pre-existing AGENTS.md is preserved", async () => {
    const target = createWerewolfFixtureRoot("rc1-agents-md-preserve-force");
    tempRoots.push(target);

    const agentsMdPath = join(target, "AGENTS.md");
    const userContent = "# My File\n\nKeep this through --force.\n";
    writeFileSync(agentsMdPath, userContent, "utf8");

    const result = await initFabric(target, { force: true });

    expect(result.agentsMdAction).toBe("preserved");
    expect(readFileSync(agentsMdPath, "utf8")).toBe(userContent);
  });

  it("agents_md_idempotent_on_rerun: a second init does not rewrite the just-created file", async () => {
    const target = createWerewolfFixtureRoot("rc1-agents-md-rerun");
    tempRoots.push(target);

    const first = await initFabric(target);
    expect(first.agentsMdAction).toBe("created");

    const agentsMdPath = join(target, "AGENTS.md");
    const firstMtimeMs = statSync(agentsMdPath).mtimeMs;
    const firstContent = readFileSync(agentsMdPath, "utf8");

    // Re-run: AGENTS.md exists, so action becomes "preserved" and content
    // must be byte-identical.
    const second = await initFabric(target, { force: true });
    expect(second.agentsMdAction).toBe("preserved");
    expect(readFileSync(agentsMdPath, "utf8")).toBe(firstContent);
    expect(statSync(agentsMdPath).mtimeMs).toBe(firstMtimeMs);
  });
});

// -----------------------------------------------------------------------------
// Issue 2 — agents_meta_stale: revision hash consistency post-init
// -----------------------------------------------------------------------------

describe("rc.1 follow-up #2: runInitScan revision is consistent with doctor recompute", () => {
  it("revision_consistent_after_init: doctor's computedMetaRevision matches the persisted metaRevision", async () => {
    const target = createWerewolfFixtureRoot("rc1-revision-consistent");
    tempRoots.push(target);

    await initFabric(target);

    const report = await runDoctorReport(target);

    // The two revisions are produced by the SAME algorithm
    // (computeRevision in rule-meta-builder.ts). After our reordering of
    // runInitScan (registerKnowledgeNodesInMeta → writeRuleMeta), the
    // persisted revision IS the canonical one.
    expect(report.summary.metaRevision).toBeTruthy();
    expect(report.summary.computedMetaRevision).toBeTruthy();
    expect(report.summary.metaRevision).toBe(report.summary.computedMetaRevision);

    // No agents_meta_stale must surface as a fixable error.
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("agents_meta_stale");
  });
});

// -----------------------------------------------------------------------------
// Issue 3 — init_context_missing check removed
// -----------------------------------------------------------------------------

describe("rc.1 follow-up #3: init_context_missing check is removed", () => {
  it("init_context_check_removed_or_demoted: no doctor check references init-context.json post-init", async () => {
    const target = createWerewolfFixtureRoot("rc1-init-context-removed");
    tempRoots.push(target);

    await initFabric(target);

    const report = await runDoctorReport(target);

    expect(report.checks.find((c) => c.code === "init_context_missing")).toBeUndefined();
    expect(report.checks.find((c) => c.code === "init_context_invalid")).toBeUndefined();
    expect(report.checks.find((c) => c.name === "Init context")).toBeUndefined();
    expect(report.manual_errors.map((e) => e.code)).not.toContain("init_context_missing");
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("init_context_missing");
    expect(report.warnings.map((w) => w.code)).not.toContain("init_context_missing");
    // summary.targetFiles must NOT include init-context.json.
    expect(Object.keys(report.summary.targetFiles)).not.toContain(".fabric/init-context.json");
  });
});

// -----------------------------------------------------------------------------
// Integration — all three fixes together: post_init_doctor_zero_issues
// -----------------------------------------------------------------------------

describe("rc.1 follow-up integration: post-init doctor reports zero issues", () => {
  it("post_init_doctor_zero_issues: errors == 0, manual_errors == 0, warnings == 0, status == 'ok'", async () => {
    const target = createWerewolfFixtureRoot("rc1-zero-issues");
    tempRoots.push(target);

    await initFabric(target);

    const report = await runDoctorReport(target);

    if (report.fixable_errors.length > 0 || report.manual_errors.length > 0 || report.warnings.length > 0) {
      // Surface a friendly, debuggable failure summary.
      throw new Error(
        `Expected zero doctor issues but got ` +
          `fixable=${JSON.stringify(report.fixable_errors.map((e) => e.code))} ` +
          `manual=${JSON.stringify(report.manual_errors.map((e) => e.code))} ` +
          `warnings=${JSON.stringify(report.warnings.map((w) => w.code))}`,
      );
    }

    expect(report.fixable_errors).toEqual([]);
    expect(report.manual_errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.status).toBe("ok");
  });
});

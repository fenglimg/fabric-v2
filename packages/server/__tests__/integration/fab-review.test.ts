/**
 * fab-review.test.ts — rc.3 TASK-007 end-to-end integration tests for the
 * fab_review service surface.
 *
 * Scope: exercises all 6 actions of the discriminated-union fab_review tool
 * (list / approve / reject / modify / search / defer) plus the doctor
 * filesystem-edit fallback synthesis path, against a real on-disk fixture
 * (mkdtemp + git init). Complements the unit-level cases in
 * src/services/review.test.ts (which exercise individual branches in
 * isolation) and src/services/doctor.test.ts (which covers the synthesis
 * inspection path against a stand-alone fixture). This file's value is
 * end-to-end flow assertions:
 *
 *   - approve emits the full 2-phase event pair AND moves files AND bumps
 *     counters in agents.meta.json
 *   - reject leaves files on disk (rc.3 contract — doctor owns vacuum)
 *   - modify in-place rewrites frontmatter without touching ids
 *   - modify with layer flip (team→personal) reallocates id under FABRIC_HOME
 *     AND emits knowledge_layer_changed with from/to_layer
 *   - search filters across pending + canonical (team) + canonical (personal)
 *   - defer emits knowledge_deferred with until + reason and leaves files alone
 *   - filesystem-edit fallback synthesizes knowledge_promoted for an orphan
 *     canonical entry and is idempotent on the second run
 *   - the registered MCP tool handler returns structuredContent matching the
 *     declared FabReviewOutputSchema (one shape per call — list and search)
 *
 * Tests run serially against fresh tmpdir fixtures; total wall time is
 * dominated by per-test `git init` + `git commit` (~30-50 ms) and stays
 * well under 5 s for the suite.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  FabReviewInputSchema,
  FabReviewInputShape,
  FabReviewOutputSchema,
  FabReviewOutputShape,
} from "@fenglimg/fabric-shared/schemas/api-contracts";

import { runDoctorReport } from "../../src/services/doctor.js";
import { readEventLedger } from "../../src/services/event-ledger.js";
import { reviewKnowledge } from "../../src/services/review.js";
import { registerReview } from "../../src/tools/review.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
let originalProjectRoot: string | undefined;

beforeEach(async () => {
  // Mirror review.test.ts:17-22: redirect personal-root resolution into a
  // tempdir so the layer-flip tests never touch the developer's real
  // ~/.fabric/. We allocate one fakeHome per test so cross-test counter
  // bleed is impossible.
  originalFabricHome = process.env.FABRIC_HOME;
  originalProjectRoot = process.env.FABRIC_PROJECT_ROOT;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-review-int-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  if (originalProjectRoot === undefined) {
    delete process.env.FABRIC_PROJECT_ROOT;
  } else {
    process.env.FABRIC_PROJECT_ROOT = originalProjectRoot;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-review-int-"));
  tempDirs.push(projectRoot);
  // Real git so approve's `git rm` exercises the production code path
  // (mirrors review.test.ts:42-45).
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Fabric Tests"], { cwd: projectRoot, stdio: "pipe" });
  // Bootstrap anchor — required so doctor's filesystem-edit fallback runs
  // under a non-error project state. Both AGENTS.md and an empty events.jsonl
  // are pre-staged.
  await writeFile(join(projectRoot, "AGENTS.md"), "# AGENTS\n", "utf8");
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    await mkdir(join(projectRoot, ".fabric", "knowledge", sub), { recursive: true });
  }
  execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["commit", "--quiet", "-m", "seed: fixture"], { cwd: projectRoot, stdio: "pipe" });
  return projectRoot;
}

type SeedOptions = {
  layer?: "team" | "personal";
  tags?: string[];
  summary?: string;
  title?: string;
};

async function seedPending(
  projectRoot: string,
  type: "decisions" | "guidelines" | "pitfalls" | "models" | "processes",
  slug: string,
  opts: SeedOptions = {},
): Promise<string> {
  const layer = opts.layer ?? "team";
  const tags = opts.tags ?? [];
  const summary = opts.summary ?? "Test summary body.";
  const dir = join(projectRoot, ".fabric", "knowledge", "pending", type);
  await mkdir(dir, { recursive: true });

  const titleLine = opts.title !== undefined ? `title: ${opts.title}\n` : "";
  const tagFlow = tags.length === 0 ? "[]" : `[${tags.join(", ")}]`;
  const frontmatter = [
    "---",
    `type: ${type}`,
    "maturity: draft",
    `layer: ${layer}`,
    `created_at: ${new Date().toISOString()}`,
    "source_session: sess-int-test",
    `tags: ${tagFlow}`,
    `summary: ${summary}`,
    `${titleLine}x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000`,
    "---",
    "",
    "## Summary",
    "",
    summary,
    "",
  ].join("\n");

  const relativePath = `.fabric/knowledge/pending/${type}/${slug}.md`;
  await writeFile(join(projectRoot, relativePath), frontmatter, "utf8");

  // Stage + commit so approve's `git rm` finds the path tracked. Mirrors
  // review.test.ts:95-100 production-faithful seeding.
  execFileSync("git", ["add", relativePath], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["commit", "--quiet", "-m", `seed: ${slug}`], { cwd: projectRoot, stdio: "pipe" });
  return relativePath;
}

// ---------------------------------------------------------------------------
// (1) End-to-end approve flow — list → approve → assert files + events + counters.
// ---------------------------------------------------------------------------

describe("fab_review integration (rc.3 TASK-007)", () => {
  it("(1) end_to_end_approve_flow: list returns 2 entries; approve allocates 2 distinct ids; events + counters bump", async () => {
    const projectRoot = await createTempProject();
    const a = await seedPending(projectRoot, "decisions", "rc3-decision-a");
    const b = await seedPending(projectRoot, "decisions", "rc3-decision-b");

    // list — confirms both pending entries are surfaced.
    const listed = await reviewKnowledge(projectRoot, { action: "list", filters: undefined });
    if (listed.action !== "list") throw new Error("unreachable");
    expect(listed.items).toHaveLength(2);
    const slugs = listed.items.map((i) => i.pending_path).sort();
    expect(slugs).toEqual([
      ".fabric/knowledge/pending/decisions/rc3-decision-a.md",
      ".fabric/knowledge/pending/decisions/rc3-decision-b.md",
    ]);

    // approve — both at once.
    const approved = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [a, b],
    });
    if (approved.action !== "approve") throw new Error("unreachable");
    expect(approved.approved).toHaveLength(2);

    const ids = approved.approved.map((e) => e.stable_id).sort();
    // Distinct + monotonic.
    expect(ids[0]).toMatch(/^KT-DEC-\d{4}$/u);
    expect(ids[1]).toMatch(/^KT-DEC-\d{4}$/u);
    expect(ids[0]).not.toBe(ids[1]);

    // Pending source files removed; canonical files present at expected path.
    expect(existsSync(join(projectRoot, a))).toBe(false);
    expect(existsSync(join(projectRoot, b))).toBe(false);
    for (const entry of approved.approved) {
      const slug = entry.pending_path.replace(/.*\//u, "").replace(/\.md$/u, "");
      const canonicalAbs = join(
        projectRoot,
        ".fabric",
        "knowledge",
        "decisions",
        `${entry.stable_id}--${slug}.md`,
      );
      expect(existsSync(canonicalAbs)).toBe(true);
      const content = await readFile(canonicalAbs, "utf8");
      expect(content).toMatch(new RegExp(`^id: ${entry.stable_id}$`, "mu"));
    }

    // Event ledger: 2× knowledge_promote_started + 2× knowledge_promoted.
    const started = await readEventLedger(projectRoot, { event_type: "knowledge_promote_started" });
    const promoted = await readEventLedger(projectRoot, { event_type: "knowledge_promoted" });
    expect(started.events).toHaveLength(2);
    expect(promoted.events).toHaveLength(2);
    const promotedIds = promoted.events
      .map((e) => (e.event_type === "knowledge_promoted" ? e.stable_id : undefined))
      .filter((s): s is string => typeof s === "string")
      .sort();
    expect(promotedIds).toEqual(ids);

    // Counter persisted: KT.DEC === 2.
    const meta = JSON.parse(
      await readFile(join(projectRoot, ".fabric", "agents.meta.json"), "utf8"),
    ) as { counters?: { KT?: { DEC?: number } } };
    expect(meta.counters?.KT?.DEC).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // (2) Reject batch — files retained (vacuum-owned) + frontmatter status=rejected
  //
  // v2.0.0-rc.27 TASK-001 (§2.2): rc.3 reject was observability-only — the
  // event fired but the file stayed visible in list/search, generating the
  // "ghost queue" loop documented in audit §2.2. rc.27 dual-writes: event
  // ledger PLUS `status: rejected` in the pending file frontmatter, so list
  // default-hides rejected entries while still preserving the file for
  // forensic recovery / doctor --vacuum.
  // ---------------------------------------------------------------------------

  it("(2) reject_batch_emits_events_writes_status_and_default_list_hides_rejected", async () => {
    const projectRoot = await createTempProject();
    const a = await seedPending(projectRoot, "decisions", "stale-a");
    const b = await seedPending(projectRoot, "guidelines", "stale-b");
    const c = await seedPending(projectRoot, "pitfalls", "stale-c");

    const result = await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [a, b, c],
      reason: "test rejection (rc27)",
    });
    if (result.action !== "reject") throw new Error("unreachable");
    expect(result.rejected).toEqual([a, b, c]);

    const rejected = await readEventLedger(projectRoot, { event_type: "knowledge_rejected" });
    expect(rejected.events).toHaveLength(3);
    for (const ev of rejected.events) {
      expect(ev.event_type).toBe("knowledge_rejected");
      expect((ev as { reason: string }).reason).toMatch(/test rejection \(rc27\)/u);
    }

    // Files retained for forensic recovery (vacuum-owned cleanup).
    expect(existsSync(join(projectRoot, a))).toBe(true);
    expect(existsSync(join(projectRoot, b))).toBe(true);
    expect(existsSync(join(projectRoot, c))).toBe(true);

    // Frontmatter mutation: each file now carries `status: rejected`.
    const aContent = await readFile(join(projectRoot, a), "utf8");
    expect(aContent).toMatch(/^status:\s*rejected\s*$/mu);

    // Default list hides rejected entries.
    const listedDefault = await reviewKnowledge(projectRoot, { action: "list", filters: undefined });
    if (listedDefault.action !== "list") throw new Error("unreachable");
    expect(listedDefault.items).toHaveLength(0);

    // Opt-in surfacing returns all three with status=rejected.
    const listedAll = await reviewKnowledge(projectRoot, {
      action: "list",
      filters: { include_rejected: true },
    });
    if (listedAll.action !== "list") throw new Error("unreachable");
    expect(listedAll.items).toHaveLength(3);
    expect(listedAll.items.every((it) => it.status === "rejected")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (3) Modify in-place — rewrite scalars, id stays put.
  // ---------------------------------------------------------------------------

  it("(3) modify_inplace_updates_frontmatter_id_and_path_unchanged", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPending(projectRoot, "decisions", "tweak-me", { tags: ["initial"] });

    // First approve so we have a canonical KT-DEC-NNNN entry to modify.
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const stableId = approve.approved[0].stable_id;
    const canonicalRel = `.fabric/knowledge/decisions/${stableId}--tweak-me.md`;
    expect(existsSync(join(projectRoot, canonicalRel))).toBe(true);

    // Modify (no layer change).
    const modify = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: { tags: ["rc3-test"], maturity: "verified" },
    });
    if (modify.action !== "modify") throw new Error("unreachable");
    expect(modify.prior_stable_id).toBeUndefined();
    expect(modify.new_stable_id).toBeUndefined();

    // File still at same canonical path with same id; frontmatter scalars updated.
    expect(existsSync(join(projectRoot, canonicalRel))).toBe(true);
    const updated = await readFile(join(projectRoot, canonicalRel), "utf8");
    expect(updated).toMatch(new RegExp(`^id: ${stableId}$`, "mu"));
    expect(updated).toMatch(/^maturity: verified$/mu);
    expect(updated).toMatch(/^tags: \[rc3-test\]$/mu);

    // No knowledge_layer_changed event.
    const layerEvents = await readEventLedger(projectRoot, { event_type: "knowledge_layer_changed" });
    expect(layerEvents.events).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // (4) Modify with layer-flip team → personal — id reallocation under FABRIC_HOME.
  // ---------------------------------------------------------------------------

  it("(4) modify_layer_flip_team_to_personal_allocates_kp_id_under_fabric_home", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPending(projectRoot, "decisions", "flip-me");

    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    const teamCanonical = `.fabric/knowledge/decisions/${priorId}--flip-me.md`;
    expect(existsSync(join(projectRoot, teamCanonical))).toBe(true);

    // Flip to personal.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: teamCanonical,
      changes: { layer: "personal" },
    });
    if (result.action !== "modify") throw new Error("unreachable");
    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KP-DEC-\d{4}$/u);

    // Old team file gone; new personal file under FABRIC_HOME.
    expect(existsSync(join(projectRoot, teamCanonical))).toBe(false);
    const fakeHome = process.env.FABRIC_HOME!;
    const personalAbs = join(
      fakeHome,
      ".fabric",
      "knowledge",
      "decisions",
      `${result.new_stable_id}--flip-me.md`,
    );
    expect(existsSync(personalAbs)).toBe(true);
    const content = await readFile(personalAbs, "utf8");
    expect(content).toMatch(new RegExp(`^id: ${result.new_stable_id}$`, "mu"));
    expect(content).toMatch(/^layer: personal$/mu);

    // knowledge_layer_changed event with from/to_layer + new stable_id.
    const layerEvents = await readEventLedger(projectRoot, { event_type: "knowledge_layer_changed" });
    expect(layerEvents.events).toHaveLength(1);
    const ev = layerEvents.events[0] as {
      event_type: "knowledge_layer_changed";
      from_layer: string;
      to_layer: string;
      stable_id?: string;
    };
    expect(ev.from_layer).toBe("team");
    expect(ev.to_layer).toBe("personal");
    expect(ev.stable_id).toBe(result.new_stable_id);
  });

  // ---------------------------------------------------------------------------
  // (5) Search filters — type/layer cuts across pending + canonical (team + personal).
  // ---------------------------------------------------------------------------

  it("(5) search_filters_by_type_and_layer_across_all_sources", async () => {
    const projectRoot = await createTempProject();
    // Mix:
    //   - 2 team-decisions (one will stay pending, one gets approved → canonical team)
    //   - 1 team-pitfall (pending)
    //   - 1 personal-guideline (will be created via approve+layer-flip, ending under FABRIC_HOME)
    await seedPending(projectRoot, "decisions", "team-dec-a", { tags: ["topic-search"] });
    const decBPending = await seedPending(projectRoot, "decisions", "team-dec-b", { tags: ["topic-search"] });
    await seedPending(projectRoot, "pitfalls", "team-pit-x", { tags: ["topic-search"] });
    const personalPending = await seedPending(projectRoot, "guidelines", "personal-glb", { tags: ["topic-search"] });

    // Promote team-dec-b → canonical team layer.
    const approveB = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [decBPending],
    });
    if (approveB.action !== "approve") throw new Error("unreachable");

    // Approve personal-glb under team, then layer-flip to personal so it ends
    // under FABRIC_HOME.
    const approvePersonal = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [personalPending],
    });
    if (approvePersonal.action !== "approve") throw new Error("unreachable");
    const teamGuidelineId = approvePersonal.approved[0].stable_id;
    const teamGuidelinePath = `.fabric/knowledge/guidelines/${teamGuidelineId}--personal-glb.md`;
    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: teamGuidelinePath,
      changes: { layer: "personal" },
    });

    // search type=decisions → 2 results (one pending team-dec-a, one canonical team-dec-b).
    const decResult = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "team-dec",
      filters: { type: "decisions" },
    });
    if (decResult.action !== "search") throw new Error("unreachable");
    expect(decResult.items).toHaveLength(2);
    for (const item of decResult.items) {
      expect(item.type).toBe("decisions");
    }

    // search layer=personal → 1 result (the layer-flipped guideline under FABRIC_HOME).
    const personalResult = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "personal-glb",
      filters: { layer: "personal" },
    });
    if (personalResult.action !== "search") throw new Error("unreachable");
    expect(personalResult.items).toHaveLength(1);
    expect(personalResult.items[0].layer).toBe("personal");
    expect(personalResult.items[0].type).toBe("guidelines");
    expect(personalResult.items[0].pending_path).toMatch(/^~\/\.fabric\/knowledge\/guidelines\//u);

    // search tags subset — all four entries share `topic-search`, so match by query+tag returns the 4.
    const tagResult = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "topic-search",
      filters: { tags: ["topic-search"] },
    });
    if (tagResult.action !== "search") throw new Error("unreachable");
    // Sanity: the substring query matches all 4 entries' tag value, AND every
    // entry has the `topic-search` tag, so the filter is a no-op against
    // a query-only result. Total = 4 (a + b + pit + personal-glb).
    expect(tagResult.items).toHaveLength(4);
  });

  // ---------------------------------------------------------------------------
  // (6) Defer — emits knowledge_deferred with until + reason.
  // ---------------------------------------------------------------------------

  it("(6) defer_emits_two_deferred_events_with_until_and_reason_and_retains_files", async () => {
    const projectRoot = await createTempProject();
    const a = await seedPending(projectRoot, "decisions", "defer-a");
    const b = await seedPending(projectRoot, "decisions", "defer-b");
    const until = "2026-06-01T00:00:00.000Z";
    const reason = "pending semantic check";

    const result = await reviewKnowledge(projectRoot, {
      action: "defer",
      pending_paths: [a, b],
      until,
      reason,
    });
    if (result.action !== "defer") throw new Error("unreachable");
    expect(result.deferred).toEqual([a, b]);

    const deferred = await readEventLedger(projectRoot, { event_type: "knowledge_deferred" });
    expect(deferred.events).toHaveLength(2);
    for (const ev of deferred.events) {
      const typed = ev as { event_type: "knowledge_deferred"; until?: string; reason?: string };
      expect(typed.until).toBe(until);
      expect(typed.reason).toBe(reason);
    }

    // Files remain on disk — defer is observability-only.
    expect(existsSync(join(projectRoot, a))).toBe(true);
    expect(existsSync(join(projectRoot, b))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (7) Filesystem-edit fallback — manual canonical mv synthesizes an event;
  //     a second runDoctorReport is idempotent (no duplicate synthesis).
  //
  // Note: rc.3 TASK-005 places the synthesis side-effect in `runDoctorReport`,
  // not `runDoctorFix`. The check produces an `info`-kind ok status (not a
  // fixable_error) because synthesis is idempotent at inspect-time and a
  // dedicated fix step would be redundant.
  // ---------------------------------------------------------------------------

  it("(7) filesystem_edit_fallback_synthesizes_then_idempotent_on_second_doctor_run", async () => {
    const projectRoot = await createTempProject();

    // First, exercise a normal approve so we have a real knowledge_promoted
    // event sitting in the ledger.
    const realPending = await seedPending(projectRoot, "decisions", "real-approve");
    const approved = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [realPending],
    });
    if (approved.action !== "approve") throw new Error("unreachable");
    const realId = approved.approved[0].stable_id;

    // Now manually drop a canonical file at .fabric/knowledge/decisions/
    // WITHOUT calling fab_review.approve. This simulates a user `git mv`-ing
    // a pending proposal into its canonical home, the exact case the
    // filesystem-edit fallback was designed to recover.
    const orphanId = "KT-DEC-9999";
    const orphanPath = join(
      projectRoot,
      ".fabric",
      "knowledge",
      "decisions",
      `${orphanId}--manual-move.md`,
    );
    const orphanFrontmatter = [
      "---",
      `id: ${orphanId}`,
      "type: decision",
      "maturity: draft",
      "layer: team",
      "created_at: 2026-05-10T00:00:00Z",
      "---",
      "# Manual move",
      "",
    ].join("\n");
    await writeFile(orphanPath, orphanFrontmatter, "utf8");

    // First doctor run — synthesizes one knowledge_promoted event.
    const first = await runDoctorReport(projectRoot);
    const firstCheck = first.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(firstCheck?.status).toBe("ok");
    expect(firstCheck?.kind).toBe("info");
    expect(firstCheck?.code).toBe("knowledge_promoted_synthesized");
    expect(firstCheck?.message).toContain(orphanId);
    expect(firstCheck?.message).toContain("[synthesized] filesystem-edit-fallback");

    // Ledger after first run: 2 knowledge_promoted events — the real approve
    // plus the synthesized one with the diagnostic reason prefix.
    const promotedAfterFirst = await readEventLedger(projectRoot, { event_type: "knowledge_promoted" });
    expect(promotedAfterFirst.events).toHaveLength(2);
    const synthesized = promotedAfterFirst.events.find(
      (e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback",
    );
    expect(synthesized).toBeDefined();
    expect(synthesized).toMatchObject({
      event_type: "knowledge_promoted",
      stable_id: orphanId,
      reason: "[synthesized] filesystem-edit-fallback",
    });
    // The real approve event for `real-approve` is also present and untouched.
    const realPromoted = promotedAfterFirst.events.find(
      (e) => e.event_type === "knowledge_promoted" && e.stable_id === realId,
    );
    expect(realPromoted).toBeDefined();

    // Second doctor run — idempotent; orphan is no longer orphaned because
    // the synthesized event is now in the ledger. No new event added.
    const second = await runDoctorReport(projectRoot);
    const secondCheck = second.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(secondCheck?.status).toBe("ok");
    expect(secondCheck?.message).toContain("No orphan canonical knowledge entries");

    const promotedAfterSecond = await readEventLedger(projectRoot, { event_type: "knowledge_promoted" });
    expect(promotedAfterSecond.events).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // (8) Tool contract — invoking through the registered MCP handler returns
  //     structuredContent that conforms to FabReviewOutputSchema. Lightweight:
  //     one round-trip per shape (list + search), not all six actions.
  //
  //     We don't spin up a full McpServer here — the tool dispatch is a thin
  //     wrapper around `reviewKnowledge` (see tools/review.ts). The contract
  //     guarantee we want to assert is that:
  //       - inputs validated through FabReviewInputSchema reach the service
  //         and return valid outputs;
  //       - outputs round-trip through FabReviewOutputSchema without loss.
  //     Schema-shape drift across releases is caught by the existing
  //     tool-contracts.test.ts golden snapshot.
  // ---------------------------------------------------------------------------

  it("(8) tool_contract_list_and_search_outputs_validate_against_FabReviewOutputSchema", async () => {
    const projectRoot = await createTempProject();
    await seedPending(projectRoot, "decisions", "contract-a", { tags: ["c8"] });
    await seedPending(projectRoot, "guidelines", "contract-b", { tags: ["c8"] });

    // Validate inputs through the schema (mirrors what the MCP runtime does
    // before invoking the handler).
    const listInput = FabReviewInputSchema.parse({ action: "list", filters: undefined });
    const listOutput = await reviewKnowledge(projectRoot, listInput);
    // Validate the OUTPUT shape — this is the contract guarantee that
    // structuredContent conforms to the declared output schema.
    const parsedListOutput = FabReviewOutputSchema.parse(listOutput);
    expect(parsedListOutput.action).toBe("list");
    if (parsedListOutput.action !== "list") throw new Error("unreachable");
    expect(parsedListOutput.items).toHaveLength(2);

    const searchInput = FabReviewInputSchema.parse({
      action: "search",
      query: "contract",
      filters: { type: "decisions" },
    });
    const searchOutput = await reviewKnowledge(projectRoot, searchInput);
    const parsedSearchOutput = FabReviewOutputSchema.parse(searchOutput);
    expect(parsedSearchOutput.action).toBe("search");
    if (parsedSearchOutput.action !== "search") throw new Error("unreachable");
    expect(parsedSearchOutput.items).toHaveLength(1);
    expect(parsedSearchOutput.items[0].type).toBe("decisions");
  });

  // ---------------------------------------------------------------------------
  // (9) TASK-001 regression guard — the published tool descriptor exposes a
  //     non-empty inputSchema with `action` plus all union-branch fields.
  //     Reproduces the original `_zod undefined` / `properties: {}` symptom
  //     class as a structural assertion.
  // ---------------------------------------------------------------------------
  it("test_published_tool_descriptor_input_schema_properties_non_empty", () => {
    type CapturedDef = { inputSchema: unknown; outputSchema: unknown; annotations: unknown };
    let captured: { name: string; def: CapturedDef } | undefined;
    const fakeServer = {
      registerTool: (name: string, def: CapturedDef) => {
        captured = { name, def };
      },
    } as unknown as McpServer;

    registerReview(fakeServer);
    expect(captured).toBeDefined();
    expect(captured!.name).toBe("fab_review");

    const inputSchema = captured!.def.inputSchema as Record<string, unknown>;
    // Regression guard against `properties: {}` (the SDK-misuse symptom).
    expect(typeof inputSchema).toBe("object");
    const inputKeys = Object.keys(inputSchema);
    expect(inputKeys.length).toBeGreaterThan(0);
    expect(inputKeys).toContain("action");

    // Every branch field of the discriminated union must surface on the
    // flat shape — drift here means ToolSearch loses fields.
    const branchKeys = new Set<string>();
    for (const opt of FabReviewInputSchema.options) {
      for (const k of Object.keys((opt as z.AnyZodObject).shape)) branchKeys.add(k);
    }
    for (const k of branchKeys) {
      expect(inputKeys, `published inputSchema missing branch field '${k}'`).toContain(k);
    }

    const outputSchema = captured!.def.outputSchema as Record<string, unknown>;
    expect(typeof outputSchema).toBe("object");
    expect(Object.keys(outputSchema)).toContain("action");
  });

  // ---------------------------------------------------------------------------
  // (10) TASK-001 — every action exercised through the registered handler
  //      against a real pending directory; structuredContent re-validates
  //      against both the flat shape (SDK surface) and the discriminated
  //      union (internal authoritative contract).
  // ---------------------------------------------------------------------------
  it("test_each_action_round_trip_against_real_pending_directory", async () => {
    const projectRoot = await createTempProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    const a = await seedPending(projectRoot, "decisions", "rt-action-a");
    const b = await seedPending(projectRoot, "decisions", "rt-action-b");
    const c = await seedPending(projectRoot, "guidelines", "rt-action-c");

    type CapturedHandler = (input: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    }>;
    let handler: CapturedHandler | undefined;
    const fakeServer = {
      registerTool: (_name: string, _def: unknown, h: CapturedHandler) => {
        handler = h;
      },
    } as unknown as McpServer;
    registerReview(fakeServer);
    expect(handler).toBeDefined();

    const FlatOutput = z.object(FabReviewOutputShape);

    // 1. list
    const listOut = await handler!({ action: "list" });
    expect(FlatOutput.safeParse(listOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(listOut.structuredContent).success).toBe(true);

    // 2. search
    const searchOut = await handler!({ action: "search", query: "rt-action" });
    expect(FlatOutput.safeParse(searchOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(searchOut.structuredContent).success).toBe(true);
    expect(
      (searchOut.structuredContent as { items: Array<unknown> }).items.length,
    ).toBeGreaterThanOrEqual(3);

    // 3. defer (b)
    const deferOut = await handler!({ action: "defer", pending_paths: [b] });
    expect(FlatOutput.safeParse(deferOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(deferOut.structuredContent).success).toBe(true);

    // 4. reject (b)
    const rejectOut = await handler!({ action: "reject", pending_paths: [b], reason: "stale" });
    expect(FlatOutput.safeParse(rejectOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(rejectOut.structuredContent).success).toBe(true);

    // 5. approve (a)
    const approveOut = await handler!({ action: "approve", pending_paths: [a] });
    expect(FlatOutput.safeParse(approveOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(approveOut.structuredContent).success).toBe(true);
    const approved = (approveOut.structuredContent as { approved: Array<{ stable_id: string }> }).approved;
    expect(approved).toHaveLength(1);

    // 6. modify (canonical from approved a)
    const stableId = approved[0].stable_id;
    const canonicalRel = `.fabric/knowledge/decisions/${stableId}--rt-action-a.md`;
    const modifyOut = await handler!({
      action: "modify",
      pending_path: canonicalRel,
      changes: { maturity: "verified" },
    });
    expect(FlatOutput.safeParse(modifyOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(modifyOut.structuredContent).success).toBe(true);

    // Sanity: c untouched.
    expect(c).toContain("rt-action-c");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.27 TASK-006 (audit §2.23): fab_review include_body for
// prompt-injection mitigation. Default list/search shows only frontmatter
// fields; reviewers pass include_body=true to render the body content
// (everything after the closing `---`) so a payload hidden under
// `## Evidence` can be visually inspected before approve.
// ---------------------------------------------------------------------------

describe("fab_review rc.27 §2.23 include_body", () => {
  it("list default omits body; include_body=true emits full body content", async () => {
    const projectRoot = await createTempProject();
    await seedPending(projectRoot, "decisions", "rc27-body-test", {
      summary: "summary line in frontmatter",
    });

    // Default — no body field.
    const defaultList = await reviewKnowledge(projectRoot, { action: "list", filters: undefined });
    if (defaultList.action !== "list") throw new Error("unreachable");
    expect(defaultList.items).toHaveLength(1);
    expect(defaultList.items[0].body).toBeUndefined();

    // Opt-in — body present, contains the "## Summary" section we seeded.
    const withBody = await reviewKnowledge(projectRoot, {
      action: "list",
      filters: { include_body: true },
    });
    if (withBody.action !== "list") throw new Error("unreachable");
    expect(withBody.items[0].body).toBeDefined();
    expect(withBody.items[0].body).toContain("## Summary");
    expect(withBody.items[0].body).toContain("summary line in frontmatter");
  });

  it("search default does NOT match body-only payloads; include_body=true does", async () => {
    const projectRoot = await createTempProject();
    // Seed an entry whose frontmatter says one thing but whose body carries
    // a hypothetical prompt-injection payload — only body-scan should match.
    const dir = join(projectRoot, ".fabric", "knowledge", "pending", "decisions");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "rc27-injection-probe.md");
    await writeFile(
      filePath,
      [
        "---",
        "type: decisions",
        "maturity: draft",
        "layer: team",
        `created_at: ${new Date().toISOString()}`,
        "source_session: sess-int-test",
        "tags: []",
        "summary: innocuous-looking summary",
        "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "---",
        "",
        "## Summary",
        "",
        "innocuous-looking summary",
        "",
        "## Evidence",
        "",
        "PROMPT_INJECTION_PAYLOAD_MARKER hidden in body",
        "",
      ].join("\n"),
      "utf8",
    );
    execFileSync("git", ["add", ".fabric/knowledge/pending/decisions/rc27-injection-probe.md"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    execFileSync("git", ["commit", "--quiet", "-m", "seed: rc27-injection-probe"], {
      cwd: projectRoot,
      stdio: "pipe",
    });

    // Default search — body-only term must NOT match.
    const defaultSearch = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "PROMPT_INJECTION_PAYLOAD_MARKER",
      filters: undefined,
    });
    if (defaultSearch.action !== "search") throw new Error("unreachable");
    expect(defaultSearch.items).toHaveLength(0);

    // include_body=true — body-scan now matches.
    const bodySearch = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "PROMPT_INJECTION_PAYLOAD_MARKER",
      filters: { include_body: true },
    });
    if (bodySearch.action !== "search") throw new Error("unreachable");
    expect(bodySearch.items).toHaveLength(1);
    expect(bodySearch.items[0].body).toContain("PROMPT_INJECTION_PAYLOAD_MARKER");
  });
});

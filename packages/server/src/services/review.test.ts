import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { reviewKnowledge } from "./review.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// v2.0: redirect personal-root resolution into a tempdir so tests never touch
// the developer's real ~/.fabric/. Mirrors rule-meta-builder.test.ts setup.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-review-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
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

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-review-"));
  tempDirs.push(projectRoot);
  // Initialize a real git repo so approve's `git rm` works the same way it
  // will in production. Mirrors rehydrate-state.test.ts:35-37 setup.
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Fabric Tests"], { cwd: projectRoot, stdio: "pipe" });
  return projectRoot;
}

async function seedPendingFile(
  projectRoot: string,
  type: "decisions" | "guidelines" | "pitfalls" | "models" | "processes",
  slug: string,
  options: {
    layer?: "team" | "personal";
    sourceSession?: string;
    summary?: string;
    tags?: string[];
  } = {},
): Promise<string> {
  const layer = options.layer ?? "team";
  const sourceSession = options.sourceSession ?? "sess-test";
  const summary = options.summary ?? "Test summary body.";
  const tags = options.tags ?? [];
  const dir = join(projectRoot, ".fabric", "knowledge", "pending", type);
  await mkdir(dir, { recursive: true });

  const tagFlow = tags.length === 0 ? "[]" : `[${tags.join(", ")}]`;
  const frontmatter = [
    "---",
    `type: ${type}`,
    "maturity: draft",
    `layer: ${layer}`,
    `created_at: ${new Date().toISOString()}`,
    `source_session: ${sourceSession}`,
    `tags: ${tagFlow}`,
    "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "---",
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Evidence (call 1)",
    "",
    summary,
    "",
  ].join("\n");

  const relativePath = `.fabric/knowledge/pending/${type}/${slug}.md`;
  await writeFile(join(projectRoot, relativePath), frontmatter, "utf8");

  // Stage so that `git rm` later finds the path tracked. Approve's git rm
  // requires the source to be in the index; for fresh-from-extract files in
  // production they'll have been committed (or at least added) by the user
  // before invoking review approve.
  execFileSync("git", ["add", relativePath], { cwd: projectRoot, stdio: "pipe" });
  execFileSync(
    "git",
    ["commit", "--quiet", "-m", `seed: ${slug}`],
    { cwd: projectRoot, stdio: "pipe" },
  );

  return relativePath;
}

describe("reviewKnowledge", () => {
  it("list_returns_pending_entries_with_expected_shape", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "first-decision");
    await seedPendingFile(projectRoot, "guidelines", "naming-rule", { tags: ["style"] });

    const result = await reviewKnowledge(projectRoot, { action: "list", filters: undefined });
    expect(result.action).toBe("list");
    if (result.action !== "list") throw new Error("unreachable");

    expect(result.items).toHaveLength(2);
    const byType = new Map(result.items.map((item) => [item.type, item]));
    const dec = byType.get("decisions");
    const gld = byType.get("guidelines");
    expect(dec).toMatchObject({
      pending_path: ".fabric/knowledge/pending/decisions/first-decision.md",
      type: "decisions",
      layer: "team",
      maturity: "draft",
    });
    expect(gld).toMatchObject({
      pending_path: ".fabric/knowledge/pending/guidelines/naming-rule.md",
      type: "guidelines",
      layer: "team",
      maturity: "draft",
      tags: ["style"],
    });
  });

  it("approve_happy_path_allocates_id_and_emits_two_phase_events", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "rc3-promote-flow");

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    expect(result.action).toBe("approve");
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(1);

    const entry = result.approved[0];
    expect(entry.pending_path).toBe(pendingPath);
    expect(entry.stable_id).toMatch(/^KT-DEC-\d{4}$/u);

    // Pending file moved out, canonical file lives under .fabric/knowledge/decisions/.
    expect(existsSync(join(projectRoot, pendingPath))).toBe(false);
    const canonicalPath = join(
      projectRoot,
      ".fabric",
      "knowledge",
      "decisions",
      `${entry.stable_id}--rc3-promote-flow.md`,
    );
    expect(existsSync(canonicalPath)).toBe(true);

    // Promoted file frontmatter contains the new id and no longer carries the
    // x-fabric-idempotency-key (meaningless post-promote — canonical file is
    // the source of truth).
    const promotedContent = await readFile(canonicalPath, "utf8");
    expect(promotedContent).toMatch(new RegExp(`^id: ${entry.stable_id}$`, "mu"));
    expect(promotedContent).not.toMatch(/^x-fabric-idempotency-key:/mu);

    // Counter persisted to agents.meta.json.
    const metaRaw = await readFile(join(projectRoot, ".fabric", "agents.meta.json"), "utf8");
    const meta = JSON.parse(metaRaw) as { counters?: { KT?: { DEC?: number } } };
    expect(meta.counters?.KT?.DEC).toBe(1);

    // Event ledger has BOTH knowledge_promote_started AND knowledge_promoted.
    const startedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_started",
    });
    const promotedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promoted",
    });
    expect(startedEvents.events).toHaveLength(1);
    expect(promotedEvents.events).toHaveLength(1);
    expect(promotedEvents.events[0]).toMatchObject({
      event_type: "knowledge_promoted",
      stable_id: entry.stable_id,
    });

    // No promote_failed event on the happy path.
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(0);
  });

  it("approve_emits_promote_failed_when_pending_path_is_missing", async () => {
    const projectRoot = await createTempProject();

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [".fabric/knowledge/pending/decisions/does-not-exist.md"],
    });
    expect(result.action).toBe("approve");
    if (result.action !== "approve") throw new Error("unreachable");
    // Failed entry is omitted from approved[] — caller learns of failure via
    // the knowledge_promote_failed event.
    expect(result.approved).toHaveLength(0);

    const startedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_started",
    });
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    const promotedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promoted",
    });
    expect(startedEvents.events).toHaveLength(1);
    expect(failedEvents.events).toHaveLength(1);
    expect(promotedEvents.events).toHaveLength(0);
    expect(failedEvents.events[0].reason).toMatch(/approve:does-not-exist/u);

    // No canonical file written, no counter increment.
    const decisionsDir = join(projectRoot, ".fabric", "knowledge", "decisions");
    expect(existsSync(decisionsDir)).toBe(false);
    const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
        counters?: { KT?: { DEC?: number } };
      };
      // Allocator never ran — counter should be absent or zero.
      expect(meta.counters?.KT?.DEC ?? 0).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // TASK-002: reject action
  // -------------------------------------------------------------------------

  it("reject_emits_rejected_event_and_returns_paths", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "stale-idea");

    const result = await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [pendingPath],
      reason: "duplicate of KT-DEC-0001",
    });
    expect(result.action).toBe("reject");
    if (result.action !== "reject") throw new Error("unreachable");
    expect(result.rejected).toEqual([pendingPath]);

    const rejectedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_rejected",
    });
    expect(rejectedEvents.events).toHaveLength(1);
    const rejectedEv = rejectedEvents.events[0] as { reason: string };
    expect(rejectedEv.reason).toMatch(/duplicate of KT-DEC-0001/u);
  });

  it("reject_does_not_delete_file_in_rc3_scope", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "tentative");

    await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [pendingPath],
      reason: "needs more evidence",
    });

    // rc.3 contract: reject is observability-only. doctor (rc.4) owns vacuum.
    expect(existsSync(join(projectRoot, pendingPath))).toBe(true);
  });

  it("reject_batch_emits_one_event_per_path", async () => {
    const projectRoot = await createTempProject();
    const a = await seedPendingFile(projectRoot, "decisions", "alpha");
    const b = await seedPendingFile(projectRoot, "guidelines", "bravo");
    const c = await seedPendingFile(projectRoot, "pitfalls", "charlie");

    const result = await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [a, b, c],
      reason: "out-of-scope",
    });
    expect(result.action).toBe("reject");
    if (result.action !== "reject") throw new Error("unreachable");
    expect(result.rejected).toHaveLength(3);

    const rejectedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_rejected",
    });
    expect(rejectedEvents.events).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // TASK-002: modify action — in-place
  // -------------------------------------------------------------------------

  it("modify_inplace_rewrites_frontmatter_only", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "tweakable", {
      tags: ["initial"],
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { tags: ["updated", "v2"], maturity: "verified" },
    });
    expect(result.action).toBe("modify");
    if (result.action !== "modify") throw new Error("unreachable");
    expect(result.prior_stable_id).toBeUndefined();
    expect(result.new_stable_id).toBeUndefined();

    const updated = await readFile(join(projectRoot, pendingPath), "utf8");
    expect(updated).toMatch(/^maturity: verified$/mu);
    expect(updated).toMatch(/^tags: \[updated, v2\]$/mu);
    // No layer-changed event since this was an in-place rewrite.
    const layerEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_layer_changed",
    });
    expect(layerEvents.events).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // TASK-002: modify action — layer flip
  // -------------------------------------------------------------------------

  it("modify_layer_flip_team_to_personal_allocates_kp_id", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "flip-me", {
      layer: "team",
    });

    // First approve so the entry has a canonical KT- id under team.
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    expect(priorId).toMatch(/^KT-DEC-\d{4}$/u);

    // Canonical team path lives under .fabric/knowledge/decisions/.
    const canonicalRel = `.fabric/knowledge/decisions/${priorId}--flip-me.md`;

    // Now flip to personal.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: { layer: "personal" },
    });
    expect(result.action).toBe("modify");
    if (result.action !== "modify") throw new Error("unreachable");

    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KP-DEC-\d{4}$/u);

    // Old team file is gone, new personal file lives under FABRIC_HOME.
    expect(existsSync(join(projectRoot, canonicalRel))).toBe(false);
    const fakeHome = process.env.FABRIC_HOME!;
    const newAbs = join(
      fakeHome,
      ".fabric",
      "knowledge",
      "decisions",
      `${result.new_stable_id}--flip-me.md`,
    );
    expect(existsSync(newAbs)).toBe(true);

    // New file's frontmatter carries the new id and new layer.
    const movedContent = await readFile(newAbs, "utf8");
    expect(movedContent).toMatch(new RegExp(`^id: ${result.new_stable_id}$`, "mu"));
    expect(movedContent).toMatch(/^layer: personal$/mu);
  });

  it("modify_layer_flip_personal_to_team_allocates_kt_id", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "personal-tip", {
      layer: "personal",
    });

    // Approve into personal canonical.
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    expect(priorId).toMatch(/^KP-GLD-\d{4}$/u);

    const fakeHome = process.env.FABRIC_HOME!;
    const personalAbs = join(
      fakeHome,
      ".fabric",
      "knowledge",
      "guidelines",
      `${priorId}--personal-tip.md`,
    );
    expect(existsSync(personalAbs)).toBe(true);

    // Pass the home-relative form so resolveModifyTarget walks the personal
    // root.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: `~/.fabric/knowledge/guidelines/${priorId}--personal-tip.md`,
      changes: { layer: "team" },
    });
    if (result.action !== "modify") throw new Error("unreachable");

    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KT-GLD-\d{4}$/u);
    expect(existsSync(personalAbs)).toBe(false);
    const newTeamAbs = join(
      projectRoot,
      ".fabric",
      "knowledge",
      "guidelines",
      `${result.new_stable_id}--personal-tip.md`,
    );
    expect(existsSync(newTeamAbs)).toBe(true);
  });

  it("modify_layer_flip_emits_layer_changed_with_from_to", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "pitfalls", "watch-out");
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    const canonicalRel = `.fabric/knowledge/pitfalls/${priorId}--watch-out.md`;

    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: { layer: "personal" },
    });

    const layerEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_layer_changed",
    });
    expect(layerEvents.events).toHaveLength(1);
    const ev = layerEvents.events[0] as {
      from_layer: string;
      to_layer: string;
      stable_id?: string;
    };
    expect(ev.from_layer).toBe("team");
    expect(ev.to_layer).toBe("personal");
    expect(ev.stable_id).toMatch(/^KP-PIT-\d{4}$/u);
  });

  // -------------------------------------------------------------------------
  // TASK-002: search action
  // -------------------------------------------------------------------------

  it("search_filters_by_type_and_returns_matches_in_pending", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "auth-flow", { tags: ["auth", "core"] });
    await seedPendingFile(projectRoot, "guidelines", "naming-rule", { tags: ["style"] });
    await seedPendingFile(projectRoot, "pitfalls", "auth-bypass", { tags: ["auth"] });

    const result = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "auth",
      filters: { type: "decisions" },
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("decisions");
    expect(result.items[0].pending_path).toContain("auth-flow");
  });

  it("search_filters_by_tags_subset", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "alpha", { tags: ["auth", "rbac"] });
    await seedPendingFile(projectRoot, "decisions", "beta", { tags: ["auth"] });
    await seedPendingFile(projectRoot, "decisions", "gamma", { tags: ["routing"] });

    const result = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "a",
      filters: { tags: ["auth", "rbac"] },
    });
    if (result.action !== "search") throw new Error("unreachable");
    // Only `alpha` has both auth AND rbac tags.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pending_path).toContain("alpha");
  });

  it("search_query_case_insensitive_substring_on_filename", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "MyImportantDecision");

    const result = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "important",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pending_path).toContain("MyImportantDecision");
  });

  it("search_includes_pending_and_canonical_entries", async () => {
    const projectRoot = await createTempProject();
    // Pending entry.
    await seedPendingFile(projectRoot, "decisions", "pending-x", { tags: ["topic"] });
    // Canonical entry — approve a second pending entry to materialize one.
    const otherPending = await seedPendingFile(projectRoot, "decisions", "topic-canonical", {
      tags: ["topic"],
    });
    await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [otherPending],
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "search",
      query: "topic",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    // Both the still-pending entry and the canonical post-approve entry match.
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    const paths = result.items.map((i) => i.pending_path);
    expect(paths.some((p) => p.includes("pending-x"))).toBe(true);
    expect(paths.some((p) => p.includes("topic-canonical"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TASK-002: defer action
  // -------------------------------------------------------------------------

  it("defer_emits_deferred_event_with_until_timestamp", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "later");
    const until = "2027-01-01T00:00:00.000Z";

    const result = await reviewKnowledge(projectRoot, {
      action: "defer",
      pending_paths: [pendingPath],
      until,
      reason: "waiting on upstream",
    });
    if (result.action !== "defer") throw new Error("unreachable");
    expect(result.deferred).toEqual([pendingPath]);

    const deferredEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_deferred",
    });
    expect(deferredEvents.events).toHaveLength(1);
    const ev = deferredEvents.events[0] as { until?: string; reason?: string };
    expect(ev.until).toBe(until);
    expect(ev.reason).toBe("waiting on upstream");
  });

  it("defer_emits_deferred_event_without_until_when_omitted", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "indefinite");

    await reviewKnowledge(projectRoot, {
      action: "defer",
      pending_paths: [pendingPath],
    });

    const deferredEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_deferred",
    });
    expect(deferredEvents.events).toHaveLength(1);
    const ev = deferredEvents.events[0] as { until?: string; reason?: string };
    expect(ev.until).toBeUndefined();
    expect(ev.reason).toBeUndefined();
  });
});

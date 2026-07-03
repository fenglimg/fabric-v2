import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KnowledgePromoteFailedEvent } from "@fenglimg/fabric-shared";
import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent, readEventLedger } from "./event-ledger.js";
import { inspectStoreBroadReviewRecheck } from "./doctor-knowledge-review-recheck.js";
import {
  __getReviewSearchIndexCacheStatsForTests,
  __isPendingKnowledgePathForTest,
  __resetReviewSearchIndexCacheForTests,
  reviewKnowledge,
  reviewPending,
} from "./review.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// v2.2 全砍 Stage 2/3 (B2 cutover): review reads/writes pending + canonical INTO
// the resolved write-target store (no dual-root). Tests provision a
// deterministic personal + team store so writes resolve; helpers compute the
// store-rooted absolute paths review now reports/accepts.
const TEST_PERSONAL_UUID = "11111111-1111-4111-8111-111111111111";
const TEST_TEAM_UUID = "22222222-2222-4222-8222-222222222222";

function provisionStores(projectRoot: string): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: TEST_PERSONAL_UUID, alias: "personal", personal: true, writable: true },
      { store_uuid: TEST_TEAM_UUID, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2)}\n`,
  );
}

function storeKnowledgeDir(layer: "team" | "personal", ...sub: string[]): string {
  const uuid = layer === "personal" ? TEST_PERSONAL_UUID : TEST_TEAM_UUID;
  return join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: uuid, personal: layer === "personal" }), STORE_LAYOUT.knowledgeDir, ...sub);
}

function toPosixPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

// W4 decolo: the stable_id counter now lives in the write-target STORE's
// committed counters.json, not the retired co-location agents.meta.json.
function storeCountersFile(layer: "team" | "personal"): string {
  const uuid = layer === "personal" ? TEST_PERSONAL_UUID : TEST_TEAM_UUID;
  return join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: uuid, personal: layer === "personal" }), STORE_LAYOUT.countersFile);
}

describe("review path guards", () => {
  it("detects pending knowledge paths with Windows separators", () => {
    expect(__isPendingKnowledgePathForTest("C:\\stores\\team\\knowledge\\pending\\decisions\\draft.md")).toBe(true);
    expect(__isPendingKnowledgePathForTest("C:\\stores\\team\\knowledge\\decisions\\KT-DEC-0001.md")).toBe(false);
  });
});

// v2.0: redirect personal-root resolution into a tempdir so tests never touch
// the developer's real ~/.fabric/. Mirrors knowledge-meta-builder.test.ts setup.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-review-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  __resetReviewSearchIndexCacheForTests();
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
  provisionStores(projectRoot);
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
  // v2.2 全砍: seed into the resolved write-target STORE's pending dir (no
  // dual-root). review.list reports + approve accepts the absolute store path.
  const dir = storeKnowledgeDir(layer, "pending", type);
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

  // Store-source pending lives in a separate store repo; review approve removes
  // it via plain unlink (sourceIsStore), so no project-repo git staging needed.
  const absolutePath = join(dir, `${slug}.md`);
  await writeFile(absolutePath, frontmatter, "utf8");
  return absolutePath;
}

describe("reviewKnowledge", () => {
  it("list_returns_pending_entries_with_expected_shape", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "first-decision");
    await seedPendingFile(projectRoot, "guidelines", "naming-rule", { tags: ["style"] });

    const result = await reviewPending(projectRoot, { action: "list", filters: undefined });
    expect(result.action).toBe("list");
    if (result.action !== "list") throw new Error("unreachable");

    expect(result.items).toHaveLength(2);
    const byType = new Map(result.items.map((item) => [item.type, item]));
    const dec = byType.get("decisions");
    const gld = byType.get("guidelines");
    expect(dec).toMatchObject({
      type: "decisions",
      layer: "team",
      maturity: "draft",
    });
    expect(toPosixPath(dec?.pending_path ?? "")).toContain(
      "knowledge/pending/decisions/first-decision.md",
    );
    expect(gld).toMatchObject({
      type: "guidelines",
      layer: "team",
      maturity: "draft",
      tags: ["style"],
    });
    expect(toPosixPath(gld?.pending_path ?? "")).toContain(
      "knowledge/pending/guidelines/naming-rule.md",
    );
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

    // Pending file moved out, canonical file lives in the team store.
    expect(existsSync(pendingPath)).toBe(false);
    const canonicalPath = storeKnowledgeDir(
      "team",
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

    // Counter persisted to the team store's committed counters.json (W4 decolo —
    // the co-location agents.meta counter is retired).
    const countersRaw = await readFile(storeCountersFile("team"), "utf8");
    const counters = JSON.parse(countersRaw) as { KT?: { DEC?: number } };
    expect(counters.KT?.DEC).toBe(1);

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
      pending_paths: [join(storeKnowledgeDir("team", "pending", "decisions"), "does-not-exist.md")],
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
    expect((failedEvents.events[0] as KnowledgePromoteFailedEvent).reason).toMatch(
      /approve:does-not-exist/u,
    );

    // No canonical file written, no counter increment.
    const decisionsDir = storeKnowledgeDir("team", "decisions");
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

  it("reject_moves_entry_out_of_pending_into_rejected_dir (F15)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "tentative");

    await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [pendingPath],
      reason: "needs more evidence",
    });

    // v2.2 全砍 F15: reject is now physically intuitive — the entry MOVES out of
    // pending/ into a sibling rejected/ dir (preserved for audit/restore, no
    // longer cluttering the active pending queue).
    expect(existsSync(pendingPath)).toBe(false);
    const rejectedPath = pendingPath.replace(`${sep}pending${sep}`, `${sep}rejected${sep}`);
    expect(existsSync(rejectedPath)).toBe(true);
    const moved = await readFile(rejectedPath, "utf8");
    expect(moved).toMatch(/^status: rejected$/mu);
  });

  it("search can surface rejected entries when include_rejected is true", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "rejected-search-target", {
      tags: ["audit-rejected"],
      summary: "Rejected search target.",
    });

    await reviewKnowledge(projectRoot, {
      action: "reject",
      pending_paths: [pendingPath],
      reason: "audit-only",
    });

    const hidden = await reviewPending(projectRoot, {
      action: "search",
      query: "rejected-search-target",
    });
    if (hidden.action !== "search") throw new Error("unreachable");
    expect(hidden.items).toHaveLength(0);

    const visible = await reviewPending(projectRoot, {
      action: "search",
      query: "rejected-search-target",
      filters: { include_rejected: true },
    });
    if (visible.action !== "search") throw new Error("unreachable");
    expect(visible.items).toHaveLength(1);
    expect(visible.items[0].status).toBe("rejected");
    expect(visible.items[0].path).toContain(`${sep}rejected${sep}`);
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

    const updated = await readFile(pendingPath, "utf8");
    expect(updated).toMatch(/^maturity: verified$/mu);
    expect(updated).toMatch(/^tags: \[updated, v2\]$/mu);
    // No layer-changed event since this was an in-place rewrite.
    const layerEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_layer_changed",
    });
    expect(layerEvents.events).toHaveLength(0);
  });

  // v2.2 graph edges (KT-DEC-0031 wiki seam): regression for the bug where the
  // modify changes schema lacked `related`, so zod .strip() silently dropped it
  // — modify returned success but the H2 adjacency never reached frontmatter,
  // leaving the only programmatic related-write path non-functional.
  it("modify writes the related[] H2 graph edge into frontmatter", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "edge-source", {
      tags: ["initial"],
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { related: ["KT-DEC-0019", "KT-GLD-0005"] },
    });
    expect(result.action).toBe("modify");

    const updated = await readFile(pendingPath, "utf8");
    expect(updated).toMatch(/^related: \[KT-DEC-0019, KT-GLD-0005\]$/mu);
  });

  it("v2.2 modify re-scopes semantic_scope (team → project:<id>) in place, store untouched", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "rescope-me", {
      tags: ["initial"],
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { semantic_scope: "project:fabric-v2" },
    });
    expect(result.action).toBe("modify");

    const updated = await readFile(pendingPath, "utf8");
    // semantic_scope line written (appended, since seed omits it).
    expect(updated).toMatch(/^semantic_scope: project:fabric-v2$/mu);
    // layer is NOT touched — scope ⊥ store. The entry stays a team-store file.
    expect(updated).toMatch(/^layer: team$/mu);
    // A knowledge_modified event records the changed field (no layer-flip event).
    const layerEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_layer_changed",
    });
    expect(layerEvents.events).toHaveLength(0);
    const modifiedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_modified",
    });
    expect(modifiedEvents.events.length).toBeGreaterThanOrEqual(1);
  });

  it("v2.2 modify rejects a personal-root semantic_scope (must use modify-layer)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "no-personal-rescope", {
      tags: ["initial"],
    });

    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: pendingPath,
        changes: { semantic_scope: "personal" },
      }),
    ).rejects.toThrow(/personal/u);

    // The file is unchanged — no semantic_scope line leaked in.
    const after = await readFile(pendingPath, "utf8");
    expect(after).not.toMatch(/^semantic_scope:/mu);
  });

  it("F55 (ISS-055): a malicious tag cannot inject a new frontmatter key via flow array", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "inject-array", {
      tags: ["initial"],
    });
    // Tag carrying a `]` + newline + a fake key. Pre-fix raw join produced
    // `tags: [ok, evil]\nmaturity: proven]` — an injected `maturity` line.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { tags: ["ok", "evil]\nmaturity: proven"] },
    });
    expect(result.action).toBe("modify");
    const updated = await readFile(pendingPath, "utf8");
    // The malicious element is JSON-quoted on one line; no real newline injected.
    expect(updated).toContain('tags: [ok, "evil]\\nmaturity: proven"]');
    // The injected key must NOT appear as a standalone frontmatter line.
    expect(updated).not.toMatch(/^maturity: proven$/mu);
  });

  it("F36 (ISS-034): a backslash-bearing summary is escaped, not left to break the quoted scalar", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "inject-backslash", {
      tags: ["initial"],
    });
    // Summary contains a colon (forces quoting) and ends in a backslash. Pre-fix
    // `"...path\"` left a dangling escaped quote that swallowed the closer.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { summary: "drive C:\\" },
    });
    expect(result.action).toBe("modify");
    const updated = await readFile(pendingPath, "utf8");
    // Backslash doubled, value properly closed — valid YAML double-quoted scalar.
    expect(updated).toContain('summary: "drive C:\\\\"');
  });

  // -------------------------------------------------------------------------
  // rc.37 NEW-12: explicit modify split (modify-content / modify-layer)
  // -------------------------------------------------------------------------

  it("modify-content edits scalars and never flips layer (layer stripped)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "content-only", {
      tags: ["initial"],
      layer: "team",
    });

    // Even though a layer is passed, modify-content MUST strip it → no flip.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify-content",
      pending_path: pendingPath,
      changes: { tags: ["edited"], layer: "personal" },
    });
    expect(result.action).toBe("modify");
    if (result.action !== "modify") throw new Error("unreachable");
    expect(result.prior_stable_id).toBeUndefined();
    expect(result.new_stable_id).toBeUndefined();

    const updated = await readFile(pendingPath, "utf8");
    expect(updated).toMatch(/^tags: \[edited\]$/mu);
    expect(updated).toMatch(/^layer: team$/mu); // unchanged — layer flip suppressed
    const layerEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_layer_changed",
    });
    expect(layerEvents.events).toHaveLength(0);
  });

  it("modify-layer flips layer (dedicated layer-flip path)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "flip-explicit", {
      layer: "team",
    });
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    const canonicalRel = storeKnowledgeDir("team", "decisions", `${priorId}--flip-explicit.md`);

    const result = await reviewKnowledge(projectRoot, {
      action: "modify-layer",
      pending_path: canonicalRel,
      changes: { layer: "personal" },
    });
    expect(result.action).toBe("modify");
    if (result.action !== "modify") throw new Error("unreachable");
    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KP-DEC-\d{4}$/u);
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
    const canonicalRel = storeKnowledgeDir("team", "decisions", `${priorId}--flip-me.md`);

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

    // Old team-store file is gone, new file lives in the personal store.
    expect(existsSync(canonicalRel)).toBe(false);
    const newAbs = storeKnowledgeDir("personal", "decisions", `${result.new_stable_id}--flip-me.md`);
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

    const personalAbs = storeKnowledgeDir("personal", "guidelines", `${priorId}--personal-tip.md`);
    expect(existsSync(personalAbs)).toBe(true);

    // Pass the absolute personal-store canonical path so resolveModifyTarget
    // walks the store.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: personalAbs,
      changes: { layer: "team" },
    });
    if (result.action !== "modify") throw new Error("unreachable");

    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KT-GLD-\d{4}$/u);
    expect(existsSync(personalAbs)).toBe(false);
    const newTeamAbs = storeKnowledgeDir("team", "guidelines", `${result.new_stable_id}--personal-tip.md`);
    expect(existsSync(newTeamAbs)).toBe(true);
  });

  it("modify_layer_flip_personal_to_team_lands_in_projects_subtree_when_bound (W1/TASK-003 parity)", async () => {
    const projectRoot = await createTempProject();
    // Bind an active_project so a team-layer destination lands in the
    // project-partitioned subtree — mirroring the approve-promote path.
    writeFileSync(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team", active_project: "demo-app" }, null, 2)}\n`,
    );
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "bound-tip", {
      layer: "personal",
    });

    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    const personalAbs = storeKnowledgeDir("personal", "guidelines", `${priorId}--bound-tip.md`);
    expect(existsSync(personalAbs)).toBe(true);

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: personalAbs,
      changes: { layer: "team" },
    });
    if (result.action !== "modify") throw new Error("unreachable");
    expect(existsSync(personalAbs)).toBe(false);

    // The flipped-to-team entry lands under knowledge/projects/demo-app/, NOT
    // flat — identical to a promote with the same active_project (C-104).
    const projectSubtreeAbs = storeKnowledgeDir(
      "team",
      "projects",
      "demo-app",
      "guidelines",
      `${result.new_stable_id}--bound-tip.md`,
    );
    expect(existsSync(projectSubtreeAbs)).toBe(true);
    const flatAbs = storeKnowledgeDir("team", "guidelines", `${result.new_stable_id}--bound-tip.md`);
    expect(existsSync(flatAbs)).toBe(false);
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
    const canonicalRel = storeKnowledgeDir("team", "pitfalls", `${priorId}--watch-out.md`);

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
  // v2.0-rc.5 C3 (TASK-012): modify-canonical + relevance fields + auto-degrade
  //
  // 1. modify accepts relevance_scope/relevance_paths in the patch on both
  //    pending and canonical entries.
  // 2. team→personal flip on a narrow entry auto-degrades to broad+[] and
  //    emits a knowledge_scope_degraded event with reason="personal-implies-broad".
  // 3. The pre-existing pending in-place rewrite path still works.
  // -------------------------------------------------------------------------

  it("test_review_modify_canonical_entry — accepts relevance_scope/paths on a canonical entry", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "canonical-target");
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const stableId = approve.approved[0].stable_id;
    const canonicalRel = storeKnowledgeDir("team", "decisions", `${stableId}--canonical-target.md`);

    // Same-layer modify with relevance fields — exercises the in-place path
    // against a canonical (post-approve) entry.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: {
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**", "packages/auth/"],
      },
    });
    if (result.action !== "modify") throw new Error("unreachable");
    // In-place modify does not return prior/new stable_id.
    expect(result.prior_stable_id).toBeUndefined();
    expect(result.new_stable_id).toBeUndefined();

    const updated = await readFile(canonicalRel, "utf8");
    expect(updated).toMatch(/^relevance_scope: narrow$/mu);
    expect(updated).toMatch(/^relevance_paths: \[src\/auth\/\*\*, packages\/auth\/\]$/mu);

    // No degrade event for a same-layer rescope.
    const degraded = await readEventLedger(projectRoot, {
      event_type: "knowledge_scope_degraded",
    });
    expect(degraded.events).toHaveLength(0);
  });

  it("test_review_modify_pending_accepts_relevance_fields — pending in-place path still works", async () => {
    // Pending modify (pre-canonical) accepting relevance fields. Confirms the
    // existing pending flow isn't broken by the canonical extension.
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "pending-rescope");

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { relevance_scope: "narrow", relevance_paths: ["src/ui/**"] },
    });
    if (result.action !== "modify") throw new Error("unreachable");

    const updated = await readFile(pendingPath, "utf8");
    expect(updated).toMatch(/^relevance_scope: narrow$/mu);
    expect(updated).toMatch(/^relevance_paths: \[src\/ui\/\*\*\]$/mu);
  });

  it("modify_inplace_emits_knowledge_modified_event_with_before_after_patch", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "pending-audit", {
      tags: ["old"],
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: {
        summary: "Updated summary for audit trail.",
        tags: ["new", "audit"],
        relevance_scope: "narrow",
        relevance_paths: ["src/audit/**"],
      },
    });
    expect(result.action).toBe("modify");

    const modified = await readEventLedger(projectRoot, {
      event_type: "knowledge_modified",
    });
    expect(modified.events).toHaveLength(1);
    const ev = modified.events[0] as {
      path: string;
      changed_fields: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      reason?: string;
    };
    expect(ev.path).toBe(pendingPath);
    expect(ev.changed_fields).toEqual([
      "summary",
      "tags",
      "relevance_scope",
      "relevance_paths",
    ]);
    expect(ev.before).toMatchObject({
      summary: null,
      tags: ["old"],
      relevance_scope: null,
      relevance_paths: null,
    });
    expect(ev.after).toMatchObject({
      summary: "Updated summary for audit trail.",
      tags: ["new", "audit"],
      relevance_scope: "narrow",
      relevance_paths: ["src/audit/**"],
    });
    expect(ev.reason).toBe(`modify:${pendingPath}`);
  });

  it("test_review_modify_layer_flip_auto_degrade — narrow team→personal flips degrade scope to broad+[]", async () => {
    const projectRoot = await createTempProject();
    // Seed pending with narrow scope + a paths array.
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "narrow-team");
    // Inject narrow + relevance_paths into frontmatter via a separate modify
    // call so the seed helper doesn't need to know about C3 yet.
    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { relevance_scope: "narrow", relevance_paths: ["src/team/**"] },
    });
    // Approve into canonical (team).
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    expect(priorId).toMatch(/^KT-DEC-\d{4}$/u);
    const canonicalRel = storeKnowledgeDir("team", "decisions", `${priorId}--narrow-team.md`);

    // Flip team → personal. Narrow + team→personal → auto-degrade.
    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: { layer: "personal" },
    });
    if (result.action !== "modify") throw new Error("unreachable");
    expect(result.prior_stable_id).toBe(priorId);
    expect(result.new_stable_id).toMatch(/^KP-DEC-\d{4}$/u);

    // New personal file frontmatter: scope=broad, paths=[].
    const newAbs = storeKnowledgeDir("personal", "decisions", `${result.new_stable_id}--narrow-team.md`);
    const newContent = await readFile(newAbs, "utf8");
    expect(newContent).toMatch(/^relevance_scope: broad$/mu);
    expect(newContent).toMatch(/^relevance_paths: \[\]$/mu);

    // knowledge_scope_degraded event emitted with the expected payload.
    const degraded = await readEventLedger(projectRoot, {
      event_type: "knowledge_scope_degraded",
    });
    expect(degraded.events).toHaveLength(1);
    const ev = degraded.events[0] as {
      stable_id: string;
      from_scope: string;
      to_scope: string;
      reason: string;
    };
    expect(ev.stable_id).toBe(result.new_stable_id);
    expect(ev.from_scope).toBe("narrow");
    expect(ev.to_scope).toBe("broad");
    expect(ev.reason).toBe("personal-implies-broad");
  });

  it("test_review_modify_layer_flip_broad_no_degrade — broad team→personal does NOT degrade or emit event", async () => {
    const projectRoot = await createTempProject();
    // Default seed: no relevance_scope frontmatter → treated as broad.
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "broad-team");
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    const canonicalRel = storeKnowledgeDir("team", "decisions", `${priorId}--broad-team.md`);

    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalRel,
      changes: { layer: "personal" },
    });

    const degraded = await readEventLedger(projectRoot, {
      event_type: "knowledge_scope_degraded",
    });
    expect(degraded.events).toHaveLength(0);
  });

  it("test_review_modify_layer_flip_personal_to_team_narrow_no_degrade — auto-degrade only on team→personal", async () => {
    // Narrow personal→team should NOT auto-degrade — personal-implies-broad
    // is one-way; the inverse direction can keep narrow paths because team
    // knowledge is workspace-local.
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "narrow-personal", {
      layer: "personal",
    });
    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { relevance_scope: "narrow", relevance_paths: ["src/ui/**"] },
    });
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");
    const priorId = approve.approved[0].stable_id;
    expect(priorId).toMatch(/^KP-GLD-\d{4}$/u);
    const personalRel = storeKnowledgeDir("personal", "guidelines", `${priorId}--narrow-personal.md`);

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: personalRel,
      changes: { layer: "team" },
    });
    if (result.action !== "modify") throw new Error("unreachable");

    // No degrade emitted.
    const degraded = await readEventLedger(projectRoot, {
      event_type: "knowledge_scope_degraded",
    });
    expect(degraded.events).toHaveLength(0);

    // New team file should preserve the original narrow paths verbatim.
    const newAbs = storeKnowledgeDir("team", "guidelines", `${result.new_stable_id}--narrow-personal.md`);
    const newContent = await readFile(newAbs, "utf8");
    expect(newContent).toMatch(/^relevance_scope: narrow$/mu);
    expect(newContent).toMatch(/^relevance_paths: \[src\/ui\/\*\*\]$/mu);
  });

  // -------------------------------------------------------------------------
  // TASK-002: search action
  // -------------------------------------------------------------------------

  it("search_filters_by_type_and_returns_matches_in_pending", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "auth-flow", { tags: ["auth", "core"] });
    await seedPendingFile(projectRoot, "guidelines", "naming-rule", { tags: ["style"] });
    await seedPendingFile(projectRoot, "pitfalls", "auth-bypass", { tags: ["auth"] });

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "auth",
      filters: { type: "decisions" },
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("decisions");
    // v2.0.0-rc.29 TASK-007 (BUG-M4): search items use `path` + `area`.
    expect(result.items[0].path).toContain("auth-flow");
  });

  it("search_filters_by_tags_subset", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "alpha", { tags: ["auth", "rbac"] });
    await seedPendingFile(projectRoot, "decisions", "beta", { tags: ["auth"] });
    await seedPendingFile(projectRoot, "decisions", "gamma", { tags: ["routing"] });

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "a",
      filters: { tags: ["auth", "rbac"] },
    });
    if (result.action !== "search") throw new Error("unreachable");
    // Only `alpha` has both auth AND rbac tags.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toContain("alpha");
  });

  it("search_query_case_insensitive_substring_on_filename", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "MyImportantDecision");

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "important",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toContain("MyImportantDecision");
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

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "topic",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    // Both the still-pending entry and the canonical post-approve entry match.
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    const paths = result.items.map((i) => i.path);
    expect(paths.some((p) => p.includes("pending-x"))).toBe(true);
    expect(paths.some((p) => p.includes("topic-canonical"))).toBe(true);
  });

  it("search_reuses_indexed_frontmatter_between_repeated_queries", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "auth-flow", { tags: ["auth", "core"] });
    await seedPendingFile(projectRoot, "guidelines", "naming-rule", { tags: ["style"] });
    await seedPendingFile(projectRoot, "pitfalls", "auth-bypass", { tags: ["auth"] });

    const first = await reviewPending(projectRoot, {
      action: "search",
      query: "auth",
      filters: undefined,
    });
    if (first.action !== "search") throw new Error("unreachable");
    expect(first.items).toHaveLength(2);
    const afterFirst = __getReviewSearchIndexCacheStatsForTests();
    expect(afterFirst.indexedFiles).toBe(3);
    expect(afterFirst.contentReads).toBe(3);

    const second = await reviewPending(projectRoot, {
      action: "search",
      query: "style",
      filters: undefined,
    });
    if (second.action !== "search") throw new Error("unreachable");
    expect(second.items).toHaveLength(1);
    expect(second.items[0].path).toContain("naming-rule");
    expect(__getReviewSearchIndexCacheStatsForTests().contentReads).toBe(afterFirst.contentReads);
  });

  it("search_reloads_only_changed_files_in_the_index", async () => {
    const projectRoot = await createTempProject();
    const changedPath = await seedPendingFile(projectRoot, "decisions", "alpha", { tags: ["old"] });
    await seedPendingFile(projectRoot, "decisions", "beta", { tags: ["stable"] });

    const first = await reviewPending(projectRoot, {
      action: "search",
      query: "old",
      filters: undefined,
    });
    if (first.action !== "search") throw new Error("unreachable");
    expect(first.items).toHaveLength(1);
    expect(__getReviewSearchIndexCacheStatsForTests().contentReads).toBe(2);

    await writeFile(
      changedPath,
      [
        "---",
        "type: decisions",
        "maturity: draft",
        "layer: team",
        `created_at: ${new Date().toISOString()}`,
        "source_session: sess-test",
        "tags: [fresh]",
        "title: changed-index-entry",
        "---",
        "",
        "changed body with enough extra bytes to alter the fingerprint",
        "",
      ].join("\n"),
      "utf8",
    );

    const second = await reviewPending(projectRoot, {
      action: "search",
      query: "changed-index-entry",
      filters: undefined,
    });
    if (second.action !== "search") throw new Error("unreachable");
    expect(second.items).toHaveLength(1);
    expect(second.items[0].path).toContain("alpha");
    expect(__getReviewSearchIndexCacheStatsForTests().contentReads).toBe(3);
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

  it("defer_identifies_each_deferred_pending_path_even_without_until_or_reason", async () => {
    const projectRoot = await createTempProject();
    const first = await seedPendingFile(projectRoot, "decisions", "defer-first");
    const second = await seedPendingFile(projectRoot, "guidelines", "defer-second");

    await reviewKnowledge(projectRoot, {
      action: "defer",
      pending_paths: [first, second],
    });

    const deferredEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_deferred",
    });
    expect(deferredEvents.events).toHaveLength(2);
    expect(deferredEvents.events.map((event) => (event as { pending_path?: string }).pending_path)).toEqual([
      first,
      second,
    ]);
    for (const event of deferredEvents.events as Array<{
      pending_path?: string;
      stable_id?: string;
      until?: string;
      reason?: string;
    }>) {
      expect(event.pending_path).toBeDefined();
      expect(event.stable_id).toBeUndefined();
      expect(event.until).toBeUndefined();
      expect(event.reason).toBeUndefined();
    }
  });

  it("defer_includes_stable_id_when_pending_frontmatter_has_id", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "defer-with-id");
    const original = await readFile(pendingPath, "utf8");
    await writeFile(pendingPath, original.replace("---\n", "---\nid: KT-DEC-0042\n"), "utf8");

    await reviewKnowledge(projectRoot, {
      action: "defer",
      pending_paths: [pendingPath],
    });

    const deferredEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_deferred",
    });
    expect(deferredEvents.events).toHaveLength(1);
    expect(deferredEvents.events[0]).toMatchObject({
      pending_path: pendingPath,
      stable_id: "KT-DEC-0042",
    });
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

  // -------------------------------------------------------------------------
  // TASK-009: focused branch coverage for rc.3 gate (>=90% lines, >=80% branch)
  // -------------------------------------------------------------------------

  it("list_applies_layer_maturity_and_tags_filters", async () => {
    const projectRoot = await createTempProject();
    // team / draft / [auth]
    await seedPendingFile(projectRoot, "decisions", "team-auth", {
      layer: "team",
      tags: ["auth", "rbac"],
    });
    // personal / draft / [routing]
    await seedPendingFile(projectRoot, "decisions", "personal-route", {
      layer: "personal",
      tags: ["routing"],
    });

    // layer filter narrows to team only
    const teamOnly = await reviewPending(projectRoot, {
      action: "list",
      filters: { layer: "team" },
    });
    if (teamOnly.action !== "list") throw new Error("unreachable");
    expect(teamOnly.items).toHaveLength(1);
    expect(teamOnly.items[0].layer).toBe("team");

    // tags subset filter — only entries containing both 'auth' and 'rbac'
    const tagged = await reviewPending(projectRoot, {
      action: "list",
      filters: { tags: ["auth", "rbac"] },
    });
    if (tagged.action !== "list") throw new Error("unreachable");
    expect(tagged.items).toHaveLength(1);
    expect(tagged.items[0].pending_path).toContain("team-auth");

    // maturity filter — none of the seeded files are 'verified'
    const verified = await reviewPending(projectRoot, {
      action: "list",
      filters: { maturity: "verified" },
    });
    if (verified.action !== "list") throw new Error("unreachable");
    expect(verified.items).toHaveLength(0);

    // layer 'both' (string-equal match-all branch)
    const both = await reviewPending(projectRoot, {
      action: "list",
      filters: { layer: "both" },
    });
    if (both.action !== "list") throw new Error("unreachable");
    expect(both.items.length).toBeGreaterThanOrEqual(2);
  });

  it("list_skips_directories_that_do_not_exist", async () => {
    const projectRoot = await createTempProject();
    // No pending dir at all → list returns empty.
    const result = await reviewPending(projectRoot, { action: "list", filters: undefined });
    if (result.action !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(0);
  });

  it("approve_emits_promote_failed_when_pending_file_lacks_type_frontmatter", async () => {
    const projectRoot = await createTempProject();
    // Write a store pending file with no/invalid frontmatter type so approveOne
    // throws immediately and emits knowledge_promote_failed.
    const dir = storeKnowledgeDir("team", "pending", "decisions");
    await mkdir(dir, { recursive: true });
    const absPath = join(dir, "no-type.md");
    await writeFile(absPath, "---\nmaturity: draft\nlayer: team\n---\n\nbody\n", "utf8");

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [absPath],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(0);

    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(1);
    expect((failedEvents.events[0] as { reason: string }).reason).toMatch(/invalid 'type'/u);
  });

  it("approve_personal_layer_uses_fs_unlink_and_writes_under_FABRIC_HOME", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "personal-flow", {
      layer: "personal",
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].stable_id).toMatch(/^KP-DEC-\d{4}$/u);
    expect(existsSync(pendingPath)).toBe(false);

    const personalAbs = storeKnowledgeDir(
      "personal",
      "decisions",
      `${result.approved[0].stable_id}--personal-flow.md`,
    );
    expect(existsSync(personalAbs)).toBe(true);
  });

  it("approve_removes_store_pending_source_via_fs_unlink", async () => {
    // v2.2 全砍 Stage 2: store-source pending lives in a separate store repo, so
    // approve always removes it via fs.unlink (never the project-repo `git rm`).
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "untracked");

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(1);
    // Source removed via fs.unlink.
    expect(existsSync(pendingPath)).toBe(false);
  });

  it("modify_throws_when_target_does_not_exist", async () => {
    const projectRoot = await createTempProject();
    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: storeKnowledgeDir("team", "pending", "decisions", "missing.md"),
        changes: { maturity: "verified" },
      }),
    ).rejects.toThrow(/modify target not found/u);
  });

  it("modify_layer_flip_throws_when_type_cannot_be_inferred", async () => {
    // Place a file under a store knowledge root but in a directory whose name is
    // NOT a known plural type, AND whose frontmatter omits 'type'. The flip path
    // then has no way to infer pluralType and must throw.
    const projectRoot = await createTempProject();
    const dir = storeKnowledgeDir("team", "experiments");
    await mkdir(dir, { recursive: true });
    const absPath = join(dir, "no-type-inferable.md");
    await writeFile(
      absPath,
      "---\nmaturity: draft\nlayer: team\n---\n\nbody\n",
      "utf8",
    );

    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: absPath,
        changes: { layer: "personal" },
      }),
    ).rejects.toThrow(/layer-flip requires a known type/u);
  });

  it("modify_inplace_handles_title_summary_quoting_and_preserves_unrelated_keys", async () => {
    // Title contains a colon → quoteIfNeeded must wrap in double-quotes.
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "quotable");

    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: {
        title: "title with: colon",
        summary: "plain summary",
      },
    });

    const updated = await readFile(pendingPath, "utf8");
    expect(updated).toMatch(/^title: "title with: colon"$/mu);
    expect(updated).toMatch(/^summary: plain summary$/mu);
    // unrelated frontmatter (source_session) preserved.
    expect(updated).toMatch(/^source_session: sess-test$/mu);
  });

  it("search_includes_personal_canonical_entries_from_personal_store", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "personal-search", {
      layer: "personal",
      tags: ["personal-topic"],
    });
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve") throw new Error("unreachable");

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "personal-search",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    // v2.2 全砍: personal canonical lives in the personal store; reported by
    // absolute path under that store.
    const personal = result.items.find((i) => i.path.includes(TEST_PERSONAL_UUID));
    expect(personal).toBeDefined();
    expect(personal!.layer).toBe("personal");
  });

  it("search_filters_by_maturity_excludes_non_matching", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "draft-only");
    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "draft",
      filters: { maturity: "verified" },
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // P1 recall-engine-refactor (TASK-005): triage mode applies NO top_k and NO
  // floor — pending review must never silently drop a match. This is the
  // load-bearing semantic difference vs fab_recall (top_k + ratio-to-top floor).
  // Both assertions seed a corpus where the recall-mode cut WOULD drop matches,
  // then prove triage returns ALL of them.
  // -------------------------------------------------------------------------

  it("triage_search_applies_no_top_k_returns_all_matches", async () => {
    const projectRoot = await createTempProject();
    // Pin the RECALL top_k knob to 1: if triage (wrongly) honored it, at most one
    // entry would survive. Triage must IGNORE it and return all matches.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify(
        { required_stores: [{ id: "team" }], active_write_store: "team", plan_context_top_k: 1 },
        null,
        2,
      )}\n`,
    );
    // Three entries that all pass the substring gate ("ranktopic" in the slug).
    await seedPendingFile(projectRoot, "decisions", "ranktopic-alpha", { tags: ["x"] });
    await seedPendingFile(projectRoot, "decisions", "ranktopic-beta", { tags: ["y"] });
    await seedPendingFile(projectRoot, "decisions", "ranktopic-gamma", { tags: ["z"] });

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "ranktopic",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    // All three survive — triage drops nothing despite plan_context_top_k=1.
    expect(result.items).toHaveLength(3);
    const slugs = result.items.map((i) => i.path).sort();
    expect(slugs.some((p) => p.includes("ranktopic-alpha"))).toBe(true);
    expect(slugs.some((p) => p.includes("ranktopic-beta"))).toBe(true);
    expect(slugs.some((p) => p.includes("ranktopic-gamma"))).toBe(true);
  });

  it("triage_search_applies_no_relevance_floor_keeps_weakly_ranked_matches", async () => {
    const projectRoot = await createTempProject();
    // Pin the recall ratio-to-top floor aggressively (0.9): under RECALL semantics
    // any match scoring < 0.9 × top would be cut. Triage must ignore the floor.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify(
        { required_stores: [{ id: "team" }], active_write_store: "team", recall_relevance_ratio: 0.9 },
        null,
        2,
      )}\n`,
    );
    // "strong" has the query term ("embedding") in its summary → high BM25 score.
    // "weak" matches the substring GATE only via filename ("embedding-weak") with a
    // DISJOINT summary → BM25 score 0, far below 0.9 × top. Recall would drop it;
    // triage must keep it.
    await seedPendingFile(projectRoot, "decisions", "embedding-strong", {
      summary: "vector embedding semantic retrieval scoring tokenization",
    });
    await seedPendingFile(projectRoot, "decisions", "embedding-weak", {
      summary: "git lifecycle archive cadence deprecation nudge",
    });

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "embedding",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    // BOTH survive — the weak (BM25-0) match is not floored out.
    expect(result.items).toHaveLength(2);
    const paths = result.items.map((i) => i.path);
    expect(paths.some((p) => p.includes("embedding-strong"))).toBe(true);
    expect(paths.some((p) => p.includes("embedding-weak"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TASK-009: Critical path-traversal sandboxing (Gemini review fix)
  // -------------------------------------------------------------------------

  it("approve_rejects_path_traversal_via_dot_dot", async () => {
    const projectRoot = await createTempProject();
    // Plant a real file outside the knowledge tree; approve must NOT touch it.
    const outsideRel = "secret-outside-knowledge.md";
    await writeFile(
      join(projectRoot, outsideRel),
      "---\ntype: decisions\nlayer: team\n---\nsecret\n",
      "utf8",
    );

    // Use a store path that resolves outside knowledge/pending via ../
    const evil = join(storeKnowledgeDir("team", "pending", "decisions"), "..", "..", "..", outsideRel);
    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [evil],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(0);

    // The outside file is untouched.
    expect(existsSync(join(projectRoot, outsideRel))).toBe(true);

    // A failure event captures the rejection.
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(1);
    expect((failedEvents.events[0] as { reason: string }).reason).toMatch(
      /escapes store knowledge root|outside the resolved store knowledge\/pending/u,
    );
  });

  it("modify_rejects_path_traversal_via_dot_dot", async () => {
    const projectRoot = await createTempProject();
    // resolveModifyTarget should return null for traversal paths → modify
    // throws "modify target not found".
    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: "../../../etc/passwd",
        changes: { maturity: "verified" },
      }),
    ).rejects.toThrow(/modify target not found/u);
  });

  it("approve_rejects_empty_path", async () => {
    const projectRoot = await createTempProject();
    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [""],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(0);
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(1);
    expect((failedEvents.events[0] as { reason: string }).reason).toMatch(
      /path is empty/u,
    );
  });

  it("approve_rejects_path_outside_pending_but_inside_knowledge", async () => {
    // A canonical store path is inside the sandbox but not under
    // knowledge/pending/. approve must reject it.
    const projectRoot = await createTempProject();
    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [storeKnowledgeDir("team", "decisions", "foo.md")],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(0);
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(1);
    expect((failedEvents.events[0] as { reason: string }).reason).toMatch(
      /outside the resolved store knowledge\/pending\/ roots/u,
    );
  });

  it("modify_rejects_personal_root_traversal_via_tilde_dot_dot", async () => {
    // `~/../../etc/passwd` resolves above FABRIC_HOME → sandbox rejects → modify
    // returns null target → throws "modify target not found".
    const projectRoot = await createTempProject();
    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: "~/../../etc/passwd",
        changes: { maturity: "verified" },
      }),
    ).rejects.toThrow(/modify target not found/u);
  });

  it("approve_rejects_personal_root_traversal_above_pending", async () => {
    // Legacy `~/...` knowledge paths are retired; store entries must be passed
    // as absolute store paths returned by list/search.
    const projectRoot = await createTempProject();
    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: ["~/../../etc/passwd"],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(0);
    const failedEvents = await readEventLedger(projectRoot, {
      event_type: "knowledge_promote_failed",
    });
    expect(failedEvents.events).toHaveLength(1);
    expect((failedEvents.events[0] as { reason: string }).reason).toMatch(
      /legacy personal knowledge root is retired/u,
    );
  });

  it("frontmatter_parser_round_trips_title_and_summary_via_search", async () => {
    // Emit a title + summary via raw-write so the parser exercises the
    // case "title" / case "summary" / case "tags" branches that aren't hit by
    // seedPendingFile (which omits title/summary).
    const projectRoot = await createTempProject();
    const dir = storeKnowledgeDir("team", "pending", "decisions");
    await mkdir(dir, { recursive: true });
    const fm = [
      "---",
      "type: decisions",
      "maturity: draft",
      "layer: team",
      "title: Hello Title",
      "summary: A short summary of this entry.",
      "tags: [coverage, parser]",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    await writeFile(join(dir, "with-title.md"), fm, "utf8");

    const result = await reviewPending(projectRoot, {
      action: "search",
      query: "hello title",
      filters: undefined,
    });
    if (result.action !== "search") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Hello Title");
    expect(result.items[0].summary).toBe("A short summary of this entry.");
    expect(result.items[0].tags).toEqual(["coverage", "parser"]);
  });

  // -------------------------------------------------------------------------
  // rc.4 TASK-006 fix (a): multiline-safe quoteIfNeeded
  //
  // The helper is internal so tests exercise it through the modify action
  // which is the only public surface that pipes user-supplied scalars into
  // frontmatter via quoteIfNeeded.
  // -------------------------------------------------------------------------

  it("modify_with_multiline_title_writes_single_line_yaml_frontmatter", async () => {
    const projectRoot = await createTempProject();
    const relPath = await seedPendingFile(projectRoot, "decisions", "multiline-title");

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: relPath,
      changes: { title: "line one\nline two\nline three" },
    });
    expect(result.action).toBe("modify");

    const written = await readFile(relPath, "utf8");
    // Frontmatter block must remain a clean ---...--- envelope; the embedded
    // newline must be JSON-escaped to \n inside a quoted scalar (no raw
    // newline leaking out of the title line).
    const fmMatch = /^---\n([\s\S]*?)\n---/u.exec(written);
    expect(fmMatch).not.toBeNull();
    const block = fmMatch![1]!;
    const titleLine = block.split("\n").find((l) => l.startsWith("title:"));
    expect(titleLine).toBeDefined();
    // Single line: must contain the JSON-escaped representation, not a raw \n.
    expect(titleLine).toContain("\\n");
    expect(titleLine).not.toMatch(/\n/u);
    // Round-trip: searching by the first segment of the title must find the
    // entry (proves the body+frontmatter remain parseable post-rewrite).
    const search = await reviewPending(projectRoot, {
      action: "search",
      query: "line one",
      filters: undefined,
    });
    if (search.action !== "search") throw new Error("unreachable");
    expect(search.items.length).toBeGreaterThan(0);
  });

  it("modify_with_carriage_return_in_summary_escapes_safely", async () => {
    const projectRoot = await createTempProject();
    const relPath = await seedPendingFile(projectRoot, "decisions", "cr-summary");

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: relPath,
      changes: { summary: "alpha\r\nbeta" },
    });
    expect(result.action).toBe("modify");

    const written = await readFile(relPath, "utf8");
    const fmMatch = /^---\n([\s\S]*?)\n---/u.exec(written);
    expect(fmMatch).not.toBeNull();
    const block = fmMatch![1]!;
    const summaryLine = block.split("\n").find((l) => l.startsWith("summary:"));
    expect(summaryLine).toBeDefined();
    // No raw CR or LF inside the value — JSON.stringify escapes both.
    expect(summaryLine).not.toMatch(/\r/u);
    expect(summaryLine).toContain("\\r");
    expect(summaryLine).toContain("\\n");
  });

  // -------------------------------------------------------------------------
  // rc.4 TASK-006 fix (c): created_after filter for list / search
  // -------------------------------------------------------------------------

  it("list_with_created_after_excludes_older_entries", async () => {
    const projectRoot = await createTempProject();

    // Seed two entries with explicit created_at — older + newer relative to
    // a fixed threshold. seedPendingFile uses Date.now() so we hand-roll
    // these to control timestamps.
    const dir = storeKnowledgeDir("team", "pending", "decisions");
    await mkdir(dir, { recursive: true });
    const oldEntry = [
      "---",
      "type: decisions",
      "maturity: draft",
      "layer: team",
      "created_at: 2026-01-01T00:00:00.000Z",
      "source_session: sess-old",
      "tags: []",
      "x-fabric-idempotency-key: sha256:000",
      "---",
      "",
      "Body.",
    ].join("\n");
    const newEntry = [
      "---",
      "type: decisions",
      "maturity: draft",
      "layer: team",
      "created_at: 2026-06-01T00:00:00.000Z",
      "source_session: sess-new",
      "tags: []",
      "x-fabric-idempotency-key: sha256:111",
      "---",
      "",
      "Body.",
    ].join("\n");
    await writeFile(join(dir, "old.md"), oldEntry, "utf8");
    await writeFile(join(dir, "new.md"), newEntry, "utf8");

    // Threshold between the two timestamps.
    const result = await reviewPending(projectRoot, {
      action: "list",
      filters: { created_after: "2026-03-01T00:00:00.000Z" },
    });
    if (result.action !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(toPosixPath(result.items[0].pending_path)).toContain(
      "knowledge/pending/decisions/new.md",
    );
  });

  it("search_with_created_after_filters_older_entries", async () => {
    const projectRoot = await createTempProject();
    const dir = storeKnowledgeDir("team", "pending", "decisions");
    await mkdir(dir, { recursive: true });
    for (const [name, ts] of [
      ["before.md", "2026-01-15T12:00:00.000Z"],
      ["after.md", "2026-04-15T12:00:00.000Z"],
    ] as const) {
      const fm = [
        "---",
        "type: decisions",
        "maturity: draft",
        "layer: team",
        `created_at: ${ts}`,
        "source_session: sess-x",
        "tags: []",
        "title: shared keyword",
        "---",
        "",
        "Body.",
      ].join("\n");
      await writeFile(join(dir, name), fm, "utf8");
    }

    // Without filter: both visible.
    const all = await reviewPending(projectRoot, {
      action: "search",
      query: "shared keyword",
      filters: undefined,
    });
    if (all.action !== "search") throw new Error("unreachable");
    expect(all.items).toHaveLength(2);

    // With threshold: only newer entry visible.
    const filtered = await reviewPending(projectRoot, {
      action: "search",
      query: "shared keyword",
      filters: { created_after: "2026-03-01T00:00:00.000Z" },
    });
    if (filtered.action !== "search") throw new Error("unreachable");
    expect(filtered.items).toHaveLength(1);
    expect(toPosixPath(filtered.items[0].path)).toContain(
      "knowledge/pending/decisions/after.md",
    );
  });

  // -------------------------------------------------------------------------
  // rc.5 TASK-008 (B1): dual pending root — team vs personal
  //
  // list enumerates BOTH workspace pending and home pending, tagging each
  // entry with its origin. approve accepts personal pending paths and
  // routes the canonical write to the correct layer root.
  // -------------------------------------------------------------------------

  async function seedPersonalPendingFile(
    type: "decisions" | "guidelines" | "pitfalls" | "models" | "processes",
    slug: string,
    options: { layer?: "team" | "personal"; tags?: string[] } = {},
  ): Promise<{ relPath: string; absPath: string }> {
    // v2.2 全砍: personal pending lives in the PERSONAL store (no dual-root).
    const dir = storeKnowledgeDir("personal", "pending", type);
    await mkdir(dir, { recursive: true });
    const layer = options.layer ?? "personal";
    const tags = options.tags ?? [];
    const tagFlow = tags.length === 0 ? "[]" : `[${tags.join(", ")}]`;
    const fm = [
      "---",
      `type: ${type}`,
      "maturity: draft",
      `layer: ${layer}`,
      `created_at: ${new Date().toISOString()}`,
      "source_session: sess-personal-seed",
      `tags: ${tagFlow}`,
      "x-fabric-idempotency-key: sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "---",
      "",
      "## Summary",
      "",
      "Personal pending body.",
      "",
    ].join("\n");
    const absPath = join(dir, `${slug}.md`);
    await writeFile(absPath, fm, "utf8");
    // Store entries are referenced by absolute path (what list reports + approve
    // accepts) — there is no `~/` dual-root form anymore.
    return { relPath: absPath, absPath };
  }

  it("test_review_list_dual_root_merge", async () => {
    // Seed one entry in workspace pending and one in home pending.
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "team-side", { layer: "team" });
    const personal = await seedPersonalPendingFile("decisions", "personal-side", {
      layer: "personal",
    });

    const result = await reviewPending(projectRoot, { action: "list", filters: undefined });
    if (result.action !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(2);

    const byOrigin = new Map(result.items.map((item) => [item.origin, item]));
    const teamItem = byOrigin.get("team");
    const personalItem = byOrigin.get("personal");
    expect(teamItem).toBeDefined();
    expect(personalItem).toBeDefined();

    expect(toPosixPath(teamItem!.pending_path)).toContain(
      "knowledge/pending/decisions/team-side.md",
    );
    expect(teamItem!.layer).toBe("team");
    expect(teamItem!.origin).toBe("team");

    expect(personalItem!.pending_path).toBe(personal.relPath);
    expect(personalItem!.layer).toBe("personal");
    expect(personalItem!.origin).toBe("personal");
  });

  it("list_with_layer_filter_personal_returns_only_personal_origin", async () => {
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "team-only", { layer: "team" });
    await seedPersonalPendingFile("decisions", "personal-only", { layer: "personal" });

    const result = await reviewPending(projectRoot, {
      action: "list",
      filters: { layer: "personal" },
    });
    if (result.action !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].origin).toBe("personal");
    expect(result.items[0].pending_path).toContain(TEST_PERSONAL_UUID);
  });

  it("list_skips_missing_personal_pending_root_silently", async () => {
    // Default beforeEach creates an empty FABRIC_HOME tempdir; with no
    // ~/.fabric/knowledge/pending tree, listPending should not throw and
    // simply skip that source. Only the team entry remains.
    const projectRoot = await createTempProject();
    await seedPendingFile(projectRoot, "decisions", "only-team");
    const result = await reviewPending(projectRoot, { action: "list", filters: undefined });
    if (result.action !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].origin).toBe("team");
  });

  it("test_extract_approve_personal_path_roundtrip", async () => {
    // End-to-end: a personal pending entry can be approved via its `~/...`
    // path and the canonical file lands in ~/.fabric/knowledge/<type>/.
    const projectRoot = await createTempProject();
    const personal = await seedPersonalPendingFile("decisions", "personal-approve", {
      layer: "personal",
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [personal.relPath],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].stable_id).toMatch(/^KP-DEC-\d{4}$/u);

    // Pending file removed from the personal root.
    expect(existsSync(personal.absPath)).toBe(false);

    // Canonical file lives in the PERSONAL store, NOT the team store.
    const canonicalAbs = storeKnowledgeDir(
      "personal",
      "decisions",
      `${result.approved[0].stable_id}--personal-approve.md`,
    );
    expect(existsSync(canonicalAbs)).toBe(true);

    const teamCanonical = storeKnowledgeDir(
      "team",
      "decisions",
      `${result.approved[0].stable_id}--personal-approve.md`,
    );
    expect(existsSync(teamCanonical)).toBe(false);
  });

  it("approve_team_pending_with_personal_frontmatter_routes_to_personal_canonical", async () => {
    // Source lives in workspace pending root but frontmatter declares
    // layer=personal. approve should write the canonical entry into
    // ~/.fabric/knowledge/<type>/ (per fm.layer) while the source removal
    // still goes through `git rm` (source origin = team).
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "guidelines", "boundary-flip", {
      layer: "personal",
    });

    const result = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (result.action !== "approve") throw new Error("unreachable");
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].stable_id).toMatch(/^KP-GLD-\d{4}$/u);

    // Pending file in workspace is gone.
    expect(existsSync(pendingPath)).toBe(false);

    // Canonical destination is the PERSONAL store (per fm.layer).
    const canonicalAbs = storeKnowledgeDir(
      "personal",
      "guidelines",
      `${result.approved[0].stable_id}--boundary-flip.md`,
    );
    expect(existsSync(canonicalAbs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// v2.2 C1 — review-confirmation stamp + verified→proven 0-dismiss gate
// (processes/maturity-promotion-rubric-v1). Producer side: review.ts stamps
// last_review_confirmed_at at approve/modify, and refuses verified→proven when
// an unresolved dismissed cite is on record.
// ---------------------------------------------------------------------------

const LAST_REVIEW_LINE = /^last_review_confirmed_at:\s*"?([^"\n]+?)"?\s*$/mu;

async function dismissCite(projectRoot: string, ts: number, id: string, tag: "applied" | "dismissed"): Promise<void> {
  await appendEventLedgerEvent(projectRoot, {
    event_type: "assistant_turn_observed",
    ts,
    kb_line_raw: `KB: ${id} [${tag}]`,
    cite_ids: [id],
    cite_tags: [tag],
    cite_commitments: [],
    turn_id: `turn-${ts}`,
    timestamp: new Date(ts).toISOString(),
  });
}

describe("review C1 — review-confirmation stamp", () => {
  it("approve stamps last_review_confirmed_at on the promoted entry, and the broad recheck lint reads it (round-trip)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "stamped-on-approve");

    const result = await reviewKnowledge(projectRoot, { action: "approve", pending_paths: [pendingPath] });
    if (result.action !== "approve") throw new Error("unreachable");
    const stableId = result.approved[0].stable_id;
    const canonicalPath = storeKnowledgeDir("team", "decisions", `${stableId}--stamped-on-approve.md`);
    const content = await readFile(canonicalPath, "utf8");

    const stamped = LAST_REVIEW_LINE.exec(content)?.[1];
    expect(stamped).toBeDefined();
    const stampedMs = Date.parse(stamped!);
    expect(Number.isNaN(stampedMs)).toBe(false);

    // Consumer round-trip: pushing `now` past the threshold surfaces THIS entry
    // for recheck — proving the field the producer wrote is exactly what the
    // lint reads (no false-green from a name mismatch, KT-PIT-0014). The seeded
    // entry has no relevance_scope → defaults broad → in scope for the lint.
    const fresh = await inspectStoreBroadReviewRecheck(projectRoot, stampedMs, 180);
    expect(fresh.candidates).toEqual([]); // just confirmed → not yet due.
    const future = stampedMs + 200 * 24 * 60 * 60 * 1000;
    const due = await inspectStoreBroadReviewRecheck(projectRoot, future, 180);
    expect(due.candidates.map((c) => c.stable_id)).toContain(`team:${stableId}`);
    expect(due.candidates.find((c) => c.stable_id === `team:${stableId}`)?.clock_source).toBe("review");
  });

  it("modify stamps last_review_confirmed_at (every review touch re-confirms)", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = await seedPendingFile(projectRoot, "decisions", "stamped-on-modify");

    await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: pendingPath,
      changes: { tags: ["touched"] },
    });
    const content = await readFile(pendingPath, "utf8");
    const stamped = LAST_REVIEW_LINE.exec(content)?.[1];
    expect(stamped).toBeDefined();
    expect(Number.isNaN(Date.parse(stamped!))).toBe(false);
  });
});

describe("review C1 — verified→proven 0-dismiss gate", () => {
  // Approve a pending entry, then bring it to maturity=verified in place, and
  // return its canonical path + stable_id.
  async function approveThenVerify(projectRoot: string, slug: string): Promise<{ id: string; path: string }> {
    const pendingPath = await seedPendingFile(projectRoot, "decisions", slug);
    const approved = await reviewKnowledge(projectRoot, { action: "approve", pending_paths: [pendingPath] });
    if (approved.action !== "approve") throw new Error("unreachable");
    const id = approved.approved[0].stable_id;
    const path = storeKnowledgeDir("team", "decisions", `${id}--${slug}.md`);
    await reviewKnowledge(projectRoot, { action: "modify", pending_path: path, changes: { maturity: "verified" } });
    return { id, path };
  }

  it("BLOCKS verified→proven when an unresolved dismissed cite is on record", async () => {
    const projectRoot = await createTempProject();
    const { id, path } = await approveThenVerify(projectRoot, "gated-by-dismissal");
    await dismissCite(projectRoot, 1000, id, "dismissed");

    await expect(
      reviewKnowledge(projectRoot, { action: "modify", pending_path: path, changes: { maturity: "proven" } }),
    ).rejects.toThrow(/0 dismiss|unresolved dismissed/u);

    // The block is a hard-fail BEFORE the write — maturity stays verified.
    const content = await readFile(path, "utf8");
    expect(content).toMatch(/^maturity: verified$/mu);
  });

  it("ALLOWS verified→proven once a later applied cite re-affirms the entry", async () => {
    const projectRoot = await createTempProject();
    const { id, path } = await approveThenVerify(projectRoot, "ungated-after-reaffirm");
    await dismissCite(projectRoot, 1000, id, "dismissed");
    await dismissCite(projectRoot, 2000, id, "applied"); // re-affirm clears the objection.

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: path,
      changes: { maturity: "proven" },
    });
    expect(result.action).toBe("modify");
    const content = await readFile(path, "utf8");
    expect(content).toMatch(/^maturity: proven$/mu);
  });

  it("ALLOWS verified→proven when the entry was never dismissed", async () => {
    const projectRoot = await createTempProject();
    const { path } = await approveThenVerify(projectRoot, "ungated-clean");

    const result = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: path,
      changes: { maturity: "proven" },
    });
    expect(result.action).toBe("modify");
    const content = await readFile(path, "utf8");
    expect(content).toMatch(/^maturity: proven$/mu);
  });
});

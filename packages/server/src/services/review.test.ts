import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { reviewKnowledge } from "./review.js";

const tempDirs: string[] = [];

afterEach(async () => {
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

  it("not_yet_implemented_actions_throw_with_task_002_marker", async () => {
    const projectRoot = await createTempProject();

    await expect(
      reviewKnowledge(projectRoot, {
        action: "reject",
        pending_paths: [".fabric/knowledge/pending/decisions/x.md"],
        reason: "stale",
      }),
    ).rejects.toThrow(/TASK-002/u);

    await expect(
      reviewKnowledge(projectRoot, {
        action: "modify",
        pending_path: ".fabric/knowledge/pending/decisions/x.md",
        changes: { layer: "personal" },
      }),
    ).rejects.toThrow(/TASK-002/u);

    await expect(
      reviewKnowledge(projectRoot, {
        action: "search",
        query: "anything",
        filters: undefined,
      }),
    ).rejects.toThrow(/TASK-002/u);

    await expect(
      reviewKnowledge(projectRoot, {
        action: "defer",
        pending_paths: [".fabric/knowledge/pending/decisions/x.md"],
      }),
    ).rejects.toThrow(/TASK-002/u);
  });
});
